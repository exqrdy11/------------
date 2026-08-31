import assert from "node:assert/strict";
import test from "node:test";

import { patchFfAnalysisClient, patchFfPlanningRoute, patchFfPlanningStore } from "../ops/patch-ff-planning-store.mjs";

const brokenStore = String.raw`
const READ_PLANNING_METRICS_SQL = \`
  SELECT
    m.warehouse_id AS "warehouseId",
    m.product_key AS "productKey",
    m.nm_id AS "nmId",
    m.sku,
    s.period_from AS date,
    m.demand,
    m.sold
  FROM ff_planning_snapshots AS s
\`;

function aggregatePeriodMetrics(metrics, period) {
  const aggregate = new Map();
  for (const metric of metrics) {
    const date = calendarDate(metric.date);
    if (date < period.from || date > period.to) throw new Error("Дневная метрика выходит за границы обновляемого периода");
    const warehouseId = String(metric.warehouseId ?? "").trim();
    const productKey = String(metric.productKey ?? "").trim();
    const sku = String(metric.sku ?? "");
    if (!warehouseId || !productKey) throw new Error("Для метрики обязательны склад и товар");
    const key = \`${"${warehouseId}"}\\u0000${"${productKey}"}\\u0000${"${sku}"}\`;
    const current = aggregate.get(key) ?? { warehouseId, productKey, nmId: metric.nmId ?? null, sku, demand: 0, sold: 0 };
    current.demand += finiteCount(metric.demand);
    current.sold += finiteCount(metric.sold);
    if (current.nmId == null && metric.nmId != null) current.nmId = metric.nmId;
    aggregate.set(key, current);
  }
  return [...aggregate.values()].sort((left, right) => left.warehouseId.localeCompare(right.warehouseId) || left.productKey.localeCompare(right.productKey) || left.sku.localeCompare(right.sku));
}

const statement = d1.prepare(\`
  INSERT INTO ff_daily_metrics (cabinet_id, metric_date, warehouse_id, product_key, nm_id, sku, demand, sold, updated_at)
  SELECT ?, ?,
    json_extract(value, '$.warehouseId'),
    json_extract(value, '$.productKey')
  FROM json_each(?)
\`).bind(input.cabinetId, period.from, generation, chunk);
`.replaceAll("\\`", "`").replaceAll("\\\\u0000", "\\u0000");

test("production snapshot patch keeps every WB metric on its real calendar day", () => {
  const patched = patchFfPlanningStore(brokenStore);

  assert.match(patched, /m\.metric_date AS date/);
  assert.match(patched, /const key = `\$\{date\}\\u0000\$\{warehouseId\}/);
  assert.match(patched, /\{ date, warehouseId, productKey/);
  assert.match(patched, /SELECT \?, json_extract\(value, '\$\.date'\),/);
  assert.match(patched, /\.bind\(input\.cabinetId, generation, chunk\)/);
  assert.doesNotMatch(patched, /s\.period_from AS date/);
  assert.doesNotMatch(patched, /\.bind\(input\.cabinetId, period\.from, generation, chunk\)/);
});

test("patch refuses an unknown store shape instead of silently deploying a partial fix", () => {
  assert.throws(() => patchFfPlanningStore("export const untouched = true;"), /не найден/);
});

test("saved snapshot GET falls back to the latest coherent 90-day snapshot", () => {
  const source = `
    return dependencies.loadPlanning({ cabinetId, period, warehouseId: requestInput.warehouseId ?? null, warnings: [] });
    return dependencies.loadPlanning({ cabinetId, period, warnings: [], fallbackToPersisted: true });
  `;
  assert.match(patchFfPlanningRoute(source), /fallbackToPersisted: true/);
  assert.match(patchFfPlanningRoute(source), /warehouseId: requestInput\.warehouseId \?\? null, warnings: \[\], fallbackToPersisted: true/);
});

test("manual refresh updates the full history window and the UI labels the 07:00 schedule", () => {
  const source = `
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
const status = model.updatedAt ? \`Данные сохранены \${escapeHtml(formatDateTime(model.updatedAt))}\` : "Снимок ещё не создан";
const planning = await postPlanningAction("refresh", { from: state.from, to: state.to }, fetchImpl);
`;
  const patched = patchFfAnalysisClient(source);
  assert.match(patched, /function fullRefreshPeriod\(\)/);
  assert.match(patched, /postPlanningAction\("refresh", fullRefreshPeriod\(\), fetchImpl\)/);
  assert.match(patched, /Автообновление ежедневно в 07:00 МСК/);
});
