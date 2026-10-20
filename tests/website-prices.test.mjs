import assert from "node:assert/strict";
import test from "node:test";

import { attachWebsitePrices, parseWebsitePricesCsv } from "../lib/website-prices.ts";

const csv = `Данные 23.09.2026,,,,
Артикул OZON,Артикул WB,Артикул Яндекс,Наименование товара,Цена сайт
АльфаЛипоевая60,АльфалипоеваяКислота60,,"Альфа-липоевая кислота, 60 капсул",427
ЕЖжидкий30,ExtractEjovik30,,Жидкий экстракт,1 646
Коэнзим90,Коэнзим90,,Коэнзим,
`;

test("из выгрузки Google Sheets читается цена сайта по артикулу WB", () => {
  const prices = parseWebsitePricesCsv(csv);

  assert.equal(prices.get("АльфалипоеваяКислота60"), 427);
  assert.equal(prices.get("ExtractEjovik30"), 1646);
  assert.equal(prices.has("Коэнзим90"), false);
});

test("цена сайта добавляется к совпавшему артикулу, а пустая цена остаётся null", async () => {
  const response = new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } });
  const result = await attachWebsitePrices(
    [{ sku: "ExtractEjovik30" }, { sku: "Коэнзим90" }],
    async () => response,
  );

  assert.deepEqual(result.rows, [
    { sku: "ExtractEjovik30", websitePrice: 1646 },
    { sku: "Коэнзим90", websitePrice: null },
  ]);
  assert.equal(result.warning, null);
});

test("ошибка Google Sheets не ломает таргет цен", async () => {
  const result = await attachWebsitePrices(
    [{ sku: "ExtractEjovik30" }],
    async () => new Response("unavailable", { status: 503 }),
  );

  assert.deepEqual(result.rows, [{ sku: "ExtractEjovik30", websitePrice: null }]);
  assert.match(result.warning ?? "", /цены сайта/i);
});

test("артикулы сопоставляются с учётом регистра", async () => {
  const caseSensitiveCsv = `Артикул WB,Цена сайт\nSku-1,900\n`;
  const result = await attachWebsitePrices(
    [{ sku: "SKU-1" }, { sku: "Sku-1" }],
    async () => new Response(caseSensitiveCsv, { status: 200 }),
  );

  assert.deepEqual(result.rows, [
    { sku: "SKU-1", websitePrice: null },
    { sku: "Sku-1", websitePrice: 900 },
  ]);
});

test("ответ 200 без нужных колонок считается ошибкой источника", async () => {
  const result = await attachWebsitePrices(
    [{ sku: "ExtractEjovik30" }],
    async () => new Response("<html>Google sign in</html>", { status: 200 }),
  );

  assert.deepEqual(result.rows, [{ sku: "ExtractEjovik30", websitePrice: null }]);
  assert.match(result.warning ?? "", /цены сайта/i);
});
