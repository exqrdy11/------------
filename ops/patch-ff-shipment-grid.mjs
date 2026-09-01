import { readFile, writeFile } from "node:fs/promises";

const MARKER = "data-ff-draft-grid";

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

export function parseShipmentGridPaste(value) {
  const rows = [];
  for (const rawLine of String(value ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const delimiter = rawLine.includes("\t") ? "\t" : rawLine.includes(";") ? ";" : ",";
    const cells = rawLine.split(delimiter).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/^(артикул|sku|товар)$/iu.test(cells[0]) && /^(количество|кол-во|quantity|qty)$/iu.test(cells[1])) continue;
    const quantity = Number(String(cells[1]).replaceAll(" ", ""));
    if (!cells[0] || !Number.isInteger(quantity) || quantity <= 0) continue;
    rows.push({ query: cells[0], quantity });
  }
  return rows;
}

export function createShipmentGridDraft(supply, catalog = []) {
  if (!supply || supply.status !== "draft") return null;
  const catalogByKey = new Map((catalog ?? []).map((item) => [String(item.productKey), item]));
  return new Map((supply.items ?? []).map((item) => {
    const productKey = String(item.productKey ?? "");
    const catalogItem = catalogByKey.get(productKey) ?? {};
    return [productKey, {
      productKey,
      nmId: item.nmId ?? catalogItem.nmId ?? null,
      sku: String(item.sku || catalogItem.sku || productKey),
      name: String(catalogItem.name || item.name || item.sku || productKey),
      quantity: Math.max(0, Math.trunc(Number(item.plannedQuantity ?? item.quantity) || 0)),
    }];
  }));
}

export function buildShipmentGridPayload(shipmentId, value) {
  const items = value instanceof Map ? [...value.values()] : [];
  return {
    shipmentId,
    items: items
      .map((item) => ({
        productKey: item.productKey,
        nmId: item.nmId ?? null,
        sku: item.sku || item.productKey,
        quantity: Math.max(0, Math.trunc(Number(item.quantity) || 0)),
      }))
      .filter((item) => item.productKey && item.quantity > 0),
  };
}

