import { NextResponse } from "next/server";
import { batchesForProduct, emptyFfBatches, emptyFfExpiry, emptyFfStock, expiryForProduct, listFfStocks, listFfWarehouses, stockForProduct, syncWbFbsWarehouses, type FfBatches, type FfExpiry, type FfStock, type ManualWarehouse } from "@/db/ff-stocks";
import { fbsHandoverMetrics, recordFbsHandoverObservations, type HandoverMetrics } from "@/db/fbs-handover-metrics";
import { cabinetSummary, cabinetToken, getAdminCabinet, type CabinetId, type CabinetSummary } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

type WbCard = {
  nmID?: number;
  nmId?: number;
  vendorCode?: string;
  title?: string;
  subjectName?: string;
  sizes?: Array<{ chrtID?: number; chrtId?: number }>;
};

type WbOrder = {
  id: number;
  nmId?: number;
  chrtId?: number;
  article?: string;
  supplyId?: string;
  createdAt?: string;
  warehouseId?: number;
};

type WbSellerWarehouse = { id?: number; name?: string; isDeleting?: boolean };
type WbFbsStock = { chrtId?: number; chrtID?: number; amount?: number };

type OrderStatus = { id: number; supplierStatus?: string; wbStatus?: string };
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
  fbsStockByWbWarehouse: FbsBreakdown;
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
};

const WB_MARKETPLACE = "https://marketplace-api.wildberries.ru";
const WB_CONTENT = "https://content-api.wildberries.ru";
const WB_ANALYTICS = "https://seller-analytics-api.wildberries.ru";
const palette = ["#ffb45c", "#8ea6ff", "#d7a6cc", "#94c5a6", "#eaa070", "#79b9bd", "#adb1b8", "#d0ad82"];
const emptyFbsBreakdown = (): FbsBreakdown => ({});
const emptyHandoverTiming = (): HandoverMetrics => ({ overall: { sampleSize: 0, averageHours: null }, byWbWarehouse: {}, trackingStartedAt: null });

type DashboardPayload = {
  configured: true;
  cabinet: CabinetSummary;
  rows: DashboardRow[];
  warehouseNames: string[];
  manualWarehouses: ManualWarehouse[];
  fbsStockSyncedWarehouseIds: string[];
  totals: {
    available: number;
    ffTotal: number;
    ffStock: FfStock;
    fbs: number;
    fbsByLocation: FbsBreakdown;
    sales7d: number;
    receiving: number;
    toSale: number;
    risk: number;
    activeSupplies: number;
  };
  warnings: string[];
  retryAt: string | null;
  updatedAt: string;
  handoverTiming: HandoverMetrics & { byLocation?: Record<string, HandoverTiming> };
};

