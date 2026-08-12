import { getD1 } from "./index";
import { cabinetIds, type CabinetId } from "@/lib/admin-auth";

export type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
  wbWarehouseId: number | null;
  wbWarehouseName: string | null;
  serviceRateKopecks: number;
  isHidden: boolean;
};

export type FfStock = Record<string, number>;
export type FfExpiry = Record<string, string | null>;
export type FfBatch = { location: string; batchCode: string; expiresAt: string | null; quantity: number };
export type FfBatches = Record<string, FfBatch[]>;

type FfStockRow = {
  product_key: string;
  sku: string;
  location: string;
  quantity: number;
  expires_at: string | null;
};
type FfBatchRow = {
  product_key: string;
  sku: string;
  location: string;
  batch_code: string;
  expires_at: string;
  quantity: number;
};

const defaultWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10, wbWarehouseId: 1692397, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20, wbWarehouseId: null, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30, wbWarehouseId: null, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false },
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
    wb_warehouse_id INTEGER,
    wb_warehouse_name TEXT,
    service_rate_kopecks INTEGER NOT NULL DEFAULT 0,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, id)
  )
`;
const createBatchesTableSql = `
  CREATE TABLE IF NOT EXISTS ff_stock_batches (
    cabinet_id TEXT NOT NULL DEFAULT 'metanutrix',
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    batch_code TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, product_key, location, batch_code, expires_at)
  )
