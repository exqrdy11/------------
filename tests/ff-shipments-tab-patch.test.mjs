import assert from "node:assert/strict";
import test from "node:test";

import { patchFfShipmentsTab } from "../ops/patch-ff-shipments-tab.mjs";

const code = (value) => value.replaceAll("\\${", "${").replaceAll("\\`", "`");
const productionShape = code(String.raw`
const SUPPLY_LABELS = { draft: "Черновик", in_transit: "В пути", received: "Принята", cancelled: "Отменена" };
function escapeHtml(value) { return String(value ?? ""); }
function formatDate(value) { return String(value ?? "").slice(0, 10); }
function formatDateTime(value) { return String(value ?? ""); }
function formatNumber(value) { return String(value ?? 0); }
function disabledAttribute() { return ""; }
function renderSupplyItem(item) { return \`<li>\${item.sku}</li>\`; }
function renderMessages() { return ""; }
function renderSummary() { return ""; }
function renderSupplyComposer() { return ""; }
function renderSkuRow() { return ""; }
function renderSupplyHistory(model, options = {}) {
  const supplies = options.supplies ?? model.supplies;
  const archived = Boolean(options.archived);
  const sectionClass = archived ? "ff-analysis-history ff-analysis-archived-history" : "ff-analysis-history";
  const titleId = archived ? "ff-analysis-archived-history-title" : "ff-analysis-history-title";
  const title = archived ? "Архив скрытых ФФ" : "История движения";
  const kicker = archived ? "ТОЛЬКО ПРОСМОТР" : "ПОСТАВКИ";
  if (!supplies.length) return \`<section class="\${sectionClass}"><h2 id="\${titleId}">\${title}</h2></section>\`;
  const cards = supplies.map((supply) => {
    const status = Object.hasOwn(SUPPLY_LABELS, supply.status) ? supply.status : "cancelled";
    const actions = [];
    if (!archived && status === "draft") {
      actions.push(\`<button type="button" data-action="download-supply" data-shipment-id="\${escapeHtml(supply.id)}">CSV</button>\`);
      actions.push(\`<button type="button" data-action="dispatch-supply" data-shipment-id="\${escapeHtml(supply.id)}">Передать в пути</button>\`);
    }
    return \`<article><header><strong>Поставка \${escapeHtml(supply.id)}</strong></header><p>\${supply.warehouseLabel ? \`\${escapeHtml(supply.warehouseLabel)} · \` : ""}</p>\${actions.join("")}</article>\`;
  }).join("");
  return \`<section class="\${sectionClass}" aria-labelledby="\${titleId}"><span>\${kicker}</span><h2 id="\${titleId}">\${title}</h2>\${cards}</section>\`;
}
export function renderAnalysisMarkup(model) {
  const warehouses = Array.isArray(model.warehouses) ? model.warehouses : [];
  if (!warehouses.length && !model.loading && !model.error) {
    return \`<section class="ff-analysis-root"><h1>Нет активных ФФ</h1>\${renderSupplyHistory(model, { supplies: Array.isArray(model.archivedSupplies) ? model.archivedSupplies : [], archived: true })}</section>\`;
  }
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const analysis = model.updatedAt ? \`\${renderSummary(model)}\${renderSupplyComposer(model)}\` : "";
  return \`<section class="ff-analysis-root"><h1>Анализ ФФ</h1>\${renderMessages(model)}\${analysis}\${renderSupplyHistory({ ...model, supplies: Array.isArray(model.supplies) ? model.supplies : [] })}\${renderSupplyHistory(model, { supplies: Array.isArray(model.archivedSupplies) ? model.archivedSupplies : [], archived: true })}</section>\`;
}
export function deriveAnalysisModel(input = {}) {
  const planning = input.planning ?? {};
  const allWarehouses = Array.isArray(planning.warehouses) ? planning.warehouses : [];
  const warehouses = allWarehouses.filter((warehouse) => !warehouse.isHidden);
  const hiddenWarehouses = new Map(allWarehouses.filter((warehouse) => warehouse.isHidden).map((warehouse) => [warehouse.id, warehouse]));
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === input.selectedWarehouseId) ?? warehouses[0] ?? null;
  const allSupplies = Array.isArray(planning.supplies) ? planning.supplies : [];
  const supplies = allSupplies.filter((supply) => supply.warehouseId === selectedWarehouse?.id);
  const archivedSupplies = allSupplies.flatMap((supply) => {
    const warehouse = hiddenWarehouses.get(supply.warehouseId);
    return warehouse ? [{ ...supply, warehouseLabel: \`\${warehouse.city} — \${warehouse.name}\` }] : [];
  });
  return { warehouses, selectedWarehouseId: selectedWarehouse?.id ?? "", rows: [], supplies, archivedSupplies };
}
function inventoryIndex(rows) { return new Map(rows ?? []); }
function stateModel(state) { return deriveAnalysisModel(state); }
function renderState(root, state) {
  root.innerHTML = renderAnalysisMarkup(stateModel(state));
}
function supplyById(state, shipmentId) { return state.planning.supplies?.find((supply) => supply.id === shipmentId); }
function loadSavedAnalysis() {}
function runPlanningMutation() {}
function buildDispatchPayload(shipmentId) { return { shipmentId }; }
function bindAnalysisEvents(root, state) {
  const handler = (event) => {
    const target = event.target.closest?.("[data-action]");
    if (!target || event.type !== "click" || target.disabled) return;
    const action = target.dataset.action;
    const shipmentId = target.dataset.shipmentId;
    if (action === "refresh") return;
    else if (action === "dispatch-supply") void runPlanningMutation(root, state, action, buildDispatchPayload(shipmentId));
  };
  root.addEventListener("click", handler);
}
function adaptNavigation(navigation, root, content) {
  const analysisLocation = () => window.location.hash === "#ff-analysis";
  const sync = () => {
    if (!navigation.querySelector("[data-ff-analysis-nav]")) {
      const button = document.createElement("button");
      button.dataset.ffAnalysisNav = "";
      button.textContent = "Анализ ФФ";
      navigation.append(button);
    }
  };
  sync();
  if (analysisLocation()) root.hidden = false;
  return () => { content.hidden = false; };
}
let activeShell = null;
`);

