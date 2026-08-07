import { getD1 } from "./index";

export type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
};

export type FfStock = Record<string, number>;

type FfStockRow = {
  product_key: string;
  sku: string;
  location: string;
  quantity: number;
};

const defaultWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10 },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20 },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30 },
];

const createStocksTableSql = `
  CREATE TABLE IF NOT EXISTS ff_stocks (
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_key, location)
  )
`;
const createWarehousesTableSql = `
  CREATE TABLE IF NOT EXISTS ff_warehouses (
    id TEXT PRIMARY KEY NOT NULL,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;
const createMigratedStocksTableSql = `
  CREATE TABLE ff_stocks_migrated (
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_key, location)
  )
`;

let initializePromise: Promise<D1Database> | null = null;

export function normalizeSku(value: string) {
  return value.trim().toLocaleUpperCase("ru-RU");
}

export function emptyFfStock(warehouses = defaultWarehouses): FfStock {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, 0]));
}

async function getFfStockDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([
        d1.prepare(createStocksTableSql),
        d1.prepare(createWarehousesTableSql),
      ]);

      const legacy = await d1.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ff_stocks'").first<{ sql: string }>();
      if (legacy?.sql.includes("CHECK (location IN")) {
        await d1.batch([
          d1.prepare(createMigratedStocksTableSql),
          d1.prepare("INSERT OR REPLACE INTO ff_stocks_migrated (product_key, nm_id, sku, location, quantity, updated_at) SELECT product_key, nm_id, sku, location, quantity, updated_at FROM ff_stocks"),
          d1.prepare("DROP TABLE ff_stocks"),
          d1.prepare("ALTER TABLE ff_stocks_migrated RENAME TO ff_stocks"),
        ]);
      }

      await d1.batch(defaultWarehouses.map((warehouse) => d1.prepare(`
        INSERT INTO ff_warehouses (id, city, name, position)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(warehouse.id, warehouse.city, warehouse.name, warehouse.position)));
      return d1;
    })();
  }

  return initializePromise;
}

export async function listFfWarehouses() {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT id, city, name, position FROM ff_warehouses ORDER BY position, city, name").all<ManualWarehouse>();
  return result.results ?? [];
}

export async function createFfWarehouse(input: { city: string; name: string }) {
  const d1 = await getFfStockDb();
  const current = await listFfWarehouses();
  const warehouse: ManualWarehouse = {
    id: `warehouse_${crypto.randomUUID().replaceAll("-", "")}`,
    city: input.city.trim(),
    name: input.name.trim(),
    position: (current.at(-1)?.position ?? 0) + 10,
  };
  await d1.prepare("INSERT INTO ff_warehouses (id, city, name, position) VALUES (?, ?, ?, ?)").bind(
    warehouse.id,
    warehouse.city,
    warehouse.name,
    warehouse.position,
  ).run();
  return warehouse;
}

export async function updateFfWarehouse(input: ManualWarehouse) {
  const d1 = await getFfStockDb();
  await d1.prepare("UPDATE ff_warehouses SET city = ?, name = ? WHERE id = ?").bind(input.city.trim(), input.name.trim(), input.id).run();
  return input;
}

export async function listFfStocks() {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT product_key, sku, location, quantity FROM ff_stocks").all<FfStockRow>();
  const byProduct = new Map<string, FfStock>();
  const bySku = new Map<string, FfStock>();

  for (const row of result.results ?? []) {
    const stock = byProduct.get(row.product_key) ?? emptyFfStock();
    stock[row.location] = Math.max(0, Number(row.quantity) || 0);
    byProduct.set(row.product_key, stock);
    const sku = normalizeSku(row.sku);
    if (sku) {
      const skuStock = bySku.get(sku) ?? emptyFfStock();
      skuStock[row.location] = Math.max(0, Number(row.quantity) || 0);
      bySku.set(sku, skuStock);
    }
  }

  return { byProduct, bySku };
}

export function stockForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  return {
    ...emptyFfStock(warehouses),
    ...(lookup.byProduct.get(input.productKey) ?? {}),
    ...(lookup.bySku.get(normalizeSku(input.sku)) ?? {}),
  };
}

export async function saveFfStock(input: { productKey: string; nmId: number | null; sku: string; stock: FfStock }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses();
  const updatedAt = new Date().toISOString();
  const productKey = normalizeSku(input.sku) ? `sku:${normalizeSku(input.sku)}` : input.productKey;
  const stock = emptyFfStock(warehouses);
  for (const warehouse of warehouses) stock[warehouse.id] = Math.max(0, Math.floor(Number(input.stock[warehouse.id]) || 0));
  await d1.batch(warehouses.map((warehouse) => d1.prepare(`
    INSERT INTO ff_stocks (product_key, nm_id, sku, location, quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_key, location) DO UPDATE SET
      nm_id = excluded.nm_id,
      sku = excluded.sku,
      quantity = excluded.quantity,
      updated_at = excluded.updated_at
  `).bind(productKey, input.nmId, input.sku, warehouse.id, stock[warehouse.id], updatedAt)));
  return stock;
}

export async function importFfStocks(input: { warehouseId: string; mode: "replace" | "add"; items: Array<{ sku: string; quantity: number }> }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses();
  if (!warehouses.some((warehouse) => warehouse.id === input.warehouseId)) throw new Error("Склад не найден");
  const updatedAt = new Date().toISOString();
  await d1.batch(input.items.map((item) => {
    const sku = normalizeSku(item.sku);
    const statement = input.mode === "add" ? `
      INSERT INTO ff_stocks (product_key, nm_id, sku, location, quantity, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?)
      ON CONFLICT(product_key, location) DO UPDATE SET
        sku = excluded.sku,
        quantity = ff_stocks.quantity + excluded.quantity,
        updated_at = excluded.updated_at
    ` : `
      INSERT INTO ff_stocks (product_key, nm_id, sku, location, quantity, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?)
      ON CONFLICT(product_key, location) DO UPDATE SET
        sku = excluded.sku,
        quantity = excluded.quantity,
        updated_at = excluded.updated_at
    `;
    return d1.prepare(statement).bind(`sku:${sku}`, item.sku.trim(), input.warehouseId, item.quantity, updatedAt);
  }));
  return { imported: input.items.length };
}
