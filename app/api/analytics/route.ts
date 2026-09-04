import { NextResponse } from "next/server";
import { listFfWarehouses, type ManualWarehouse } from "@/db/ff-stocks";
import { cabinetToken, getAdminCabinet } from "@/lib/admin-auth";
import { loadInventorySnapshot } from "@/db/inventory-snapshots";
import { isCurrentWbSellableSnapshot, isSellableWbProduct, sellableWbProductIdsFromSnapshot } from "@/lib/wb-sellable-products";

export const dynamic = "force-dynamic";

const WB_STATISTICS = "https://statistics-api.wildberries.ru";
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 2 * 60 * 1000;

type WbSale = {
  nmId?: number;
  date?: string;
  warehouseName?: string;
  warehouseType?: string;
  saleID?: string;
  isCancel?: boolean;
};

type AnalyticsPayload = {
  from: string;
  to: string;
  summary: { fbs: number; fbo: number; total: number; fbsShare: number; fboShare: number };
  daily: Array<{ date: string; fbs: number; fbo: number }>;
  fbsWarehouses: Array<{ id: string; name: string; sublabel: string; value: number }>;
  source: { factAvailable: boolean; retryAt: string | null; retryExact: boolean };
  warnings: string[];
  updatedAt: string;
};

const cache = new Map<string, { expiresAt: number; payload: AnalyticsPayload }>();

type WbApiError = Error & { status?: number; retryAfterSeconds?: number; retryExact?: boolean };

function secondsFromHeader(value: string | null) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

function rateLimitRetry(response: Response) {
  const retry = secondsFromHeader(response.headers.get("X-Ratelimit-Retry") ?? response.headers.get("Retry-After"));
  if (retry !== null) return { seconds: retry, exact: true };
  const reset = secondsFromHeader(response.headers.get("X-Ratelimit-Reset"));
  if (reset !== null) return { seconds: reset, exact: true };
  return { seconds: 30, exact: false };
}

function retryDetails(error: unknown) {
  const apiError = error as WbApiError;
  if (apiError.status !== 429 || !apiError.retryAfterSeconds) return null;
  return {
    retryAt: new Date(Date.now() + apiError.retryAfterSeconds * 1000).toISOString(),
    retryExact: apiError.retryExact ?? false,
  };
}

async function wbFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const error = new Error(`WB API ${response.status}`) as WbApiError;
    error.status = response.status;
    if (response.status === 429) {
      const retry = rateLimitRetry(response);
      error.retryAfterSeconds = retry.seconds;
      error.retryExact = retry.exact;
    }
    throw error;
  }
  return response.json() as Promise<T>;
}

function warningFor(section: string, error: unknown) {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401 || status === 403) return `${section}: у токена нет доступа «Статистика»`;
  if (status === 429) return `${section}: WB временно ограничил частоту запросов`;
  return `${section}: данные временно недоступны`;
}

function dateKey(value: string | undefined) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function daysBetween(from: string, to: string) {
  const days: string[] = [];
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  for (let cursor = first; cursor <= last; cursor += DAY_MS) days.push(new Date(cursor).toISOString().slice(0, 10));
  return days;
}

function parsePeriod(request: Request) {
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 6 * DAY_MS).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs || toMs - fromMs > 89 * DAY_MS) throw new Error("Выберите период не более 90 дней");
  return { from, to, fromMs, toMs };
}

function isFbsSale(sale: WbSale) {
  const type = (sale.warehouseType ?? "").toLocaleLowerCase("ru-RU");
  return type.includes("продавца") || type.includes("seller");
}

function isSale(sale: WbSale) {
  return sale.saleID?.startsWith("S") && !sale.isCancel;
}

function initialWarehouseValues(warehouses: ManualWarehouse[]) {
  return new Map(warehouses.map((warehouse) => [warehouse.id, 0]));
}