function evaluatePatched(source) {
  const executable = source.replaceAll("export function", "function");
  return new Function(`${executable}\nreturn { deriveAnalysisModel, renderShipmentsMarkup, renderFfWorkspaceMarkup, ffCustomViewFromHash, prepareDraftForEditing };`)();
}

test("shipments tab shows every active FF and uses a human-readable title instead of UUID", () => {
  const patched = patchFfShipmentsTab(productionShape);
  const { deriveAnalysisModel, renderFfWorkspaceMarkup } = evaluatePatched(patched);
  const model = deriveAnalysisModel({
    selectedWarehouseId: "volgograd",
    planning: {
      warehouses: [
        { id: "volgograd", city: "Волгоград", name: "Upakovka", isHidden: false },
        { id: "top-full", city: "Москва", name: "Top-Full", isHidden: false },
        { id: "old", city: "Казань", name: "Старый ФФ", isHidden: true },
      ],
      supplies: [
        { id: "7c4a9f90-617f-4f48-8ed9-f22cde0df16f", warehouseId: "volgograd", status: "draft", createdAt: "2026-09-01T07:00:00Z", items: [] },
        { id: "f464bb47-0000-4000-8000-123456789012", warehouseId: "top-full", status: "in_transit", createdAt: "2026-09-01T08:00:00Z", items: [] },
        { id: "orphan-draft", warehouseId: "missing-ff", warehouseLabel: "Сохранённый ФФ", status: "draft", createdAt: "2026-09-01T09:00:00Z", items: [] },
        { id: "archive-uuid", warehouseId: "old", status: "received", createdAt: "2026-08-01T08:00:00Z", items: [] },
      ],
    },
  });

  assert.equal(model.shipmentSupplies.length, 3);
  const analysisHtml = renderFfWorkspaceMarkup(model, "analysis");
  const shipmentsHtml = renderFfWorkspaceMarkup(model, "shipments");
  assert.doesNotMatch(analysisHtml, /История движения/);
  assert.match(shipmentsHtml, />Отгрузки</);
  assert.match(shipmentsHtml, /Поставка → Волгоград — Upakovka · 2026-09-01/);
  assert.match(shipmentsHtml, /Поставка → Москва — Top-Full · 2026-09-01/);
  assert.match(shipmentsHtml, /Поставка → Сохранённый ФФ · 2026-09-01/);
  assert.match(shipmentsHtml, /data-action="edit-supply"[^>]*>Редактировать состав/);
  assert.match(shipmentsHtml, />Отправить в путь</);
  assert.equal((shipmentsHtml.match(/data-action="edit-supply"/g) ?? []).length, 2);
  assert.doesNotMatch(shipmentsHtml, />Поставка 7c4a9f90-617f-4f48-8ed9-f22cde0df16f</);
});

