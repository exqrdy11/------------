import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function replaceRequired(source, pattern, replacement, label) {
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Шаблон «${label}» не найден ровно один раз (найдено: ${matches.length})`);
  }
  return source.replace(pattern, replacement);
}

export function patchFfPlanningStore(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Пустой файл хранилища анализа ФФ");
  const alreadyPatched = input.includes("m.metric_date AS date,")
    && input.includes("const key = `${date}\\u0000${warehouseId}\\u0000${productKey}\\u0000${sku}`;")
    && input.includes("SELECT ?, json_extract(value, '$.date'),")
    && !input.includes(".bind(input.cabinetId, period.from, generation, chunk");
  if (alreadyPatched) return input;

  let source = input;
  source = replaceRequired(source, /s\.period_from AS date,/g, "m.metric_date AS date,", "реальная дата при чтении");
  source = replaceRequired(
    source,
    /const key = `\$\{warehouseId\}\\u0000\$\{productKey\}\\u0000\$\{sku\}`;/g,
    "const key = `${date}\\u0000${warehouseId}\\u0000${productKey}\\u0000${sku}`;",
    "дата в ключе агрегации",
  );
  source = replaceRequired(
    source,
    /const current = aggregate\.get\(key\) \?\? \{ warehouseId, productKey, nmId: metric\.nmId \?\? null, sku, demand: 0, sold: 0 \};/g,
    "const current = aggregate.get(key) ?? { date, warehouseId, productKey, nmId: metric.nmId ?? null, sku, demand: 0, sold: 0 };",
    "дата в строке метрики",
  );
  source = replaceRequired(
    source,
    /return \[\.\.\.aggregate\.values\(\)\]\.sort\(\(left, right\) => left\.warehouseId\.localeCompare\(right\.warehouseId\) \|\| left\.productKey\.localeCompare\(right\.productKey\) \|\| left\.sku\.localeCompare\(right\.sku\)\);/g,
    "return [...aggregate.values()].sort((left, right) => left.date.localeCompare(right.date) || left.warehouseId.localeCompare(right.warehouseId) || left.productKey.localeCompare(right.productKey) || left.sku.localeCompare(right.sku));",
    "сортировка дневных метрик",
  );
  source = replaceRequired(
    source,
    /SELECT \?, \?,\s*\n\s*json_extract\(value, '\$\.warehouseId'\),/g,
    "SELECT ?, json_extract(value, '$.date'),\n        json_extract(value, '$.warehouseId'),",
    "дата при записи метрик",
  );
  source = replaceRequired(
    source,
    /\.bind\(input\.cabinetId, period\.from, generation, chunk/g,
    ".bind(input.cabinetId, generation, chunk",
    "параметры записи метрик",
  );
  return source;
}

export function patchFfPlanningRoute(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Пустой файл маршрута анализа ФФ");
  if (input.includes("warehouseId: requestInput.warehouseId ?? null, warnings: [], fallbackToPersisted: true")) return input;
  return replaceRequired(
    input,
    /loadPlanning\(\{ cabinetId, period, warehouseId: requestInput\.warehouseId \?\? null, warnings: \[\] \}\)/g,
    "loadPlanning({ cabinetId, period, warehouseId: requestInput.warehouseId ?? null, warnings: [], fallbackToPersisted: true })",
    "чтение последнего сохранённого снимка",
  );
}

export function patchFfAnalysisClient(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Пустой клиент анализа ФФ");
  let source = input;
  if (!source.includes("const PLANNING_REQUEST_TIMEOUT_MS") && source.includes("export async function fetchSavedAnalysisSnapshot")) {
    source = replaceRequired(
      source,
      /export async function fetchSavedAnalysisSnapshot/g,
      `const PLANNING_REQUEST_TIMEOUT_MS = 25_000;

export async function fetchPlanningWithTimeout(fetchImpl, url, init, timeoutMs = PLANNING_REQUEST_TIMEOUT_MS, timeoutMessage = "Сервер слишком долго отвечает") {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, controller ? { ...init, signal: controller.signal } : init)),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function supplyItemQuantity(item) {
  return Math.max(0, Number(item?.plannedQuantity ?? item?.actualQuantity ?? item?.quantity) || 0);
}

