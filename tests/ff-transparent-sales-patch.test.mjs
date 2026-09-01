import assert from "node:assert/strict";
import test from "node:test";

import { patchFfTransparentSales } from "../ops/patch-ff-transparent-sales.mjs";

const code = (value) => value.replaceAll("\\${", "${").replaceAll("\\`", "`");
const source = code(String.raw`
function renderSkuRow(row, model) {
  return \`<td data-label="Выкуплено">\${formatNumber(row.sales)}<small>Факт выбранного периода</small></td>
    <td data-label="Прогноз в день"><strong>\${formatNumber(row.forecastDailySales)}</strong><small>7д \${formatNumber(row.windowRates?.[7])} · 14д \${formatNumber(row.windowRates?.[14])} · 28д \${formatNumber(row.windowRates?.[28])}</small></td>\`;
}
function renderSummary(model) {
  const totals = model.totals ?? {};
  return \`<article><span>Выкуплено по заказам периода</span><strong>\${formatNumber(totals.sales)}</strong><small>Факт: \${formatNumber(totals.reportAverageDailySales)} шт./день</small></article>
    <article><span>Прогноз в день</span><strong>\${formatNumber(totals.forecastDailySales ?? totals.averageDailySales)}</strong><small>7д \${formatNumber(totals.windowRates?.[7])} · 14д \${formatNumber(totals.windowRates?.[14])} · 28д \${formatNumber(totals.windowRates?.[28])}</small></article>\`;
}
const analysis = model.updatedAt ? \`<table><thead><tr><th>Выкуплено</th><th>Прогноз в день</th></tr></thead></table>\` : "";
const result = {
  totals: {
    ...analysis.totals,
    averageDailySales: allRows.reduce((sum, row) => sum + row.averageDailySales, 0),
    availableStock: allRows.reduce((sum, row) => sum + row.availableStock, 0),
  },
};
`);

test("показывает фактические продажи в день и прозрачную формулу", () => {
  const patched = patchFfTransparentSales(source);

  assert.match(patched, /Факт продаж в день/);
  assert.match(patched, /row\.sales.*÷.*row\.reportDays/);
  assert.match(patched, /totals\.sales.*÷.*totals\.reportDays/);
  assert.match(patched, /Расчётный темп/);
  assert.match(patched, /reportDays: Math\.max\(0, \.\.\.allRows\.map/);
  assert.equal(patchFfTransparentSales(patched), patched);
});

test("отказывается молча изменять незнакомый бандл", () => {
  assert.throws(() => patchFfTransparentSales("export const untouched = true;"), /не найден/);
});
