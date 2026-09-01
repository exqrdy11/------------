import { readFile, writeFile } from "node:fs/promises";

const MARKER = "data-ff-shipments-nav";

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

export function patchFfShipmentsTab(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return source;

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
  const visibleWarehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
  const warehouseById = new Map(allWarehouses.map((warehouse) => [warehouse.id, warehouse]));`,
    "индекс активных ФФ",
  );

  source = replaceRequired(
    source,
    /(const archivedSupplies = allSupplies\.flatMap\(\(supply\) => \{[\s\S]*?\n\s*\}\);)/,
    `$1
  const shipmentSupplies = allSupplies.flatMap((supply) => {
    const warehouse = warehouseById.get(supply.warehouseId);
    return warehouse && visibleWarehouseIds.has(supply.warehouseId)
      ? [{ ...supply, warehouseLabel: \`\${warehouse.city} — \${warehouse.name}\` }]
      : [];
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

  return source;
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
