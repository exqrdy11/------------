import type { CabinetId } from "../lib/admin-auth";
import type { DailyFfMetric } from "../lib/ff-planning-source";

export type FfDailyMetric = DailyFfMetric & { nmId: number | null };

type FfDailyMetricRow = {
  warehouse_id: string;
  product_key: string;
  nm_id: number | null;
  sku: string;
  metric_date: string;
  demand: number;
  sold: number;
};

type FfPlanningSnapshotRow = {
  cooldown_until: string | null;
  refresh_updated_at: string | null;
  warehouse_id: string | null;
  product_key: string | null;
  nm_id: number | null;
  sku: string | null;
  metric_date: string | null;
  demand: number | null;
  sold: number | null;
};

export type FfDailyMetricFilter = {
  from?: string;
  to?: string;
  warehouseId?: string;
  productKey?: string;
};

export type FfPlanningMetricSnapshot = {
  daily: FfDailyMetric[];
  cooldownUntil: string | null;
  updatedAt: string | null;
};

const createFfDailyMetricsTableSql = `
  CREATE TABLE IF NOT EXISTS ff_daily_metrics (
    cabinet_id TEXT NOT NULL DEFAULT 'metanutrix',
    metric_date TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    demand INTEGER NOT NULL DEFAULT 0 CHECK (demand >= 0),
    sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, metric_date, warehouse_id, product_key, sku)
  )
`;
const createFfPlanningRefreshesTableSql = `
  CREATE TABLE IF NOT EXISTS ff_planning_refreshes (
    cabinet_id TEXT PRIMARY KEY,
    cooldown_until TEXT,
    updated_at TEXT
  )
`;

export const FF_PLANNING_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
type PlanningDatabase = Pick<D1Database, "prepare" | "batch">;
type RefreshState = { cooldown_until: string | null; updated_at: string | null };
export type WarehousePlanningSettings = { openedAt: string | null; planningTargetDays: number };

let initializePromise: Promise<D1Database> | null = null;

function invalidDate(value: string): never {
  throw new Error(`Дата должна быть в формате YYYY-MM-DD: ${value}`);
}

export function normalizePlanningDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalidDate(value);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalidDate(value);
  return value;
}

export function normalizeOpenedAt(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return normalizePlanningDate(value);
}

export function normalizePlanningTargetDays(value: number | null | undefined): number {
  if (value == null) return 14;
  if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error("Плановый срок должен быть от 1 до 365 дней");
  return value;
}

export function mergeWarehousePlanningSettings(current: WarehousePlanningSettings, patch: { openedAt?: unknown; planningTargetDays?: unknown }): WarehousePlanningSettings {
  let openedAt = current.openedAt;
  let planningTargetDays = current.planningTargetDays;
  if (Object.hasOwn(patch, "openedAt")) {
    if (patch.openedAt != null && typeof patch.openedAt !== "string") throw new Error("Дата открытия должна быть в формате YYYY-MM-DD");
    openedAt = normalizeOpenedAt(patch.openedAt as string | null | undefined);
  }
  if (Object.hasOwn(patch, "planningTargetDays")) {
    planningTargetDays = normalizePlanningTargetDays(patch.planningTargetDays as number | null | undefined);
  }
  return { openedAt, planningTargetDays };
}

function normalizeMetricCount(value: number, field: "demand" | "sold") {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} должен быть неотрицательным числом`);
  return Math.floor(value);
}

function normalizeNmId(value: string | number | null) {
  if (value == null || value === "") return null;
  const nmId = Number(value);
  if (!Number.isInteger(nmId)) throw new Error("nmId должен быть целым числом");
  return nmId;
}

export function normalizeFfDailyMetrics(metrics: DailyFfMetric[]): FfDailyMetric[] {
  const unique = new Map<string, FfDailyMetric>();
  for (const metric of metrics) {
    const date = normalizePlanningDate(metric.date);
    const warehouseId = metric.warehouseId.trim();
    const productKey = metric.productKey.trim();
    const sku = metric.sku.trim();
    if (!warehouseId || !productKey) throw new Error("Для дневной метрики обязательны склад и товар");
    const normalized: FfDailyMetric = {
      warehouseId,
      productKey,
      nmId: normalizeNmId(metric.nmId),
      sku,
      date,
      demand: normalizeMetricCount(metric.demand, "demand"),
      sold: normalizeMetricCount(metric.sold, "sold"),
    };
    const key = `${date}\u0000${warehouseId}\u0000${productKey}\u0000${sku}`;
    const current = unique.get(key);
    if (current) {
      current.demand += normalized.demand;
      current.sold += normalized.sold;
      if (current.nmId == null || (normalized.nmId != null && normalized.nmId < current.nmId)) current.nmId = normalized.nmId;
    } else {
      unique.set(key, normalized);
    }
  }
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.warehouseId.localeCompare(right.warehouseId)
    || left.productKey.localeCompare(right.productKey)
    || left.sku.localeCompare(right.sku));
}

async function getFfPlanningDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const { getD1 } = await import("./index");
      const d1 = getD1();
      await d1.batch([d1.prepare(createFfDailyMetricsTableSql), d1.prepare(createFfPlanningRefreshesTableSql)]);
      return d1;
    })();
  }
  return initializePromise;
}

function metricInsertStatements(d1: PlanningDatabase, cabinetId: CabinetId, metrics: FfDailyMetric[], updatedAt: string) {
  return metrics.map((metric) => d1.prepare(`
    INSERT INTO ff_daily_metrics (cabinet_id, metric_date, warehouse_id, product_key, nm_id, sku, demand, sold, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(cabinetId, metric.date, metric.warehouseId, metric.productKey, metric.nmId, metric.sku, metric.demand, metric.sold, updatedAt));
}