function supplyItemsSignature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => \`${"${String(item?.productKey ?? item?.nmId ?? item?.sku ?? \"\")}:${supplyItemQuantity(item)}"}\`)
    .sort()
    .join("|");
}

function planningMutationApplied(action, body, supplies) {
  const allSupplies = Array.isArray(supplies) ? supplies : [];
  if (action === "create-supply") {
    return allSupplies.some((supply) => supply.status === "draft"
      && supply.warehouseId === body.warehouseId
      && supplyItemsSignature(supply.items) === supplyItemsSignature(body.items));
  }
  if (action === "update-supply") {
    return allSupplies.some((supply) => supply.id === body.shipmentId
      && supply.status === "draft"
      && supplyItemsSignature(supply.items) === supplyItemsSignature(body.items));
  }
  if (action === "dispatch-supply") return allSupplies.some((supply) => supply.id === body.shipmentId && supply.status === "in_transit");
  if (action === "receive-supply") return allSupplies.some((supply) => supply.id === body.shipmentId && supply.status === "received");
  if (action === "cancel-supply") return allSupplies.some((supply) => supply.id === body.shipmentId && supply.status === "cancelled");
  return false;
}

export async function fetchSavedAnalysisSnapshot`,
      "защита запросов планирования от зависания",
    );
  }
  if (source.includes("const planningResponse = await fetchImpl(`/api/ff-planning?${query}`, init);")) {
    source = replaceRequired(
      source,
      /const planningResponse = await fetchImpl\(`\/api\/ff-planning\?\$\{query\}`, init\);/g,
      'const planningResponse = await fetchPlanningWithTimeout(fetchImpl, `/api/ff-planning?${query}`, init, PLANNING_REQUEST_TIMEOUT_MS, "Сервер слишком долго загружает сохранённые отгрузки");',
      "таймаут чтения сохранённых отгрузок",
    );
  }
  if (source.includes('const response = await fetchImpl("/api/ff-planning", {')) {
    source = replaceRequired(
      source,
      /const response = await fetchImpl\("\/api\/ff-planning", \{([\s\S]*?)\n\s*\}\);/g,
      'const response = await fetchPlanningWithTimeout(fetchImpl, "/api/ff-planning", {$1\n  }, PLANNING_REQUEST_TIMEOUT_MS, "Сервер слишком долго сохраняет отгрузку");',
      "таймаут сохранения отгрузки",
    );
  }
  if (!source.includes("Сохранённые отгрузки перепроверены") && source.includes("export async function runPlanningMutation")) {
    source = replaceRequired(
      source,
      /export async function runPlanningMutation\(root, state, action, body, fetchImpl = fetch\) \{[\s\S]*?\n\}/g,
      `export async function runPlanningMutation(root, state, action, body, fetchImpl = fetch) {
  if (state.actionPending || state.refreshing) return false;
  state.actionPending = true;
  state.error = null;
  renderState(root, state);
  let succeeded = false;
  const requestBody = { from: state.from, to: state.to, ...body };
  try {
    const planning = await postPlanningAction(action, requestBody, fetchImpl);
    if (!Array.isArray(planning.inventory?.rows)) throw new Error("Ответ планирования не содержит сохранённые остатки");
    applySnapshot(state, { planning, inventory: planning.inventory });
    state.selectedProductKeys = null;
    state.quantitiesByProduct.clear();
    succeeded = true;
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : "Не удалось изменить поставку";
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const saved = await fetchSavedAnalysisSnapshot({ from: state.from, to: state.to, fetchImpl });
      applySnapshot(state, saved);
      if (planningMutationApplied(action, requestBody, saved.planning?.supplies)) {
        state.selectedProductKeys = null;
        state.quantitiesByProduct.clear();
        succeeded = true;
      } else {
        state.error = \`${"${originalMessage}"}. Сохранённые отгрузки перепроверены; незаписанные данные не заменили старые.\`;
      }
    } catch {
      state.error = originalMessage;
    }
  } finally {
    state.actionPending = false;
    renderState(root, state);
  }
  return succeeded;
}`,
      "сверка сохранения черновика после сбоя",
    );
  }
  if (!source.includes("function fullRefreshPeriod()")) {
    source = replaceRequired(
      source,
      /function isoDate\(date\) \{\s*return date\.toISOString\(\)\.slice\(0, 10\);\s*\}/g,
      `function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function fullRefreshPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 89);
  return { from: isoDate(from), to: isoDate(to) };
}`,
      "единое окно обновления",
    );
  }
  if (source.includes('postPlanningAction("refresh", { from: state.from, to: state.to }, fetchImpl)')) {
    source = replaceRequired(
      source,
      /postPlanningAction\("refresh", \{ from: state\.from, to: state\.to \}, fetchImpl\)/g,
      'postPlanningAction("refresh", fullRefreshPeriod(), fetchImpl)',
      "полное ручное обновление",
    );
  }
  if (!source.includes("Автообновление ежедневно в 07:00 МСК")) {
    source = replaceRequired(
      source,
      /const status = model\.updatedAt \? `Данные сохранены \$\{escapeHtml\(formatDateTime\(model\.updatedAt\)\)\}` : "Снимок ещё не создан";/g,
      'const status = `${model.updatedAt ? `Данные сохранены ${escapeHtml(formatDateTime(model.updatedAt))}` : "Снимок ещё не создан"} · Автообновление ежедневно в 07:00 МСК`;',
      "подпись расписания",
    );
  }
  return source;
}