`;
const createScopedStocksTableSql = createStocksTableSql.replace("IF NOT EXISTS ff_stocks", "ff_stocks_scoped");
const createScopedWarehousesTableSql = createWarehousesTableSql.replace("IF NOT EXISTS ff_warehouses", "ff_warehouses_scoped");

let initializePromise: Promise<D1Database> | null = null;

export function normalizeSku(value: string) {
  return value.trim().toLocaleUpperCase("ru-RU");
}

function databaseExpiry(value: string | null | undefined) {
  return value || "";
}

function displayExpiry(value: string | null | undefined) {
  return value || null;
}

function productKeyFor(input: { productKey: string; sku: string }) {
  return input.productKey || (normalizeSku(input.sku) ? `sku:${normalizeSku(input.sku)}` : "");
}

export function emptyFfStock(warehouses = defaultWarehouses): FfStock {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, 0]));
}

export function emptyFfExpiry(warehouses = defaultWarehouses): FfExpiry {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, null]));
}

export function emptyFfBatches(warehouses = defaultWarehouses): FfBatches {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, []]));
}

async function getFfStockDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([d1.prepare(createStocksTableSql), d1.prepare(createWarehousesTableSql), d1.prepare(createBatchesTableSql)]);

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
          d1.prepare("INSERT INTO ff_warehouses_scoped (cabinet_id, id, city, name, position, wb_warehouse_id, wb_warehouse_name, is_hidden, created_at) SELECT 'metanutrix', id, city, name, position, NULL, NULL, 0, created_at FROM ff_warehouses"),
          d1.prepare("DROP TABLE ff_warehouses"),
          d1.prepare("ALTER TABLE ff_warehouses_scoped RENAME TO ff_warehouses"),
        ]);
      }

      const [currentStockColumns, currentWarehouseColumns] = await Promise.all([
        d1.prepare("PRAGMA table_info(ff_stocks)").all<{ name: string }>(),
        d1.prepare("PRAGMA table_info(ff_warehouses)").all<{ name: string }>(),
      ]);
      if (!(currentStockColumns.results ?? []).some((column) => column.name === "expires_at")) {
        await d1.prepare("ALTER TABLE ff_stocks ADD COLUMN expires_at TEXT").run();
      }
      const currentWarehouseColumnNames = new Set((currentWarehouseColumns.results ?? []).map((column) => column.name));
      if (!currentWarehouseColumnNames.has("wb_warehouse_id")) await d1.prepare("ALTER TABLE ff_warehouses ADD COLUMN wb_warehouse_id INTEGER").run();
      if (!currentWarehouseColumnNames.has("wb_warehouse_name")) await d1.prepare("ALTER TABLE ff_warehouses ADD COLUMN wb_warehouse_name TEXT").run();
      if (!currentWarehouseColumnNames.has("service_rate_kopecks")) await d1.prepare("ALTER TABLE ff_warehouses ADD COLUMN service_rate_kopecks INTEGER NOT NULL DEFAULT 0").run();
      if (!currentWarehouseColumnNames.has("is_hidden")) await d1.prepare("ALTER TABLE ff_warehouses ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0").run();

      await d1.batch([
        d1.prepare("DELETE FROM ff_stock_batches WHERE cabinet_id = 'trusthome'"),
        d1.prepare("DELETE FROM ff_stocks WHERE cabinet_id = 'trusthome'"),
        d1.prepare("DELETE FROM ff_warehouses WHERE cabinet_id = 'trusthome'"),
        // The presets belong to the WB cabinet only. Ozon fills this list
        // from its own FBS warehouses on first synchronization.
        ...cabinetIds.filter((cabinetId) => cabinetId === "metanutrix").flatMap((cabinetId) => defaultWarehouses.map((warehouse) => d1.prepare(`
        INSERT INTO ff_warehouses (cabinet_id, id, city, name, position, wb_warehouse_id, wb_warehouse_name, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cabinet_id, id) DO UPDATE SET
          wb_warehouse_id = COALESCE(ff_warehouses.wb_warehouse_id, excluded.wb_warehouse_id),
          wb_warehouse_name = COALESCE(ff_warehouses.wb_warehouse_name, excluded.wb_warehouse_name)
      `).bind(cabinetId, warehouse.id, warehouse.city, warehouse.name, warehouse.position, warehouse.wbWarehouseId, warehouse.wbWarehouseName, warehouse.isHidden))),
      ]);
      await d1.prepare(`
        INSERT OR IGNORE INTO ff_stock_batches (cabinet_id, product_key, nm_id, sku, location, batch_code, expires_at, quantity, updated_at)
        SELECT cabinet_id, product_key, nm_id, sku, location, '', COALESCE(expires_at, ''), quantity, updated_at
        FROM ff_stocks
      `).run();
      return d1;
    })();
  }

  return initializePromise;
}

export async function listFfWarehouses(cabinetId: CabinetId) {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT id, city, name, position, wb_warehouse_id AS wbWarehouseId, wb_warehouse_name AS wbWarehouseName, service_rate_kopecks AS serviceRateKopecks, is_hidden AS isHidden FROM ff_warehouses WHERE cabinet_id = ? ORDER BY position, city, name").bind(cabinetId).all<ManualWarehouse & { serviceRateKopecks: number | null; isHidden: boolean | number }>();
  return (result.results ?? []).map((warehouse) => ({ ...warehouse, serviceRateKopecks: Math.max(0, Number(warehouse.serviceRateKopecks) || 0), isHidden: Boolean(warehouse.isHidden) }));
}

export async function createFfWarehouse(input: { cabinetId: CabinetId; city: string; name: string }) {
  const d1 = await getFfStockDb();
  const current = await listFfWarehouses(input.cabinetId);
  const warehouse: ManualWarehouse = {
    id: `warehouse_${crypto.randomUUID().replaceAll("-", "")}`,
    city: input.city.trim(),
    name: input.name.trim(),
    position: (current.at(-1)?.position ?? 0) + 10,
    wbWarehouseId: null,
    wbWarehouseName: null,
    serviceRateKopecks: 0,
    isHidden: false,
  };
  await d1.prepare("INSERT INTO ff_warehouses (cabinet_id, id, city, name, position, wb_warehouse_id, wb_warehouse_name, service_rate_kopecks, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
    input.cabinetId,
    warehouse.id,
    warehouse.city,
    warehouse.name,
    warehouse.position,
    warehouse.wbWarehouseId,
    warehouse.wbWarehouseName,
    warehouse.serviceRateKopecks,
    warehouse.isHidden,
  ).run();
  return warehouse;
}

export async function updateFfWarehouse(input: ManualWarehouse & { cabinetId: CabinetId }) {
  const d1 = await getFfStockDb();
  const warehouse = {
    ...input,
    city: input.city.trim(),
    name: input.name.trim(),
    wbWarehouseName: input.wbWarehouseName?.trim() || null,
  };
  await d1.prepare("UPDATE ff_warehouses SET city = ?, name = ?, wb_warehouse_id = ?, wb_warehouse_name = ?, service_rate_kopecks = ?, is_hidden = ? WHERE cabinet_id = ? AND id = ?").bind(
    warehouse.city,
    warehouse.name,
    warehouse.wbWarehouseId,
    warehouse.wbWarehouseName,
    Math.max(0, Math.round(Number(warehouse.serviceRateKopecks) || 0)),
    warehouse.isHidden,
    warehouse.cabinetId,
    warehouse.id,
  ).run();
  return warehouse;
}

export async function syncWbFbsWarehouses(input: { cabinetId: CabinetId; warehouses: Array<{ id: number; name: string }> }) {
  return syncMarketplaceFbsWarehouses({ ...input, idPrefix: "wb", defaultName: "Склад WB FBS" });
}

export async function syncMarketplaceFbsWarehouses(input: { cabinetId: CabinetId; warehouses: Array<{ id: number; name: string }>; idPrefix: string; defaultName: string }) {
  const d1 = await getFfStockDb();
  const current = await listFfWarehouses(input.cabinetId);
  const knownWbIds = new Set(current.flatMap((warehouse) => warehouse.wbWarehouseId ? [warehouse.wbWarehouseId] : []));
  const maxPosition = current.reduce((value, warehouse) => Math.max(value, warehouse.position), 0);
  const missing = input.warehouses.filter((warehouse) => !knownWbIds.has(warehouse.id));
  if (!missing.length) return current;
  await d1.batch(missing.map((warehouse, index) => d1.prepare(`
    INSERT INTO ff_warehouses (cabinet_id, id, city, name, position, wb_warehouse_id, wb_warehouse_name, is_hidden)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(input.cabinetId, `${input.idPrefix}_${warehouse.id}`, warehouse.name, input.defaultName, maxPosition + (index + 1) * 10, warehouse.id, warehouse.name)));
  return listFfWarehouses(input.cabinetId);
}

