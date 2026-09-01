import assert from "node:assert/strict";
import test from "node:test";

import * as planningPatches from "../ops/patch-ff-planning-store.mjs";

const { patchFfAnalysisClient, patchFfPlanningRoute, patchFfPlanningStore } = planningPatches;

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

test("planning mutations time out and reconcile the saved server state", () => {
  const source = `
function fullRefreshPeriod() { return { from: "2026-01-01", to: "2026-01-31" }; }
const scheduleLabel = "Автообновление ежедневно в 07:00 МСК";
export async function fetchSavedAnalysisSnapshot({ from, to, fetchImpl = fetch }) {
  const query = new URLSearchParams({ from, to });
  const init = { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" };
  const planningResponse = await fetchImpl(\`/api/ff-planning?\${query}\`, init);
  return { planning: await planningResponse.json(), inventory: {} };
}
export async function postPlanningAction(action, body, fetchImpl = fetch) {
  if (!PLANNING_ACTIONS.has(action)) throw new Error("Неизвестное действие");
  const response = await fetchImpl("/api/ff-planning", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ action, ...body }),
  });
  return response.json();
}
export async function runPlanningMutation(root, state, action, body, fetchImpl = fetch) {
  if (state.actionPending || state.refreshing) return false;
  state.actionPending = true;
  state.error = null;
  renderState(root, state);
  let succeeded = false;
  try {
    const planning = await postPlanningAction(action, { from: state.from, to: state.to, ...body }, fetchImpl);
    if (!Array.isArray(planning.inventory?.rows)) throw new Error("Ответ планирования не содержит сохранённые остатки");
    applySnapshot(state, { planning, inventory: planning.inventory });
    state.selectedProductKeys = null;
    state.quantitiesByProduct.clear();
    succeeded = true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Не удалось изменить поставку";
  } finally {
    state.actionPending = false;
    renderState(root, state);
  }
  return succeeded;
}
`;
  const patched = patchFfAnalysisClient(source);
  assert.match(patched, /PLANNING_REQUEST_TIMEOUT_MS/);
  assert.match(patched, /fetchPlanningWithTimeout/);
  assert.match(patched, /planningMutationApplied/);
  assert.match(patched, /Сохранённые отгрузки перепроверены/);
  assert.match(patched, /fetchSavedAnalysisSnapshot\(\{ from: state\.from, to: state\.to, fetchImpl \}\)/);
});

const brokenStockAttachment = `
function indexPhysicalStocks(stocks) {
  return new Map(stocks.map((stock) => [\`${"${stock.location}"}:${"${stock.productKey}"}\`, stock]));
}
function indexPhysicalBatches() { return new Map(); }
function selectedIndexedStock(row, location, index) { return index.get(\`${"${location}"}:${"${row.key}"}\`) ?? null; }
function indexKey(location, productKey) { return \`${"${location}"}:${"${productKey}"}\`; }
function stockProductKey(stock) { return stock.productKey; }

export function attachPhysicalStocks(rows, warehouses, stocks, batches) {
  const stockIndex = indexPhysicalStocks(stocks);
  const batchIndex = indexPhysicalBatches(batches);
  return rows.map(row => {
    const ffStock = {};
    const ffExpiry = {};
    const ffBatches = {};
    for (const warehouse of warehouses) {
      const stock = selectedIndexedStock(row, warehouse.id, stockIndex);
      ffStock[warehouse.id] = Math.max(0, Number(stock?.quantity) || 0);
      ffExpiry[warehouse.id] = stock?.expiresAt ?? stock?.expires_at ?? null;
      ffBatches[warehouse.id] = stock ? (batchIndex.get(indexKey(warehouse.id, stockProductKey(stock))) ?? [])
        .map(batch => ({ quantity: Math.max(0, Number(batch.quantity) || 0) }))
        : [];
    }
    return { ...row, ffStock, ffExpiry, ffBatches };
  });
}
`;

test("production stock attachment keeps saved WB FBS stock when no manual stock row exists", () => {
  assert.equal(typeof planningPatches.patchFfPlanningStockAttachment, "function");
  const patched = planningPatches.patchFfPlanningStockAttachment(brokenStockAttachment);
  const attachPhysicalStocks = new Function(`${patched.replace("export function", "function")}\nreturn attachPhysicalStocks;`)();
  const [row] = attachPhysicalStocks(
    [{ key: "nm:123", ffStock: { ff_api: 24, ff_manual: 9 } }],
    [{ id: "ff_api" }, { id: "ff_manual" }, { id: "ff_empty" }],
    [{ location: "ff_manual", productKey: "nm:123", quantity: 4 }],
    [],
  );

  assert.deepEqual(row.ffStock, { ff_api: 24, ff_manual: 4, ff_empty: 0 });
});

