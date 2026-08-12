import { NextResponse } from "next/server";
import { emptyFfBatches, emptyFfExpiry, emptyFfStock, listFfStocks, listFfWarehouses, stockForProduct, syncMarketplaceFbsWarehouses, type FfBatches, type FfExpiry, type FfStock, type ManualWarehouse } from "@/db/ff-stocks";
import { fbsHandoverMetrics, recordFbsHandoverObservations, type HandoverMetrics } from "@/db/fbs-handover-metrics";
import { getInventoryRefreshCooldown, loadInventorySnapshot, releaseInventoryRefresh, reserveInventoryRefresh, saveInventorySnapshot } from "@/db/inventory-snapshots";
import { cabinetSummary, getAdminCabinet, type CabinetSummary } from "@/lib/admin-auth";
import { isOzonConfigured, ozonErrorMessage, ozonFetch, type OzonApiError } from "@/lib/ozon-api";

export const dynamic = "force-dynamic";

type FbsBreakdown = Record<string, number>;
type HandoverTiming = { sampleSize: number; averageHours: number | null };
type OzonStock = {
  warehouse_id?: number | string;
  warehouse_name?: string;
  warehouse_ids?: Array<number | string>;
  present?: number;
  reserved?: number;
  type?: string;
  warehouse_type?: string;
};
type OzonStockItem = { product_id?: number; offer_id?: string; name?: string; stocks?: OzonStock[] };
type OzonProduct = { id?: number; product_id?: number; offer_id?: string; name?: string };
type OzonPostingProduct = { product_id?: number; offer_id?: string; name?: string; quantity?: number };
type OzonPosting = { posting_number?: string; order_id?: number | string; status?: string; in_process_at?: string; created_at?: string; shipment_date?: string; warehouse_id?: number | string; warehouse_name?: string; products?: OzonPostingProduct[] };

type DashboardRow = {
  key: string;
  sku: string;
  nmId: number | null;
  name: string;
  category: string;
  color: string;
  warehouses: Record<string, number>;
  ffStock: FfStock;
  ffExpiry: FfExpiry;
  ffBatches: FfBatches;
  fbs: number;
  fbsByLocation: FbsBreakdown;
  fbsByWbWarehouse: FbsBreakdown;
  sales7d: number;
  sales7dByLocation: FbsBreakdown;
  sales7dByWbWarehouse: FbsBreakdown;
  receiving: number;
  receivingByLocation: FbsBreakdown;
  receivingByWbWarehouse: FbsBreakdown;
  toSale: number;
  toSaleByLocation: FbsBreakdown;
  toSaleByWbWarehouse: FbsBreakdown;
  status: "В норме" | "Мало" | "Заканчивается";
  updated: string;
  fbsStockByWbWarehouse: FbsBreakdown;
};

type OzonAnalytics = { daily: Record<string, number>; byWarehouse: FbsBreakdown };
type OzonPayload = {
  configured: true;
  cabinet: CabinetSummary;
  rows: DashboardRow[];
  warehouseNames: string[];
  manualWarehouses: ManualWarehouse[];
  totals: { available: number; ffTotal: number; ffStock: FfStock; fbs: number; fbsByLocation: FbsBreakdown; sales7d: number; receiving: number; toSale: number; risk: number; activeSupplies: number };
  warnings: string[];
  retryAt: string | null;
  updatedAt: string;
  handoverTiming: HandoverMetrics & { byLocation?: Record<string, HandoverTiming> };
  ozonAnalytics: OzonAnalytics;
};

const palette = ["#ffb45c", "#8ea6ff", "#d7a6cc", "#94c5a6", "#eaa070", "#79b9bd", "#adb1b8", "#d0ad82"];
const TIMEOUT_MS = 25_000;
const LOCK_MS = TIMEOUT_MS + 5_000;
const emptyBreakdown = (): FbsBreakdown => ({});
const emptyTiming = (): HandoverMetrics => ({ overall: { sampleSize: 0, averageHours: null }, byWbWarehouse: {}, trackingStartedAt: null });

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function increment(target: FbsBreakdown, key: string, quantity: number) {
  target[key] = (target[key] ?? 0) + Math.max(0, quantity);
}