function runtimeTemplate() { /*__FF_SHIPMENT_GRID_START__
function shipmentGridCatalog(state) {
  const seen = new Set();
  return (state.inventory?.rows ?? []).flatMap((row) => {
    const productKey = String(row.key ?? row.productKey ?? "").trim();
    if (!productKey || seen.has(productKey)) return [];
    seen.add(productKey);
    return [{
      productKey,
      nmId: row.nmId ?? null,
      sku: String(row.sku || productKey),
      name: String(row.name || row.sku || productKey),
    }];
  });
}

function parseShipmentGridPaste(value) {
  const rows = [];
  for (const rawLine of String(value ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const delimiter = rawLine.includes("\t") ? "\t" : rawLine.includes(";") ? ";" : ",";
    const cells = rawLine.split(delimiter).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/^(артикул|sku|товар)$/iu.test(cells[0]) && /^(количество|кол-во|quantity|qty)$/iu.test(cells[1])) continue;
    const quantity = Number(String(cells[1]).replaceAll(" ", ""));
    if (!cells[0] || !Number.isInteger(quantity) || quantity <= 0) continue;
    rows.push({ query: cells[0], quantity });
  }
  return rows;
}

function createShipmentGridDraft(supply, catalog = []) {
  if (!supply || supply.status !== "draft") return null;
  const catalogByKey = new Map((catalog ?? []).map((item) => [String(item.productKey), item]));
  return new Map((supply.items ?? []).map((item) => {
    const productKey = String(item.productKey ?? "");
    const catalogItem = catalogByKey.get(productKey) ?? {};
    return [productKey, {
      productKey,
      nmId: item.nmId ?? catalogItem.nmId ?? null,
      sku: String(item.sku || catalogItem.sku || productKey),
      name: String(catalogItem.name || item.name || item.sku || productKey),
      quantity: Math.max(0, Math.trunc(Number(item.plannedQuantity ?? item.quantity) || 0)),
    }];
  }));
}

function buildShipmentGridPayload(shipmentId, value) {
  const items = value instanceof Map ? [...value.values()] : [];
  return {
    shipmentId,
    items: items
      .map((item) => ({
        productKey: item.productKey,
        nmId: item.nmId ?? null,
        sku: item.sku || item.productKey,
        quantity: Math.max(0, Math.trunc(Number(item.quantity) || 0)),
      }))
      .filter((item) => item.productKey && item.quantity > 0),
  };
}

function shipmentGridViewModel(state) {
  return {
    shipmentEditorId: state.shipmentEditorId ?? null,
    shipmentDraftItems: state.shipmentDraftItems instanceof Map ? state.shipmentDraftItems : new Map(),
    shipmentCatalogQuery: state.shipmentCatalogQuery ?? "",
    shipmentGridPaste: state.shipmentGridPaste ?? "",
    shipmentCatalog: shipmentGridCatalog(state),
  };
}

function shipmentGridLookup(catalog, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase("ru");
  if (!needle) return null;
  const exact = (catalog ?? []).find((item) => [item.productKey, item.sku, item.nmId]
    .some((value) => String(value ?? "").trim().toLocaleLowerCase("ru") === needle));
  if (exact) return exact;
  const matches = (catalog ?? []).filter((item) => `${item.sku} ${item.name} ${item.productKey}`.toLocaleLowerCase("ru").includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

function beginShipmentGridEdit(state, supply) {
  const draft = createShipmentGridDraft(supply, shipmentGridCatalog(state));
  if (!draft) return false;
  state.selectedWarehouseId = supply.warehouseId;
  state.shipmentEditorId = supply.id;
  state.shipmentDraftItems = draft;
  state.shipmentCatalogQuery = "";
  state.shipmentGridPaste = "";
  state.error = null;
  return true;
}

function closeShipmentGridEdit(state) {
  state.shipmentEditorId = null;
  state.shipmentDraftItems = new Map();
  state.shipmentCatalogQuery = "";
  state.shipmentGridPaste = "";
}

function addShipmentGridItem(state, query, quantity = 1) {
  const item = shipmentGridLookup(shipmentGridCatalog(state), query);
  if (!item) {
    state.error = "Товар не найден. Выберите точный артикул из списка.";
    return false;
  }
  state.shipmentDraftItems ??= new Map();
  const current = state.shipmentDraftItems.get(item.productKey);
  state.shipmentDraftItems.set(item.productKey, {
    ...item,
    quantity: current ? Math.max(1, Number(current.quantity) || 1) : Math.max(1, Math.trunc(Number(quantity) || 1)),
  });
  state.shipmentCatalogQuery = "";
  state.error = null;
  return true;
}

function applyShipmentGridPaste(state) {
  const parsed = parseShipmentGridPaste(state.shipmentGridPaste);
  if (!parsed.length) {
    state.error = "Не нашли строк формата «Артикул → Количество».";
    return false;
  }
  const missing = [];
  for (const row of parsed) {
    const item = shipmentGridLookup(shipmentGridCatalog(state), row.query);
    if (!item) {
      missing.push(row.query);
      continue;
    }
    state.shipmentDraftItems.set(item.productKey, { ...item, quantity: row.quantity });
  }
  state.shipmentGridPaste = "";
  state.error = missing.length ? `Не найдены: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}` : null;
  return missing.length < parsed.length;
}

function shipmentGridStyles() {
  return `<style data-ff-draft-grid-style>
    .ff-shipment-grid{margin-top:18px;border:1px solid #d9e2f2;border-radius:16px;background:#f8faff;overflow:hidden}
    .ff-shipment-grid__message{margin:14px 16px 0;padding:10px 12px;border-radius:10px;background:#fff1ee;color:#a33b2f;font-weight:700}
    .ff-shipment-grid__table-wrap{overflow-x:auto;background:#fff}
    .ff-shipment-grid table{width:100%;min-width:680px;border-collapse:collapse}
    .ff-shipment-grid th{padding:11px 14px;background:#eef3fb;color:#64738d;font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:.04em}
    .ff-shipment-grid td{padding:10px 14px;border-top:1px solid #e7ecf4;vertical-align:middle}
    .ff-shipment-grid td:nth-child(1){font-weight:800;color:#263754;white-space:nowrap}
    .ff-shipment-grid td:nth-child(2){width:100%;color:#52627c}
    .ff-shipment-grid input[type=number]{width:120px;min-height:42px;padding:8px 10px;border:1px solid #cfd9ea;border-radius:10px;background:#fff;font:inherit;font-weight:800;text-align:right}
    .ff-shipment-grid__remove{min-width:42px!important;padding:8px!important;border-color:#f1c8c3!important;background:#fff6f4!important;color:#b13a2c!important}
    .ff-shipment-grid__tools{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:10px;padding:14px 16px;border-top:1px solid #e1e7f1}
    .ff-shipment-grid__tools label{display:grid;gap:6px;color:#5f6e86;font-size:12px;font-weight:800}
    .ff-shipment-grid__tools input,.ff-shipment-grid__paste textarea{min-height:44px;padding:10px 12px;border:1px solid #cfd9ea;border-radius:10px;background:#fff;font:inherit}
    .ff-shipment-grid__paste{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:10px;padding:0 16px 14px}
    .ff-shipment-grid__paste textarea{min-height:76px;resize:vertical}
    .ff-shipment-grid__footer{display:flex;justify-content:flex-end;gap:10px;padding:14px 16px;background:#eef3fb}
    .ff-shipment-grid__empty{padding:22px;text-align:center;color:#748198}
    @media(max-width:760px){.ff-shipment-grid__tools,.ff-shipment-grid__paste{grid-template-columns:1fr}.ff-shipment-grid__footer{flex-wrap:wrap}.ff-shipment-grid__footer button{flex:1 1 180px}}
  </style>`;
}

function renderDraftShipmentGrid(supply, model) {
  if (!supply || supply.status !== "draft" || model.shipmentEditorId !== supply.id) return "";
  const items = model.shipmentDraftItems instanceof Map ? [...model.shipmentDraftItems.values()] : [];
  const catalog = Array.isArray(model.shipmentCatalog) ? model.shipmentCatalog : [];
  const datalistId = `ff-shipment-products-${String(supply.id).replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
  const rows = items.map((item) => `<tr data-product-key="${escapeHtml(item.productKey)}">
    <td>${escapeHtml(item.sku || item.productKey)}</td>
    <td>${escapeHtml(item.name || item.sku || item.productKey)}</td>
    <td><input type="number" min="1" max="10000000" step="1" inputmode="numeric" data-role="shipment-grid-quantity" data-shipment-id="${escapeHtml(supply.id)}" data-product-key="${escapeHtml(item.productKey)}" aria-label="Количество ${escapeHtml(item.sku || item.productKey)}" value="${Math.max(1, Math.trunc(Number(item.quantity) || 1))}"${disabledAttribute(model)}></td>
    <td><button type="button" class="ff-analysis-secondary ff-shipment-grid__remove" data-action="remove-shipment-grid-item" data-shipment-id="${escapeHtml(supply.id)}" data-product-key="${escapeHtml(item.productKey)}" aria-label="Удалить ${escapeHtml(item.sku || item.productKey)}"${disabledAttribute(model)}>×</button></td>
  </tr>`).join("");
  const options = catalog.map((item) => `<option value="${escapeHtml(item.sku)}">${escapeHtml(item.name)} · ${escapeHtml(item.productKey)}</option>`).join("");
  return `${shipmentGridStyles()}<section class="ff-shipment-grid" data-ff-draft-grid data-shipment-id="${escapeHtml(supply.id)}">
    ${model.error ? `<p class="ff-shipment-grid__message" role="alert">${escapeHtml(model.error)}</p>` : ""}
    <div class="ff-shipment-grid__table-wrap"><table><thead><tr><th>Артикул</th><th>Товар</th><th>Количество</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="ff-shipment-grid__empty">Добавьте товары или вставьте строки из таблицы.</td></tr>`}</tbody></table></div>
    <div class="ff-shipment-grid__tools"><label>Добавить товар<input type="search" list="${escapeHtml(datalistId)}" data-role="shipment-catalog-query" value="${escapeHtml(model.shipmentCatalogQuery)}" placeholder="Артикул, название или WB ID" autocomplete="off"${disabledAttribute(model)}><datalist id="${escapeHtml(datalistId)}">${options}</datalist></label><button type="button" class="ff-analysis-secondary" data-action="add-shipment-grid-item" data-shipment-id="${escapeHtml(supply.id)}"${disabledAttribute(model)}>Добавить строку</button></div>
    <div class="ff-shipment-grid__paste"><textarea data-role="shipment-grid-paste" placeholder="Артикул&#9;Количество&#10;SKU-1&#9;50" aria-label="Строки из Excel или Google Sheets"${disabledAttribute(model)}>${escapeHtml(model.shipmentGridPaste)}</textarea><button type="button" class="ff-analysis-secondary" data-action="apply-shipment-grid-paste" data-shipment-id="${escapeHtml(supply.id)}"${disabledAttribute(model)}>Вставить из Excel / Google Sheets</button></div>
    <footer class="ff-shipment-grid__footer"><button type="button" class="ff-analysis-secondary" data-action="cancel-shipment-grid" data-shipment-id="${escapeHtml(supply.id)}"${disabledAttribute(model)}>Закрыть без сохранения</button><button type="button" data-action="save-shipment-grid" data-shipment-id="${escapeHtml(supply.id)}"${disabledAttribute(model, items.length === 0)}>Сохранить состав</button></footer>
  </section>`;
}

function renderShipmentGridOrItems(supply, model, readOnly = false) {
  const grid = renderDraftShipmentGrid(supply, model);
  return grid || `<ul>${(supply.items ?? []).map((item) => renderSupplyItem(item, supply, model, readOnly)).join("")}</ul>`;
}

async function saveShipmentGrid(root, state, supply) {
  const payload = buildShipmentGridPayload(supply.id, state.shipmentDraftItems);
  if (!payload.items.length) {
    state.error = "В поставке должна остаться хотя бы одна позиция.";
    renderState(root, state);
    return false;
  }
  const succeeded = await runPlanningMutation(root, state, "update-supply", payload);
  if (succeeded) {
    closeShipmentGridEdit(state);
    renderState(root, state);
  }
  return succeeded;
}

function handleShipmentGridEvent(root, state, event, target) {
  const role = target.dataset.role;
  const action = target.dataset.action;
  if (event.type === "input" && role === "shipment-grid-quantity") {
    const item = state.shipmentDraftItems?.get(target.dataset.productKey);
    if (item) item.quantity = Math.max(0, Math.trunc(Number(target.value) || 0));
    return true;
  }
  if (event.type === "input" && role === "shipment-catalog-query") {
    state.shipmentCatalogQuery = target.value;
    return true;
  }
  if (event.type === "input" && role === "shipment-grid-paste") {
    state.shipmentGridPaste = target.value;
    return true;
  }
  if (event.type === "keydown" && role === "shipment-grid-quantity" && event.key === "Enter") {
    event.preventDefault();
    const inputs = [...root.querySelectorAll('[data-role="shipment-grid-quantity"]')];
    inputs[(inputs.indexOf(target) + 1) % Math.max(1, inputs.length)]?.focus();
    return true;
  }
  if (event.type !== "click") return false;
  const shipmentId = target.dataset.shipmentId;
  const supply = supplyById(state, shipmentId);
  if (action === "edit-supply") {
    if (beginShipmentGridEdit(state, supply)) renderState(root, state);
    return true;
  }
  if (action === "cancel-shipment-grid") {
    closeShipmentGridEdit(state);
    state.error = null;
    renderState(root, state);
    return true;
  }
  if (action === "remove-shipment-grid-item") {
    state.shipmentDraftItems?.delete(target.dataset.productKey);
    renderState(root, state);
    return true;
  }
  if (action === "add-shipment-grid-item") {
    addShipmentGridItem(state, state.shipmentCatalogQuery);
    renderState(root, state);
    return true;
  }
  if (action === "apply-shipment-grid-paste") {
    applyShipmentGridPaste(state);
    renderState(root, state);
    return true;
  }
  if (action === "save-shipment-grid") {
    if (supply?.status === "draft") void saveShipmentGrid(root, state, supply);
    return true;
  }
  return false;
}
__FF_SHIPMENT_GRID_END__*/ }

