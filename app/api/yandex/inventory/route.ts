import { NextResponse } from "next/server";
import { emptyFfBatches, emptyFfExpiry, emptyFfStock, listFfStocks, listFfWarehouses, stockForProduct, syncMarketplaceFbsWarehouses, type FfBatches, type FfExpiry, type FfStock, type ManualWarehouse } from "@/db/ff-stocks";
import { fbsHandoverMetrics, recordFbsHandoverObservations, type HandoverMetrics } from "@/db/fbs-handover-metrics";
import { getInventoryRefreshCooldown, loadInventorySnapshot, releaseInventoryRefresh, reserveInventoryRefresh, saveInventorySnapshot } from "@/db/inventory-snapshots";
import { cabinetSummary, getAdminCabinet, type CabinetSummary } from "@/lib/admin-auth";
import { isYandexMarketConfigured, yandexMarketErrorMessage, yandexMarketFetch, type YandexMarketApiError } from "@/lib/yandex-market-api";

export const dynamic = "force-dynamic";

type FbsBreakdown = Record<string, number>;
type HandoverTiming = { sampleSize: number; averageHours: number | null };
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

type YandexCampaign = { id?: number; domain?: string; placementType?: string; apiAvailability?: string; business?: { name?: string } };
type YandexStock = { type?: string; count?: number; available?: number; amount?: number };
type YandexStockOffer = { offerId?: string; stocks?: YandexStock[] };
type YandexStockWarehouse = { warehouseId?: number; offers?: YandexStockOffer[] };
type YandexOrderItem = { id?: number; offerId?: string; offerName?: string; count?: number };
type YandexOrder = { orderId?: number | string; campaignId?: number; status?: string; substatus?: string; creationDate?: string; updateDate?: string; cancelRequested?: boolean; items?: YandexOrderItem[] };
type YandexAnalytics = { daily: Record<string, number>; byWarehouse: FbsBreakdown };
type YandexPayload = {
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
  yandexAnalytics: YandexAnalytics;
};

const palette = ["#ffb45c", "#8ea6ff", "#d7a6cc", "#94c5a6", "#eaa070", "#79b9bd", "#adb1b8", "#d0ad82"];
const TIMEOUT_MS = 25_000;
const LOCK_MS = TIMEOUT_MS + 5_000;
const emptyBreakdown = (): FbsBreakdown => ({});
const emptyTiming = (): HandoverMetrics => ({ overall: { sampleSize: 0, averageHours: null }, byWbWarehouse: {}, trackingStartedAt: null });

function increment(target: FbsBreakdown, key: string, quantity: number) {
  target[key] = (target[key] ?? 0) + Math.max(0, quantity);
}

