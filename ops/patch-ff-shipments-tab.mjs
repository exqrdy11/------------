import { readFile, writeFile } from "node:fs/promises";

const MARKER = "data-ff-shipments-nav";
const FILTER_MARKER = "data-ff-shipment-filters";
const EXPORT_MARKER = 'data-action="download-unified-shipments"';
const LEGACY_SHIPMENT_INDEX = `  const visibleWarehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
  const warehouseById = new Map(allWarehouses.map((warehouse) => [warehouse.id, warehouse]));`;
const RESILIENT_SHIPMENT_INDEX = `  const warehouseById = new Map(allWarehouses.map((warehouse) => [warehouse.id, warehouse]));`;
const LEGACY_SHIPMENT_SUPPLIES = `  const shipmentSupplies = allSupplies.flatMap((supply) => {
    const warehouse = warehouseById.get(supply.warehouseId);
    return warehouse && visibleWarehouseIds.has(supply.warehouseId)
      ? [{ ...supply, warehouseLabel: \`\${warehouse.city} — \${warehouse.name}\` }]
      : [];
  });`;
const RESILIENT_SHIPMENT_SUPPLIES = `  const shipmentSupplies = allSupplies.flatMap((supply) => {
    const warehouse = warehouseById.get(supply.warehouseId);
    if (warehouse?.isHidden) return [];
    const warehouseLabel = warehouse
      ? \`\${warehouse.city} — \${warehouse.name}\`
      : String(supply.warehouseLabel || supply.warehouseId || "ФФ");
    return [{ ...supply, warehouseLabel }];
  });`;

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