function addBatch(target: Map<string, FfBatches>, key: string, row: FfBatchRow) {
  const batches = target.get(key) ?? emptyFfBatches();
  const locationBatches = batches[row.location] ?? [];
  locationBatches.push({
    location: row.location,
    batchCode: row.batch_code,
    expiresAt: displayExpiry(row.expires_at),
    quantity: Math.max(0, Number(row.quantity) || 0),
  });
  batches[row.location] = locationBatches.sort((a, b) => (a.expiresAt ?? "9999-12-31").localeCompare(b.expiresAt ?? "9999-12-31") || a.batchCode.localeCompare(b.batchCode));
  target.set(key, batches);
}

export async function listFfStocks(cabinetId: CabinetId) {
  const d1 = await getFfStockDb();
  const [stockResult, batchResult] = await Promise.all([
    d1.prepare("SELECT product_key, sku, location, quantity, expires_at FROM ff_stocks WHERE cabinet_id = ?").bind(cabinetId).all<FfStockRow>(),
    d1.prepare("SELECT product_key, sku, location, batch_code, expires_at, quantity FROM ff_stock_batches WHERE cabinet_id = ? AND quantity > 0 ORDER BY expires_at, batch_code").bind(cabinetId).all<FfBatchRow>(),
  ]);
  const byProduct = new Map<string, FfStock>();
  const bySku = new Map<string, FfStock>();
  const expiryByProduct = new Map<string, FfExpiry>();
  const expiryBySku = new Map<string, FfExpiry>();
  const batchesByProduct = new Map<string, FfBatches>();
  const batchesBySku = new Map<string, FfBatches>();

  for (const row of stockResult.results ?? []) {
    const stock = byProduct.get(row.product_key) ?? emptyFfStock();
    stock[row.location] = Math.max(0, Number(row.quantity) || 0);
    byProduct.set(row.product_key, stock);
    const expiry = expiryByProduct.get(row.product_key) ?? emptyFfExpiry();
    expiry[row.location] = displayExpiry(row.expires_at);
    expiryByProduct.set(row.product_key, expiry);
    const sku = normalizeSku(row.sku);
    if (sku) {
      const skuStock = bySku.get(sku) ?? emptyFfStock();
      skuStock[row.location] = Math.max(0, Number(row.quantity) || 0);
      bySku.set(sku, skuStock);
      const skuExpiry = expiryBySku.get(sku) ?? emptyFfExpiry();
      skuExpiry[row.location] = displayExpiry(row.expires_at);
      expiryBySku.set(sku, skuExpiry);
    }
  }

  for (const row of batchResult.results ?? []) {
    addBatch(batchesByProduct, row.product_key, row);
    const sku = normalizeSku(row.sku);
    if (sku) addBatch(batchesBySku, sku, row);
  }

  return { byProduct, bySku, expiryByProduct, expiryBySku, batchesByProduct, batchesBySku };
}