function dateKey(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function isSellerFbsStock(stock: OzonStock, sellerIds: Set<number>) {
  const type = `${stock.type ?? ""} ${stock.warehouse_type ?? ""}`.toLowerCase();
  return sellerIds.has(Number(stock.warehouse_id))
    || (stock.warehouse_ids ?? []).some((id) => sellerIds.has(Number(id)))
    || type.includes("fbs")
    || type.includes("seller");
}

function physicalStock(stock: OzonStock) {
  return Math.max(0, Number(stock.present) || 0) + Math.max(0, Number(stock.reserved) || 0);
}

async function getOzonWarehouses(signal: AbortSignal) {
  const data = await ozonFetch<{ result?: Array<{ warehouse_id?: number | string; name?: string }> }>("/v2/warehouse/list", { method: "POST", body: "{}" }, signal);
  return (data.result ?? []).flatMap((warehouse) => {
    const id = Number(warehouse.warehouse_id);
    return Number.isInteger(id) && id > 0
      ? [{ id, name: warehouse.name?.trim() || `Склад Ozon FBS №${id}` }]
      : [];
  });
}

async function getOzonStocks(signal: AbortSignal) {
  const items: OzonStockItem[] = [];
  let cursor = "";
  for (let page = 0; page < 30; page += 1) {
    const data = await ozonFetch<{ items?: OzonStockItem[]; cursor?: string }>("/v4/product/info/stocks", {
      method: "POST",
      body: JSON.stringify({ filter: { offer_id: [], product_id: [], visibility: "ALL" }, cursor, limit: 1000 }),
    }, signal);
    const batch = data.items ?? [];
    items.push(...batch);
    const next = data.cursor ?? "";
    if (!batch.length || !next || next === cursor) break;
    cursor = next;
  }
  return items;
}

async function enrichProductNames(items: OzonStockItem[], signal: AbortSignal) {
  const ids = [...new Set(items.map((item) => Number(item.product_id)).filter((id) => Number.isInteger(id) && id > 0))];
  const names = new Map<number, { name: string; offerId: string }>();
  for (const idsChunk of chunks(ids, 1000)) {
    const data = await ozonFetch<{ items?: OzonProduct[]; result?: { items?: OzonProduct[] } }>("/v3/product/info/list", {
      method: "POST",
      body: JSON.stringify({ product_id: idsChunk }),
    }, signal);
    for (const product of data.items ?? data.result?.items ?? []) {
      const id = Number(product.id ?? product.product_id);
      if (Number.isInteger(id) && id > 0) names.set(id, { name: product.name?.trim() || "", offerId: product.offer_id?.trim() || "" });
    }
  }
  return names;
}

async function getOzonPostings(signal: AbortSignal) {
  const postings: OzonPosting[] = [];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  for (let offset = 0; offset < 30_000; offset += 1000) {
    const data = await ozonFetch<{ result?: { postings?: OzonPosting[]; has_next?: boolean }; postings?: OzonPosting[]; has_next?: boolean }>("/v3/posting/fbs/list", {
      method: "POST",
      body: JSON.stringify({ dir: "ASC", filter: { since, to }, limit: 1000, offset, with: { analytics_data: false, financial_data: false, barcodes: true, translit: false } }),
    }, signal);
    const batch = data.result?.postings ?? data.postings ?? [];
    postings.push(...batch);
    const hasNext = data.result?.has_next ?? data.has_next ?? false;
    if (!batch.length || !hasNext) break;
  }
  return postings;
}

function createRow(rowMap: Map<string, DashboardRow>, input: { productId: number; sku?: string; name?: string }) {
  const key = `ozon:${input.productId}`;
  const current = rowMap.get(key);
  if (current) return current;
  const seed = input.productId;
  const row: DashboardRow = {
    key,
    sku: input.sku || `Ozon ${input.productId}`,
    nmId: input.productId,
    name: input.name || input.sku || `Товар Ozon ${input.productId}`,
    category: "Ozon",
    color: palette[Math.abs(seed) % palette.length],
    warehouses: {}, ffStock: emptyFfStock(), ffExpiry: emptyFfExpiry(), ffBatches: emptyFfBatches(), fbsStockByWbWarehouse: emptyBreakdown(),
    fbs: 0, fbsByLocation: emptyBreakdown(), fbsByWbWarehouse: emptyBreakdown(), sales7d: 0, sales7dByLocation: emptyBreakdown(), sales7dByWbWarehouse: emptyBreakdown(),
    receiving: 0, receivingByLocation: emptyBreakdown(), receivingByWbWarehouse: emptyBreakdown(), toSale: 0, toSaleByLocation: emptyBreakdown(), toSaleByWbWarehouse: emptyBreakdown(),
    status: "В норме", updated: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }),
  };
  rowMap.set(key, row);
  return row;
}

