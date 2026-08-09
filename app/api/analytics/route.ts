import { NextResponse } from "next/server";
import { listFfWarehouses, type ManualWarehouse } from "@/db/ff-stocks";
import { cabinetToken, getAdminCabinet } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const WB_MARKETPLACE = "https://marketplace-api.wildberries.ru";
const WB_STATISTICS = "https://statistics-api.wildberries.ru";
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 2 * 60 * 1000;

type WbSale = {
  date?: string;
  warehouseName?: string;
  warehouseType?: string;
  saleID?: string;
  isCancel?: boolean;
};

type WbOrder = { id: number; createdAt?: string; warehouseId?: number };
type OrderStatus = { id: number; supplierStatus?: string; wbStatus?: string };
type AnalyticsPayload = {
  from: string;
  to: string;
  summary: { fbs: number; fbo: number; total: number; fbsShare: number; fboShare: number };
  daily: Array<{ date: string; fbs: number; fbo: number }>;
  fbsWarehouses: Array<{ id: string; name: string; sublabel: string; value: number }>;
  source: { fbs: "sales" | "orders"; fboAvailable: boolean };
  warnings: string[];
  updatedAt: string;
};

const cache = new Map<string, { expiresAt: number; payload: AnalyticsPayload }>();

async function wbFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const error = new Error(`WB API ${response.status}`) as Error & { status?: number };
    error.status = response.status;
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

async function getFbsOrdersFallback(token: string, fromMs: number, toMs: number) {
  const orders: WbOrder[] = [];
  for (let start = fromMs; start <= toMs; start += 30 * DAY_MS) {
    const end = Math.min(toMs + DAY_MS - 1, start + 30 * DAY_MS - 1);
    let next = 0;
    for (let page = 0; page < 30; page += 1) {
      const params = new URLSearchParams({ limit: "1000", next: String(next), dateFrom: String(Math.floor(start / 1000)), dateTo: String(Math.floor(end / 1000)) });
      const data = await wbFetch<{ next?: number; orders?: WbOrder[] }>(token, `${WB_MARKETPLACE}/api/v3/orders?${params}`);
      const batch = data.orders ?? [];
      orders.push(...batch);
      if (batch.length < 1000 || !data.next || data.next === next) break;
      next = data.next;
    }
  }
  const statuses = new Map<number, OrderStatus>();
  for (let index = 0; index < orders.length; index += 1000) {
    const ids = orders.slice(index, index + 1000).map((order) => order.id);
    if (!ids.length) continue;
    const data = await wbFetch<{ orders?: OrderStatus[] }>(token, `${WB_MARKETPLACE}/api/v3/orders/status`, { method: "POST", body: JSON.stringify({ orders: ids }) });
    for (const status of data.orders ?? []) statuses.set(status.id, status);
  }
  return { orders, statuses };
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
  const token = cabinetToken(cabinetId);
  if (!token) return NextResponse.json({ error: "Токен Wildberries ещё не подключён" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  let period: ReturnType<typeof parsePeriod>;
  try {
    period = parsePeriod(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректный период" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const key = `${cabinetId}:${period.from}:${period.to}`;
  const cached = cache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload, { headers: { "Cache-Control": "private, max-age=0" } });

  const [manualWarehouses, salesResult] = await Promise.all([listFfWarehouses(cabinetId), wbFetch<WbSale[]>(token, `${WB_STATISTICS}/api/v1/supplier/sales?${new URLSearchParams({ dateFrom: `${period.from}T00:00:00`, flag: "0" })}`).then((items) => ({ ok: true as const, items })).catch((error) => ({ ok: false as const, error }))]);
  const daily = new Map(daysBetween(period.from, period.to).map((date) => [date, { date, fbs: 0, fbo: 0 }]));
  const fbsWarehouseValues = initialWarehouseValues(manualWarehouses);
  const warehouseByName = new Map(manualWarehouses.filter((warehouse) => warehouse.wbWarehouseName).map((warehouse) => [warehouse.wbWarehouseName!.trim().toLocaleLowerCase("ru-RU"), warehouse.id]));
  let unassigned = 0;
  const warnings: string[] = [];
  let source: AnalyticsPayload["source"] = { fbs: "sales", fboAvailable: true };

  if (salesResult.ok) {
    for (const sale of salesResult.items) {
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
    warnings.push(warningFor("Факт продаж FBO", salesResult.error));
    source = { fbs: "orders", fboAvailable: false };
    try {
      const fallback = await getFbsOrdersFallback(token, period.fromMs, period.toMs);
      const canceled = new Set(["canceled", "canceled_by_client", "declined_by_client", "defect"]);
      const warehouseById = new Map(manualWarehouses.filter((warehouse) => warehouse.wbWarehouseId).map((warehouse) => [String(warehouse.wbWarehouseId), warehouse.id]));
      for (const order of fallback.orders) {
        const status = fallback.statuses.get(order.id);
        if (!status || canceled.has(status.wbStatus ?? "") || status.supplierStatus === "cancel") continue;
        const day = dateKey(order.createdAt);
        const point = day ? daily.get(day) : null;
        if (!point) continue;
        point.fbs += 1;
        const warehouseId = warehouseById.get(String(order.warehouseId ?? ""));
        if (warehouseId) fbsWarehouseValues.set(warehouseId, (fbsWarehouseValues.get(warehouseId) ?? 0) + 1);
        else unassigned += 1;
      }
    } catch (error) {
      warnings.push(warningFor("Заказы FBS", error));
    }
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
  cache.set(key, { expiresAt: Date.now() + (source.fboAvailable ? CACHE_MS : 30 * 1000), payload });
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0" } });
}
