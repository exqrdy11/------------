import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";

const createInventorySnapshotsTableSql = `
  CREATE TABLE IF NOT EXISTS inventory_snapshots (
    cabinet_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

let initializePromise: Promise<D1Database> | null = null;

async function getInventorySnapshotsDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.prepare(createInventorySnapshotsTableSql).run();
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