function mapByLocation(input: FbsBreakdown, ids: Map<string, string>) {
  return Object.entries(input).reduce<FbsBreakdown>((total, [marketplaceWarehouseId, quantity]) => {
    increment(total, ids.get(marketplaceWarehouseId) ?? "unassigned", quantity);
    return total;
  }, {});
}

async function attachFfStocks(payload: OzonPayload): Promise<OzonPayload> {
  const [manualWarehouses, lookup] = await Promise.all([listFfWarehouses("ozon"), listFfStocks("ozon")]);
  const marketplaceToFf = new Map(manualWarehouses.filter((warehouse) => warehouse.wbWarehouseId).map((warehouse) => [String(warehouse.wbWarehouseId), warehouse.id]));
  const rows = payload.rows.map((row) => {
    const ffStock = stockForProduct(lookup, { productKey: row.key, sku: row.sku }, manualWarehouses);
    for (const [marketplaceWarehouseId, physical] of Object.entries(row.fbsStockByWbWarehouse)) {
      const ffWarehouseId = marketplaceToFf.get(marketplaceWarehouseId);
      if (ffWarehouseId) ffStock[ffWarehouseId] = physical;
    }
    return {
      ...row,
      ffStock,
      fbsByLocation: mapByLocation(row.fbsByWbWarehouse, marketplaceToFf),
      sales7dByLocation: mapByLocation(row.sales7dByWbWarehouse, marketplaceToFf),
      receivingByLocation: mapByLocation(row.receivingByWbWarehouse, marketplaceToFf),
      toSaleByLocation: mapByLocation(row.toSaleByWbWarehouse, marketplaceToFf),
    };
  });
  const visible = manualWarehouses.filter((warehouse) => !warehouse.isHidden);
  const ffStock = rows.reduce<FfStock>((total, row) => {
    for (const warehouse of visible) total[warehouse.id] = (total[warehouse.id] ?? 0) + (row.ffStock[warehouse.id] ?? 0);
    return total;
  }, emptyFfStock(visible));
  const handoverTiming = { ...payload.handoverTiming, byLocation: Object.fromEntries(Object.entries(payload.handoverTiming.byWbWarehouse).map(([marketplaceWarehouseId, timing]) => [marketplaceToFf.get(marketplaceWarehouseId) ?? "unassigned", timing])) };
  return {
    ...payload,
    rows,
    manualWarehouses,
    handoverTiming,
    totals: {
      ...payload.totals,
      ffStock,
      ffTotal: Object.values(ffStock).reduce((sum, quantity) => sum + quantity, 0),
      fbsByLocation: rows.reduce<FbsBreakdown>((total, row) => {
        for (const [warehouseId, quantity] of Object.entries(row.fbsByLocation)) increment(total, warehouseId, quantity);
        return total;
      }, {}),
    },
  };
}