export function patchFfPlanningStockAttachment(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Пустой файл хранилища анализа ФФ");
  if (input.includes("Object.prototype.hasOwnProperty.call(ffStock, warehouse.id)")) return input;

  let source = input;
  source = replaceRequired(
    source,
    /const ffStock = \{\};\s*\n(\s*)const ffExpiry = \{\};/g,
    `const ffStock = row.ffStock && typeof row.ffStock === "object" && !Array.isArray(row.ffStock)
      ? { ...row.ffStock }
      : {};
$1const ffExpiry = {};`,
    "сохранённый API-остаток ФФ",
  );
  source = replaceRequired(
    source,
    /ffStock\[warehouse\.id\] = Math\.max\(0, Number\(stock\?\.quantity\) \|\| 0\);/g,
    `if (stock) ffStock[warehouse.id] = Math.max(0, Number(stock.quantity) || 0);
      else if (!Object.prototype.hasOwnProperty.call(ffStock, warehouse.id)) ffStock[warehouse.id] = 0;`,
    "приоритет явного ручного остатка",
  );
  return source;
}

const PLANNING_FBS_STOCK_HELPERS = `function assertCompletePlanningFbsStocks(warehouses, result, hasSellableProducts) {
  if (!hasSellableProducts) return;
  const mappedWarehouseIds = [...new Set((warehouses ?? [])
    .filter((warehouse) => !warehouse.isHidden && warehouse.wbWarehouseId)
    .map((warehouse) => String(warehouse.wbWarehouseId)))];
  const mappedWarehouseIdSet = new Set(mappedWarehouseIds);
  const failed = (result.errors ?? []).find((entry) => mappedWarehouseIdSet.has(String(entry.warehouseId)));
  if (failed) {
    if (failed.reason instanceof Error) throw failed.reason;
    throw new Error(String(failed.reason ?? \`WB не вернул остатки FBS склада \${failed.warehouse ?? failed.warehouseId}\`));
  }
  const syncedWarehouseIds = new Set((result.syncedWarehouseIds ?? []).map(String));
  const missingWarehouseId = mappedWarehouseIds.find((warehouseId) => !syncedWarehouseIds.has(warehouseId));
  if (missingWarehouseId) throw new Error(\`WB не вернул остатки FBS склада \${missingWarehouseId}\`);
}

function attachPlanningFbsStocks(rows, warehouses, result) {
  const syncedWarehouseIds = new Set((result.syncedWarehouseIds ?? []).map(String));
  return (rows ?? []).map((row) => {
    const ffStock = row.ffStock && typeof row.ffStock === "object" && !Array.isArray(row.ffStock)
      ? { ...row.ffStock }
      : {};
    for (const warehouse of warehouses ?? []) {
      const wbWarehouseId = warehouse.wbWarehouseId ? String(warehouse.wbWarehouseId) : null;
      if (!wbWarehouseId || !syncedWarehouseIds.has(wbWarehouseId)) continue;
      const stock = result.stockByWarehouse?.get(wbWarehouseId);
      const nmId = Number(row.nmId);
      ffStock[warehouse.id] = Number.isInteger(nmId) && nmId > 0
        ? Math.max(0, Number(stock?.get(nmId)) || 0)
        : 0;
    }
    return { ...row, ffStock };
  });
}

`;

