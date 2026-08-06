import { getD1 } from "./index";

export type FfLocationKey = "kazan" | "moscow" | "spb";
export type FfStock = Record<FfLocationKey, number>;

type FfStockRow = {
  product_key: string;
  location: FfLocationKey;
  quantity: number;
};

const locations: FfLocationKey[] = ["kazan", "moscow", "spb"];
const createTableSql = `
  CREATE TABLE IF NOT EXISTS ff_stocks (
    product_key TEXT NOT NULL,
    nm_id INTEGER,
    sku TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL CHECK (location IN ('kazan', 'moscow', 'spb')),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_key, location)
  )
`;

let initializePromise: Promise<D1Database> | null = null;

export function emptyFfStock(): FfStock {
  return { kazan: 0, moscow: 0, spb: 0 };
}

async function getFfStockDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.prepare(createTableSql).run();
      return d1;
    })();
  }

  return initializePromise;
}

export async function listFfStocks() {
  const d1 = await getFfStockDb();
  const result = await d1.prepare("SELECT product_key, location, quantity FROM ff_stocks").all<FfStockRow>();
  const byProduct = new Map<string, FfStock>();

  for (const row of result.results ?? []) {
    if (!locations.includes(row.location)) continue;
    const stock = byProduct.get(row.product_key) ?? emptyFfStock();
    stock[row.location] = Math.max(0, Number(row.quantity) || 0);
    byProduct.set(row.product_key, stock);
  }

  return byProduct;
}

export async function saveFfStock(input: { productKey: string; nmId: number | null; sku: string; stock: FfStock }) {
  const d1 = await getFfStockDb();
  const updatedAt = new Date().toISOString();
  await d1.batch(locations.map((location) => d1.prepare(`
    INSERT INTO ff_stocks (product_key, nm_id, sku, location, quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_key, location) DO UPDATE SET
      nm_id = excluded.nm_id,
      sku = excluded.sku,
      quantity = excluded.quantity,
      updated_at = excluded.updated_at
  `).bind(input.productKey, input.nmId, input.sku, location, input.stock[location], updatedAt)));
  return input.stock;
}