async function refreshOzonInventory(signal: AbortSignal): Promise<OzonPayload> {
  const cabinet = cabinetSummary("ozon");
  const [warehouseResult, stockResult, postingsResult] = await Promise.allSettled([getOzonWarehouses(signal), getOzonStocks(signal), getOzonPostings(signal)]);
  const failures = [warehouseResult, stockResult, postingsResult].filter((item): item is PromiseRejectedResult => item.status === "rejected");
  if (failures.length) throw failures[0].reason;
  const sellerWarehouses = warehouseResult.value;
  const stockItems = stockResult.value;
  const postings = postingsResult.value;
  await syncMarketplaceFbsWarehouses({ cabinetId: "ozon", warehouses: sellerWarehouses, idPrefix: "ozon", defaultName: "Склад Ozon FBS" });
  const names = await enrichProductNames(stockItems, signal).catch(() => new Map<number, { name: string; offerId: string }>());
  const sellerIds = new Set(sellerWarehouses.map((warehouse) => warehouse.id));
  const rowMap = new Map<string, DashboardRow>();
  for (const item of stockItems) {
    const productId = Number(item.product_id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    const info = names.get(productId);
    const row = createRow(rowMap, { productId, sku: info?.offerId || item.offer_id, name: info?.name || item.name });
    for (const stock of item.stocks ?? []) {
      const quantity = physicalStock(stock);
      if (!quantity) continue;
      const warehouseIds = [stock.warehouse_id, ...(stock.warehouse_ids ?? [])]
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (isSellerFbsStock(stock, sellerIds)) {
        for (const warehouseId of warehouseIds) increment(row.fbsStockByWbWarehouse, String(warehouseId), quantity);
      } else {
        const name = `Ozon · ${stock.warehouse_name?.trim() || "FBO"}`;
        row.warehouses[name] = (row.warehouses[name] ?? 0) + quantity;
      }
    }
  }
  const now = Date.now();
  const weekStart = now - 7 * 86_400_000;
  const daily: Record<string, number> = {};
  const warehouseDaily = emptyBreakdown();
  const beforeHandover = new Set(["awaiting_packaging", "awaiting_registration", "new", "packaging"]);
  const handedOver = new Set(["awaiting_deliver", "delivering", "driver_pickup", "sent_by_seller"]);
  const delivered = new Set(["delivered"]);
  const observed = [] as Array<{ id: string; warehouseId: number | null; createdAt: string | null; state: "before" | "handover" }>;
  for (const posting of postings) {
    const status = (posting.status ?? "").toLowerCase();
    const parsedWarehouseId = Number(posting.warehouse_id);
    const warehouseId = Number.isInteger(parsedWarehouseId) && parsedWarehouseId > 0 ? parsedWarehouseId : null;
    const createdAt = posting.in_process_at ?? posting.created_at ?? null;
    const before = beforeHandover.has(status);
    const handover = handedOver.has(status) || delivered.has(status);
    for (const product of posting.products ?? []) {
      const productId = Number(product.product_id);
      if (!Number.isInteger(productId) || productId <= 0) continue;
      const quantity = Math.max(1, Math.floor(Number(product.quantity) || 1));
      const row = createRow(rowMap, { productId, sku: product.offer_id, name: product.name });
      const sourceWarehouse = warehouseId ? String(warehouseId) : "unknown";
      if (before) { row.fbs += quantity; increment(row.fbsByWbWarehouse, sourceWarehouse, quantity); }
      if (handedOver && !delivered.has(status)) { row.receiving += quantity; increment(row.receivingByWbWarehouse, sourceWarehouse, quantity); }
      if (delivered.has(status)) { row.toSale += quantity; increment(row.toSaleByWbWarehouse, sourceWarehouse, quantity); }
      const createdMs = createdAt ? Date.parse(createdAt) : Number.NaN;
      if (Number.isFinite(createdMs) && createdMs >= weekStart && !status.includes("cancel")) {
        row.sales7d += quantity;
        increment(row.sales7dByWbWarehouse, sourceWarehouse, quantity);
        const day = dateKey(createdAt ?? undefined);
        if (day) daily[day] = (daily[day] ?? 0) + quantity;
        increment(warehouseDaily, sourceWarehouse, quantity);
      }
      if (before || handover) {
        for (let unit = 0; unit < quantity; unit += 1) observed.push({ id: `${posting.posting_number ?? posting.order_id ?? productId}:${productId}:${unit}`, warehouseId, createdAt, state: before ? "before" : "handover" });
      }
    }
  }
  await recordFbsHandoverObservations({ cabinetId: "ozon", orders: observed });
  const handoverTiming = await fbsHandoverMetrics("ozon");
  const rows = [...rowMap.values()].map((row) => {
    const total = Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
    const physicalFbs = Object.values(row.fbsStockByWbWarehouse).reduce((sum, value) => sum + value, 0);
    row.status = total + physicalFbs <= 5 ? "Заканчивается" : total + physicalFbs <= 20 ? "Мало" : "В норме";
    return row;
  }).sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const fboTotal = rows.reduce((sum, row) => sum + Object.values(row.warehouses).reduce((inner, value) => inner + value, 0), 0);
  const totals = {
    available: fboTotal,
    ffTotal: 0,
    ffStock: emptyFfStock(),
    fbs: rows.reduce((sum, row) => sum + row.fbs, 0),
    fbsByLocation: emptyBreakdown(),
    sales7d: rows.reduce((sum, row) => sum + row.sales7d, 0),
    receiving: rows.reduce((sum, row) => sum + row.receiving, 0),
    toSale: rows.reduce((sum, row) => sum + row.toSale, 0),
    risk: rows.filter((row) => row.status !== "В норме").length,
    activeSupplies: new Set(postings.filter((posting) => beforeHandover.has((posting.status ?? "").toLowerCase()) || handedOver.has((posting.status ?? "").toLowerCase())).map((posting) => posting.posting_number || posting.order_id)).size,
  };
  const warning = !fboTotal && rows.length ? "Остаток FBO Ozon пока не найден: показаны товары FBS и их резервы." : null;
  return {
    configured: true,
    cabinet,
    rows,
    warehouseNames: [...new Set(rows.flatMap((row) => Object.keys(row.warehouses)))].sort((a, b) => a.localeCompare(b, "ru")),
    manualWarehouses: [],
    totals,
    warnings: warning ? [warning] : [],
    retryAt: null,
    updatedAt: new Date().toISOString(),
    handoverTiming,
    ozonAnalytics: { daily, byWarehouse: warehouseDaily },
  };
}

function retryAt(error: unknown) {
  const apiError = error as OzonApiError;
  return apiError.status === 429 ? new Date(Date.now() + (apiError.retryAfterSeconds ?? 60) * 1000).toISOString() : null;
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ configured: true, error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (cabinetId !== "ozon") return NextResponse.json({ error: "Сначала переключитесь в кабинет Ozon" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const cabinet = cabinetSummary("ozon");
  if (!isOzonConfigured()) return NextResponse.json({ configured: false, cabinet, error: "Ключи Ozon для этого кабинета ещё не настроены на сервере" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const cached = await loadInventorySnapshot<OzonPayload>("ozon").catch(() => null);
  const cooldown = await getInventoryRefreshCooldown("ozon").catch(() => null);
  if (!force && cached?.rows) return NextResponse.json(await attachFfStocks({ ...cached, retryAt: cached.retryAt ?? cooldown }), { headers: { "Cache-Control": "private, max-age=0" } });
  const reservation = await reserveInventoryRefresh("ozon", LOCK_MS);
  if (!reservation.reserved) {
    if (cached?.rows) return NextResponse.json(await attachFfStocks({ ...cached, retryAt: reservation.cooldownUntil }), { headers: { "Cache-Control": "private, max-age=0" } });
    return NextResponse.json({ configured: true, cabinet, error: "Обновление Ozon уже запущено другим пользователем. Повторите после таймера.", retryAt: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const payload = await refreshOzonInventory(controller.signal);
    await saveInventorySnapshot("ozon", payload, payload.updatedAt).catch(() => undefined);
    return NextResponse.json(await attachFfStocks(payload), { headers: { "Cache-Control": "private, max-age=0" } });
  } catch (error) {
    if (cached?.rows) {
      const fallback = { ...cached, retryAt: retryAt(error), warnings: [...new Set([...(cached.warnings ?? []), ozonErrorMessage("Синхронизация Ozon", error), "Показаны последние корректные данные."])] };
      return NextResponse.json(await attachFfStocks(fallback), { headers: { "Cache-Control": "private, max-age=0" } });
    }
    return NextResponse.json({ configured: true, cabinet, error: ozonErrorMessage("Синхронизация Ozon", error), retryAt: retryAt(error) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timeout);
    await releaseInventoryRefresh("ozon").catch(() => undefined);
  }
}
