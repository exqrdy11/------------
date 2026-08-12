import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";

const createInventorySnapshotsTableSql = `
  CREATE TABLE IF NOT EXISTS inventory_snapshots (
    cabinet_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;
const createInventoryRefreshLocksTableSql = `
  CREATE TABLE IF NOT EXISTS inventory_refresh_locks (
    cabinet_id TEXT PRIMARY KEY,
    available_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

let initializePromise: Promise<D1Database> | null = null;

async function getInventorySnapshotsDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([
        d1.prepare(createInventorySnapshotsTableSql),
        d1.prepare(createInventoryRefreshLocksTableSql),
      ]);
      return d1;
    })();
  }
  return initializePromise;
}

export async function loadInventorySnapshot<T>(cabinetId: CabinetId): Promise<T | null> {
  const d1 = await getInventorySnapshotsDb();
  const row = await d1.prepare("SELECT payload_json FROM inventory_snapshots WHERE cabinet_id = ?").bind(cabinetId).first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}

export async function saveInventorySnapshot(cabinetId: CabinetId, payload: unknown, updatedAt: string) {
  const d1 = await getInventorySnapshotsDb();
  await d1.prepare(`
    INSERT INTO inventory_snapshots (cabinet_id, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cabinet_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).bind(cabinetId, JSON.stringify(payload), updatedAt).run();
}

export async function getInventoryRefreshCooldown(cabinetId: CabinetId) {
  const d1 = await getInventorySnapshotsDb();
  const lock = await d1.prepare("SELECT available_at FROM inventory_refresh_locks WHERE cabinet_id = ?").bind(cabinetId).first<{ available_at: string }>();
  if (!lock?.available_at || Date.parse(lock.available_at) <= Date.now()) return null;
  return lock.available_at;
}

export async function reserveInventoryRefresh(cabinetId: CabinetId, cooldownMilliseconds = 5 * 60 * 1000) {
  const d1 = await getInventorySnapshotsDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + cooldownMilliseconds).toISOString();
  const reserved = await d1.prepare(`
    INSERT INTO inventory_refresh_locks (cabinet_id, available_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cabinet_id) DO UPDATE SET
      available_at = excluded.available_at,
      updated_at = excluded.updated_at
    WHERE inventory_refresh_locks.available_at <= ?
    RETURNING available_at
  `).bind(cabinetId, cooldownUntil, nowIso, nowIso).all<{ available_at: string }>();
  if (reserved.results?.length) return { reserved: true, cooldownUntil };
  return { reserved: false, cooldownUntil: await getInventoryRefreshCooldown(cabinetId) };
}

export async function releaseInventoryRefresh(cabinetId: CabinetId) {
  const d1 = await getInventorySnapshotsDb();
  await d1.prepare("DELETE FROM inventory_refresh_locks WHERE cabinet_id = ?").bind(cabinetId).run();
}
