import assert from "node:assert/strict";
import test from "node:test";

import { patchFfForecastClient } from "../ops/patch-ff-forecast-client.mjs";

const productionShape = [
  'const RISK_LABELS = { critical: "Критично" };',
  'function renderSkuRow(row, model) {',
  '  return `<td data-label="Продажи">${formatNumber(row.sales)}</td><td data-label="Среднее в день">${formatNumber(row.averageDailySales)}</td>`;',
  '}',
  'function renderSummary(model) {',
  '  const totals = model.totals ?? {};',
  '  return `<article><span>Продано за период</span><strong>${formatNumber(totals.sales)}</strong></article><article><span>Среднее в день</span><strong>${formatNumber(totals.averageDailySales)}</strong></article>`;',
  '}',
  'analysis = buildWarehouseAnalysis({',
  '  warehouseId: selectedWarehouse.id,',
  '  from: input.from,',
  '  to: input.to,',
  '  targetDays: 14,',
  '});',
  'const analysis = model.updatedAt ? `${renderSummary(model)}<table><thead><tr><th>Продажи</th><th>Среднее в день</th></tr></thead></table>` : "";',
  '${renderMessages(model)}',
  '${analysis}',
  'function ensureStylesheet() {',
  '  if (document.querySelector("link[data-ff-analysis-style]")) return;',
  '  const link = document.createElement("link");',
  '  link.rel = "stylesheet";',
  '  link.href = "/assets/ff-analysis.css?v=old";',
  '  link.dataset.ffAnalysisStyle = "";',
  '  document.head.append(link);',
  '}',
  'averageDailySales: allRows.reduce((sum, row) => sum + row.averageDailySales, 0),',
].join("\n");

test("client patch separates factual period metrics from the stable forecast", () => {
  const patched = patchFfForecastClient(productionShape);

  assert.match(patched, /Выкуплено по заказам периода/);
  assert.match(patched, /Прогноз в день/);
  assert.match(patched, /7д .*14д .*28д/);
  assert.match(patched, /asOf: new Date\(planning\.updatedAt\)/);
  assert.match(patched, /openedAt: selectedWarehouse\.openedAt/);
  assert.match(patched, /выбранные даты показывают факт/i);
  assert.match(patched, /existing\.href = href/);
  assert.match(patched, /ff-analysis\.css\?v=20260831-robust1/);
});

test("client patch is idempotent and rejects an unknown bundle shape", () => {
  const once = patchFfForecastClient(productionShape);
  assert.equal(patchFfForecastClient(once), once);
  assert.throws(() => patchFfForecastClient("export const untouched = true;"), /не найден/);
});
