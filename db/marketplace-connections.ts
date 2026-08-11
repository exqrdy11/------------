import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";
import type { Marketplace } from "./marketplace-credentials";

const createMarketplaceConnectionControlsTableSql = `
  CREATE TABLE IF NOT EXISTS marketplace_connection_controls (
    cabinet_id TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    is_disabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, marketplace)
  )
`;

let initializePromise: Promise<D1Database> | null = null;

async function getConnectionDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.prepare(createMarketplaceConnectionControlsTableSql).run();
      return d1;
    })();
  }
  return initializePromise;
}

export async function isMarketplaceDisabled(cabinetId: CabinetId, marketplace: Marketplace) {
  const d1 = await getConnectionDb();
  const row = await d1.prepare(
    "SELECT is_disabled FROM marketplace_connection_controls WHERE cabinet_id = ? AND marketplace = ?",
  ).bind(cabinetId, marketplace).first<{ is_disabled: number }>();
  return row?.is_disabled === 1;
}

export async function disableMarketplace(cabinetId: CabinetId, marketplace: Marketplace) {
  const d1 = await getConnectionDb();
  await d1.batch([
    d1.prepare("DELETE FROM marketplace_credentials WHERE cabinet_id = ? AND marketplace = ?").bind(cabinetId, marketplace),
    d1.prepare(`
      INSERT INTO marketplace_connection_controls (cabinet_id, marketplace, is_disabled, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(cabinet_id, marketplace) DO UPDATE SET
        is_disabled = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(cabinetId, marketplace),
  ]);
}
