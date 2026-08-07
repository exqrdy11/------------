import { getD1 } from "./index";
import { cabinetIds, type CabinetId } from "@/lib/admin-auth";

export type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
};

export type FfStock = Record<string, number>;
export type FfExpiry = Record<string, string | null>;

type FfStockRow = {
  product_key: string;
  sku: string;
  location: string;
  quantity: number;
  expires_at: string | null;
};

const defaultWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10 },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20 },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30 },
];

const createStocksTableSql = `
  CREATE TABLE IF NOT EXISTS ff_stocks (
    cabinet_id TEXT NOT NULL DEFAULT 'metanutrix',
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    expires_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, product_key, location)
  )
`;
const createWarehousesTableSql = `
  CREATE TABLE IF NOT EXISTS ff_warehouses (
    cabinet_id TEXT NOT NULL DEFAULT 'metanutrix',
    id TEXT NOT NULL,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, id)
  )
`;
const createScopedStocksTableSql = createStocksTableSql.replace("IF NOT EXISTS ff_stocks", "ff_stocks_scoped");
const createScopedWarehousesTableSql = createWarehousesTableSql.replace("IF NOT EXISTS ff_warehouses", "ff_warehouses_scoped");

let initializePromise: Promise<D1Database> | null = null;

export function normalizeSku(value: string) {
  return value.trim().toLocaleUpperCase("ru-RU");
}

export function emptyFfStock(warehouses = defaultWarehouses): FfStock {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, 0]));
}

export function emptyFfExpiry(warehouses = defaultWarehouses): FfExpiry {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, null]));
}

async function getFfStockDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([d1.prepare(createStocksTableSql), d1.prepare(createWarehousesTableSql)]);

      const [stockColumns, warehouseColumns, stockDefinition] = await Promise.all([
        d1.prepare("PRAGMA table_info(ff_stocks)").all<{ name: string }>(),
        d1.prepare("PRAGMA table_info(ff_warehouses)").all<{ name: string }>(),
        d1.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ff_stocks'").first<{ sql: string }>(),
      ]);
      const stockColumnNames = new Set((stockColumns.results ?? []).map((column) => column.name));
      const warehouseColumnNames = new Set((warehouseColumns.results ?? []).map((column) => column.name));
      const stockNeedsScopeMigration = !stockColumnNames.has("cabinet_id") || stockDefinition?.sql.includes("CHECK (location IN");
      const warehouseNeedsScopeMigration = !warehouseColumnNames.has("cabinet_id");

      if (stockNeedsScopeMigration) {
        const expiresAtColumn = stockColumnNames.has("expires_at") ? "expires_at" : "NULL";
        await d1.batch([
          d1.prepare("DROP TABLE IF EXISTS ff_stocks_scoped"),
          d1.prepare(createScopedStocksTableSql),
          d1.prepare(`INSERT INTO ff_stocks_scoped (cabinet_id, product_key, nm_id, sku, location, quantity, expires_at, updated_at) SELECT 'metanutrix', product_key, nm_id, sku, location, quantity, ${expiresAtColumn}, updated_at FROM ff_stocks`),
          d1.prepare("DROP TABLE ff_stocks"),
          d1.prepare("ALTER TABLE ff_stocks_scoped RENAME TO ff_stocks"),
        ]);
      }

      if (warehouseNeedsScopeMigration) {
        await d1.batch([
          d1.prepare("DROP TABLE IF EXISTS ff_warehouses_scoped"),
          d1.prepare(createScopedWarehousesTableSql),
          d1.prepare("INSERT INTO ff_warehouses_scoped (cabinet_id, id, city, name, position, created_at) SELECT 'metanutrix', id, city, name, position, created_at FROM ff_warehouses"),
          d1.prepare("DROP TABLE ff_warehouses"),
          d1.prepare("ALTER TABLE ff_warehouses_scoped RENAME TO ff_warehouses"),
        ]);
      }

      const currentColumns = await d1.prepare("PRAGMA table_info(ff_stocks)").all<{ name: string }>();
      if (!(currentColumns.results ?? []).some((column) => column.name === "expires_at")) {
        await d1.prepare("ALTER TABLE ff_stocks ADD COLUMN expires_at TEXT").run();
      }

      await d1.batch(cabinetIds.flatMap((cabinetId) => defaultWarehouses.map((warehouse) => d1.prepare(`
        INSERT INTO ff_warehouses (cabinet_id, id, city, name, position)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cabinet_id, id) DO NOTHING
      `).bind(cabinetId, warehouse.id, warehouse.city, warehouse.name, warehouse.position))));
      return d1;
    })();
  }

  return initializePromise;
}

export async function listFfWarehouses(cabinetId: CabinetId) {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT id, city, name, position FROM ff_warehouses WHERE cabinet_id = ? ORDER BY position, city, name").bind(cabinetId).all<ManualWarehouse>();
  return result.results ?? [];
}

export async function createFfWarehouse(input: { cabinetId: CabinetId; city: string; name: string }) {
  const d1 = await getFfStockDb();
  const current = await listFfWarehouses(input.cabinetId);
  const warehouse: ManualWarehouse = {
    id: `warehouse_${crypto.randomUUID().replaceAll("-", "")}`,
    city: input.city.trim(),
    name: input.name.trim(),
    position: (current.at(-1)?.position ?? 0) + 10,
  };
  await d1.prepare("INSERT INTO ff_warehouses (cabinet_id, id, city, name, position) VALUES (?, ?, ?, ?, ?)").bind(
    input.cabinetId,
    warehouse.id,
    warehouse.city,
    warehouse.name,
    warehouse.position,
  ).run();
  return warehouse;
}