test("custom navigation recognizes both Analysis FF and Shipments views", () => {
  const patched = patchFfShipmentsTab(productionShape);
  const { ffCustomViewFromHash } = evaluatePatched(patched);
  assert.equal(ffCustomViewFromHash("#ff-analysis"), "analysis");
  assert.equal(ffCustomViewFromHash("#ff-shipments"), "shipments");
  assert.equal(ffCustomViewFromHash("#overview"), null);
  assert.equal(patchFfShipmentsTab(patched), patched);
});

test("only a draft can be selected for editing", () => {
  const { prepareDraftForEditing } = evaluatePatched(patchFfShipmentsTab(productionShape));
  const state = {
    selectedWarehouseId: "old",
    selectedProductKeys: new Set(["sku:old"]),
    quantitiesByProduct: new Map([["sku:old", 3]]),
  };
  assert.equal(prepareDraftForEditing(state, { status: "in_transit", warehouseId: "blocked" }), false);
  assert.equal(state.selectedWarehouseId, "old");
  assert.equal(prepareDraftForEditing(state, { status: "draft", warehouseId: "volgograd" }), true);
  assert.equal(state.selectedWarehouseId, "volgograd");
  assert.equal(state.selectedProductKeys, null);
  assert.equal(state.quantitiesByProduct.size, 0);
});

test("shipments are split into active, received and archive tabs and can be filtered by FF", () => {
  const { deriveAnalysisModel, renderShipmentsMarkup } = evaluatePatched(patchFfShipmentsTab(productionShape));
  const baseModel = deriveAnalysisModel({
    planning: {
      warehouses: [
        { id: "volgograd", city: "Волгоград", name: "Upakovka", isHidden: false },
        { id: "top-full", city: "Москва", name: "Top-Full", isHidden: false },
      ],
      supplies: [
        { id: "volgograd-draft", warehouseId: "volgograd", status: "draft", createdAt: "2026-09-02", items: [] },
        { id: "top-full-transit", warehouseId: "top-full", status: "in_transit", createdAt: "2026-09-02", items: [] },
        { id: "volgograd-received", warehouseId: "volgograd", status: "received", createdAt: "2026-09-01", items: [] },
        { id: "volgograd-cancelled", warehouseId: "volgograd", status: "cancelled", createdAt: "2026-08-31", items: [] },
      ],
    },
  });

  const activeHtml = renderShipmentsMarkup(baseModel);
  assert.match(activeHtml, /data-ff-shipment-filters/);
  assert.match(activeHtml, /Активные[^<]*2/);
  assert.match(activeHtml, /Принятые[^<]*1/);
  assert.match(activeHtml, /Архив[^<]*1/);
  assert.match(activeHtml, /volgograd-draft/);
  assert.match(activeHtml, /Поставка → Москва — Top-Full · 2026-09-02/);
  assert.doesNotMatch(activeHtml, /2026-09-01/);
  assert.doesNotMatch(activeHtml, /2026-08-31/);

  const receivedHtml = renderShipmentsMarkup({ ...baseModel, shipmentStatusFilter: "received" });
  assert.match(receivedHtml, /Поставка → Волгоград — Upakovka · 2026-09-01/);
  assert.doesNotMatch(receivedHtml, /volgograd-draft/);

  const archiveHtml = renderShipmentsMarkup({ ...baseModel, shipmentStatusFilter: "archive" });
  assert.match(archiveHtml, /Поставка → Волгоград — Upakovka · 2026-08-31/);
  assert.doesNotMatch(archiveHtml, /2026-09-01/);

  const filteredHtml = renderShipmentsMarkup({ ...baseModel, shipmentWarehouseFilter: "volgograd" });
  assert.match(filteredHtml, /Активные[^<]*1/);
  assert.match(filteredHtml, /volgograd-draft/);
  assert.doesNotMatch(filteredHtml, /Москва — Top-Full · 2026-09-02/);
});
