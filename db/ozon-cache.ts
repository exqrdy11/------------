import { env } from "cloudflare:workers";

type D1RunResult = {
  meta?: { changes?: number };
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<D1RunResult>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

export type OzonCacheRow = {
  cache_key: string;
  payload: string | null;
  refreshed_at: string | null;
  refreshing_until: string | null;
  last_error: string | null;
};

function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  return db;
}

export async function ensureOzonCache() {
  await database().prepare(`
    CREATE TABLE IF NOT EXISTS ozon_api_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT,
      refreshed_at TEXT,
      refreshing_until TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function readOzonCache(cacheKey: string) {
  await ensureOzonCache();
  return database()
    .prepare(`SELECT cache_key, payload, refreshed_at, refreshing_until, last_error
      FROM ozon_api_cache WHERE cache_key = ?`)
    .bind(cacheKey)
    .first<OzonCacheRow>();
}

export async function acquireOzonRefresh(cacheKey: string, lockSeconds = 120) {
  await ensureOzonCache();
  const modifier = `+${Math.max(30, Math.min(lockSeconds, 300))} seconds`;
  const result = await database().prepare(`
    INSERT INTO ozon_api_cache (cache_key, refreshing_until, updated_at)
    VALUES (?, datetime('now', ?), CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      refreshing_until = excluded.refreshing_until,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE ozon_api_cache.refreshing_until IS NULL
       OR ozon_api_cache.refreshing_until <= CURRENT_TIMESTAMP
  `).bind(cacheKey, modifier).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function saveOzonCache(cacheKey: string, payload: unknown) {
  await ensureOzonCache();
  await database().prepare(`
    INSERT INTO ozon_api_cache
      (cache_key, payload, refreshed_at, refreshing_until, last_error, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      refreshed_at = CURRENT_TIMESTAMP,
      refreshing_until = NULL,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).bind(cacheKey, JSON.stringify(payload)).run();
}

export async function failOzonRefresh(cacheKey: string, error: string) {
  await ensureOzonCache();
  await database().prepare(`
    UPDATE ozon_api_cache
    SET refreshing_until = datetime('now', '+2 minutes'), last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE cache_key = ?
  `).bind(error.slice(0, 500), cacheKey).run();
}

export function cacheAgeMs(row: OzonCacheRow | null) {
  if (!row?.refreshed_at) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(row.refreshed_at.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? Date.now() - parsed : Number.POSITIVE_INFINITY;
}

export function parseCachedPayload<T>(row: OzonCacheRow | null) {
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