function lookupValue<T>(byProduct: Map<string, T>, bySku: Map<string, T>, input: { productKey: string; sku: string }) {
  return byProduct.get(input.productKey) ?? bySku.get(normalizeSku(input.sku));
}

export function stockForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  return { ...emptyFfStock(warehouses), ...(lookupValue(lookup.byProduct, lookup.bySku, input) ?? {}) };
}

export function expiryForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  return { ...emptyFfExpiry(warehouses), ...(lookupValue(lookup.expiryByProduct, lookup.expiryBySku, input) ?? {}) };
}

export function batchesForProduct(lookup: Awaited<ReturnType<typeof listFfStocks>>, input: { productKey: string; sku: string }, warehouses: ManualWarehouse[]) {
  const batches = lookupValue(lookup.batchesByProduct, lookup.batchesBySku, input) ?? {};
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, [...(batches[warehouse.id] ?? [])]]));
}

async function syncStockSummary(input: { d1: D1Database; cabinetId: CabinetId; productKey: string; nmId: number | null; sku: string; warehouseId: string; updatedAt: string }) {
  const aggregate = await input.d1.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity, MIN(NULLIF(expires_at, '')) AS expires_at
    FROM ff_stock_batches
    WHERE cabinet_id = ? AND product_key = ? AND location = ?
  `).bind(input.cabinetId, input.productKey, input.warehouseId).first<{ quantity: number; expires_at: string | null }>();
  const quantity = Math.max(0, Number(aggregate?.quantity) || 0);
  const expiresAt = aggregate?.expires_at || null;
  await input.d1.prepare(`
    INSERT INTO ff_stocks (cabinet_id, product_key, nm_id, sku, location, quantity, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cabinet_id, product_key, location) DO UPDATE SET
      nm_id = excluded.nm_id,
      sku = excluded.sku,
      quantity = excluded.quantity,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(input.cabinetId, input.productKey, input.nmId, input.sku, input.warehouseId, quantity, expiresAt, input.updatedAt).run();
}

async function productState(cabinetId: CabinetId, productKey: string, sku: string) {
  const warehouses = await listFfWarehouses(cabinetId);
  const lookup = await listFfStocks(cabinetId);
  const input = { productKey, sku };
  return {
    stock: stockForProduct(lookup, input, warehouses),
    expiresAt: expiryForProduct(lookup, input, warehouses),
    batches: batchesForProduct(lookup, input, warehouses),
  };
}

export async function saveFfStock(input: { cabinetId: CabinetId; productKey: string; nmId: number | null; sku: string; stock: FfStock; expiresAt: FfExpiry }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses(input.cabinetId);
  const updatedAt = new Date().toISOString();
  const productKey = productKeyFor(input);
  const stock = emptyFfStock(warehouses);
  const expiresAt = emptyFfExpiry(warehouses);
  for (const warehouse of warehouses) stock[warehouse.id] = Math.max(0, Math.floor(Number(input.stock[warehouse.id]) || 0));
  for (const warehouse of warehouses) expiresAt[warehouse.id] = input.expiresAt[warehouse.id] || null;
  await d1.batch(warehouses.flatMap((warehouse) => {
    const statements = [d1.prepare("DELETE FROM ff_stock_batches WHERE cabinet_id = ? AND product_key = ? AND location = ?").bind(input.cabinetId, productKey, warehouse.id)];
    if (stock[warehouse.id] > 0) statements.push(d1.prepare(`
      INSERT INTO ff_stock_batches (cabinet_id, product_key, nm_id, sku, location, batch_code, expires_at, quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Корректировка', ?, ?, ?)
    `).bind(input.cabinetId, productKey, input.nmId, input.sku, warehouse.id, databaseExpiry(expiresAt[warehouse.id]), stock[warehouse.id], updatedAt));
    return statements;
  }));
  for (const warehouse of warehouses) {
    await syncStockSummary({ d1, cabinetId: input.cabinetId, productKey, nmId: input.nmId, sku: input.sku, warehouseId: warehouse.id, updatedAt });
  }
  return productState(input.cabinetId, productKey, input.sku);
}