function runtimeSource() {
  const source = runtimeTemplate.toString();
  return source.slice(source.indexOf("/*__FF_SHIPMENT_GRID_START__") + "/*__FF_SHIPMENT_GRID_START__".length, source.indexOf("__FF_SHIPMENT_GRID_END__*/"));
}

export function patchFfShipmentGrid(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return source;

  source = replaceRequired(
    source,
    /\nfunction renderSupplyHistory\(model, options = \{\}\) \{/,
    `\n${runtimeSource()}\nfunction renderSupplyHistory(model, options = {}) {`,
    "редактор состава отгрузки",
  );

  source = replaceRequired(
    source,
    `<ul>\${(supply.items ?? []).map((item) => renderSupplyItem(item, supply, model, archived)).join("")}</ul>`,
    `\${renderShipmentGridOrItems(supply, model, archived)}`,
    "строки состава поставки",
  );

  source = replaceRequired(
    source,
    `    quantitiesByProduct: new Map(),\n    loading: true,`,
    `    quantitiesByProduct: new Map(),\n    shipmentEditorId: null,\n    shipmentDraftItems: new Map(),\n    shipmentCatalogQuery: "",\n    shipmentGridPaste: "",\n    loading: true,`,
    "состояние табличного редактора",
  );

  source = replaceRequired(
    source,
    /function renderState\(root, state\) \{\s*const view = root\.dataset\.ffAnalysisView === "shipments" \? "shipments" : "analysis";\s*root\.innerHTML = renderFfWorkspaceMarkup\(stateModel\(state\), view\);\s*\}/,
    `function renderState(root, state) {\n  const view = root.dataset.ffAnalysisView === "shipments" ? "shipments" : "analysis";\n  const model = Object.assign(stateModel(state), shipmentGridViewModel(state));\n  root.innerHTML = renderFfWorkspaceMarkup(model, view);\n}`,
    "модель редактора отгрузки",
  );

  source = replaceRequired(
    source,
    `    if (!target || !root.contains(target)) return;\n    if (event.type === "input") {`,
    `    if (!target || !root.contains(target)) return;\n    if (handleShipmentGridEvent(root, state, event, target)) return;\n    if (event.type === "input") {`,
    "события табличного редактора",
  );

  source = replaceRequired(
    source,
    `  root.addEventListener("input", handler);\n}`,
    `  root.addEventListener("input", handler);\n  root.addEventListener("keydown", handler);\n}`,
    "клавиатурная навигация редактора",
  );

  return source;
}

async function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3] ?? inputFile;
  if (!inputFile) throw new Error("Укажите путь к ff-analysis-app.mjs");
  const source = await readFile(inputFile, "utf8");
  await writeFile(outputFile, patchFfShipmentGrid(source));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
