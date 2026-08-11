import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("таргет цен работает через API WB, а не через Google-таблицу", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
  ]);

  assert.doesNotMatch(page, /targetPriceSheetUrl|Открыть таблицу/);
  assert.match(page, /Обновить цены/);
  assert.match(page, /Конкуренты/);
  assert.match(route, /https:\/\/card\.wb\.ru\/cards\/v4\/detail/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
});

test("обновление цен не стирает последние корректные значения при ответе WB с ошибкой", async () => {
  const [route, storage] = await Promise.all([
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
    readFile(new URL("db/target-prices.ts", root), "utf8"),
  ]);

  assert.match(route, /publicOwn\?\.price \?\? row\.currentPrice/);
  assert.match(route, /point\.price \?\? competitor\.price/);
  assert.match(route, /оставили последние корректные значения/);
  assert.match(storage, /ON CONFLICT\(cabinet_id, product_key\) DO UPDATE/);
  assert.match(storage, /target_price_products/);
});
