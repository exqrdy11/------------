import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";
import { targetPriceSnapshot, type TargetPriceSnapshotRow } from "@/lib/target-price-snapshot";

export type TargetPriceCompetitor = {
  nmId: number;
  price: number | null;
  source: string | null;
  name: string | null;
  updatedAt: string | null;
  error: string | null;
};

export type TargetPriceRow = Omit<TargetPriceSnapshotRow, "competitors"> & {
  competitors: TargetPriceCompetitor[];
  refreshedAt: string | null;
  refreshError: string | null;
};

const createTargetPricesTableSql = `
  CREATE TABLE IF NOT EXISTS target_price_products (
    cabinet_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    sku TEXT NOT NULL,
    nm_id INTEGER,
    orders INTEGER NOT NULL DEFAULT 0,
    price_before_spp REAL,
    spp_percent REAL,
    current_price REAL,
    updated_at TEXT,
    search_query TEXT,
    competitors_json TEXT NOT NULL DEFAULT '[]',
    candidate_nm_id INTEGER,
    score REAL,
    reason TEXT,
    source_status TEXT,
    refreshed_at TEXT,
    refresh_error TEXT,
    PRIMARY KEY (cabinet_id, product_key)
  )
`;
const createTargetPricesIndexSql = "CREATE INDEX IF NOT EXISTS target_price_products_cabinet_orders ON target_price_products (cabinet_id, orders DESC)";
const createTargetPriceCandidatesTableSql = `
  CREATE TABLE IF NOT EXISTS target_price_candidate_snapshots (
    cabinet_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    query TEXT NOT NULL,
    candidates_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT,
    warning TEXT,
    PRIMARY KEY (cabinet_id, product_key)
  )
`;
const createTargetPriceRefreshLocksTableSql = `
  CREATE TABLE IF NOT EXISTS target_price_refresh_locks (
    cabinet_id TEXT NOT NULL,
    refresh_kind TEXT NOT NULL,
    available_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (cabinet_id, refresh_kind)
  )
`;

type TargetPriceDbRow = {
  product_key: string;
  sku: string;
  nm_id: number | null;
  orders: number;
  price_before_spp: number | null;
  spp_percent: number | null;
  current_price: number | null;
  updated_at: string | null;
  search_query: string | null;
  competitors_json: string;
  candidate_nm_id: number | null;
  score: number | null;
  reason: string | null;
  source_status: string | null;
  refreshed_at: string | null;
  refresh_error: string | null;
};

type TargetPriceCandidateDbRow = {
  query: string;
  candidates_json: string;
  updated_at: string | null;
  warning: string | null;
};

export type TargetPriceCandidateSnapshot = {
  query: string;
  candidates: TargetPriceCompetitor[];
  updatedAt: string | null;
  warning: string | null;
};

export type TargetPriceRefreshKind = "prices" | "competitors";

let initializePromise: Promise<D1Database> | null = null;

function productKey(row: Pick<TargetPriceSnapshotRow, "sku" | "nmId">) {
  return row.nmId ? `nm:${row.nmId}` : `sku:${row.sku.trim().toLocaleUpperCase("ru-RU")}`;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCompetitors(value: string): TargetPriceCompetitor[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): TargetPriceCompetitor[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const nmId = asNumber(record.nmId);
      if (!nmId) return [];
      return [{
        nmId,
        price: asNumber(record.price),
        source: typeof record.source === "string" ? record.source : null,
        name: typeof record.name === "string" ? record.name : null,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
        error: typeof record.error === "string" ? record.error : null,
      }];
    });
  } catch {
    return [];
  }
}

function toTargetPriceRow(row: TargetPriceDbRow): TargetPriceRow {
  return {
    sku: row.sku,
    nmId: row.nm_id,
    orders: row.orders ?? 0,
    priceBeforeSpp: row.price_before_spp,
    sppPercent: row.spp_percent,
    currentPrice: row.current_price,
    updatedAt: row.updated_at,
    searchQuery: row.search_query,
    competitors: parseCompetitors(row.competitors_json),
    candidateNmId: row.candidate_nm_id,
    score: row.score,
    reason: row.reason,
    sourceStatus: row.source_status,
    refreshedAt: row.refreshed_at,
    refreshError: row.refresh_error,
  };
}

async function getTargetPricesDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([
        d1.prepare(createTargetPricesTableSql),
        d1.prepare(createTargetPricesIndexSql),
        d1.prepare(createTargetPriceCandidatesTableSql),
        d1.prepare(createTargetPriceRefreshLocksTableSql),
      ]);
      return d1;
    })();
  }
  return initializePromise;
}