export async function saveFfStockBatch(input: { cabinetId: CabinetId; productKey: string; nmId: number | null; sku: string; warehouseId: string; batchCode: string; expiresAt: string | null; quantity: number }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses(input.cabinetId);
  if (!warehouses.some((warehouse) => warehouse.id === input.warehouseId)) throw new Error("Склад не найден");
  const productKey = productKeyFor(input);
  const updatedAt = new Date().toISOString();
  const batchCode = input.batchCode.trim();
  const expiresAt = databaseExpiry(input.expiresAt);
  if (input.quantity > 0) {
    await d1.prepare(`
      INSERT INTO ff_stock_batches (cabinet_id, product_key, nm_id, sku, location, batch_code, expires_at, quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cabinet_id, product_key, location, batch_code, expires_at) DO UPDATE SET
        nm_id = excluded.nm_id,
        sku = excluded.sku,
        quantity = excluded.quantity,
        updated_at = excluded.updated_at
    `).bind(input.cabinetId, productKey, input.nmId, input.sku, input.warehouseId, batchCode, expiresAt, input.quantity, updatedAt).run();
  } else {
    await d1.prepare("DELETE FROM ff_stock_batches WHERE cabinet_id = ? AND product_key = ? AND location = ? AND batch_code = ? AND expires_at = ?").bind(input.cabinetId, productKey, input.warehouseId, batchCode, expiresAt).run();
  }
  await syncStockSummary({ d1, cabinetId: input.cabinetId, productKey, nmId: input.nmId, sku: input.sku, warehouseId: input.warehouseId, updatedAt });
  return productState(input.cabinetId, productKey, input.sku);
}

export async function deleteFfStockBatch(input: { cabinetId: CabinetId; productKey: string; nmId: number | null; sku: string; warehouseId: string; batchCode: string; expiresAt: string | null }) {
  return saveFfStockBatch({ ...input, quantity: 0 });
}

export async function importFfStocks(input: { cabinetId: CabinetId; warehouseId: string; mode: "replace" | "add"; items: Array<{ sku: string; nmId: number | null; quantity: number; batchCode?: string; expiresAt?: string | null }> }) {
  const d1 = await getFfStockDb();
  const warehouses = await listFfWarehouses(input.cabinetId);
  if (!warehouses.some((warehouse) => warehouse.id === input.warehouseId)) throw new Error("Склад не найден");
  const updatedAt = new Date().toISOString();
  const products = [...new Map(input.items.map((item) => {
    const sku = normalizeSku(item.sku);
    const productKey = item.nmId ? `nm:${item.nmId}` : `sku:${sku}`;
    return [productKey, { productKey, nmId: item.nmId, sku: item.sku.trim() }];
  })).values()];

  if (input.mode === "replace") {
    await d1.batch(products.map((product) => d1.prepare("DELETE FROM ff_stock_batches WHERE cabinet_id = ? AND product_key = ? AND location = ?").bind(input.cabinetId, product.productKey, input.warehouseId)));
  }

  const inserts = input.items.filter((item) => item.quantity > 0).map((item) => {
    const sku = normalizeSku(item.sku);
    const productKey = item.nmId ? `nm:${item.nmId}` : `sku:${sku}`;
    const statement = input.mode === "add" ? `
      INSERT INTO ff_stock_batches (cabinet_id, product_key, nm_id, sku, location, batch_code, expires_at, quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cabinet_id, product_key, location, batch_code, expires_at) DO UPDATE SET
        sku = excluded.sku,
        quantity = ff_stock_batches.quantity + excluded.quantity,
        updated_at = excluded.updated_at
    ` : `
      INSERT INTO ff_stock_batches (cabinet_id, product_key, nm_id, sku, location, batch_code, expires_at, quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cabinet_id, product_key, location, batch_code, expires_at) DO UPDATE SET
        sku = excluded.sku,
        quantity = excluded.quantity,
        updated_at = excluded.updated_at
    `;
    return d1.prepare(statement).bind(input.cabinetId, productKey, item.nmId, item.sku.trim(), input.warehouseId, item.batchCode?.trim() ?? "", databaseExpiry(item.expiresAt), item.quantity, updatedAt);
  });
  if (inserts.length) await d1.batch(inserts);
  for (const product of products) {
    await syncStockSummary({ d1, cabinetId: input.cabinetId, productKey: product.productKey, nmId: product.nmId, sku: product.sku, warehouseId: input.warehouseId, updatedAt });
  }
  return { imported: input.items.length };
}