const CACHE_LIFETIME_MS = 2 * 60 * 1000;
const FORCE_REFRESH_COOLDOWN_MS = 20 * 1000;
const INVENTORY_REFRESH_TIMEOUT_MS = 25 * 1000;
const WB_RATE_LIMIT_RETRY_MS = 20 * 1000;
const memoryCache = new Map<CabinetId, { createdAt: number; expiresAt: number; payload: DashboardPayload }>();

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function wbFetch<T>(token: string, url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal,
    cache: "no-store",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = new Error(`WB API ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

async function getCards(token: string, signal?: AbortSignal): Promise<WbCard[]> {
  const cards: WbCard[] = [];
  let cursor: { limit: number; updatedAt?: string; nmID?: number } = { limit: 100 };

  for (let page = 0; page < 30; page += 1) {
    const data = await wbFetch<{ cards?: WbCard[]; cursor?: { total?: number; updatedAt?: string; nmID?: number } }>(
      token,
      `${WB_CONTENT}/content/v2/get/cards/list`,
      {
        method: "POST",
        body: JSON.stringify({ settings: { sort: { ascending: true }, cursor, filter: { withPhoto: -1 } } }),
      },
      signal,
    );
    const batch = data.cards ?? [];
    cards.push(...batch);
    if (batch.length < cursor.limit || !data.cursor?.updatedAt || !data.cursor?.nmID) break;
    cursor = { limit: 100, updatedAt: data.cursor.updatedAt, nmID: data.cursor.nmID };
  }

  return cards;
}

async function getWbStocks(token: string, signal?: AbortSignal) {
  const response = await wbFetch<{ data?: { items?: Array<{
    nmId?: number;
    warehouseName?: string;
    quantity?: number;
  }> } }>(token, `${WB_ANALYTICS}/api/analytics/v1/stocks-report/wb-warehouses`, {
    method: "POST",
    body: JSON.stringify({ nmIds: [], chrtIds: [], limit: 250000, offset: 0 }),
  }, signal);
  return response.data?.items ?? [];
}

async function getSellerWarehouses(token: string, signal?: AbortSignal): Promise<Array<{ id: number; name: string }>> {
  const warehouses = await wbFetch<WbSellerWarehouse[]>(token, `${WB_MARKETPLACE}/api/v3/warehouses`, undefined, signal);
  return warehouses
    .filter((warehouse) => Number.isInteger(warehouse.id) && (warehouse.id ?? 0) > 0 && !warehouse.isDeleting)
    .map((warehouse) => ({ id: warehouse.id!, name: warehouse.name?.trim() || `Склад WB FBS №${warehouse.id}` }));
}

async function getFbsStocks(token: string, cards: WbCard[], warehouses: Array<{ id: number; name: string }>, signal?: AbortSignal) {
  const chrtToNmId = new Map<number, number>();
  for (const card of cards) {
    const nmId = card.nmID ?? card.nmId;
    if (!nmId) continue;
    for (const size of card.sizes ?? []) {
      const chrtId = size.chrtID ?? size.chrtId;
      if (chrtId) chrtToNmId.set(chrtId, nmId);
    }
  }
  const chrtIds = [...chrtToNmId.keys()];
  if (!chrtIds.length || !warehouses.length) return { stockByWarehouse: new Map<string, Map<number, number>>(), syncedWarehouseIds: [] as string[], errors: [] as Array<{ warehouse: string; reason: unknown }> };

  const results = await Promise.all(warehouses.map(async (warehouse) => {
    try {
      const stock = new Map<number, number>();
      for (const chunk of chunks(chrtIds, 1000)) {
        const response = await wbFetch<{ stocks?: WbFbsStock[] }>(token, `${WB_MARKETPLACE}/api/v3/stocks/${warehouse.id}`, {
          method: "POST",
          body: JSON.stringify({ chrtIds: chunk }),
        }, signal);
        for (const item of response.stocks ?? []) {
          const nmId = chrtToNmId.get(item.chrtId ?? item.chrtID ?? 0);
          if (!nmId) continue;
          stock.set(nmId, (stock.get(nmId) ?? 0) + Math.max(0, Number(item.amount) || 0));
        }
      }
      return { warehouse, stock, error: null as unknown };
    } catch (error) {
      return { warehouse, stock: new Map<number, number>(), error };
    }
  }));

  return {
    stockByWarehouse: new Map(results.filter((result) => !result.error).map((result) => [String(result.warehouse.id), result.stock])),
    syncedWarehouseIds: results.filter((result) => !result.error).map((result) => String(result.warehouse.id)),
    errors: results.filter((result) => result.error).map((result) => ({ warehouse: result.warehouse.name, reason: result.error })),
  };
}

async function getOrders(token: string, signal?: AbortSignal): Promise<{ orders: WbOrder[]; statuses: Map<number, OrderStatus> }> {
  const orders: WbOrder[] = [];
  const now = Math.floor(Date.now() / 1000);
  const dateFrom = now - 30 * 24 * 60 * 60;
  let next = 0;
  for (let page = 0; page < 30; page += 1) {
    const params = new URLSearchParams({ limit: "1000", next: String(next), dateFrom: String(dateFrom), dateTo: String(now) });
    const data = await wbFetch<{ next?: number; orders?: WbOrder[] }>(token, `${WB_MARKETPLACE}/api/v3/orders?${params}`, undefined, signal);
    const batch = data.orders ?? [];
    orders.push(...batch);
    if (batch.length < 1000 || !data.next || data.next === next) break;
    next = data.next;
  }

  const statuses = new Map<number, OrderStatus>();
  for (const batch of chunks(orders.map((order) => order.id), 1000)) {
    if (!batch.length) continue;
    const data = await wbFetch<{ orders?: OrderStatus[] }>(token, `${WB_MARKETPLACE}/api/v3/orders/status`, {
      method: "POST",
      body: JSON.stringify({ orders: batch }),
    }, signal);
    for (const status of data.orders ?? []) statuses.set(status.id, status);
  }

  return { orders, statuses };
}

function getOrCreateRow(map: Map<string, DashboardRow>, input: { nmId?: number; sku?: string; name?: string; category?: string }) {
  const key = input.nmId ? `nm:${input.nmId}` : `sku:${input.sku ?? "unknown"}`;
  const existing = map.get(key);
  if (existing) return existing;
  const seed = input.nmId ?? [...(input.sku ?? "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const row: DashboardRow = {
    key,
    sku: input.sku || (input.nmId ? String(input.nmId) : "Без артикула"),
    nmId: input.nmId ?? null,
    name: input.name || input.sku || `Товар ${input.nmId ?? ""}`.trim(),
    category: input.category || "Wildberries",
    color: palette[Math.abs(seed) % palette.length],
    warehouses: {},
    ffStock: emptyFfStock(),
    ffExpiry: emptyFfExpiry(),
    ffBatches: emptyFfBatches(),
    fbsStockByWbWarehouse: emptyFbsBreakdown(),
    fbs: 0,
    fbsByLocation: emptyFbsBreakdown(),
    fbsByWbWarehouse: emptyFbsBreakdown(),
    sales7d: 0,
    sales7dByLocation: emptyFbsBreakdown(),
    sales7dByWbWarehouse: emptyFbsBreakdown(),
    receiving: 0,
    receivingByLocation: emptyFbsBreakdown(),
    receivingByWbWarehouse: emptyFbsBreakdown(),
    toSale: 0,
    toSaleByLocation: emptyFbsBreakdown(),
    toSaleByWbWarehouse: emptyFbsBreakdown(),
    status: "В норме",
    updated: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }),
  };
  map.set(key, row);
  return row;
}

function warningFor(section: string, error: unknown) {
  const status = (error as Error & { status?: number })?.status;
  if ((error as Error)?.name === "AbortError") return `${section}: Wildberries отвечает дольше 25 секунд`;
  if (status === 401 || status === 403) return `${section}: у токена нет нужной категории доступа`;
  if (status === 429) return `${section}: Wildberries временно ограничил частоту запросов`;
  return `${section}: данные временно недоступны`;
}

function mapWbWarehouseBreakdown(input: FbsBreakdown, warehouseMap: Map<string, string>) {
  return Object.entries(input).reduce<FbsBreakdown>((total, [wbWarehouseId, quantity]) => {
    const warehouseId = warehouseMap.get(wbWarehouseId) ?? "unassigned";
    total[warehouseId] = (total[warehouseId] ?? 0) + quantity;
    return total;
  }, {});
}

function mapHandoverTimingByLocation(input: HandoverMetrics, warehouseMap: Map<string, string>) {
  const totals = new Map<string, { sampleSize: number; totalHours: number }>();
  for (const [wbWarehouseId, timing] of Object.entries(input.byWbWarehouse)) {
    if (timing.averageHours === null || !timing.sampleSize) continue;
    const warehouseId = warehouseMap.get(wbWarehouseId) ?? "unassigned";
    const total = totals.get(warehouseId) ?? { sampleSize: 0, totalHours: 0 };
    total.sampleSize += timing.sampleSize;
    total.totalHours += timing.averageHours * timing.sampleSize;
    totals.set(warehouseId, total);
  }
  return Object.fromEntries([...totals].map(([warehouseId, total]) => [warehouseId, {
    sampleSize: total.sampleSize,
    averageHours: total.sampleSize ? total.totalHours / total.sampleSize : null,
  }]));
}

async function attachFfStocks(payload: DashboardPayload, cabinetId: CabinetId): Promise<DashboardPayload> {
  try {
    const [manualWarehouses, lookup] = await Promise.all([listFfWarehouses(cabinetId), listFfStocks(cabinetId)]);
    const wbWarehouseToFfWarehouse = new Map(
      manualWarehouses
        .filter((warehouse) => warehouse.wbWarehouseId)
        .map((warehouse) => [String(warehouse.wbWarehouseId), warehouse.id]),
    );
    const syncedWarehouseIds = new Set(payload.fbsStockSyncedWarehouseIds);
    const rows = payload.rows.map((row) => {
      const ffStock = stockForProduct(lookup, { productKey: row.key, sku: row.sku }, manualWarehouses);
      for (const warehouse of manualWarehouses) {
        const wbWarehouseId = warehouse.wbWarehouseId ? String(warehouse.wbWarehouseId) : null;
        if (wbWarehouseId && syncedWarehouseIds.has(wbWarehouseId)) ffStock[warehouse.id] = row.fbsStockByWbWarehouse[wbWarehouseId] ?? 0;
      }
      return {
        ...row,
        ffStock,
        ffExpiry: expiryForProduct(lookup, { productKey: row.key, sku: row.sku }, manualWarehouses),
        ffBatches: batchesForProduct(lookup, { productKey: row.key, sku: row.sku }, manualWarehouses),
        fbsByLocation: mapWbWarehouseBreakdown(row.fbsByWbWarehouse, wbWarehouseToFfWarehouse),
        sales7dByLocation: mapWbWarehouseBreakdown(row.sales7dByWbWarehouse, wbWarehouseToFfWarehouse),
        receivingByLocation: mapWbWarehouseBreakdown(row.receivingByWbWarehouse, wbWarehouseToFfWarehouse),
        toSaleByLocation: mapWbWarehouseBreakdown(row.toSaleByWbWarehouse, wbWarehouseToFfWarehouse),
      };
    });
    const visibleWarehouses = manualWarehouses.filter((warehouse) => !warehouse.isHidden);
    const ffStock = rows.reduce((total, row) => {
      for (const warehouse of visibleWarehouses) total[warehouse.id] = (total[warehouse.id] ?? 0) + (row.ffStock[warehouse.id] ?? 0);
      return total;
    }, emptyFfStock(visibleWarehouses));
    const handoverTiming = {
      ...payload.handoverTiming,
      byLocation: mapHandoverTimingByLocation(payload.handoverTiming, wbWarehouseToFfWarehouse),
    };
    return {
      ...payload,
      rows,
      manualWarehouses,
      totals: {
        ...payload.totals,
        ffStock,
        ffTotal: Object.values(ffStock).reduce((sum, value) => sum + value, 0),
        fbsByLocation: rows.reduce<FbsBreakdown>((total, row) => {
          for (const [warehouseId, quantity] of Object.entries(row.fbsByLocation)) total[warehouseId] = (total[warehouseId] ?? 0) + quantity;
          return total;
        }, {}),
        sales7d: rows.reduce((sum, row) => sum + row.sales7d, 0),
      },
      handoverTiming,
    };
  } catch (error) {
    return {
      ...payload,
      rows: payload.rows.map((row) => ({ ...row, ffStock: emptyFfStock(), ffExpiry: emptyFfExpiry(), ffBatches: emptyFfBatches() })),
      manualWarehouses: [],
      handoverTiming: { ...payload.handoverTiming, byLocation: {} },
      warnings: [...payload.warnings, warningFor("Ручные остатки ФФ", error)],
    };
  }
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) {
    return NextResponse.json({ configured: true, error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const cabinet = cabinetSummary(cabinetId);
  const token = cabinetToken(cabinetId);
  if (!token) {
    return NextResponse.json(
      { configured: false, cabinet, error: `Токен Wildberries для кабинета «${cabinet.name}» ещё не подключён` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const now = Date.now();
  const cached = memoryCache.get(cabinetId);
  const cachedRetryAt = cached?.payload.retryAt ? Date.parse(cached.payload.retryAt) : Number.NaN;
  const cacheIsWaitingForWb = Number.isFinite(cachedRetryAt) && cachedRetryAt > now;
  const retryWindowExpired = Number.isFinite(cachedRetryAt) && cachedRetryAt <= now;
  const forceIsTooSoon = force && cached && now - cached.createdAt < FORCE_REFRESH_COOLDOWN_MS && !retryWindowExpired;
  if (cached && cached.expiresAt > now && (!force || forceIsTooSoon)) {
    return NextResponse.json(await attachFfStocks({ ...cached.payload, retryAt: cacheIsWaitingForWb ? cached.payload.retryAt : null }, cabinetId), { headers: { "Cache-Control": "private, max-age=0" } });
  }

  const refreshController = new AbortController();
  let refreshTimedOut = false;
  const refreshTimeout = setTimeout(() => {
    refreshTimedOut = true;
    refreshController.abort();
  }, INVENTORY_REFRESH_TIMEOUT_MS);

  try {
    const [cardsResult, wbStocksResult, ordersResult, sellerWarehousesResult] = await Promise.allSettled([
      getCards(token, refreshController.signal),
      getWbStocks(token, refreshController.signal),
      getOrders(token, refreshController.signal),
      getSellerWarehouses(token, refreshController.signal),
    ]);

    if (refreshTimedOut && cached) {
      const fallback = {
        ...cached.payload,
        retryAt: null,
        warnings: [...new Set([...cached.payload.warnings, "WB отвечает дольше 25 секунд — показаны последние корректные данные"])],
      };
      return NextResponse.json(await attachFfStocks(fallback, cabinetId), { headers: { "Cache-Control": "private, max-age=0" } });
    }
  const warnings: string[] = [];
  const rowMap = new Map<string, DashboardRow>();

  const cards = cardsResult.status === "fulfilled" ? cardsResult.value : [];
  const sellerWarehouses = sellerWarehousesResult.status === "fulfilled" ? sellerWarehousesResult.value : [];
  if (cardsResult.status === "rejected") warnings.push(warningFor("Карточки товаров", cardsResult.reason));
  if (sellerWarehousesResult.status === "rejected") warnings.push(warningFor("Склады FBS продавца", sellerWarehousesResult.reason));
  for (const card of cards) {
    getOrCreateRow(rowMap, {
      nmId: card.nmID ?? card.nmId,
      sku: card.vendorCode,
      name: card.title,
      category: card.subjectName,
    });
  }

  if (sellerWarehouses.length) {
    try {
      await syncWbFbsWarehouses({ cabinetId, warehouses: sellerWarehouses });
    } catch (error) {
      warnings.push(warningFor("Склады ФФ", error));
    }
  }

  const fbsStockResult = cardsResult.status === "fulfilled" && sellerWarehousesResult.status === "fulfilled"
    ? await getFbsStocks(token, cards, sellerWarehouses, refreshController.signal)
    : { stockByWarehouse: new Map<string, Map<number, number>>(), syncedWarehouseIds: [] as string[], errors: [] as Array<{ warehouse: string; reason: unknown }> };
  if (refreshTimedOut && cached) {
    const fallback = {
      ...cached.payload,
      retryAt: null,
      warnings: [...new Set([...cached.payload.warnings, "WB отвечает дольше 25 секунд — показаны последние корректные данные"])],
    };
    return NextResponse.json(await attachFfStocks(fallback, cabinetId), { headers: { "Cache-Control": "private, max-age=0" } });
  }
  for (const failure of fbsStockResult.errors) warnings.push(warningFor(`Остатки FBS · ${failure.warehouse}`, failure.reason));
  for (const [warehouseId, stock] of fbsStockResult.stockByWarehouse) {
    for (const [nmId, quantity] of stock) {
      const row = getOrCreateRow(rowMap, { nmId });
      row.fbsStockByWbWarehouse[warehouseId] = (row.fbsStockByWbWarehouse[warehouseId] ?? 0) + quantity;
    }
  }

  if (wbStocksResult.status === "fulfilled") {
    for (const stock of wbStocksResult.value) {
      const row = getOrCreateRow(rowMap, {
        nmId: stock.nmId,
      });
      const warehouseName = `WB · ${stock.warehouseName || "Склад WB"}`;
      row.warehouses[warehouseName] = (row.warehouses[warehouseName] ?? 0) + (stock.quantity ?? 0);
    }
  } else {
    if (cached) {
      for (const previous of cached.payload.rows) {
        const row = getOrCreateRow(rowMap, { nmId: previous.nmId ?? undefined, sku: previous.sku, name: previous.name, category: previous.category });
        row.warehouses = { ...previous.warehouses };
      }
      warnings.push(`${warningFor("Остатки на складах WB", wbStocksResult.reason)} — показаны последние корректные данные`);
    } else {
      warnings.push(warningFor("Остатки на складах WB", wbStocksResult.reason));
    }
  }

  let activeSupplies = 0;
  let handoverTiming = emptyHandoverTiming();
  if (ordersResult.status === "fulfilled") {
    const supplies = new Set<string>();
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const terminal = new Set(["sold", "canceled", "canceled_by_client", "declined_by_client", "defect"]);
    const canceled = new Set(["canceled", "canceled_by_client", "declined_by_client", "defect"]);
    try {
      const observedOrders = ordersResult.value.orders.flatMap((order) => {
        const status = ordersResult.value.statuses.get(order.id);
        const isBeforeHandover = status?.supplierStatus === "new" || status?.supplierStatus === "confirm";
        const isHandedOver = status?.supplierStatus === "complete" && ["waiting", "sorted", "ready_for_pickup"].includes(status.wbStatus ?? "");
        if (!isBeforeHandover && !isHandedOver) return [];
        return [{
          id: order.id,
          warehouseId: order.warehouseId ?? null,
          createdAt: order.createdAt ?? null,
          state: isBeforeHandover ? "before" as const : "handover" as const,
        }];
      });
      await recordFbsHandoverObservations({ cabinetId, orders: observedOrders });
      handoverTiming = await fbsHandoverMetrics(cabinetId);
    } catch (error) {
      warnings.push(warningFor("Скорость передачи FBS", error));
    }
    for (const order of ordersResult.value.orders) {
      const status = ordersResult.value.statuses.get(order.id);
      if (!status) continue;
      const row = getOrCreateRow(rowMap, { nmId: order.nmId, sku: order.article, name: order.article });
      const warehouseId = order.warehouseId ? String(order.warehouseId) : "unknown";
      const createdAt = order.createdAt ? Date.parse(order.createdAt) : Number.NaN;
      if (!canceled.has(status.wbStatus ?? "") && status.supplierStatus !== "cancel" && Number.isFinite(createdAt) && createdAt >= weekStart) {
        row.sales7d += 1;
        row.sales7dByWbWarehouse[warehouseId] = (row.sales7dByWbWarehouse[warehouseId] ?? 0) + 1;
      }
      // `sold` is the only final state that means the buyer actually redeemed
      // the item. Cancellations are intentionally not included here.
      if (status.wbStatus === "sold") {
        row.toSale += 1;
        row.toSaleByWbWarehouse[warehouseId] = (row.toSaleByWbWarehouse[warehouseId] ?? 0) + 1;
        continue;
      }
      if (terminal.has(status.wbStatus ?? "") || status.supplierStatus === "cancel") continue;

      // New and confirmed orders are the same pre-handover stage for stock
      // planning: they still occupy a unit at the FBS warehouse.
      if (status.supplierStatus === "new" || status.supplierStatus === "confirm") {
        row.fbs += 1;
        row.fbsByWbWarehouse[warehouseId] = (row.fbsByWbWarehouse[warehouseId] ?? 0) + 1;
        if (order.supplyId) supplies.add(order.supplyId);
      }
      // A delivery sticker stays on the same order after handover. All WB
      // delivery states are one stage and must not be deducted twice.
      if (status.supplierStatus === "complete" && ["waiting", "sorted", "ready_for_pickup"].includes(status.wbStatus ?? "")) {
        row.receiving += 1;
        row.receivingByWbWarehouse[warehouseId] = (row.receivingByWbWarehouse[warehouseId] ?? 0) + 1;
        if (order.supplyId) supplies.add(order.supplyId);
      }
    }
    activeSupplies = supplies.size;
  } else {
    warnings.push(warningFor("FBS-отгрузки", ordersResult.reason));
  }

  const rows = [...rowMap.values()].map((row) => {
    const total = Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
    row.status = total <= 5 ? "Заканчивается" : total <= 20 ? "Мало" : "В норме";
    return row;
  }).sort((a, b) => {
    const priority = { "Заканчивается": 0, "Мало": 1, "В норме": 2 };
    return priority[a.status] - priority[b.status] || a.name.localeCompare(b.name, "ru");
  });

  const rateLimited = [cardsResult, wbStocksResult, ordersResult, sellerWarehousesResult]
    .some((result) => result.status === "rejected" && (result.reason as Error & { status?: number })?.status === 429)
    || fbsStockResult.errors.some((failure) => (failure.reason as Error & { status?: number })?.status === 429);
  const retryAt = rateLimited ? new Date(now + WB_RATE_LIMIT_RETRY_MS).toISOString() : null;

  if (!rows.length && warnings.length) {
    return NextResponse.json(
      { configured: true, error: "Wildberries не вернул данные. Проверьте категории токена: Контент, Маркетплейс и Аналитика.", warnings, retryAt },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const warehouseNames = [...new Set(rows.flatMap((row) => Object.keys(row.warehouses)))].sort((a, b) => a.localeCompare(b, "ru"));
  const totals = {
    available: rows.reduce((sum, row) => sum + Object.values(row.warehouses).reduce((inner, value) => inner + value, 0), 0),
    ffTotal: 0,
    ffStock: emptyFfStock(),
    fbs: rows.reduce((sum, row) => sum + row.fbs, 0),
    fbsByLocation: emptyFbsBreakdown(),
    sales7d: rows.reduce((sum, row) => sum + row.sales7d, 0),
    receiving: rows.reduce((sum, row) => sum + row.receiving, 0),
    toSale: rows.reduce((sum, row) => sum + row.toSale, 0),
    risk: rows.filter((row) => row.status !== "В норме").length,
    activeSupplies,
  };
  const updatedAt = new Date().toISOString();
  const payload: DashboardPayload = { configured: true, cabinet, rows, warehouseNames, manualWarehouses: [], fbsStockSyncedWarehouseIds: fbsStockResult.syncedWarehouseIds, totals, warnings, retryAt, updatedAt, handoverTiming };
  memoryCache.set(cabinetId, { createdAt: now, expiresAt: now + CACHE_LIFETIME_MS, payload });

  return NextResponse.json(await attachFfStocks(payload, cabinetId), { headers: { "Cache-Control": "private, max-age=0" } });
  } finally {
    clearTimeout(refreshTimeout);
  }
}