function warehouseResult(warehouses: ManualWarehouse[], values: Map<string, number>, unassigned = 0) {
  const result = warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.city, sublabel: warehouse.name, value: values.get(warehouse.id) ?? 0 }));
  if (unassigned) result.push({ id: "unassigned", name: "Не назначено", sublabel: "Свяжите ФФ со складом WB", value: unassigned });
  return result.sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "ru"));
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let period: ReturnType<typeof parsePeriod>;
  try {
    period = parsePeriod(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректный период" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (cabinetId === "ozon" || cabinetId === "yandex") {
    type MarketplaceSnapshot = {
      updatedAt?: string;
      ozonAnalytics?: { daily?: Record<string, number>; byWarehouse?: Record<string, number> };
      yandexAnalytics?: { daily?: Record<string, number>; byWarehouse?: Record<string, number> };
    };
    const marketplace = cabinetId === "yandex" ? "Яндекс Маркет" : "Ozon";
    const snapshot = await loadInventorySnapshot<MarketplaceSnapshot>(cabinetId).catch(() => null);
    const analytics = cabinetId === "yandex" ? snapshot?.yandexAnalytics : snapshot?.ozonAnalytics;
    const daily = daysBetween(period.from, period.to).map((date) => ({ date, fbs: Math.max(0, Number(analytics?.daily?.[date]) || 0), fbo: 0 }));
    const fbs = daily.reduce((sum, point) => sum + point.fbs, 0);
    const manualWarehouses = await listFfWarehouses(cabinetId);
    const byMarketplaceWarehouse = analytics?.byWarehouse ?? {};
    const fbsWarehouses = warehouseResult(manualWarehouses, new Map(manualWarehouses.map((warehouse) => [warehouse.id, Math.max(0, Number(byMarketplaceWarehouse[String(warehouse.wbWarehouseId ?? "")]) || 0)])));
    return NextResponse.json({
      from: period.from,
      to: period.to,
      summary: { fbs, fbo: 0, total: fbs, fbsShare: fbs ? 100 : 0, fboShare: 0 },
      daily,
      fbsWarehouses,
      source: { factAvailable: Boolean(snapshot), retryAt: null, retryExact: true },
      warnings: snapshot ? [`${marketplace}: динамика показывает созданные FBS-заказы за выбранный период. Факт выкупа ${cabinetId === "yandex" ? "FBY" : "FBO"} подключается отдельным финансовым источником.`] : [`Сначала обновите остатки ${marketplace}, чтобы собрать аналитику.`],
      updatedAt: snapshot?.updatedAt ?? new Date().toISOString(),
    } satisfies AnalyticsPayload, { headers: { "Cache-Control": "private, max-age=0" } });
  }

  const token = cabinetToken(cabinetId);
  if (!token) return NextResponse.json({ error: "Токен Wildberries ещё не подключён" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const key = `${cabinetId}:${period.from}:${period.to}`;
  const cached = cache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload, { headers: { "Cache-Control": "private, max-age=0" } });

  const [manualWarehousesRaw, inventorySnapshot, salesResult] = await Promise.all([
    listFfWarehouses(cabinetId),
    loadInventorySnapshot(cabinetId).catch(() => null),
    wbFetch<WbSale[]>(token, `${WB_STATISTICS}/api/v1/supplier/sales?${new URLSearchParams({ dateFrom: `${period.from}T00:00:00`, flag: "0" })}`)
      .then((items) => ({ ok: true as const, items }))
      .catch((error) => ({ ok: false as const, error })),
  ]);
  const manualWarehouses = manualWarehousesRaw as ManualWarehouse[];
  if (!isCurrentWbSellableSnapshot(inventorySnapshot)) {
    return NextResponse.json(
      { error: "Сначала обновите остатки WB: список товаров с ярлыком «продаем» ещё не сформирован." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const sellableNmIds = sellableWbProductIdsFromSnapshot(inventorySnapshot);
  const daily = new Map(daysBetween(period.from, period.to).map((date) => [date, { date, fbs: 0, fbo: 0 }]));
  const fbsWarehouseValues = initialWarehouseValues(manualWarehouses);
  const warehouseByName = new Map<string, string>(manualWarehouses.filter((warehouse) => warehouse.wbWarehouseName).map((warehouse) => [warehouse.wbWarehouseName!.trim().toLocaleLowerCase("ru-RU"), warehouse.id]));
  let unassigned = 0;
  const warnings: string[] = [];
  let source: AnalyticsPayload["source"] = { factAvailable: true, retryAt: null, retryExact: true };

  if (salesResult.ok) {
    for (const sale of salesResult.items) {
      if (!isSellableWbProduct(sellableNmIds, sale.nmId)) continue;
      if (!isSale(sale)) continue;
      const day = dateKey(sale.date);
      if (!day || day < period.from || day > period.to) continue;
      const point = daily.get(day);
      if (!point) continue;
      if (isFbsSale(sale)) {
        point.fbs += 1;
        const warehouseId = warehouseByName.get((sale.warehouseName ?? "").trim().toLocaleLowerCase("ru-RU"));
        if (warehouseId) fbsWarehouseValues.set(warehouseId, (fbsWarehouseValues.get(warehouseId) ?? 0) + 1);
        else unassigned += 1;
      } else {
        point.fbo += 1;
      }
    }
  } else {
    warnings.push(warningFor("Факт продаж FBS и FBO", salesResult.error));
    const retry = retryDetails(salesResult.error);
    source = { factAvailable: false, retryAt: retry?.retryAt ?? null, retryExact: retry?.retryExact ?? true };
  }

  const points = [...daily.values()];
  const fbs = points.reduce((sum, point) => sum + point.fbs, 0);
  const fbo = points.reduce((sum, point) => sum + point.fbo, 0);
  const total = fbs + fbo;
  const payload: AnalyticsPayload = {
    from: period.from,
    to: period.to,
    summary: { fbs, fbo, total, fbsShare: total ? Math.round((fbs / total) * 100) : 0, fboShare: total ? Math.round((fbo / total) * 100) : 0 },
    daily: points,
    fbsWarehouses: warehouseResult(manualWarehouses, fbsWarehouseValues, unassigned),
    source,
    warnings,
    updatedAt: new Date().toISOString(),
  };
  const retryCacheMs = source.retryAt ? Math.max(1_000, Date.parse(source.retryAt) - Date.now()) : 0;
  cache.set(key, { expiresAt: Date.now() + (retryCacheMs || (source.factAvailable ? CACHE_MS : 30 * 1000)), payload });
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0" } });
}