export async function updateFfWarehouse(input: ManualWarehouse & { cabinetId: CabinetId }) {
  const d1 = await getFfStockDb();
  await d1.prepare("UPDATE ff_warehouses SET city = ?, name = ? WHERE cabinet_id = ? AND id = ?").bind(input.city.trim(), input.name.trim(), input.cabinetId, input.id).run();
  return input;
}

export async function listFfStocks(cabinetId: CabinetId) {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT product_key, sku, location, quantity, expires_at FROM ff_stocks WHERE cabinet_id = ?").bind(cabinetId).all<FfStockRow>();
  const byProduct = new Map<string, FfStock>();
  const bySku = new Map<string, FfStock>();
  const expiryByProduct = new Map<string, FfExpiry>();
  const expiryBySku = new Map<string, FfExpiry>();

  for (const row of result.results ?? []) {
    const stock = byProduct.get(row.product_key) ?? emptyFfStock();
    stock[row.location] = Math.max(0, Number(row.quantity) || 0);
    byProduct.set(row.product_key, stock);
    const expiry = expiryByProduct.get(row.product_key) ?? emptyFfExpiry();
    expiry[row.location] = row.expires_at || null;
    expiryByProduct.set(row.product_key, expiry);
    const sku = normalizeSku(row.sku);
    if (sku) {
      const skuStock = bySku.get(sku) ?? emptyFfStock();
      skuStock[row.location] = Math.max(0, Number(row.quantity) || 0);
      bySku.set(sku, skuStock);
      const skuExpiry = expiryBySku.get(sku) ?? emptyFfExpiry();
      skuExpiry[row.location] = row.expires_at || null;
      expiryBySku.set(sku, skuExpiry);
    }
  }

  return { byProduct, bySku, expiryByProduct, expiryBySku };
}

export function stockForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  return {
    ...emptyFfStock(warehouses),
    ...(lookup.byProduct.get(input.productKey) ?? {}),
    ...(lookup.bySku.get(normalizeSku(input.sku)) ?? {}),
  };
}

export function expiryForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  return {
    ...emptyFfExpiry(warehouses),
    ...(lookup.expiryByProduct.get(input.productKey) ?? {}),
    ...(lookup.expiryBySku.get(normalizeSku(input.sku)) ?? {}),
  };
}

export async function saveFfStock(input: { cabinetId: CabinetId; productKey: string; nmId: number | null; sku: string; stock: FfStock; expiresAt: FfExpiry }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses(input.cabinetId);
  const updatedAt = new Date().toISOString();
  const productKey = normalizeSku(input.sku) ? `sku:${normalizeSku(input.sku)}` : input.productKey;
  const stock = emptyFfStock(warehouses);
  const expiresAt = emptyFfExpiry(warehouses);
  for (const warehouse of warehouses) stock[warehouse.id] = Math.max(0, Math.floor(Number(input.stock[warehouse.id]) || 0));
  for (const warehouse of warehouses) expiresAt[warehouse.id] = input.expiresAt[warehouse.id] || null;
  await d1.batch(warehouses.map((warehouse) => d1.prepare(`
    INSERT INTO ff_stocks (cabinet_id, product_key, nm_id, sku, location, quantity, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cabinet_id, product_key, location) DO UPDATE SET
      nm_id = excluded.nm_id,
      sku = excluded.sku,
      quantity = excluded.quantity,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(input.cabinetId, productKey, input.nmId, input.sku, warehouse.id, stock[warehouse.id], expiresAt[warehouse.id], updatedAt)));
  return { stock, expiresAt };
}

export async function importFfStocks(input: { cabinetId: CabinetId; warehouseId: string; mode: "replace" | "add"; items: Array<{ sku: string; quantity: number; expiresAt?: string | null }> }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses(input.cabinetId);
  if (!warehouses.some((warehouse) => warehouse.id === input.warehouseId)) throw new Error("Склад не найден");
  const updatedAt = new Date().toISOString();
  await d1.batch(input.items.map((item) => {
    const sku = normalizeSku(item.sku);
    const shouldUpdateExpiry = Object.hasOwn(item, "expiresAt");
    const statement = input.mode === "add" ? `
      INSERT INTO ff_stocks (cabinet_id, product_key, nm_id, sku, location, quantity, expires_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(cabinet_id, product_key, location) DO UPDATE SET
        sku = excluded.sku,
        quantity = ff_stocks.quantity + excluded.quantity,
        expires_at = CASE WHEN ? THEN excluded.expires_at ELSE ff_stocks.expires_at END,
        updated_at = excluded.updated_at
    ` : `
      INSERT INTO ff_stocks (cabinet_id, product_key, nm_id, sku, location, quantity, expires_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(cabinet_id, product_key, location) DO UPDATE SET
        sku = excluded.sku,
        quantity = excluded.quantity,
        expires_at = CASE WHEN ? THEN excluded.expires_at ELSE ff_stocks.expires_at END,
        updated_at = excluded.updated_at
    `;
    return d1.prepare(statement).bind(input.cabinetId, `sku:${sku}`, item.sku.trim(), input.warehouseId, item.quantity, item.expiresAt ?? null, updatedAt, shouldUpdateExpiry ? 1 : 0);
  }));
  return { imported: input.items.length };
}