const brokenPlanningRefresh = `
async function prepareWbFfPlanningMetrics(input) {
  const d1 = await getFfPlanningDb();
  input.signal?.throwIfAborted();
  const [{ orders, statuses }, currentOrders, warehouses, cards] = await Promise.all([
        getPlanningOrders(input.token, input.from, input.to, input.signal),
        getOrders$1(input.token, input.signal),
        listFfWarehouses(input.cabinetId),
        getCards(input.token, input.signal)
  ]);
  input.signal?.throwIfAborted();
  assertUniqueWbWarehouseMappings(warehouses);
  const sellableCards = selectSellableWbCards(cards);
  const sellableNmIds = sellableWbProductIds(sellableCards);
  const sellableOrders = orders.filter((order) => isSellableWbProduct(sellableNmIds, order.nmId));
  const warehouseMappings = warehouses.map((warehouse) => ({
        warehouseId: warehouse.wbWarehouseId,
        warehouseName: warehouse.wbWarehouseName,
        ffWarehouseId: warehouse.id
  }));
  const { daily, warnings } = aggregateWbPlanningMetrics({
        orders: sellableOrders,
        statuses: [...statuses.values()],
        warehouseMappings
  });
  if (!sellableNmIds.size) warnings.push("Нет товаров");
  const products = sellableCards.flatMap((card) => {
        const nmId = Number(card.nmID ?? card.nmId);
        if (!Number.isInteger(nmId) || nmId <= 0) return [];
        return [{ key: \`nm:${"${nmId}"}\`, nmId, sku: card.vendorCode, name: card.title, category: "WB", color: "blue" }];
  });
  return {
    d1,
    snapshot: {
      cabinetId: input.cabinetId,
      from: input.from,
      to: input.to,
      metrics: daily,
      inventoryRows: buildPlanningInventoryRows({
        products,
        orders: currentOrders.orders.filter((order) => isSellableWbProduct(sellableNmIds, order.nmId)),
        statuses: currentOrders.statuses,
        warehouses
      }),
      warnings,
      generation: (new Date()).toISOString()
    }
  };
}
`;

function planningRefreshFromPatchedSource(source, fbsStockResult) {
  const names = [
    "getFfPlanningDb", "getPlanningOrders", "getOrders$1", "listFfWarehouses", "getCards",
    "assertUniqueWbWarehouseMappings", "selectSellableWbCards", "sellableWbProductIds",
    "isSellableWbProduct", "aggregateWbPlanningMetrics", "buildPlanningInventoryRows",
    "getSellerWarehouses", "getFbsStocks",
  ];
  const values = [
    async () => ({}),
    async () => ({ orders: [], statuses: new Map() }),
    async () => ({ orders: [], statuses: new Map() }),
    async () => [{ id: "wb_1987385", wbWarehouseId: "1987385", wbWarehouseName: "Волгоград" }],
    async () => [{ nmID: 123, vendorCode: "SKU-123", title: "Товар" }],
    () => {},
    (cards) => cards,
    (cards) => new Set(cards.map((card) => card.nmID)),
    (ids, nmId) => ids.has(nmId),
    () => ({ daily: [], warnings: [] }),
    ({ products }) => products,
    async () => [{ id: 1987385, name: "Волгоград" }],
    async () => fbsStockResult,
  ];
  return new Function(...names, `${source}\nreturn prepareWbFfPlanningMetrics;`)(...values);
}

test("manual planning refresh stores current WB FBS stock by mapped FF warehouse", async () => {
  assert.equal(typeof planningPatches.patchFfPlanningServerStocks, "function");
  const patched = planningPatches.patchFfPlanningServerStocks(brokenPlanningRefresh);
  const refresh = planningRefreshFromPatchedSource(patched, {
    stockByWarehouse: new Map([["1987385", new Map([[123, 24]])]]),
    syncedWarehouseIds: ["1987385"],
    errors: [],
  });
  const result = await refresh({ token: "secret", cabinetId: "metanutrix", from: "2026-08-01", to: "2026-08-31" });

  assert.deepEqual(result.snapshot.inventoryRows[0].ffStock, { wb_1987385: 24 });
});

test("planning refresh refuses a partial WB stock response so it cannot replace the last good snapshot with zero", async () => {
  assert.equal(typeof planningPatches.patchFfPlanningServerStocks, "function");
  const patched = planningPatches.patchFfPlanningServerStocks(brokenPlanningRefresh);
  const refresh = planningRefreshFromPatchedSource(patched, {
    stockByWarehouse: new Map(),
    syncedWarehouseIds: [],
    errors: [{ warehouseId: "1987385", warehouse: "Волгоград", reason: new Error("429") }],
  });

  await assert.rejects(
    refresh({ token: "secret", cabinetId: "metanutrix", from: "2026-08-01", to: "2026-08-31" }),
    /429/,
  );
});