async function seedSnapshot(cabinetId: CabinetId) {
  const d1 = await getTargetPricesDb();
  const existing = await d1.prepare("SELECT COUNT(*) AS count FROM target_price_products WHERE cabinet_id = ?").bind(cabinetId).first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;
  const statement = d1.prepare(`
    INSERT OR IGNORE INTO target_price_products (
      cabinet_id, product_key, sku, nm_id, orders, price_before_spp, spp_percent,
      current_price, updated_at, search_query, competitors_json, candidate_nm_id,
      score, reason, source_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await d1.batch(targetPriceSnapshot.map((row) => statement.bind(
    cabinetId,
    productKey(row),
    row.sku,
    row.nmId,
    row.orders,
    row.priceBeforeSpp,
    row.sppPercent,
    row.currentPrice,
    row.updatedAt,
    row.searchQuery,
    JSON.stringify(row.competitors.map((competitor) => ({ ...competitor, name: null, updatedAt: null, error: null }))),
    row.candidateNmId,
    row.score,
    row.reason,
    row.sourceStatus,
  )));
}

export async function listTargetPrices(cabinetId: CabinetId) {
  await seedSnapshot(cabinetId);
  const d1 = await getTargetPricesDb();
  const result = await d1.prepare(`
    SELECT product_key, sku, nm_id, orders, price_before_spp, spp_percent, current_price,
      updated_at, search_query, competitors_json, candidate_nm_id, score, reason,
      source_status, refreshed_at, refresh_error
    FROM target_price_products
    WHERE cabinet_id = ?
    ORDER BY orders DESC, sku COLLATE NOCASE ASC
  `).bind(cabinetId).all<TargetPriceDbRow>();
  return (result.results ?? []).map(toTargetPriceRow);
}

export async function saveTargetPrices(cabinetId: CabinetId, rows: TargetPriceRow[]) {
  const d1 = await getTargetPricesDb();
  const statement = d1.prepare(`
    INSERT INTO target_price_products (
      cabinet_id, product_key, sku, nm_id, orders, price_before_spp, spp_percent,
      current_price, updated_at, search_query, competitors_json, candidate_nm_id,
      score, reason, source_status, refreshed_at, refresh_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cabinet_id, product_key) DO UPDATE SET
      sku = excluded.sku,
      nm_id = excluded.nm_id,
      orders = excluded.orders,
      price_before_spp = excluded.price_before_spp,
      spp_percent = excluded.spp_percent,
      current_price = excluded.current_price,
      updated_at = excluded.updated_at,
      search_query = excluded.search_query,
      competitors_json = excluded.competitors_json,
      candidate_nm_id = excluded.candidate_nm_id,
      score = excluded.score,
      reason = excluded.reason,
      source_status = excluded.source_status,
      refreshed_at = excluded.refreshed_at,
      refresh_error = excluded.refresh_error
  `);
  await d1.batch(rows.map((row) => statement.bind(
    cabinetId,
    productKey(row),
    row.sku,
    row.nmId,
    row.orders,
    row.priceBeforeSpp,
    row.sppPercent,
    row.currentPrice,
    row.updatedAt,
    row.searchQuery,
    JSON.stringify(row.competitors),
    row.candidateNmId,
    row.score,
    row.reason,
    row.sourceStatus,
    row.refreshedAt,
    row.refreshError,
  )));
}

export async function getTargetPriceCandidateSnapshot(cabinetId: CabinetId, row: Pick<TargetPriceRow, "sku" | "nmId">) {
  const d1 = await getTargetPricesDb();
  const snapshot = await d1.prepare(`
    SELECT query, candidates_json, updated_at, warning
    FROM target_price_candidate_snapshots
    WHERE cabinet_id = ? AND product_key = ?
  `).bind(cabinetId, productKey(row)).first<TargetPriceCandidateDbRow>();
  if (!snapshot) return null;
  return {
    query: snapshot.query,
    candidates: parseCompetitors(snapshot.candidates_json),
    updatedAt: snapshot.updated_at,
    warning: snapshot.warning,
  } satisfies TargetPriceCandidateSnapshot;
}

export async function saveTargetPriceCandidateSnapshot(cabinetId: CabinetId, row: Pick<TargetPriceRow, "sku" | "nmId">, snapshot: TargetPriceCandidateSnapshot) {
  const d1 = await getTargetPricesDb();
  await d1.prepare(`
    INSERT INTO target_price_candidate_snapshots (
      cabinet_id, product_key, query, candidates_json, updated_at, warning
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cabinet_id, product_key) DO UPDATE SET
      query = excluded.query,
      candidates_json = excluded.candidates_json,
      updated_at = excluded.updated_at,
      warning = excluded.warning
  `).bind(
    cabinetId,
    productKey(row),
    snapshot.query,
    JSON.stringify(snapshot.candidates),
    snapshot.updatedAt,
    snapshot.warning,
  ).run();
}

export async function getTargetPriceRefreshCooldown(cabinetId: CabinetId, refreshKind: TargetPriceRefreshKind) {
  const d1 = await getTargetPricesDb();
  const lock = await d1.prepare(`
    SELECT available_at
    FROM target_price_refresh_locks
    WHERE cabinet_id = ? AND refresh_kind = ?
  `).bind(cabinetId, refreshKind).first<{ available_at: string }>();
  if (!lock?.available_at || Date.parse(lock.available_at) <= Date.now()) return null;
  return lock.available_at;
}

export async function reserveTargetPriceRefresh(cabinetId: CabinetId, refreshKind: TargetPriceRefreshKind, cooldownMilliseconds = 5 * 60 * 1000) {
  const d1 = await getTargetPricesDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + cooldownMilliseconds).toISOString();
  const reserved = await d1.prepare(`
    INSERT INTO target_price_refresh_locks (
      cabinet_id, refresh_kind, available_at, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(cabinet_id, refresh_kind) DO UPDATE SET
      available_at = excluded.available_at,
      updated_at = excluded.updated_at
    WHERE target_price_refresh_locks.available_at <= ?
    RETURNING available_at
  `).bind(cabinetId, refreshKind, cooldownUntil, nowIso, nowIso).all<{ available_at: string }>();
  if (reserved.results?.length) return { reserved: true, cooldownUntil };
  return { reserved: false, cooldownUntil: await getTargetPriceRefreshCooldown(cabinetId, refreshKind) };
}
