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

export type FfDailyMetricFilter = {
  from?: string;
  to?: string;
  warehouseId?: string;
  productKey?: string;
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
      await d1.prepare(createFfDailyMetricsTableSql).run();
      return d1;
    })();
  }
  return initializePromise;
}

export async function replaceFfDailyMetrics(input: { cabinetId: CabinetId; metrics: DailyFfMetric[] }) {
  const metrics = normalizeFfDailyMetrics(input.metrics);
  const d1 = await getFfPlanningDb();
  await d1.prepare("DELETE FROM ff_daily_metrics WHERE cabinet_id = ?").bind(input.cabinetId).run();
  const updatedAt = new Date().toISOString();
  for (let index = 0; index < metrics.length; index += 100) {
    await d1.batch(metrics.slice(index, index + 100).map((metric) => d1.prepare(`
      INSERT INTO ff_daily_metrics (cabinet_id, metric_date, warehouse_id, product_key, nm_id, sku, demand, sold, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(input.cabinetId, metric.date, metric.warehouseId, metric.productKey, metric.nmId, metric.sku, metric.demand, metric.sold, updatedAt)));
  }
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
