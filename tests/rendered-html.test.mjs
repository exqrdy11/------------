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
  assert.match(route, /cabinetToken\(session\.cabinetId\)/);
  assert.match(route, /data\.products \?\? data\.data\?\.products/);
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

test("остатки ФФ и движение FBS переживают временный лимит WB", async () => {
  const [route, snapshots] = await Promise.all([
    readFile(new URL("app/api/inventory/route.ts", root), "utf8"),
    readFile(new URL("db/inventory-snapshots.ts", root), "utf8"),
  ]);

  assert.match(route, /loadInventorySnapshot<DashboardPayload>/);
  assert.match(route, /restoreFbsStocksForWarehouses/);
  assert.match(route, /restoreFbsMovement/);
  assert.match(route, /snapshotIsComplete/);
  assert.match(route, /partial response must never become the new baseline/);
  assert.match(snapshots, /inventory_snapshots/);
  assert.match(snapshots, /ON CONFLICT\(cabinet_id\) DO UPDATE/);
});

test("артикул в таргете цен открывает рынок и ссылки на конкурентов", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /pricing-row-open/);
  assert.match(page, /Открыть рынок и конкурентов/);
  assert.match(page, /Открыть свою карточку на WB/);
  assert.match(page, /catalog\/\$\{competitor\.nmId\}\/detail\.aspx/);
});

test("новые FBS остаются в физическом остатке ФФ и отдельно резервируются", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /Фактически на ФФ/);
  assert.match(page, /Свободно к продаже/);
  assert.match(page, /ещё лежат на ФФ/);
  assert.match(page, /physical: \{ kicker: "ФАКТИЧЕСКИ НА ФФ"/);
  assert.match(page, /fulfillmentList === "physical" \? physicalStock/);
});
