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

test("в таргете цен конкуренты добавляются только вручную", async () => {
  const [page, route, storage] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
    readFile(new URL("db/target-prices.ts", root), "utf8"),
  ]);

  assert.match(route, /add-competitor/);
  assert.match(route, /remove-competitor/);
  assert.match(route, /set-competitor-price/);
  assert.match(route, /выбран вручную/);
  assert.match(page, /Добавить вручную/);
  assert.match(page, /Артикул WB конкурента/);
  assert.match(page, /Цена конкурента появится после отдельного обновления цен/);
  assert.match(page, /Убрать/);
  assert.match(storage, /competitors_json/);
  assert.doesNotMatch(route, /WB_SEARCH_API/);
  assert.doesNotMatch(route, /refresh-candidates/);
  assert.doesNotMatch(route, /getTargetPriceCandidateSnapshot/);
  assert.doesNotMatch(page, /Обновить подбор WB/);
  assert.doesNotMatch(storage, /target_price_candidate_snapshots/);
});

test("в Ozon конкурент добавляется ссылкой и обычное обновление сохраняет последнюю цену", async () => {
  const [page, route, ozon] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
    readFile(new URL("lib/ozon-target-prices.ts", root), "utf8"),
  ]);

  assert.match(page, /Цена, ₽/);
  assert.match(page, /Сохранить/);
  assert.match(page, /Ссылка конкурента Ozon/);
  assert.match(page, /сохранит последнюю удачную/);
  assert.match(route, /введено вручную/);
  assert.match(route, /Укажите корректную цену конкурента в рублях/);
  assert.match(route, /normalizeOzonProductUrl/);
  assert.match(ozon, /composer-api\.bx\/page\/json\/v2/);
  assert.match(ozon, /Сохранили последнюю цену/);
  assert.match(ozon, /fetchPublicOzonCard/);
});

test("цены обновляются вручную для владельца и гостя, без пятиминутного ограничения", async () => {
  const [page, route, storage] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
    readFile(new URL("db/target-prices.ts", root), "utf8"),
  ]);

  assert.match(route, /TARGET_PRICE_REFRESH_REQUEST_LOCK_MS = 30 \* 1000/);
  assert.match(route, /getAdminSession/);
  assert.match(route, /session\.role !== "owner"/);
  assert.match(route, /reserveTargetPriceRefresh\(session\.cabinetId, "prices"/);
  assert.match(storage, /target_price_refresh_locks/);
  assert.match(page, /Сохранённый снимок цен WB/);
  assert.match(page, /Обновить цены/);
  assert.match(page, /Рекомендованный интервал обновления — 2 минуты/);
  assert.doesNotMatch(route, /reserveTargetPriceRefresh\(session\.cabinetId, "competitors"/);
  assert.doesNotMatch(storage, /target_price_candidate_snapshots/);
});

test("главная открывается из сохранённого снимка, а обновление защищено только на время текущего запроса", async () => {
  const [route, snapshots] = await Promise.all([
    readFile(new URL("app/api/inventory/route.ts", root), "utf8"),
    readFile(new URL("db/inventory-snapshots.ts", root), "utf8"),
  ]);

  assert.match(route, /INVENTORY_REFRESH_REQUEST_LOCK_MS = INVENTORY_REFRESH_TIMEOUT_MS \+ 5 \* 1000/);
  assert.match(route, /if \(!force && lastKnown\)/);
  assert.match(route, /Opening the dashboard never calls Wildberries/);
  assert.match(route, /reserveInventoryRefresh\(cabinetId, INVENTORY_REFRESH_REQUEST_LOCK_MS\)/);
  assert.match(route, /only while the current request/);
  assert.match(snapshots, /inventory_refresh_locks/);
  assert.match(snapshots, /reserveInventoryRefresh/);
  assert.match(snapshots, /releaseInventoryRefresh/);
  assert.match(snapshots, /getInventoryRefreshCooldown/);
});

test("новые FBS остаются на ФФ, но не входят в свободный остаток", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /Фактически на ФФ/);
  assert.match(page, /Свободно к продаже/);
  assert.match(page, /ещё лежат на ФФ/);
  assert.match(page, /physical: \{ kicker: "ФАКТИЧЕСКИ НА ФФ"/);
  assert.match(page, /function physicalFfStock/);
  assert.match(page, /return Math\.max\(0, \(row\.ffStock\[warehouseId\] \?\? 0\) - \(row\.fbsByLocation\[warehouseId\] \?\? 0\)\)/);
  assert.match(page, /return row\.ffStock\[warehouseId\] \?\? 0/);
  assert.match(page, /Фактически на ФФ \{formatNumber\.format\(ffPhysicalTotal\)\}/);
});

test("Яндекс Маркет имеет изолированный кабинет с FBS, FBY и остатками ФФ", async () => {
  const [page, auth, inventory, analytics] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/admin-auth.ts", root), "utf8"),
    readFile(new URL("app/api/yandex/inventory/route.ts", root), "utf8"),
    readFile(new URL("app/api/analytics/route.ts", root), "utf8"),
  ]);

  assert.match(auth, /cabinetIds = \["metanutrix", "ozon", "yandex"\]/);
  assert.match(page, /\/api\/yandex\/inventory/);
  assert.match(page, /ID кампании FBS ЯМ/);
  assert.match(inventory, /placementType\?\.toUpperCase\(\) === "FBS"/);
  assert.match(inventory, /placementType\?\.toUpperCase\(\) === "FBY"/);
  assert.match(inventory, /syncMarketplaceFbsWarehouses/);
  assert.match(analytics, /cabinetId === "ozon" \|\| cabinetId === "yandex"/);
});

test("таргет Яндекс Маркета не наследует таблицу WB и обновляет только свои цены", async () => {
  const [storage, route, refresh] = await Promise.all([
    readFile(new URL("db/target-prices.ts", root), "utf8"),
    readFile(new URL("app/api/target-prices/route.ts", root), "utf8"),
    readFile(new URL("lib/yandex-target-prices.ts", root), "utf8"),
  ]);

  assert.match(storage, /cabinetId === "yandex"\s*\? \[\]/);
  assert.match(route, /session\.cabinetId === "yandex"/);
  assert.match(route, /refreshYandexTargetPrices/);
  assert.match(refresh, /\/v2\/campaigns\/\$\{campaignId\}\/offer-prices/);
  assert.match(refresh, /explicitly manual until a legal, dedicated market-data source/);
});