function removeRequired(source, fragment, label) {
  const next = source.replaceAll(fragment, "");
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

function shipmentFiltersTemplate() { /*__FF_SHIPMENT_FILTERS_START__
export function buildUnifiedShipmentWorkbookData(model) {
  const warehouses = Array.isArray(model?.warehouses) ? model.warehouses : [];
  const warehouseById = new Map(warehouses.map((warehouse) => [String(warehouse?.id || ""), warehouse]));
  const currentSupplies = Array.isArray(model?.shipmentSupplies) ? model.shipmentSupplies : [];
  const archivedSupplies = Array.isArray(model?.archivedSupplies) ? model.archivedSupplies : [];
  const suppliesById = new Map();
  for (const [index, supply] of [...currentSupplies, ...archivedSupplies].entries()) {
    const key = String(supply?.id || `${supply?.warehouseId || "ff"}-${index}`);
    if (!suppliesById.has(key)) suppliesById.set(key, supply);
  }
  const activeSupplies = [...suppliesById.values()].filter((supply) => supply?.status === "draft" || supply?.status === "in_transit");
  const totals = new Map();
  const cityRows = new Map();
  const fulfillmentRows = new Map();
  const cities = new Set();
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

  for (const supply of activeSupplies) {
    const warehouseId = String(supply?.warehouseId || "");
    const warehouse = warehouseById.get(warehouseId);
    const fallbackLabel = String(supply?.warehouseLabel || warehouseId || "ФФ").trim() || "ФФ";
    const fallbackCity = fallbackLabel.split(/\s+[\u2014-]\s+/)[0]?.trim();
    const city = String(warehouse?.city || fallbackCity || "Без города").trim() || "Без города";
    const fulfillment = warehouse
      ? `${city} — ${String(warehouse?.name || warehouseId || "ФФ").trim()}`
      : fallbackLabel;
    cities.add(city);

    for (const item of Array.isArray(supply?.items) ? supply.items : []) {
      const article = String(item?.sku || item?.article || item?.vendorCode || item?.nmId || item?.productKey || item?.id || "").trim();
      const quantity = Number(item?.quantity ?? item?.plannedQuantity ?? item?.actualQuantity ?? 0);
      if (!article || !Number.isFinite(quantity) || quantity <= 0) continue;
      const name = String(item?.name || item?.title || item?.productName || article).trim() || article;

      const total = totals.get(article) || { article, name, quantity: 0 };
      total.quantity += quantity;
      if (!total.name || total.name === total.article) total.name = name;
      totals.set(article, total);

      const cityRow = cityRows.get(article) || { article, name, quantities: {}, total: 0 };
      cityRow.quantities[city] = Number(cityRow.quantities[city] || 0) + quantity;
      cityRow.total += quantity;
      if (!cityRow.name || cityRow.name === cityRow.article) cityRow.name = name;
      cityRows.set(article, cityRow);

      const fulfillmentKey = `${fulfillment}\u0000${article}`;
      const fulfillmentRow = fulfillmentRows.get(fulfillmentKey) || { city, fulfillment, article, name, quantity: 0 };
      fulfillmentRow.quantity += quantity;
      if (!fulfillmentRow.name || fulfillmentRow.name === fulfillmentRow.article) fulfillmentRow.name = name;
      fulfillmentRows.set(fulfillmentKey, fulfillmentRow);
    }
  }

  const sortByArticle = (left, right) => collator.compare(left.article, right.article);
  return {
    activeSupplyCount: activeSupplies.length,
    cities: [...cities].sort(collator.compare),
    totals: [...totals.values()].sort(sortByArticle),
    byCity: [...cityRows.values()].sort(sortByArticle),
    byFulfillment: [...fulfillmentRows.values()].sort((left, right) => collator.compare(left.city, right.city)
      || collator.compare(left.fulfillment, right.fulfillment)
      || collator.compare(left.article, right.article)),
  };
}

let unifiedShipmentXlsxPromise = null;

function loadUnifiedShipmentXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (unifiedShipmentXlsxPromise) return unifiedShipmentXlsxPromise;
  unifiedShipmentXlsxPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/xlsx.full.min.js";
    script.async = true;
    script.onload = () => globalThis.XLSX
      ? resolve(globalThis.XLSX)
      : reject(new Error("Библиотека Excel не загрузилась"));
    script.onerror = () => reject(new Error("Не удалось загрузить модуль Excel"));
    document.head.append(script);
  }).catch((error) => {
    unifiedShipmentXlsxPromise = null;
    throw error;
  });
  return unifiedShipmentXlsxPromise;
}

async function downloadUnifiedShipmentWorkbook(model) {
  const data = buildUnifiedShipmentWorkbookData(model);
  if (!data.totals.length) throw new Error("Нет активных черновиков или отгрузок в пути");
  const XLSX = await loadUnifiedShipmentXlsx();
  const workbook = XLSX.utils.book_new();
  const totalsSheet = XLSX.utils.json_to_sheet(data.totals.map((row) => ({
    "Артикул": row.article,
    "Наименование": row.name,
    "Количество": row.quantity,
  })));
  totalsSheet["!cols"] = [{ wch: 28 }, { wch: 52 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, totalsSheet, "Итого");

  const citySheet = XLSX.utils.json_to_sheet(data.byCity.map((row) => {
    const result = { "Артикул": row.article, "Наименование": row.name };
    for (const city of data.cities) result[city] = Number(row.quantities[city] || 0);
    result["Итого"] = row.total;
    return result;
  }));
  citySheet["!cols"] = [{ wch: 28 }, { wch: 52 }, ...data.cities.map(() => ({ wch: 16 })), { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, citySheet, "По городам");

  const fulfillmentSheet = XLSX.utils.json_to_sheet(data.byFulfillment.map((row) => ({
    "Город": row.city,
    "Фулфилмент": row.fulfillment,
    "Артикул": row.article,
    "Наименование": row.name,
    "Количество": row.quantity,
  })));
  fulfillmentSheet["!cols"] = [{ wch: 20 }, { wch: 44 }, { wch: 28 }, { wch: 52 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, fulfillmentSheet, "По ФФ");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `otgruzki-vse-ff-${date}.xlsx`);
}

export function renderShipmentsMarkup(model) {
  const shipmentStatusFilter = ["active", "received", "archive"].includes(model.shipmentStatusFilter)
    ? model.shipmentStatusFilter
    : "active";
  const shipmentWarehouseFilter = String(model.shipmentWarehouseFilter || "");
  const currentSupplies = Array.isArray(model.shipmentSupplies) ? model.shipmentSupplies : [];
  const archivedSupplies = Array.isArray(model.archivedSupplies) ? model.archivedSupplies : [];
  const allSuppliesById = new Map();
  for (const [index, supply] of [...currentSupplies, ...archivedSupplies].entries()) {
    const key = String(supply?.id || `${supply?.warehouseId || "ff"}-${index}`);
    if (!allSuppliesById.has(key)) allSuppliesById.set(key, supply);
  }
  const allSupplies = [...allSuppliesById.values()];
  const matchesWarehouse = (supply) => !shipmentWarehouseFilter
    || String(supply?.warehouseId || "") === shipmentWarehouseFilter;
  const scopedSupplies = allSupplies.filter(matchesWarehouse);
  const groups = {
    active: scopedSupplies.filter((supply) => supply.status === "draft" || supply.status === "in_transit"),
    received: scopedSupplies.filter((supply) => supply.status === "received"),
    archive: scopedSupplies.filter((supply) => supply.status === "cancelled"),
  };
  const visibleSupplies = groups[shipmentStatusFilter];
  const warehouseOptions = new Map();
  for (const warehouse of Array.isArray(model.warehouses) ? model.warehouses : []) {
    if (!warehouse?.id) continue;
    warehouseOptions.set(String(warehouse.id), `${warehouse.city || "ФФ"} — ${warehouse.name || warehouse.id}`);
  }
  for (const supply of allSupplies) {
    const warehouseId = String(supply?.warehouseId || "");
    if (warehouseId && !warehouseOptions.has(warehouseId)) {
      warehouseOptions.set(warehouseId, String(supply?.warehouseLabel || warehouseId));
    }
  }
  const options = [`<option value=""${shipmentWarehouseFilter ? "" : " selected"}>Все ФФ</option>`]
    .concat([...warehouseOptions.entries()].map(([warehouseId, label]) => `<option value="${escapeHtml(warehouseId)}"${warehouseId === shipmentWarehouseFilter ? " selected" : ""}>${escapeHtml(label)}</option>`))
    .join("");
  const tabs = [
    ["active", "Активные", groups.active.length],
    ["received", "Принятые", groups.received.length],
    ["archive", "Архив", groups.archive.length],
  ].map(([status, label, count]) => `<button type="button" class="ff-analysis-secondary${shipmentStatusFilter === status ? " active" : ""}" data-action="shipment-status-filter" data-shipment-status="${status}" aria-pressed="${shipmentStatusFilter === status}">${label} ${formatNumber(count)}</button>`).join("");
  const historyOptions = shipmentStatusFilter === "archive"
    ? { supplies: visibleSupplies, archived: true, title: "Архив отменённых", kicker: "АРХИВ" }
    : shipmentStatusFilter === "received"
      ? { supplies: visibleSupplies, title: "Принятые поставки", kicker: "ИСТОРИЯ" }
      : { supplies: visibleSupplies, title: "Активные отгрузки", kicker: "В РАБОТЕ" };
  return `<section class="ff-analysis-root" aria-label="Отгрузки">
    <header class="ff-analysis-controls">
      <div class="ff-analysis-title"><span class="ff-analysis-kicker">ПЛАНЫ И ИСТОРИЯ</span><h1>Отгрузки</h1></div>
      <div class="ff-analysis-periods"><span data-role="updated-at" role="status">Активных: ${formatNumber(groups.active.length)} · принятых: ${formatNumber(groups.received.length)}</span><button type="button" class="ff-analysis-secondary" data-action="download-unified-shipments">Скачать единый Excel</button></div>
    </header>
    <section class="ff-analysis-method" role="note"><strong>Все планы сохранены.</strong><span>Черновик можно править и пересохранять. Когда состав груза точно готов — отправьте его в путь, и редактирование закроется.</span></section>
    <section class="ff-analysis-method" data-ff-shipment-filters aria-label="Фильтры отгрузок">
      <label><span>Фулфилмент</span><select data-role="shipment-warehouse-filter" aria-label="Фулфилмент">${options}</select></label>
      <div class="ff-analysis-periods" role="tablist" aria-label="Статус поставки">${tabs}</div>
    </section>
    ${renderSupplyHistory(model, historyOptions)}
  </section>`;
}
__FF_SHIPMENT_FILTERS_END__*/ }

function shipmentFiltersSource() {
  const source = shipmentFiltersTemplate.toString();
  return source.slice(
    source.indexOf("/*__FF_SHIPMENT_FILTERS_START__") + "/*__FF_SHIPMENT_FILTERS_START__".length,
    source.indexOf("__FF_SHIPMENT_FILTERS_END__*/"),
  ).trim();
}

function upgradeShipmentFilters(input) {
  let source = String(input ?? "");
  if (source.includes(EXPORT_MARKER)) return source;
  const alreadyFiltered = source.includes(FILTER_MARKER);
  source = replaceRequired(
    source,
    /export function renderShipmentsMarkup\(model\) \{[\s\S]*?\n\}\n\nexport function renderFfWorkspaceMarkup/,
    `${shipmentFiltersSource()}\n\nexport function renderFfWorkspaceMarkup`,
    "фильтры статусов и ФФ",
  );
  if (!alreadyFiltered) {
    const gridModel = "const model = Object.assign(stateModel(state), shipmentGridViewModel(state));";
    const filteredGridModel = `const model = Object.assign(stateModel(state), shipmentGridViewModel(state), {
    shipmentStatusFilter: root.dataset.ffShipmentStatusFilter || "active",
    shipmentWarehouseFilter: root.dataset.ffShipmentWarehouseFilter || "",
  });`;
    if (source.includes(gridModel)) {
      source = source.replace(gridModel, filteredGridModel);
    } else {
      source = source.replace(
        "root.innerHTML = renderFfWorkspaceMarkup(stateModel(state), view);",
        `const model = Object.assign(stateModel(state), {
    shipmentStatusFilter: root.dataset.ffShipmentStatusFilter || "active",
    shipmentWarehouseFilter: root.dataset.ffShipmentWarehouseFilter || "",
  });
  root.innerHTML = renderFfWorkspaceMarkup(model, view);`,
      );
    }
    if (!source.includes("shipmentStatusFilter: root.dataset.ffShipmentStatusFilter")) {
      throw new Error("Фрагмент «состояние фильтров отгрузок» не найден в клиентском бандле");
    }
    source = source.replace(
      `if (event.type === "change") {
      if (target.dataset.role === "ff-select") {`,
      `if (event.type === "change") {
      if (target.dataset.role === "shipment-warehouse-filter") {
        root.dataset.ffShipmentWarehouseFilter = target.value;
        renderState(root, state);
      } else if (target.dataset.role === "ff-select") {`,
    );
    source = source.replace(
      `if (action === "refresh") void refreshAnalysis(root, state);`,
      `if (action === "shipment-status-filter") {
      root.dataset.ffShipmentStatusFilter = target.dataset.shipmentStatus || "active";
      renderState(root, state);
    } else if (action === "refresh") void refreshAnalysis(root, state);`,
    );
  }
  const exportHandler = `if (action === "download-unified-shipments") {
      target.disabled = true;
      const exportModel = typeof shipmentGridViewModel === "function"
        ? Object.assign(stateModel(state), shipmentGridViewModel(state))
        : stateModel(state);
      void downloadUnifiedShipmentWorkbook(exportModel)
        .catch((error) => globalThis.alert?.(error?.message || "Не удалось скачать Excel"))
        .finally(() => { target.disabled = false; });
    } else if (action === "shipment-status-filter") {`;
  if (source.includes(`if (action === "shipment-status-filter") {`)) {
    source = source.replace(`if (action === "shipment-status-filter") {`, exportHandler);
  } else if (source.includes(`if (action === "refresh")`)) {
    source = source.replace(
      `if (action === "refresh")`,
      `if (action === "download-unified-shipments") {
      target.disabled = true;
      const exportModel = typeof shipmentGridViewModel === "function"
        ? Object.assign(stateModel(state), shipmentGridViewModel(state))
        : stateModel(state);
      void downloadUnifiedShipmentWorkbook(exportModel)
        .catch((error) => globalThis.alert?.(error?.message || "Не удалось скачать Excel"))
        .finally(() => { target.disabled = false; });
    } else if (action === "refresh")`,
    );
  } else {
    throw new Error("Фрагмент «скачивание единого Excel» не найден в клиентском бандле");
  }
  return source;
}

export function patchFfShipmentsTab(input) {
  let source = String(input ?? "");
  source = source
    .replace(LEGACY_SHIPMENT_INDEX, RESILIENT_SHIPMENT_INDEX)
    .replace(LEGACY_SHIPMENT_SUPPLIES, RESILIENT_SHIPMENT_SUPPLIES);
  if (source.includes(MARKER)) return upgradeShipmentFilters(source);

  source = replaceRequired(
    source,
    /(const SUPPLY_LABELS = \{[\s\S]*?\};)/,
    `$1

export function ffCustomViewFromHash(hash) {
  if (hash === "#ff-analysis") return "analysis";
  if (hash === "#ff-shipments") return "shipments";
  return null;
}

function supplyDisplayTitle(supply) {
  const warehouse = String(supply?.warehouseLabel || "ФФ").trim() || "ФФ";
  return \`Поставка → \${warehouse} · \${formatDate(supply?.createdAt)}\`;
}`,
    "вспомогательные функции отгрузок",
  );

  source = replaceRequired(
    source,
    /const title = archived \? "Архив скрытых ФФ" : "История движения";\s*const kicker = archived \? "ТОЛЬКО ПРОСМОТР" : "ПОСТАВКИ";/,
    `const title = options.title ?? (archived ? "Архив скрытых ФФ" : "История движения");
  const kicker = options.kicker ?? (archived ? "ТОЛЬКО ПРОСМОТР" : "ПОСТАВКИ");`,
    "заголовок истории поставок",
  );

  source = replaceRequired(
    source,
    /<strong>Поставка \$\{escapeHtml\(supply\.id\)\}<\/strong>/,
    `<strong>\${escapeHtml(supplyDisplayTitle(supply))}</strong>`,
    "понятное название поставки",
  );

  source = replaceRequired(
    source,
    /if \(!archived && status === "draft"\) \{\s*(actions\.push\(`<button type="button" data-action="download-supply")/,
    `if (!archived && status === "draft") {
      actions.push(\`<button type="button" class="ff-analysis-secondary" data-action="edit-supply" data-shipment-id="\${escapeHtml(supply.id)}"\${disabledAttribute(model)}>Редактировать состав</button>\`);
      $1`,
    "кнопка редактирования черновика",
  );

  source = replaceRequired(
    source,
    ">Передать в пути</button>",
    ">Отправить в путь</button>",
    "понятная кнопка отправки",
  );

  source = replaceRequired(
    source,
    /(const warehouses = allWarehouses\.filter\(\(warehouse\) => !warehouse\.isHidden\);)/,
    `$1
  const warehouseById = new Map(allWarehouses.map((warehouse) => [warehouse.id, warehouse]));`,
    "индекс активных ФФ",
  );

  source = replaceRequired(
    source,
    /(const archivedSupplies = allSupplies\.flatMap\(\(supply\) => \{[\s\S]*?\n\s*\}\);)/,
    `$1
  const shipmentSupplies = allSupplies.flatMap((supply) => {
    const warehouse = warehouseById.get(supply.warehouseId);
    if (warehouse?.isHidden) return [];
    const warehouseLabel = warehouse
      ? \`\${warehouse.city} — \${warehouse.name}\`
      : String(supply.warehouseLabel || supply.warehouseId || "ФФ");
    return [{ ...supply, warehouseLabel }];
  });`,
    "единый список отгрузок",
  );

  source = replaceRequired(
    source,
    /(\bsupplies,)(\s*)(archivedSupplies\b)/,
    `$1$2shipmentSupplies,$2$3`,
    "отгрузки в модели анализа",
  );

  source = removeRequired(
    source,
    "${renderSupplyHistory({ ...model, supplies: Array.isArray(model.supplies) ? model.supplies : [] })}",
    "история выбранного ФФ в анализе",
  );
  source = removeRequired(
    source,
    "${renderSupplyHistory(model, { supplies: Array.isArray(model.archivedSupplies) ? model.archivedSupplies : [], archived: true })}",
    "архив отгрузок в анализе",
  );

  source = replaceRequired(
    source,
    /\nfunction inventoryIndex\(rows\) \{/,
    `

export function renderShipmentsMarkup(model) {
  const supplies = Array.isArray(model.shipmentSupplies) ? model.shipmentSupplies : [];
  const archivedSupplies = Array.isArray(model.archivedSupplies) ? model.archivedSupplies : [];
  const activeCount = supplies.filter((supply) => supply.status === "draft" || supply.status === "in_transit").length;
  const completedCount = supplies.filter((supply) => supply.status === "received").length;
  return \`<section class="ff-analysis-root" aria-label="Отгрузки">
    <header class="ff-analysis-controls">
      <div class="ff-analysis-title"><span class="ff-analysis-kicker">ПЛАНЫ И ИСТОРИЯ</span><h1>Отгрузки</h1></div>
      <span data-role="updated-at" role="status">Активных: \${formatNumber(activeCount)} · принятых: \${formatNumber(completedCount)}</span>
    </header>
    <section class="ff-analysis-method" role="note"><strong>Все планы сохранены.</strong><span>Черновик можно править и пересохранять. Когда состав груза точно готов — отправьте его в путь, и редактирование закроется.</span></section>
    \${renderSupplyHistory(model, { supplies, title: "Все отгрузки", kicker: "ПОСТАВКИ" })}
    \${renderSupplyHistory(model, { supplies: archivedSupplies, archived: true })}
  </section>\`;
}

export function renderFfWorkspaceMarkup(model, view = "analysis") {
  const shipmentsVisible = view === "shipments";
  return \`<div data-ff-view="analysis"\${shipmentsVisible ? " hidden" : ""}>\${renderAnalysisMarkup(model)}</div>
    <div data-ff-view="shipments"\${shipmentsVisible ? "" : " hidden"}>\${renderShipmentsMarkup(model)}</div>\`;
}

function inventoryIndex(rows) {`,
    "разметка вкладки отгрузок",
  );

  source = replaceRequired(
    source,
    /function renderState\(root, state\) \{\s*root\.innerHTML = renderAnalysisMarkup\(stateModel\(state\)\);\s*\}/,
    `function renderState(root, state) {
  const view = root.dataset.ffAnalysisView === "shipments" ? "shipments" : "analysis";
  root.innerHTML = renderFfWorkspaceMarkup(stateModel(state), view);
}`,
    "общий рендер разделов",
  );

  source = replaceRequired(
    source,
    /\nfunction supplyById\(state, shipmentId\) \{/,
    `

export function prepareDraftForEditing(state, supply) {
  if (!supply || supply.status !== "draft") return false;
  state.selectedWarehouseId = supply.warehouseId;
  state.selectedProductKeys = null;
  state.quantitiesByProduct.clear();
  return true;
}

function supplyById(state, shipmentId) {`,
    "подготовка черновика к редактированию",
  );

  source = replaceRequired(
    source,
    /else if \(action === "dispatch-supply"\) void runPlanningMutation\(root, state, action, buildDispatchPayload\(shipmentId\)\);/,
    `else if (action === "edit-supply") {
      const supply = supplyById(state, shipmentId);
      if (prepareDraftForEditing(state, supply)) {
        root.dataset.ffAnalysisView = "analysis";
        const url = new URL(window.location.href);
        url.hash = "ff-analysis";
        window.history.pushState({ ffCustomView: "analysis" }, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
        void loadSavedAnalysis(root, state);
      }
    } else if (action === "dispatch-supply") {
      const confirmed = globalThis.confirm?.("Отправить поставку в путь? После этого состав редактировать нельзя.");
      if (confirmed !== false) void runPlanningMutation(root, state, action, buildDispatchPayload(shipmentId));
    }`,
    "редактирование и фиксация отгрузки",
  );

  source = replaceRequired(
    source,
    /function adaptNavigation\(navigation, root, content\) \{[\s\S]*?\n\}\s*\nlet activeShell/,
    `function setFfCustomView(root, view) {
  root.dataset.ffAnalysisView = view;
  for (const section of root.querySelectorAll("[data-ff-view]")) {
    section.hidden = section.dataset.ffView !== view;
  }
}

function adaptNavigation(navigation, root, content) {
  const labelFor = (item) => [...item.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join("")
    .trim() || item.textContent.trim();
  const setNativeLabel = (item, label) => {
    const textNode = [...item.childNodes].find((node) => node.nodeType === 3);
    if (textNode) textNode.textContent = label;
    else item.textContent = label;
  };
  let lastNativeItem = [...navigation.querySelectorAll("button, a")].find((item) => !item.dataset.ffAnalysisNav && !item.dataset.ffShipmentsNav && item.classList.contains("active")) ?? null;
  const setActiveItem = (item) => {
    for (const candidate of navigation.querySelectorAll("button, a")) {
      candidate.classList.remove("active");
      candidate.toggleAttribute("aria-current", false);
    }
    if (!item) return;
    item.classList.add("active");
    if (item.dataset.ffAnalysisNav !== undefined || item.dataset.ffShipmentsNav !== undefined) item.setAttribute("aria-current", "page");
  };
  const currentCustomView = () => ffCustomViewFromHash(window.location.hash);
  const showCustomView = (view, nativeItem = null) => {
    const custom = view === "analysis" || view === "shipments";
    root.hidden = !custom;
    content.hidden = custom;
    if (custom) {
      setFfCustomView(root, view);
      setActiveItem(navigation.querySelector(view === "shipments" ? "[data-ff-shipments-nav]" : "[data-ff-analysis-nav]"));
    } else if (nativeItem ?? lastNativeItem) {
      setActiveItem(nativeItem ?? lastNativeItem);
    }
  };
  const updateLocation = (view) => {
    if (currentCustomView() === view) return;
    const url = new URL(window.location.href);
    url.hash = view === "shipments" ? "ff-shipments" : view === "analysis" ? "ff-analysis" : "";
    window.history.pushState({ ffCustomView: view }, "", url);
  };
  const createCustomButton = (selector, datasetKey, text) => {
    if (navigation.querySelector(selector)) return;
    const reference = navigation.querySelector("button:not([hidden]), a:not([hidden])");
    const button = document.createElement("button");
    button.type = "button";
    button.className = \`\${(reference?.className ?? "").split(/\\s+/).filter((name) => name && name !== "active").join(" ")} ff-analysis-nav-item\`.trim();
    button.dataset[datasetKey] = "";
    button.textContent = text;
    navigation.append(button);
  };
  const sync = () => {
    for (const button of navigation.querySelectorAll("button, a")) {
      const text = labelFor(button);
      if (text === "План поставок" || text === "Аналитика" || text === "Анализ") button.hidden = true;
      if (text === "ФФ") setNativeLabel(button, "Остатки и настройки");
    }
    createCustomButton("[data-ff-analysis-nav]", "ffAnalysisNav", "Анализ ФФ");
    createCustomButton("[data-ff-shipments-nav]", "ffShipmentsNav", "Отгрузки");
  };
  sync();
  if (navigation.dataset.ffAnalysisNavigationBound === "true") return () => {};
  navigation.dataset.ffAnalysisNavigationBound = "true";
  const observer = new MutationObserver(sync);
  observer.observe(navigation, { childList: true, subtree: true });
  const clickHandler = (event) => {
    if (event.target.closest?.("[data-ff-shipments-nav]")) {
      updateLocation("shipments");
      showCustomView("shipments");
    } else if (event.target.closest?.("[data-ff-analysis-nav]")) {
      updateLocation("analysis");
      showCustomView("analysis");
    } else if (event.target.closest?.("button, a")) {
      lastNativeItem = event.target.closest("button, a");
      updateLocation(null);
      showCustomView(null, lastNativeItem);
    }
  };
  const popstateHandler = () => showCustomView(currentCustomView());
  navigation.addEventListener("click", clickHandler);
  window.addEventListener("popstate", popstateHandler);
  showCustomView(currentCustomView());
  return () => {
    observer.disconnect();
    navigation.removeEventListener("click", clickHandler);
    window.removeEventListener("popstate", popstateHandler);
    delete navigation.dataset.ffAnalysisNavigationBound;
  };
}

let activeShell`,
    "навигация анализа и отгрузок",
  );

  return upgradeShipmentFilters(source);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажите путь к ff-analysis-app.mjs");
  const source = await readFile(file, "utf8");
  await writeFile(file, patchFfShipmentsTab(source));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