export function patchFfPlanningServerStocks(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Пустой серверный runtime анализа ФФ");
  if (input.includes("function attachPlanningFbsStocks(rows, warehouses, result)")) return input;

  let source = input;
  source = replaceRequired(
    source,
    /async function prepareWbFfPlanningMetrics\(input\) \{/g,
    `${PLANNING_FBS_STOCK_HELPERS}async function prepareWbFfPlanningMetrics(input) {`,
    "подключение API-остатков к снимку",
  );
  source = replaceRequired(
    source,
    /const sellableNmIds = sellableWbProductIds\(sellableCards\);/g,
    `const sellableNmIds = sellableWbProductIds(sellableCards);
  const sellerWarehouses = await getSellerWarehouses(input.token, input.signal);
  const visibleWbWarehouseIds = new Set(warehouses
    .filter((warehouse) => !warehouse.isHidden && warehouse.wbWarehouseId)
    .map((warehouse) => String(warehouse.wbWarehouseId)));
  const planningSellerWarehouses = sellerWarehouses.filter((warehouse) => visibleWbWarehouseIds.has(String(warehouse.id)));
  const fbsStockResult = await getFbsStocks(input.token, sellableCards, planningSellerWarehouses, input.signal);
  input.signal?.throwIfAborted();
  assertCompletePlanningFbsStocks(warehouses, fbsStockResult, sellableNmIds.size > 0);`,
    "загрузка FBS-остатков WB",
  );
  source = replaceRequired(
    source,
    /inventoryRows: buildPlanningInventoryRows\(\{([\s\S]*?)\n(\s*)\}\),\n(\s*)warnings,/g,
    `inventoryRows: attachPlanningFbsStocks(buildPlanningInventoryRows({$1
$2}), warehouses, fbsStockResult),
$3warnings,`,
    "сохранение API-остатков в снимке",
  );
  return source;
}

async function main() {
  const target = process.argv[2];
  const kind = process.argv[3] ?? "store";
  if (!target) throw new Error("Передайте путь к runtime-файлу анализа ФФ");
  const current = await readFile(target, "utf8");
  const patcher = kind === "route"
    ? patchFfPlanningRoute
    : kind === "client"
      ? patchFfAnalysisClient
      : kind === "stock-store"
        ? patchFfPlanningStockAttachment
        : kind === "server-stocks"
          ? patchFfPlanningServerStocks
          : patchFfPlanningStore;
  const patched = patcher(current);
  if (patched !== current) await writeFile(target, patched, "utf8");
  process.stdout.write(patched === current ? "already-patched\n" : "patched\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