export async function replaceFfDailyMetrics(input: { cabinetId: CabinetId; metrics: DailyFfMetric[] }) {
  const metrics = normalizeFfDailyMetrics(input.metrics);
  const d1 = await getFfPlanningDb();
  const updatedAt = new Date().toISOString();
  await d1.batch([
    d1.prepare("DELETE FROM ff_daily_metrics WHERE cabinet_id = ?").bind(input.cabinetId),
    ...metricInsertStatements(d1, input.cabinetId, metrics, updatedAt),
  ]);
}

export async function replaceFfDailyMetricsRangeInDb(d1: PlanningDatabase, input: { cabinetId: CabinetId; from: string; to: string; metrics: DailyFfMetric[] }, updatedAt = new Date().toISOString()) {
  const from = normalizePlanningDate(input.from);
  const to = normalizePlanningDate(input.to);
  if (from > to) throw new Error("Дата начала позже даты окончания");
  const metrics = normalizeFfDailyMetrics(input.metrics);
  if (metrics.some((metric) => metric.date < from || metric.date > to)) throw new Error("Дневная метрика выходит за границы обновляемого периода");
  await d1.batch([
    d1.prepare("DELETE FROM ff_daily_metrics WHERE cabinet_id = ? AND metric_date >= ? AND metric_date <= ?").bind(input.cabinetId, from, to),
    ...metricInsertStatements(d1, input.cabinetId, metrics, updatedAt),
    d1.prepare(`
      INSERT INTO ff_planning_refreshes (cabinet_id, cooldown_until, updated_at)
      VALUES (?, NULL, ?)
      ON CONFLICT(cabinet_id) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(input.cabinetId, updatedAt),
  ]);
  return updatedAt;
}

export async function replaceFfDailyMetricsRange(input: { cabinetId: CabinetId; from: string; to: string; metrics: DailyFfMetric[] }) {
  return replaceFfDailyMetricsRangeInDb(await getFfPlanningDb(), input);
}

export async function getFfPlanningRefreshState(cabinetId: CabinetId): Promise<RefreshState> {
  const d1 = await getFfPlanningDb();
  return await d1.prepare("SELECT cooldown_until, updated_at FROM ff_planning_refreshes WHERE cabinet_id = ?")
    .bind(cabinetId).first<RefreshState>() ?? { cooldown_until: null, updated_at: null };
}

export async function loadFfPlanningMetricSnapshotInDb(
  d1: PlanningDatabase,
  cabinetId: CabinetId,
  filter: FfDailyMetricFilter = {},
): Promise<FfPlanningMetricSnapshot> {
  const joinConditions = ["m.cabinet_id = c.cabinet_id", "m.updated_at = r.updated_at"];
  const values: string[] = [cabinetId];
  if (filter.from) {
    joinConditions.push("m.metric_date >= ?");
    values.push(normalizePlanningDate(filter.from));
  }
  if (filter.to) {
    joinConditions.push("m.metric_date <= ?");
    values.push(normalizePlanningDate(filter.to));
  }
  if (filter.warehouseId) {
    joinConditions.push("m.warehouse_id = ?");
    values.push(filter.warehouseId);
  }
  if (filter.productKey) {
    joinConditions.push("m.product_key = ?");
    values.push(filter.productKey);
  }
  // The generation and its rows are deliberately returned by one SQLite
  // statement. The updated_at equality also prevents rows from an older range
  // refresh from being labelled as part of the current generation.
  const result = await d1.prepare(`
    SELECT
      r.cooldown_until,
      r.updated_at AS refresh_updated_at,
      m.warehouse_id,
      m.product_key,
      m.nm_id,
      m.sku,
      m.metric_date,
      m.demand,
      m.sold
    FROM (SELECT ? AS cabinet_id) AS c
    LEFT JOIN ff_planning_refreshes AS r ON r.cabinet_id = c.cabinet_id
    LEFT JOIN ff_daily_metrics AS m ON ${joinConditions.join(" AND ")}
    ORDER BY m.metric_date, m.warehouse_id, m.product_key, m.sku
  `).bind(...values).all<FfPlanningSnapshotRow>();
  const rows = result.results ?? [];
  const state = rows[0];
  const daily = rows.flatMap((row): FfDailyMetric[] => row.metric_date && row.warehouse_id && row.product_key
    ? [{
      warehouseId: row.warehouse_id,
      productKey: row.product_key,
      nmId: row.nm_id,
      sku: row.sku ?? "",
      date: row.metric_date,
      demand: Math.max(0, Number(row.demand) || 0),
      sold: Math.max(0, Number(row.sold) || 0),
    }]
    : []);
  return {
    daily,
    cooldownUntil: state?.cooldown_until ?? null,
    updatedAt: state?.refresh_updated_at ?? null,
  };
}

export async function loadFfPlanningMetricSnapshot(cabinetId: CabinetId, filter: FfDailyMetricFilter = {}) {
  return loadFfPlanningMetricSnapshotInDb(await getFfPlanningDb(), cabinetId, filter);
}

export async function reserveFfPlanningRefreshInDb(d1: PlanningDatabase, cabinetId: CabinetId, now = new Date()) {
  await d1.prepare("INSERT OR IGNORE INTO ff_planning_refreshes (cabinet_id, cooldown_until, updated_at) VALUES (?, NULL, NULL)").bind(cabinetId).run();
  const cooldownUntil = new Date(now.getTime() + FF_PLANNING_REFRESH_COOLDOWN_MS).toISOString();
  const result = await d1.prepare(`
    UPDATE ff_planning_refreshes
    SET cooldown_until = ?
    WHERE cabinet_id = ? AND (cooldown_until IS NULL OR cooldown_until <= ?)
  `).bind(cooldownUntil, cabinetId, now.toISOString()).run();
  const state = await d1.prepare("SELECT cooldown_until, updated_at FROM ff_planning_refreshes WHERE cabinet_id = ?")
    .bind(cabinetId).first<RefreshState>() ?? { cooldown_until: null, updated_at: null };
  return { reserved: Number(result.meta?.changes ?? 0) > 0, cooldownUntil: state.cooldown_until };
}

export async function reserveFfPlanningRefresh(cabinetId: CabinetId) {
  return reserveFfPlanningRefreshInDb(await getFfPlanningDb(), cabinetId);
}

export async function listFfDailyMetrics(cabinetId: CabinetId, filter: FfDailyMetricFilter = {}): Promise<FfDailyMetric[]> {
  const conditions = ["cabinet_id = ?"];
  const values: string[] = [cabinetId];
  if (filter.from) {
    conditions.push("metric_date >= ?");
    values.push(normalizePlanningDate(filter.from));
  }
  if (filter.to) {
    conditions.push("metric_date <= ?");
    values.push(normalizePlanningDate(filter.to));
  }
  if (filter.warehouseId) {
    conditions.push("warehouse_id = ?");
    values.push(filter.warehouseId);
  }
  if (filter.productKey) {
    conditions.push("product_key = ?");
    values.push(filter.productKey);
  }
  const d1 = await getFfPlanningDb();
  const result = await d1.prepare(`
    SELECT warehouse_id, product_key, nm_id, sku, metric_date, demand, sold
    FROM ff_daily_metrics
    WHERE ${conditions.join(" AND ")}
    ORDER BY metric_date, warehouse_id, product_key, sku
  `).bind(...values).all<FfDailyMetricRow>();
  return (result.results ?? []).map((row) => ({
    warehouseId: row.warehouse_id,
    productKey: row.product_key,
    nmId: row.nm_id,
    sku: row.sku,
    date: row.metric_date,
    demand: Math.max(0, Number(row.demand) || 0),
    sold: Math.max(0, Number(row.sold) || 0),
  }));
}