function dateKey(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function campaignName(campaign: YandexCampaign) {
  return campaign.business?.name?.trim() || campaign.domain?.trim() || `Кампания Яндекс Маркета №${campaign.id ?? ""}`.trim();
}

function physicalStock(stocks: YandexStock[]) {
  return stocks.reduce((sum, stock) => {
    if ((stock.type ?? "FIT").toUpperCase() !== "FIT") return sum;
    return sum + Math.max(0, Number(stock.count ?? stock.available ?? stock.amount) || 0);
  }, 0);
}

async function getCampaigns(signal: AbortSignal) {
  const campaigns: YandexCampaign[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<{ campaigns?: YandexCampaign[]; paging?: { nextPageToken?: string } }>(`/v2/campaigns?${params}`, {}, signal);
    campaigns.push(...(data.campaigns ?? []));
    const next = data.paging?.nextPageToken ?? "";
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  return campaigns.flatMap((campaign) => Number.isInteger(campaign.id) && campaign.id! > 0 ? [{ ...campaign, id: campaign.id! }] : []);
}

async function getCampaignStocks(campaignId: number, signal: AbortSignal) {
  const warehouses: YandexStockWarehouse[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<{ result?: { warehouses?: YandexStockWarehouse[]; paging?: { nextPageToken?: string } } }>(`/v2/campaigns/${campaignId}/offers/stocks?${params}`, { method: "POST", body: JSON.stringify({ withTurnover: false }) }, signal);
    const result = data.result ?? {};
    warehouses.push(...(result.warehouses ?? []));
    const next = result.paging?.nextPageToken ?? "";
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  return warehouses;
}

async function getOrders(businessId: number, signal: AbortSignal) {
  const orders: YandexOrder[] = [];
  let pageToken = "";
  for (let page = 0; page < 30; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<{ orders?: YandexOrder[]; paging?: { nextPageToken?: string } }>(`/v1/businesses/${businessId}/orders?${params}`, { method: "POST", body: "{}" }, signal);
    const batch = data.orders ?? [];
    orders.push(...batch);
    const next = data.paging?.nextPageToken ?? "";
    if (!batch.length || !next || next === pageToken) break;
    pageToken = next;
  }
  return orders;
}

function createRow(rowMap: Map<string, DashboardRow>, input: { sku: string; name?: string }) {
  const sku = input.sku.trim() || "Яндекс Маркет";
  const key = `yandex:${sku.toLocaleUpperCase("ru-RU")}`;
  const current = rowMap.get(key);
  if (current) return current;
  const seed = [...sku].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
  const row: DashboardRow = {
    key,
    sku,
    nmId: null,
    name: input.name?.trim() || sku,
    category: "Яндекс Маркет",
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

async function attachFfStocks(payload: YandexPayload): Promise<YandexPayload> {
  const [manualWarehouses, lookup] = await Promise.all([listFfWarehouses("yandex"), listFfStocks("yandex")]);
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

async function refreshYandexInventory(signal: AbortSignal): Promise<YandexPayload> {
  const cabinet = cabinetSummary("yandex");
  const campaigns = await getCampaigns(signal);
  const fbsCampaigns = campaigns.filter((campaign) => campaign.placementType?.toUpperCase() === "FBS" && campaign.apiAvailability !== "DISABLED_BY_INACTIVITY");
  const fbyCampaigns = campaigns.filter((campaign) => campaign.placementType?.toUpperCase() === "FBY");
  await syncMarketplaceFbsWarehouses({
    cabinetId: "yandex",
    warehouses: fbsCampaigns.map((campaign) => ({ id: campaign.id, name: campaignName(campaign) })),
    idPrefix: "ym",
    defaultName: "Склад Яндекс Маркета FBS",
  });
  const businessId = Number(process.env.YANDEX_MARKET_BUSINESS_ID?.trim());
  const stockCampaigns = [...fbsCampaigns, ...fbyCampaigns];
  const [stockResults, ordersResult] = await Promise.all([
    Promise.all(stockCampaigns.map(async (campaign) => ({ campaign, warehouses: await getCampaignStocks(campaign.id, signal) }))),
    Number.isInteger(businessId) && businessId > 0 ? getOrders(businessId, signal) : Promise.resolve([]),
  ]);
  const rowMap = new Map<string, DashboardRow>();
  for (const { campaign, warehouses } of stockResults) {
    const fbs = campaign.placementType?.toUpperCase() === "FBS";
    for (const warehouse of warehouses) {
      for (const offer of warehouse.offers ?? []) {
        const sku = offer.offerId?.trim();
        if (!sku) continue;
        const quantity = physicalStock(offer.stocks ?? []);
        const row = createRow(rowMap, { sku });
        if (fbs) {
          // For FBS the campaign represents the seller's fulfilment location.
          // Market can also return a technical return warehouse in this response,
          // so we deliberately bind the stock to the campaign configured by seller.
          increment(row.fbsStockByWbWarehouse, String(campaign.id), quantity);
        } else {
          const name = `Яндекс Маркет · ${campaignName(campaign)}`;
          row.warehouses[name] = (row.warehouses[name] ?? 0) + quantity;
        }
      }
    }
  }
  const fbsCampaignIds = new Set(fbsCampaigns.map((campaign) => campaign.id));
  const now = Date.now();
  const weekStart = now - 7 * 86_400_000;
  const daily: Record<string, number> = {};
  const warehouseDaily = emptyBreakdown();
  const beforeHandover = new Set(["PLACING", "RESERVED", "UNPAID", "PROCESSING"]);
  const handedOver = new Set(["DELIVERY", "PICKUP"]);
  const delivered = new Set(["DELIVERED"]);
  const observed = [] as Array<{ id: string; warehouseId: number | null; createdAt: string | null; state: "before" | "handover" }>;
  for (const order of ordersResult) {
    const campaignId = Number(order.campaignId);
    if (!fbsCampaignIds.has(campaignId)) continue;
    const status = (order.status ?? "").toUpperCase();
    const before = beforeHandover.has(status);
    const handover = handedOver.has(status) || delivered.has(status);
    const createdAt = order.creationDate ?? order.updateDate ?? null;
    for (const item of order.items ?? []) {
      const sku = item.offerId?.trim() || (item.id ? `YM ${item.id}` : "");
      if (!sku) continue;
      const quantity = Math.max(1, Math.floor(Number(item.count) || 1));
      const row = createRow(rowMap, { sku, name: item.offerName });
      if (item.offerName?.trim()) row.name = item.offerName.trim();
      if (before) { row.fbs += quantity; increment(row.fbsByWbWarehouse, String(campaignId), quantity); }
      if (handedOver && !delivered.has(status)) { row.receiving += quantity; increment(row.receivingByWbWarehouse, String(campaignId), quantity); }
      if (delivered.has(status)) { row.toSale += quantity; increment(row.toSaleByWbWarehouse, String(campaignId), quantity); }
      const createdMs = createdAt ? Date.parse(createdAt) : Number.NaN;
      if (Number.isFinite(createdMs) && createdMs >= weekStart && !order.cancelRequested && status !== "CANCELLED") {
        row.sales7d += quantity;
        increment(row.sales7dByWbWarehouse, String(campaignId), quantity);
        const day = dateKey(createdAt ?? undefined);
        if (day) daily[day] = (daily[day] ?? 0) + quantity;
        increment(warehouseDaily, String(campaignId), quantity);
      }
      if (before || handover) {
        for (let unit = 0; unit < quantity; unit += 1) observed.push({ id: `${order.orderId ?? sku}:${item.id ?? sku}:${unit}`, warehouseId: campaignId, createdAt, state: before ? "before" : "handover" });
      }
    }
  }
  await recordFbsHandoverObservations({ cabinetId: "yandex", orders: observed });
  const handoverTiming = await fbsHandoverMetrics("yandex");
  const rows = [...rowMap.values()].map((row) => {
    const total = Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
    const physicalFbs = Object.values(row.fbsStockByWbWarehouse).reduce((sum, value) => sum + value, 0);
    row.status = total + physicalFbs <= 5 ? "Заканчивается" : total + physicalFbs <= 20 ? "Мало" : "В норме";
    return row;
  }).sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const fboTotal = rows.reduce((sum, row) => sum + Object.values(row.warehouses).reduce((inner, value) => inner + value, 0), 0);
  return {
    configured: true,
    cabinet,
    rows,
    warehouseNames: [...new Set(rows.flatMap((row) => Object.keys(row.warehouses)))].sort((a, b) => a.localeCompare(b, "ru")),
    manualWarehouses: [],
    totals: {
      available: fboTotal,
      ffTotal: 0,
      ffStock: emptyFfStock(),
      fbs: rows.reduce((sum, row) => sum + row.fbs, 0),
      fbsByLocation: emptyBreakdown(),
      sales7d: rows.reduce((sum, row) => sum + row.sales7d, 0),
      receiving: rows.reduce((sum, row) => sum + row.receiving, 0),
      toSale: rows.reduce((sum, row) => sum + row.toSale, 0),
      risk: rows.filter((row) => row.status !== "В норме").length,
      activeSupplies: new Set(ordersResult.filter((order) => fbsCampaignIds.has(Number(order.campaignId)) && (beforeHandover.has((order.status ?? "").toUpperCase()) || handedOver.has((order.status ?? "").toUpperCase()))).map((order) => order.orderId)).size,
    },
    warnings: ["Яндекс Маркет: аналитика FBS показывает созданные заказы. Факт выкупа FBY подключается отдельным финансовым отчётом."],
    retryAt: null,
    updatedAt: new Date().toISOString(),
    handoverTiming,
    yandexAnalytics: { daily, byWarehouse: warehouseDaily },
  };
}

function retryAt(error: unknown) {
  const apiError = error as YandexMarketApiError;
  return apiError.status === 429 ? new Date(Date.now() + (apiError.retryAfterSeconds ?? 60) * 1000).toISOString() : null;
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ configured: true, error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (cabinetId !== "yandex") return NextResponse.json({ error: "Сначала переключитесь в кабинет Яндекс Маркета" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const cabinet = cabinetSummary("yandex");
  if (!isYandexMarketConfigured()) return NextResponse.json({ configured: false, cabinet, error: "Ключ Яндекс Маркета для этого кабинета ещё не настроен на сервере" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const cached = await loadInventorySnapshot<YandexPayload>("yandex").catch(() => null);
  const cooldown = await getInventoryRefreshCooldown("yandex").catch(() => null);
  if (!force && cached?.rows) return NextResponse.json(await attachFfStocks({ ...cached, retryAt: cached.retryAt ?? cooldown }), { headers: { "Cache-Control": "private, max-age=0" } });
  const reservation = await reserveInventoryRefresh("yandex", LOCK_MS);
  if (!reservation.reserved) {
    if (cached?.rows) return NextResponse.json(await attachFfStocks({ ...cached, retryAt: reservation.cooldownUntil }), { headers: { "Cache-Control": "private, max-age=0" } });
    return NextResponse.json({ configured: true, cabinet, error: "Обновление Яндекс Маркета уже запущено другим пользователем. Повторите после таймера.", retryAt: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const payload = await refreshYandexInventory(controller.signal);
    await saveInventorySnapshot("yandex", payload, payload.updatedAt).catch(() => undefined);
    return NextResponse.json(await attachFfStocks(payload), { headers: { "Cache-Control": "private, max-age=0" } });
  } catch (error) {
    if (cached?.rows) {
      const fallback = { ...cached, retryAt: retryAt(error), warnings: [...new Set([...(cached.warnings ?? []), yandexMarketErrorMessage("Синхронизация Яндекс Маркета", error), "Показаны последние корректные данные."])] };
      return NextResponse.json(await attachFfStocks(fallback), { headers: { "Cache-Control": "private, max-age=0" } });
    }
    return NextResponse.json({ configured: true, cabinet, error: yandexMarketErrorMessage("Синхронизация Яндекс Маркета", error), retryAt: retryAt(error) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timeout);
    await releaseInventoryRefresh("yandex").catch(() => undefined);
  }
}
