"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as CFB from "cfb";
import * as XLSX from "xlsx";
import { summarizeActiveFbsLocations } from "@/lib/fbs-summary";
import { calculateFfPlan, effectivePeriod, type FfPlan } from "@/lib/ff-planning";
import RnpDashboard from "./rnp-control/RnpDashboard";

type StockStatus = "В норме" | "Мало" | "Заканчивается";
type View = "overview" | "stock" | "fbs" | "sales" | "analytics" | "rnp" | "pricing" | "payments" | "reports" | "fulfillment" | "manual" | "cabinets";
type FulfillmentList = "physical" | "available" | "reserved" | "receiving" | "toSale";
type AnalyticsChannel = "all" | "fbs" | "fbo";
type PricingFilter = "all" | "lower" | "raise" | "review" | "hold";
type PricingSort = "priority" | "orders" | "delta";
type FbsBreakdown = Record<string, number>;
type FfStock = Record<string, number>;
type FfExpiry = Record<string, string | null>;
type FfBatch = { location: string; batchCode: string; expiresAt: string | null; quantity: number };
type FfBatches = Record<string, FfBatch[]>;
type CabinetSummary = { id: "metanutrix" | "ozon" | "yandex"; name: string; configured: boolean; marketplace: "wb" | "ozon" | "yandex" };
type UserRole = "owner" | "viewer";
type MarketplaceConnection = {
  platform: "yandex" | "ozon";
  configured: boolean;
  disabled: boolean;
  connected: boolean;
  accountName: string | null;
  details: string[];
  error: string | null;
};

type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
  wbWarehouseId: number | null;
  wbWarehouseName: string | null;
  serviceRateKopecks: number;
  isHidden: boolean;
  openedAt: string | null;
  planningTargetDays: number;
};
type StockFfColumn = { id: string; city: string; name: string; warehouse: ManualWarehouse | null };

type StockRow = {
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
  sales7d: number;
  sales7dByLocation: FbsBreakdown;
  receiving: number;
  receivingByLocation: FbsBreakdown;
  toSale: number;
  toSaleByLocation: FbsBreakdown;
  status: StockStatus;
  updated: string;
};

type DashboardTotals = {
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
type HandoverTiming = { sampleSize: number; averageHours: number | null };
type HandoverMetrics = {
  overall: HandoverTiming;
  byLocation: Record<string, HandoverTiming>;
  trackingStartedAt: string | null;
};

type InventoryResponse = {
  configured: boolean;
  cabinet?: CabinetSummary | null;
  rows?: StockRow[];
  warehouseNames?: string[];
  manualWarehouses?: ManualWarehouse[];
  totals?: DashboardTotals;
  warnings?: string[];
  retryAt?: string | null;
  handoverTiming?: HandoverMetrics;
  updatedAt?: string;
  plannerGeneration?: string | null;
  error?: string;
};

type AnalyticsPoint = { date: string; fbs: number; fbo: number };
type AnalyticsWarehouse = { id: string; name: string; sublabel: string; value: number };
type AnalyticsResponse = {
  from: string;
  to: string;
  summary: { fbs: number; fbo: number; total: number; fbsShare: number; fboShare: number };
  daily: AnalyticsPoint[];
  fbsWarehouses: AnalyticsWarehouse[];
  source: { factAvailable: boolean; retryAt: string | null; retryExact: boolean };
  warnings: string[];
  updatedAt: string;
};

type ImportItem = { sku: string; nmId: number | null; quantity: number; batchCode: string; expiresAt?: string | null };
type ImportPreview = { fileName: string; sheetName: string; items: ImportItem[]; skipped: number; hasExpiryColumn: boolean; hasBatchColumn: boolean };
type FfOrderExport = { orderId: string | number; article: string; quantity: number; sticker: string | null; stickerText?: string | null };
type FfOrdersExportResponse = {
  warehouse?: { id: string; city: string; name: string };
  orders?: FfOrderExport[];
  missingStickers?: number;
  error?: string;
};
type FfSettlement = {
  warehouse: ManualWarehouse;
  from: string;
  to: string;
  orders: Array<{ orderId: string; handedOverAt: string }>;
  quantity: number;
  rateKopecks: number;
  totalKopecks: number;
  untrackedHandoverQuantity: number;
  trackingStartedAt: string | null;
};
type TargetPriceCompetitor = {
  nmId: number;
  url: string | null;
  price: number | null;
  source: string | null;
  name: string | null;
  updatedAt: string | null;
  error: string | null;
};
type TargetPriceRow = {
  sku: string;
  nmId: number | null;
  orders: number;
  priceBeforeSpp: number | null;
  sppPercent: number | null;
  currentPrice: number | null;
  updatedAt: string | null;
  searchQuery: string | null;
  competitors: TargetPriceCompetitor[];
  candidateNmId: number | null;
  score: number | null;
  reason: string | null;
  sourceStatus: string | null;
  refreshedAt: string | null;
  refreshError: string | null;
};
type TargetPricesResponse = { rows?: TargetPriceRow[]; updatedAt?: string | null; warnings?: string[]; cooldownUntil?: string | null; error?: string };
type FfPlanningDailyMetric = { warehouseId: string; productKey: string; nmId: number | null; sku: string; date: string; demand: number; sold: number };
type FfPlanningSource = {
  demand: { kind: string; label: string; dateBasis: string };
  sold: { kind: string; label: string; dateBasis: string };
};
type FfPlanningResponse = {
  period?: { from: string; to: string; days: number } | null;
  warehouses?: ManualWarehouse[];
  daily?: FfPlanningDailyMetric[];
  source?: FfPlanningSource;
  warnings?: string[];
  updatedAt?: string | null;
  retryAt?: string | null;
  error?: string;
};

type FfPlannerSnapshot = {
  warehouses: ManualWarehouse[];
  daily: FfPlanningDailyMetric[];
  rows: StockRow[];
  source: FfPlanningSource;
  warnings: string[];
  updatedAt: string;
  generation: string;
  retryAt: string | null;
  inventory: InventoryResponse;
};

function validSnapshotTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function laterPlannerRetryAt(first: string | null | undefined, second: string | null | undefined) {
  const candidates = [first, second].flatMap((value) => validSnapshotTimestamp(value) ? [{ value, time: Date.parse(value) }] : []);
  return candidates.sort((left, right) => right.time - left.time)[0]?.value ?? null;
}

function plannerRefreshError(message: string, retryAt: string | null | undefined, cause?: unknown) {
  const error = cause instanceof Error ? cause : new Error(message);
  if (!(cause instanceof Error)) error.message = message;
  const causeRetryAt = cause && typeof cause === "object" && "retryAt" in cause
    ? (cause as { retryAt?: string | null }).retryAt
    : null;
  return Object.assign(error, { retryAt: laterPlannerRetryAt(retryAt, causeRetryAt) });
}

export async function runCoherentFfPlannerRefresh(
  fetchPlanning: () => Promise<FfPlanningResponse>,
  fetchInventory: (generation: string) => Promise<InventoryResponse>,
  commit: (snapshot: FfPlannerSnapshot) => void,
) {
  // Planning is deliberately first. If it fails, inventory is not refreshed
  // independently and the previous coherent UI snapshot stays untouched.
  const planning = await fetchPlanning();
  if (!Array.isArray(planning.warehouses) || !Array.isArray(planning.daily) || !planning.source) {
    throw plannerRefreshError("Источник спроса вернул неполный снимок", planning.retryAt);
  }
  if (!validSnapshotTimestamp(planning.updatedAt)) {
    throw plannerRefreshError("Снимок спроса ещё не создан", planning.retryAt);
  }

  let inventory: InventoryResponse;
  try {
    inventory = await fetchInventory(planning.updatedAt);
    if (!Array.isArray(inventory.rows)) throw new Error("Источник остатков вернул неполный снимок");
    if (!validSnapshotTimestamp(inventory.updatedAt)) throw new Error("Источник остатков не сообщил время снимка");
    if (inventory.plannerGeneration !== planning.updatedAt) {
      throw new Error("Поколение остатков не совпадает со снимком спроса");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Источник остатков не обновился";
    throw plannerRefreshError(message, planning.retryAt, error);
  }
  const snapshot: FfPlannerSnapshot = {
    warehouses: planning.warehouses,
    daily: planning.daily,
    rows: inventory.rows,
    source: planning.source,
    warnings: [...new Set([...(planning.warnings ?? []), ...(inventory.warnings ?? [])])],
    updatedAt: new Date(Math.min(Date.parse(planning.updatedAt), Date.parse(inventory.updatedAt))).toISOString(),
    generation: planning.updatedAt,
    retryAt: planning.retryAt ?? null,
    inventory,
  };
  commit(snapshot);
  return snapshot;
}

export function ffPlanningSupported(marketplace: CabinetSummary["marketplace"] | null | undefined) {
  return marketplace === "wb";
}

export function FfPlannerMarketplaceUnavailable({ marketplaceName }: { marketplaceName: string }) {
  return <section className="planner-panel" aria-label="План поставок недоступен">
    <div className="section-heading planner-heading"><div><span className="section-kicker">ПЛАН ПОСТАВОК · WB</span><h2>План поставок доступен только для Wildberries</h2><p className="section-note">Для {marketplaceName} ещё не подключены согласованные источники спроса и остатков. Данные Wildberries сюда не подставляются.</p></div></div>
    <div className="empty-state planner-snapshot-state" role="status"><strong>{marketplaceName}: расчёт пока недоступен</strong><span>После подключения источников этого маркетплейса появится отдельный план без смешивания данных.</span></div>
  </section>;
}

const defaultManualWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "KazanTeam", position: 10, wbWarehouseId: 1692397, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false, openedAt: null, planningTargetDays: 14 },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20, wbWarehouseId: null, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false, openedAt: null, planningTargetDays: 14 },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30, wbWarehouseId: null, wbWarehouseName: null, serviceRateKopecks: 0, isHidden: false, openedAt: null, planningTargetDays: 14 },
];
const emptyFbsBreakdown: FbsBreakdown = {};
const emptyTotals: DashboardTotals = { available: 0, ffTotal: 0, ffStock: {}, fbs: 0, fbsByLocation: emptyFbsBreakdown, sales7d: 0, receiving: 0, toSale: 0, risk: 0, activeSupplies: 0 };
const emptyHandoverMetrics: HandoverMetrics = { overall: { sampleSize: 0, averageHours: null }, byLocation: {}, trackingStartedAt: null };
const defaultFfPlanningSource: FfPlanningSource = {
  demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
  sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
};
const formatNumber = new Intl.NumberFormat("ru-RU");
const formatMoney = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const formatRate = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function formatHandoverTime(hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} мин`;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return minutes >= 30 ? `${wholeHours},5 ч` : `${wholeHours} ч`;
}
const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "WILDBERRIES · ОПЕРАЦИИ", title: "Остатки и движение товаров" },
  stock: { eyebrow: "СКЛАДЫ · АРТИКУЛЫ", title: "Остатки по всем складам" },
  fbs: { eyebrow: "FBS · ПОСЛЕДНИЕ 30 ДНЕЙ", title: "Отгрузки и приёмка" },
  sales: { eyebrow: "ФФ · СПРОС И ОСТАТКИ", title: "План поставок" },
  analytics: { eyebrow: "АНАЛИТИКА · РУКОВОДИТЕЛЮ", title: "Продажи FBS и FBO" },
  rnp: { eyebrow: "OZON · РЕКЛАМА", title: "РНП — контроль рекламы" },
  pricing: { eyebrow: "ЦЕНЫ · РЫНОК WB", title: "Таргет цен" },
  payments: { eyebrow: "БУХГАЛТЕРИЯ · ФФ", title: "Калькулятор оплат ФФ" },
  reports: { eyebrow: "ВЫГРУЗКИ · CSV", title: "Отчёты по кабинету" },
  fulfillment: { eyebrow: "ФУЛФИЛМЕНТ · СКЛАДЫ", title: "ФФ — остатки и движение" },
  manual: { eyebrow: "ФУЛФИЛМЕНТ · РУЧНЫЕ ОСТАТКИ", title: "Склады ФФ и импорт Excel" },
  cabinets: { eyebrow: "КАБИНЕТЫ · МАРКЕТПЛЕЙСЫ", title: "Выберите кабинет" },
};

function stockTotal(row: StockRow) {
  return Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
}

function availableFfStock(row: StockRow, warehouseId: string) {
  // The FBS balance contains goods physically at the fulfilment warehouse.
  // New / confirm orders have already reserved their units, but have not left
  // the warehouse yet, so subtract them only from the free-to-sell balance.
  return Math.max(0, (row.ffStock[warehouseId] ?? 0) - (row.fbsByLocation[warehouseId] ?? 0));
}

function physicalFfStock(row: StockRow, warehouseId: string) {
  return row.ffStock[warehouseId] ?? 0;
}

function hasFfWarehouseActivity(row: StockRow, warehouseId: string) {
  return (row.ffStock[warehouseId] ?? 0) > 0
    || (row.fbsByLocation[warehouseId] ?? 0) > 0
    || (row.receivingByLocation[warehouseId] ?? 0) > 0
    || (row.toSaleByLocation[warehouseId] ?? 0) > 0;
}

function hasFbsMovement(row: StockRow) {
  return row.fbs > 0 || row.receiving > 0 || row.toSale > 0;
}

function hasActiveFbsMovement(row: StockRow) {
  return row.fbs > 0 || row.receiving > 0;
}

function activeFbsQuantity(row: StockRow) {
  return row.fbs + row.receiving;
}

function fulfillmentStockStatus(quantity: number): StockStatus {
  if (quantity <= 5) return "Заканчивается";
  if (quantity <= 20) return "Мало";
  return "В норме";
}

function formatSyncTime(value: string | null) {
  if (!value) return "ожидаем данные";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function formatManualWarehouse(warehouse: ManualWarehouse) {
  return `${warehouse.city} — ${warehouse.name}`;
}

function normalizedSku(value: string) {
  return value.trim().toLocaleUpperCase("ru-RU");
}

type PriceRecommendation = {
  row: TargetPriceRow;
  low: number | null;
  median: number | null;
  high: number | null;
  target: number | null;
  delta: number | null;
  action: PricingFilter;
  label: string;
  detail: string;
  priority: number;
};

function roundPrice(value: number) {
  return Math.round(value / 5) * 5;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildPriceRecommendation(row: TargetPriceRow): PriceRecommendation {
  const market = row.competitors.map((item) => item.price).filter((price): price is number => Boolean(price && price > 0));
  const needsReview = row.sourceStatus === "нужен подбор" || row.sourceStatus === "нужен конкурент" || row.sourceStatus?.includes("ошибка");
  if (!row.currentPrice || !market.length) {
    return {
      row, low: null, median: null, high: null, target: null, delta: null,
      action: "review", label: "Нужна проверка", detail: needsReview ? "Сначала подберите или подтвердите конкурента." : "Нет актуальной цены конкурента для расчёта.",
      priority: row.orders + 10_000_000,
    };
  }
  const low = Math.min(...market);
  const high = Math.max(...market);
  const middle = median(market);
  const target = roundPrice(Math.max(low * 1.02, middle * 0.985));
  const delta = target - row.currentPrice;
  const threshold = Math.max(10, row.currentPrice * 0.015);
  if (needsReview) {
    return {
      row, low, median: middle, high, target, delta,
      action: "review", label: "Проверить рынок", detail: row.candidateNmId ? `Проверьте вручную карточку WB ${row.candidateNmId}${row.score ? ` · score ${Math.round(row.score * 100)}%` : ""}.` : "Добавьте карточку конкурента вручную для сравнения.",
      priority: row.orders + Math.abs(delta) * 1_000,
    };
  }
  if (Math.abs(delta) < threshold) {
    return {
      row, low, median: middle, high, target: row.currentPrice, delta: 0,
      action: "hold", label: "Оставить", detail: "Текущая цена в коридоре рынка; менять не нужно.",
      priority: row.orders,
    };
  }
  const action: PricingFilter = delta < 0 ? "lower" : "raise";
  return {
    row, low, median: middle, high, target, delta, action,
    label: delta < 0 ? "Снизить цену" : "Можно поднять", detail: delta < 0 ? "Таргет ниже текущей цены, но остаётся выше самого дешёвого конкурента." : "Цена ниже рыночного коридора — можно проверить повышение без потери позиции.",
    priority: row.orders * Math.max(1, Math.abs(delta)),
  };
}

function normalizedHeader(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/g, "");
}

function parseQuantity(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? Math.floor(result) : Number.NaN;
}

function isoDate(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function currentMonthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function kopecksToRubles(value: number) {
  return Math.max(0, Number(value) || 0) / 100;
}

function rateDraft(value: number) {
  return kopecksToRubles(value).toLocaleString("ru-RU", { useGrouping: false, maximumFractionDigits: 2 });
}

function parseRateKopecks(value: string) {
  const rubles = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(rubles) || rubles < 0 || rubles > 100_000) return null;
  return Math.round(rubles * 100);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(date);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(new Date(`${value}T12:00:00Z`));
}

function parseExpiryDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const usDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (usDate) {
    const month = Number(usDate[1]);
    const day = Number(usDate[2]);
    const year = usDate[3].length === 2 ? 2000 + Number(usDate[3]) : Number(usDate[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }
  const match = raw.match(/^(?:(\d{4})[-./](\d{1,2})[-./](\d{1,2})|(\d{1,2})[-./](\d{1,2})[-./](\d{4}))$/);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function stickerImageBase64(sticker: string | null) {
  if (!sticker) return null;
  const value = sticker.startsWith("data:image/") ? sticker.slice(sticker.indexOf(",") + 1) : sticker;
  return value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

function downloadFfOrdersWorkbook(warehouse: { city: string; name: string }, orders: FfOrderExport[], marketplaceName: string) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Артикул продавца", "Кол-во", `Стикер ${marketplaceName}`],
    ...orders.map((order) => [order.article, order.quantity, order.stickerText ?? (order.sticker ? "" : "Стикер не получен")]),
  ]);
  worksheet["!cols"] = [{ wch: 31 }, { wch: 10 }, { wch: 48 }];
  worksheet["!rows"] = [{ hpt: 24 }, ...orders.map(() => ({ hpt: 180 }))];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Заказы ФФ");

  const root = "Root Entry/";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const archive = CFB.read(new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })), { type: "array" });
  const readText = (path: string) => {
    const entry = CFB.find(archive, `${root}${path}`);
    if (!entry?.content) throw new Error(`Не удалось подготовить Excel: ${path}`);
    return decoder.decode(entry.content);
  };
  const put = (path: string, value: string | Uint8Array) => {
    CFB.utils.cfb_del(archive, `${root}${path}`);
    CFB.utils.cfb_add(archive, `${root}${path}`, typeof value === "string" ? encoder.encode(value) : value, { unsafe: true });
  };

  const images = orders.flatMap((order, orderIndex) => {
    const sticker = stickerImageBase64(order.sticker);
    return sticker ? [{ orderIndex, data: base64ToBytes(sticker) }] : [];
  });
  if (images.length) {
    const sheetXml = readText("xl/worksheets/sheet1.xml");
    put("xl/worksheets/sheet1.xml", sheetXml.replace("</worksheet>", "<drawing r:id=\"rId1\"/></worksheet>"));
    put("xl/worksheets/_rels/sheet1.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/></Relationships>");
    put("xl/drawings/_rels/drawing1.xml.rels", `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">${images.map((_, imageIndex) => `<Relationship Id=\"rId${imageIndex + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image${imageIndex + 1}.png\"/>`).join("")}</Relationships>`);
    put("xl/drawings/drawing1.xml", `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">${images.map((image, imageIndex) => `<xdr:twoCellAnchor editAs=\"oneCell\"><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.orderIndex + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>3200000</xdr:colOff><xdr:row>${image.orderIndex + 1}</xdr:row><xdr:rowOff>2200000</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id=\"${imageIndex + 1}\" name=\"Стикер ${imageIndex + 1}\"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed=\"rId${imageIndex + 1}\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"3200000\" cy=\"2200000\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`).join("")}</xdr:wsDr>`);
    images.forEach((image, imageIndex) => put(`xl/media/image${imageIndex + 1}.png`, image.data));
    const contentTypes = readText("[Content_Types].xml");
    if (!contentTypes.includes("/xl/drawings/drawing1.xml")) put("[Content_Types].xml", contentTypes.replace("</Types>", "<Override PartName=\"/xl/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/></Types>"));
  }

  const output = CFB.write(archive, { type: "array", fileType: "zip", compression: true });
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `FBS-заказы-${warehouse.city.replace(/[^\\p{L}\\p{N}-]+/gu, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function parseExcelFile(file: File): Promise<ImportPreview> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В файле нет листов");
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false });
  const headerRowIndex = rows.slice(0, 10).findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.some((header) => ["артикул", "артикулпродавца", "sku", "vendorcode", "артикулwb", "nmid", "nm", "номенклатуравб"].includes(header))
      && headers.some((header) => ["количество", "колво", "остаток", "qty", "quantity"].includes(header));
  });
  if (headerRowIndex < 0) throw new Error("Нужны столбцы «Артикул WB» или «Артикул продавца», а также «Количество»");

  const headers = rows[headerRowIndex].map(normalizedHeader);
  const skuColumn = headers.findIndex((header) => ["артикул", "артикулпродавца", "sku", "vendorcode"].includes(header));
  const nmIdColumn = headers.findIndex((header) => ["артикулwb", "nmid", "nm", "номенклатуравб"].includes(header));
  const quantityColumn = headers.findIndex((header) => ["количество", "колво", "остаток", "qty", "quantity"].includes(header));
  const expiryColumn = headers.findIndex((header) => ["срокгодности", "годендо", "датаокончаниясрокагодности", "expiry", "expirydate", "expirationdate"].includes(header));
  const batchColumn = headers.findIndex((header) => ["партия", "номерпартии", "batch", "batchcode", "lot", "lotnumber"].includes(header));
  const hasExpiryColumn = expiryColumn >= 0;
  const hasBatchColumn = batchColumn >= 0;
  const grouped = new Map<string, ImportItem>();
  let skipped = 0;

  for (const row of rows.slice(headerRowIndex + 1)) {
    const sku = skuColumn >= 0 ? String(row[skuColumn] ?? "").trim() : "";
    const nmIdValue = nmIdColumn >= 0 ? Number(String(row[nmIdColumn] ?? "").trim()) : Number.NaN;
    const nmId = Number.isInteger(nmIdValue) && nmIdValue > 0 && nmIdValue <= 2_147_483_647 ? nmIdValue : null;
    const quantity = parseQuantity(row[quantityColumn]);
    const batchCode = hasBatchColumn ? String(row[batchColumn] ?? "").trim().slice(0, 120) : "";
    const expiryValue = hasExpiryColumn ? String(row[expiryColumn] ?? "").trim() : "";
    const expiresAt = hasExpiryColumn ? parseExpiryDate(row[expiryColumn]) : undefined;
    if (!sku && !nmId && !String(row[quantityColumn] ?? "").trim()) continue;
    if ((!sku && !nmId) || !Number.isFinite(quantity) || quantity < 0 || quantity > 10_000_000 || (hasExpiryColumn && Boolean(expiryValue) && !expiresAt)) {
      skipped += 1;
      continue;
    }
    const key = `${nmId ? `nm:${nmId}` : `sku:${normalizedSku(sku)}`}\u0000${batchCode}\u0000${expiresAt ?? ""}`;
    const previous = grouped.get(key);
    grouped.set(key, { sku, nmId, batchCode, quantity: (previous?.quantity ?? 0) + quantity, ...(hasExpiryColumn ? { expiresAt: expiresAt ?? null } : {}) });
  }

  const items = [...grouped.values()];
  if (!items.length) throw new Error("Не нашли ни одной корректной строки с артикулом WB или артикулом продавца и количеством");
  if (items.some((item) => item.quantity > 10_000_000)) throw new Error("Количество по одной партии не должно превышать 10 000 000");
  return { fileName: file.name, sheetName, items, skipped, hasExpiryColumn, hasBatchColumn };
}

function ExpiryManager({ rows, warehouses }: {
  rows: StockRow[];
  warehouses: ManualWarehouse[];
}) {
  if (!rows.length || !warehouses.length) return null;

  return <section className="expiry-manager" aria-label="Срок годности товара">
    <div>
      <span className="section-kicker">ПАРТИИ И СРОКИ ГОДНОСТИ</span>
      <h3>Учитываются отдельно</h3>
      <p>Партии и сроки сохраняются из Excel. В карточках товаров ручное редактирование отключено.</p>
    </div>
  </section>;
}

type PlannerRange = { from: string; to: string; targetDays: number };
type PlannerProduct = { key: string; sku: string; nmId: number | null; name: string; category: string; color: string };
type PlannerPlan = { warehouse: ManualWarehouse; product: PlannerProduct; plan: FfPlan };

export function applyPlannerRangeToSelected(
  current: Record<string, PlannerRange>,
  selectedWarehouseIds: string[],
  range: Pick<PlannerRange, "from" | "to">,
  targetDays: number,
) {
  const next = { ...current };
  for (const warehouseId of selectedWarehouseIds) next[warehouseId] = { ...range, targetDays };
  return next;
}

export function updatePlannerWarehouseRange(
  current: Record<string, PlannerRange>,
  warehouseId: string,
  fallback: PlannerRange,
  change: Partial<PlannerRange>,
) {
  return { ...current, [warehouseId]: { ...(current[warehouseId] ?? fallback), ...change } };
}

export function togglePlannerWarehouse(selectedWarehouseIds: string[], warehouseId: string, checked: boolean) {
  return checked
    ? [...new Set([...selectedWarehouseIds, warehouseId])]
    : selectedWarehouseIds.filter((id) => id !== warehouseId);
}

export function toggleAllPlannerWarehouses(
  selectedWarehouseIds: string[],
  warehouses: Array<Pick<ManualWarehouse, "id" | "isHidden">>,
) {
  const visibleWarehouseIds = warehouses.filter((warehouse) => !warehouse.isHidden).map((warehouse) => warehouse.id);
  const visibleWarehouseIdSet = new Set(visibleWarehouseIds);
  const allVisibleSelected = visibleWarehouseIds.length > 0
    && visibleWarehouseIds.every((warehouseId) => selectedWarehouseIds.includes(warehouseId));
  return allVisibleSelected
    ? selectedWarehouseIds.filter((warehouseId) => !visibleWarehouseIdSet.has(warehouseId))
    : [...new Set([...selectedWarehouseIds, ...visibleWarehouseIds])];
}

export function mergePlannerWarehouseMetadata<T extends { id: string }>(snapshotWarehouses: T[], liveWarehouses: T[]) {
  if (!snapshotWarehouses.length) return liveWarehouses;
  const liveById = new Map(liveWarehouses.map((warehouse) => [warehouse.id, warehouse]));
  const snapshotIds = new Set(snapshotWarehouses.map((warehouse) => warehouse.id));
  return [
    ...snapshotWarehouses.map((warehouse) => liveById.get(warehouse.id) ?? warehouse),
    ...liveWarehouses.filter((warehouse) => !snapshotIds.has(warehouse.id)),
  ];
}

export function plannerWarehouseDefaultRange(
  warehouse: Pick<ManualWarehouse, "openedAt" | "planningTargetDays">,
  initialRange: Pick<PlannerRange, "from" | "to">,
  minimumFrom?: string,
): PlannerRange {
  let from = initialRange.from;
  if (warehouse.openedAt && warehouse.openedAt <= initialRange.to) {
    from = minimumFrom && warehouse.openedAt < minimumFrom ? minimumFrom : warehouse.openedAt;
  }
  return { from, to: initialRange.to, targetDays: warehouse.planningTargetDays || 14 };
}

export function syncPlannerWarehouseRanges(
  current: Record<string, PlannerRange>,
  warehouses: Array<Pick<ManualWarehouse, "id" | "planningTargetDays" | "openedAt">>,
  initialRange: Pick<PlannerRange, "from" | "to">,
  targetOverrideIds: ReadonlySet<string>,
  periodOverrideIds: ReadonlySet<string> = new Set(),
  minimumFrom?: string,
) {
  return Object.fromEntries(warehouses.map((warehouse) => {
    const existing = current[warehouse.id];
    const savedDefault = plannerWarehouseDefaultRange(warehouse, initialRange, minimumFrom);
    const period = existing && periodOverrideIds.has(warehouse.id)
      ? { from: existing.from, to: existing.to }
      : { from: savedDefault.from, to: savedDefault.to };
    const targetDays = existing && targetOverrideIds.has(warehouse.id) ? existing.targetDays : savedDefault.targetDays;
    return [warehouse.id, { ...period, targetDays }];
  }));
}

export function summarizePlannerUnassigned(
  daily: FfPlanningDailyMetric[],
  selectedWarehouses: Array<Pick<ManualWarehouse, "id" | "openedAt">>,
  warehouseRanges: Record<string, PlannerRange>,
  fallbackRange: Pick<PlannerRange, "from" | "to">,
) {
  const appliedPeriods = selectedWarehouses.flatMap((warehouse) => {
    const range = warehouseRanges[warehouse.id] ?? { ...fallbackRange, targetDays: 14 };
    try {
      const period = effectivePeriod({ from: range.from, to: range.to, openedAt: warehouse.openedAt });
      return period.days > 0 ? [{ from: period.from, to: period.to }] : [];
    } catch {
      return [];
    }
  });
  const facts = daily.filter((metric) => metric.warehouseId === "unassigned"
    && appliedPeriods.some((period) => metric.date >= period.from && metric.date <= period.to));
  return {
    facts,
    demand: facts.reduce((sum, metric) => sum + metric.demand, 0),
    sold: facts.reduce((sum, metric) => sum + metric.sold, 0),
  };
}

function offsetPlanningDate(date: string, dayOffset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  return value.toISOString().slice(0, 10);
}

function compactPlanningDate(date: string) {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}.${month}` : date;
}

function plannerNumber(value: number, maximumFractionDigits = 1) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function plannerCoverage(value: number | null) {
  return value === null ? "Нет спроса" : `${plannerNumber(value)} дн.`;
}

function plannerSupply(value: number) {
  return value > 0 ? `+${formatNumber.format(value)} шт.` : "0 шт.";
}

export function FfSupplyPlanner({
  today = isoDate(0),
  warehouses,
  daily,
  rows,
  dataAvailable,
  selectedWarehouseIds,
  onSelectedWarehouseIdsChange,
  canEditWarehouseSettings = false,
  warehouseOpeningSavingId = null,
  onWarehouseOpenedAtChange,
  warehouseSettingsError = null,
  onRefresh,
  loading,
  refreshing,
  updatedAt,
  retrySeconds,
  error,
  warnings,
  source,
}: {
  today?: string;
  warehouses: ManualWarehouse[];
  daily: FfPlanningDailyMetric[];
  rows: StockRow[];
  dataAvailable: boolean;
  selectedWarehouseIds: string[];
  onSelectedWarehouseIdsChange: (ids: string[]) => void;
  canEditWarehouseSettings?: boolean;
  warehouseOpeningSavingId?: string | null;
  onWarehouseOpenedAtChange?: (warehouse: ManualWarehouse, openedAt: string) => void;
  warehouseSettingsError?: string | null;
  onRefresh: () => void;
  loading: boolean;
  refreshing: boolean;
  updatedAt: string | null;
  retrySeconds: number | null;
  error: string | null;
  warnings: string[];
  source: FfPlanningSource;
}) {
  const snapshotFrom = offsetPlanningDate(today, -89);
  const initialRange = useMemo(() => ({ from: offsetPlanningDate(today, -6), to: today }), [today]);
  const [commonPreset, setCommonPreset] = useState<"7d" | "14d" | "30d" | "custom">("7d");
  const [commonRange, setCommonRange] = useState(initialRange);
  const [commonTargetDays, setCommonTargetDays] = useState(14);
  const [warehouseRanges, setWarehouseRanges] = useState<Record<string, PlannerRange>>(() => Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, plannerWarehouseDefaultRange(warehouse, initialRange, snapshotFrom)])));
  const [plannerQuery, setPlannerQuery] = useState("");
  const targetOverrideIdsRef = useRef(new Set<string>());
  const periodOverrideIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWarehouseRanges((current) => syncPlannerWarehouseRanges(current, warehouses, initialRange, targetOverrideIdsRef.current, periodOverrideIdsRef.current, snapshotFrom));
      const warehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
      targetOverrideIdsRef.current = new Set([...targetOverrideIdsRef.current].filter((warehouseId) => warehouseIds.has(warehouseId)));
      periodOverrideIdsRef.current = new Set([...periodOverrideIdsRef.current].filter((warehouseId) => warehouseIds.has(warehouseId)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialRange, snapshotFrom, warehouses]);

  const chooseCommonPreset = (preset: "7d" | "14d" | "30d" | "custom") => {
    setCommonPreset(preset);
    if (preset === "custom") return;
    const days = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
    setCommonRange({ from: offsetPlanningDate(today, -(days - 1)), to: today });
  };

  const updateWarehouseRange = (warehouseId: string, change: Partial<PlannerRange>) => {
    if (change.targetDays !== undefined) targetOverrideIdsRef.current.add(warehouseId);
    if (change.from !== undefined || change.to !== undefined) periodOverrideIdsRef.current.add(warehouseId);
    setWarehouseRanges((current) => updatePlannerWarehouseRange(current, warehouseId, { ...initialRange, targetDays: 14 }, change));
  };

  const applyCommonRange = () => {
    for (const warehouseId of selectedWarehouseIds) {
      targetOverrideIdsRef.current.add(warehouseId);
      periodOverrideIdsRef.current.add(warehouseId);
    }
    setWarehouseRanges((current) => applyPlannerRangeToSelected(current, selectedWarehouseIds, commonRange, commonTargetDays));
  };

  const toggleWarehouse = (warehouseId: string, checked: boolean) => {
    onSelectedWarehouseIdsChange(togglePlannerWarehouse(selectedWarehouseIds, warehouseId, checked));
  };

  const visibleWarehouseIds = warehouses.filter((warehouse) => !warehouse.isHidden).map((warehouse) => warehouse.id);
  const allVisibleWarehousesSelected = visibleWarehouseIds.length > 0
    && visibleWarehouseIds.every((warehouseId) => selectedWarehouseIds.includes(warehouseId));

  const selectedWarehouses = useMemo(() => warehouses.filter((warehouse) => !warehouse.isHidden && selectedWarehouseIds.includes(warehouse.id)), [selectedWarehouseIds, warehouses]);
  const products = useMemo(() => {
    const byKey = new Map<string, PlannerProduct>();
    for (const row of rows) byKey.set(row.key, { key: row.key, sku: row.sku, nmId: row.nmId, name: row.name, category: row.category, color: row.color });
    for (const metric of daily) {
      if (!byKey.has(metric.productKey)) byKey.set(metric.productKey, {
        key: metric.productKey,
        sku: metric.sku || String(metric.nmId ?? metric.productKey),
        nmId: metric.nmId,
        name: metric.sku || `Товар ${metric.nmId ?? ""}`.trim(),
        category: "Wildberries",
        color: "#8090ad",
      });
    }
    return [...byKey.values()];
  }, [daily, rows]);
  const inventoryByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const dailyByWarehouseProduct = useMemo(() => {
    const index = new Map<string, FfPlanningDailyMetric[]>();
    for (const metric of daily) {
      const key = `${metric.warehouseId}\u0000${metric.productKey}`;
      const metrics = index.get(key) ?? [];
      metrics.push(metric);
      index.set(key, metrics);
    }
    return index;
  }, [daily]);

  const calculation = useMemo(() => {
    const plans: PlannerPlan[] = [];
    const invalidWarehouseIds = new Set<string>();
    for (const warehouse of selectedWarehouses) {
      const range = warehouseRanges[warehouse.id] ?? plannerWarehouseDefaultRange(warehouse, initialRange, snapshotFrom);
      let period: ReturnType<typeof effectivePeriod>;
      try {
        period = effectivePeriod({ from: range.from, to: range.to, openedAt: warehouse.openedAt });
      } catch {
        invalidWarehouseIds.add(warehouse.id);
        continue;
      }
      for (const product of products) {
        const facts = (dailyByWarehouseProduct.get(`${warehouse.id}\u0000${product.key}`) ?? []).filter((metric) => metric.warehouseId === warehouse.id
          && metric.date >= period.from
          && metric.date <= period.to);
        const row = inventoryByKey.get(product.key);
        const plan = calculateFfPlan({
          ffId: warehouse.id,
          productKey: product.key,
          sku: product.sku,
          nmId: product.nmId ?? undefined,
          from: range.from,
          to: range.to,
          openedAt: warehouse.openedAt,
          targetCoverageDays: range.targetDays,
          demand: facts.reduce((sum, metric) => sum + metric.demand, 0),
          sold: facts.reduce((sum, metric) => sum + metric.sold, 0),
          freeStock: row ? availableFfStock(row, warehouse.id) : 0,
        });
        plans.push({ warehouse, product, plan });
      }
    }
    return { plans, invalidWarehouseIds };
  }, [dailyByWarehouseProduct, initialRange, inventoryByKey, products, selectedWarehouses, snapshotFrom, warehouseRanges]);

  const plannerGroups = useMemo(() => {
    const groups = new Map<string, { product: PlannerProduct; plans: PlannerPlan[] }>();
    for (const item of calculation.plans) {
      const group = groups.get(item.product.key) ?? { product: item.product, plans: [] };
      group.plans.push(item);
      groups.set(item.product.key, group);
    }
    const term = plannerQuery.trim().toLocaleLowerCase("ru-RU");
    return [...groups.values()].map((group) => {
      const demand = group.plans.reduce((sum, item) => sum + item.plan.demand, 0);
      const sold = group.plans.reduce((sum, item) => sum + item.plan.sold, 0);
      const freeStock = group.plans.reduce((sum, item) => sum + item.plan.freeStock, 0);
      const averageDemandPerDay = group.plans.reduce((sum, item) => sum + item.plan.averageDemandPerDay, 0);
      const recommendedSupply = group.plans.reduce((sum, item) => sum + item.plan.recommendedSupply, 0);
      return {
        ...group,
        demand,
        sold,
        freeStock,
        averageDemandPerDay,
        recommendedSupply,
        coverageDays: averageDemandPerDay > 0 ? freeStock / averageDemandPerDay : null,
      };
    }).filter((group) => {
      const haystack = `${group.product.name} ${group.product.sku} ${group.product.nmId ?? ""}`.toLocaleLowerCase("ru-RU");
      return (!term || haystack.includes(term)) && (group.demand > 0 || group.sold > 0 || group.freeStock > 0);
    }).sort((left, right) => right.recommendedSupply - left.recommendedSupply || right.demand - left.demand || left.product.name.localeCompare(right.product.name, "ru"));
  }, [calculation.plans, plannerQuery]);

  const warehouseSummaries = selectedWarehouses.map((warehouse) => {
    const warehousePlans = calculation.plans.filter((item) => item.warehouse.id === warehouse.id).map((item) => item.plan);
    const demand = warehousePlans.reduce((sum, plan) => sum + plan.demand, 0);
    const sold = warehousePlans.reduce((sum, plan) => sum + plan.sold, 0);
    const freeStock = warehousePlans.reduce((sum, plan) => sum + plan.freeStock, 0);
    const averageDemandPerDay = warehousePlans.reduce((sum, plan) => sum + plan.averageDemandPerDay, 0);
    return {
      warehouse,
      demand,
      sold,
      freeStock,
      averageDemandPerDay,
      coverageDays: averageDemandPerDay > 0 ? freeStock / averageDemandPerDay : null,
      recommendedSupply: warehousePlans.reduce((sum, plan) => sum + plan.recommendedSupply, 0),
    };
  });

  const demandSourceLabel = source.demand.kind === "created_fbs_orders" ? "созданные FBS" : `${source.demand.label.charAt(0).toLocaleLowerCase("ru-RU")}${source.demand.label.slice(1)}`;
  const soldSourceLabel = source.sold.kind === "confirmed_buyouts" ? "подтверждённые выкупы" : `${source.sold.label.charAt(0).toLocaleLowerCase("ru-RU")}${source.sold.label.slice(1)}`;
  const demandLabel = `Спрос · ${demandSourceLabel}`;
  const soldLabel = `Продано · ${soldSourceLabel}`;
  const unassigned = summarizePlannerUnassigned(daily, selectedWarehouses, warehouseRanges, initialRange);
  const unassignedFacts = unassigned.facts;
  const unassignedDemand = unassigned.demand;
  const unassignedSold = unassigned.sold;

  return <section className="planner-panel" aria-label="План поставок">
    <div className="section-heading planner-heading">
      <div><span className="section-kicker">ОБЩИЙ ПЛАН · НЕСКОЛЬКО ФФ</span><h2>Что и куда довезти</h2><p className="section-note">{source.demand.label} и {source.sold.label} загружаются одним согласованным снимком и не смешиваются.</p></div>
      <button className="secondary-btn planner-refresh-btn" type="button" onClick={onRefresh} disabled={refreshing || loading || Boolean(retrySeconds)}><span className={refreshing ? "spin" : ""}>↻</span>{refreshing ? "Обновляем…" : retrySeconds ? `Через ${formatCountdown(retrySeconds)}` : "Обновить данные"}</button>
    </div>

    <section className="planner-bulk-bar" aria-label="Общие настройки плана">
      <div className="planner-period-presets"><span>Общий период</span><div role="group" aria-label="Общий период">{([['7d', '7 дней'], ['14d', '14 дней'], ['30d', '30 дней'], ['custom', 'Свой период']] as const).map(([value, label]) => <button type="button" className={commonPreset === value ? "active" : ""} key={value} onClick={() => chooseCommonPreset(value)}>{label}</button>)}</div></div>
      {commonPreset === "custom" && <div className="planner-common-dates"><label><span>С</span><input type="date" min={snapshotFrom} max={commonRange.to} value={commonRange.from} onChange={(event) => setCommonRange((current) => ({ ...current, from: event.target.value }))} /></label><label><span>По</span><input type="date" min={commonRange.from} max={today} value={commonRange.to} onChange={(event) => setCommonRange((current) => ({ ...current, to: event.target.value }))} /></label></div>}
      <label className="planner-target-control"><span>Целевой запас</span><input type="number" min="1" max="365" value={commonTargetDays} onChange={(event) => setCommonTargetDays(Math.max(1, Math.min(365, Number(event.target.value) || 1)))} /><small>дн.</small></label>
      <div className="planner-bulk-actions">
        <button className="planner-select-all-btn" type="button" onClick={() => onSelectedWarehouseIdsChange(toggleAllPlannerWarehouses(selectedWarehouseIds, warehouses))} disabled={!visibleWarehouseIds.length}>{allVisibleWarehousesSelected ? "Снять все" : "Выбрать все"}</button>
        <button className="primary-btn planner-apply-btn" type="button" onClick={applyCommonRange} disabled={!selectedWarehouseIds.length}>Применить выбранным</button>
      </div>
    </section>

    <div className="planner-ff-grid">{warehouses.filter((warehouse) => !warehouse.isHidden).map((warehouse) => {
      const selected = selectedWarehouseIds.includes(warehouse.id);
      const range = warehouseRanges[warehouse.id] ?? plannerWarehouseDefaultRange(warehouse, initialRange, snapshotFrom);
      let periodLabel = "Проверьте даты";
      try {
        const period = effectivePeriod({ from: range.from, to: range.to, openedAt: warehouse.openedAt });
        periodLabel = period.days ? `${compactPlanningDate(period.from)}–${compactPlanningDate(period.to)} · ${period.days} дн.` : "Склад ещё не работал в этот период";
      } catch {}
      const savingOpeningDate = warehouseOpeningSavingId === warehouse.id;
      return <article className={`planner-ff-card ${selected ? "selected" : ""}`} key={warehouse.id}>
        <label className="planner-ff-select"><input type="checkbox" checked={selected} onChange={(event) => toggleWarehouse(warehouse.id, event.target.checked)} /><span><strong>{formatManualWarehouse(warehouse)}</strong><small>{warehouse.openedAt ? `Работает с ${shortDate(warehouse.openedAt)}` : "Дата открытия не указана"}</small></span></label>
        {canEditWarehouseSettings && onWarehouseOpenedAtChange && <label className="planner-ff-opening"><span>Дата открытия ФФ</span><input aria-label={`Дата открытия ${formatManualWarehouse(warehouse)}`} type="date" max={today} value={warehouse.openedAt ?? ""} disabled={savingOpeningDate} onChange={(event) => onWarehouseOpenedAtChange(warehouse, event.target.value)} /><small>{savingOpeningDate ? "Сохраняем…" : warehouse.openedAt ? "Начало периода подставляется автоматически" : "Укажите один раз — сохраним в настройках"}</small></label>}
        <div className="planner-ff-period"><span>Период этого ФФ</span><div><label><small>С</small><input type="date" min={snapshotFrom} max={range.to} value={range.from} disabled={!selected} onChange={(event) => updateWarehouseRange(warehouse.id, { from: event.target.value })} /></label><label><small>По</small><input type="date" min={range.from} max={today} value={range.to} disabled={!selected} onChange={(event) => updateWarehouseRange(warehouse.id, { to: event.target.value })} /></label></div></div>
        <label className="planner-ff-target"><span>Целевой запас этого ФФ</span><span><input type="number" min="1" max="365" value={range.targetDays} disabled={!selected} onChange={(event) => updateWarehouseRange(warehouse.id, { targetDays: Math.max(1, Math.min(365, Number(event.target.value) || 1)) })} /><small>дн.</small></span></label>
        <p>{periodLabel}</p>
      </article>;
    })}</div>

    {warehouseSettingsError && <div className="planner-notice error" role="alert">{warehouseSettingsError}</div>}

    {!dataAvailable ? <div className={loading ? "loading-state planner-snapshot-state" : "empty-state planner-snapshot-state"} role={loading ? "status" : "alert"}>{loading ? <><span className="loader"/><strong>Загружаем общий снимок</strong><small>{source.demand.label} и {source.sold.label} будут показаны только вместе с остатками</small></> : <><strong>План поставок пока недоступен</strong><span>{error || `Не удалось согласованно загрузить ${source.demand.label.toLocaleLowerCase("ru-RU")} и остатки.`}</span><small>Частичные данные не подменяются нулями. Обновите снимок ещё раз.</small></>}</div> : <>
    {error && <div className="planner-notice error" role="alert">{error}</div>}
    {warnings.length > 0 && <div className="planner-notice warning">{warnings.join(" · ")}</div>}
    {calculation.invalidWarehouseIds.size > 0 && <div className="planner-notice error">Проверьте период выбранных ФФ.</div>}
    {unassignedFacts.length > 0 && <div className="planner-unassigned-note"><strong>Не назначено на ФФ</strong><span>{demandLabel} {formatNumber.format(unassignedDemand)} шт. · {soldLabel} {formatNumber.format(unassignedSold)} шт.</span><small>Считаем по объединению применённых периодов выбранных ФФ. Общий период изменит итог только после «Применить выбранным».</small></div>}

    <div className="planner-summary-grid">{warehouseSummaries.map((summary) => <article key={summary.warehouse.id}>
      <div><span>ФФ</span><h3>{formatManualWarehouse(summary.warehouse)}</h3></div>
      <dl><div><dt>{demandLabel}</dt><dd>{formatNumber.format(summary.demand)} <small>шт.</small></dd></div><div><dt>{soldLabel}</dt><dd>{formatNumber.format(summary.sold)} <small>шт.</small></dd></div><div><dt>Свободный остаток</dt><dd>{formatNumber.format(summary.freeStock)} <small>шт.</small></dd></div><div><dt>Среднее в день</dt><dd>{plannerNumber(summary.averageDemandPerDay)}</dd></div><div><dt>Хватит на</dt><dd>{plannerCoverage(summary.coverageDays)}</dd></div><div className="supply"><dt>Рекомендовано</dt><dd>{plannerSupply(summary.recommendedSupply)}</dd></div></dl>
    </article>)}</div>

    <section className="planner-sku-card">
      <div className="planner-sku-heading"><div><span className="section-kicker">ПО АРТИКУЛАМ</span><h3>Сумма выбранных ФФ</h3><p>Рекомендация каждого ФФ рассчитана отдельно; избыток одного склада не скрывает дефицит другого.</p></div><label className="search-field"><span>⌕</span><input value={plannerQuery} onChange={(event) => setPlannerQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск в плане поставок" /></label></div>
      <div className="planner-source-strip"><span>{demandLabel}: {source.demand.dateBasis === "order_created_at" ? "по дате создания заказа" : source.demand.dateBasis}</span><span>{soldLabel}: {source.sold.dateBasis === "order_created_at" ? "по дате создания заказа" : source.sold.dateBasis}</span><small>{updatedAt ? `Общий снимок обновлён ${formatDateTime(updatedAt)}` : "Общий снимок ещё не обновлялся"}</small></div>
      <div className="planner-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{demandLabel}</th><th>{soldLabel}</th><th>Свободный остаток</th><th>Среднее в день</th><th>Хватит на</th><th>Рекомендовано</th></tr></thead><tbody>{plannerGroups.map((group) => [
        <tr className="planner-sku-row" key={`${group.product.key}:summary`}><td><div className="product-cell"><span className="product-swatch" style={{ background: group.product.color }}>{group.product.name.charAt(0).toUpperCase()}</span><span><strong>{group.product.name}</strong><small>{group.product.sku}{group.product.nmId ? ` · WB ${group.product.nmId}` : ""}</small></span></div></td><td><span>{demandLabel}</span><strong>{formatNumber.format(group.demand)} <small>шт.</small></strong></td><td><span>{soldLabel}</span><strong>{formatNumber.format(group.sold)} <small>шт.</small></strong></td><td><strong>{formatNumber.format(group.freeStock)} <small>шт.</small></strong></td><td><strong>{plannerNumber(group.averageDemandPerDay)}</strong></td><td><span>Хватит на</span><strong>{plannerCoverage(group.coverageDays)}</strong></td><td><span>Рекомендовано</span><strong className={group.recommendedSupply > 0 ? "needed" : "covered"}>{plannerSupply(group.recommendedSupply)}</strong></td></tr>,
        <tr className="planner-sku-details-row" key={`${group.product.key}:details`}><td colSpan={7}><details><summary>По складам ФФ</summary><div className="planner-expanded-grid">{group.plans.map(({ warehouse, plan }) => <article key={warehouse.id}><div><h4>{formatManualWarehouse(warehouse)}</h4><small>{compactPlanningDate(plan.from)}–{compactPlanningDate(plan.to)} · {plan.effectiveDays} {plan.effectiveDays === 1 ? "день" : plan.effectiveDays >= 2 && plan.effectiveDays <= 4 ? "дня" : "дней"}</small></div><dl><div><dt>{demandLabel}</dt><dd>{formatNumber.format(plan.demand)} шт.</dd></div><div><dt>{soldLabel}</dt><dd>{formatNumber.format(plan.sold)} шт.</dd></div><div><dt>Свободный остаток</dt><dd>{formatNumber.format(plan.freeStock)} шт.</dd></div><div><dt>Среднее в день</dt><dd>{plannerNumber(plan.averageDemandPerDay)}</dd></div><div><dt>Хватит на</dt><dd>{plannerCoverage(plan.coverageDays)}</dd></div><div><dt>Рекомендовано</dt><dd className={plan.recommendedSupply > 0 ? "needed" : "covered"}>{plannerSupply(plan.recommendedSupply)}</dd></div></dl></article>)}</div></details></td></tr>,
      ])}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Обновляем согласованный снимок</strong><small>{source.demand.label} и {source.sold.label} остаются отдельными метриками</small></div>}{!loading && selectedWarehouses.length > 0 && !plannerGroups.length && <div className="empty-state"><strong>За выбранный период данных нет</strong><span>Попробуйте другой период или обновите общий снимок.</span></div>}{!selectedWarehouses.length && <div className="empty-state"><strong>Выберите хотя бы один ФФ</strong><span>Отметьте склады выше, чтобы построить план поставок.</span></div>}</div>
    </section>
    </>}
  </section>;
}

function MarketplaceConnectionCard({
  connection,
  platform,
  mark,
  title,
  onCheck,
  onDisable,
  canManage,
  checking,
  onOpen,
  opening,
}: {
  connection?: MarketplaceConnection;
  platform: "yandex" | "ozon";
  mark: string;
  title: string;
  onCheck: () => void;
  onDisable: (platform: "yandex" | "ozon") => Promise<void>;
  canManage: boolean;
  checking: boolean;
  onOpen?: () => void;
  opening?: boolean;
}) {
  const connected = connection?.connected ?? false;
  const configured = connection?.configured ?? false;
  const disabled = connection?.disabled ?? false;
  const [disabling, setDisabling] = useState(false);
  const disable = async () => {
    setDisabling(true);
    try {
      await onDisable(platform);
    } finally {
      setDisabling(false);
    }
  };
  return <article className={`cabinet-platform-card ${connected ? "connected-platform" : "pending-platform"}`}>
    <div className="cabinet-platform-head"><span className={`platform-mark ${platform === "yandex" ? "ym-mark" : "oz-mark"}`}>{mark}</span><div><strong>{title}</strong><small>{disabled ? "Подключение отключено" : connected ? "Подключено по API" : configured ? "Нужна проверка подключения" : "Настраивается на сервере"}</small></div></div>
    {disabled ? <div className="platform-connect"><strong>Подключение отключено</strong><span>Ключи остаются в защищённой настройке сервера. Включение выполняется только на сервере.</span></div> : connected ? <div className="platform-connect connected"><strong>{connection?.accountName || title}</strong><span>{connection?.details.length ? connection.details.join(" · ") : "Доступ к кабинету подтверждён"}</span></div> : <div className="platform-connect"><strong>{configured ? "Ключ на сервере" : "Ключ не настроен"}</strong><span>{configured ? connection?.error || "Проверьте подключение." : "API-ключи вводятся только в защищённой настройке сервера и не доступны в браузере."}</span></div>}
    {onOpen && configured && !disabled && <button className="marketplace-check-btn" type="button" onClick={onOpen} disabled={opening}>{opening ? "Открываем…" : "Открыть кабинет"}</button>}
    {canManage && configured && !disabled && <><button className="marketplace-check-btn" type="button" onClick={onCheck} disabled={checking || disabling}>{checking ? "Проверяем…" : connected ? "Проверить снова" : "Проверить подключение"}</button><button className="marketplace-link-btn marketplace-disable-btn" type="button" onClick={() => void disable()} disabled={checking || disabling}>{disabling ? "Отключаем…" : "Отключить"}</button></>}
    {!canManage && <p>Гостевой доступ: можно обновлять статусы, но API-ключи и настройки скрыты.</p>}
    {canManage && configured && !disabled && !connected && <p>После успешной проверки сюда попадут доступные кампании или склады.</p>}
    {canManage && connected && <p>{platform === "ozon" ? "Кабинет Ozon готов: откройте его для остатков, FBS и ФФ." : "Следующий этап: подтянем товары, остатки и заказы в отдельный контур этого маркетплейса."}</p>}
  </article>;
}

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [role, setRole] = useState<UserRole | null>(null);
  const [cabinet, setCabinet] = useState<CabinetSummary | null>(null);
  const [availableCabinets, setAvailableCabinets] = useState<CabinetSummary[]>([]);
  const [cabinetSwitchingId, setCabinetSwitchingId] = useState<CabinetSummary["id"] | null>(null);
  const [cabinetSwitchError, setCabinetSwitchError] = useState<string | null>(null);
  const [marketplaceConnections, setMarketplaceConnections] = useState<MarketplaceConnection[]>([]);
  const [marketplaceConnectionsLoading, setMarketplaceConnectionsLoading] = useState(false);
  const [adminLogin, setAdminLogin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("overview");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [warehouseNames, setWarehouseNames] = useState<string[]>([]);
  const [manualWarehouses, setManualWarehouses] = useState<ManualWarehouse[]>(defaultManualWarehouses);
  const [totals, setTotals] = useState<DashboardTotals>(emptyTotals);
  const [handoverTiming, setHandoverTiming] = useState<HandoverMetrics>(emptyHandoverMetrics);
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("Все склады");
  const [stockFfWarehouseId, setStockFfWarehouseId] = useState("all");
  const [stockFfCompareIds, setStockFfCompareIds] = useState<string[]>([]);
  const [stockFfCompareOpen, setStockFfCompareOpen] = useState(false);
  const [pricingQuery, setPricingQuery] = useState("");
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>("all");
  const [pricingSort, setPricingSort] = useState<PricingSort>("priority");
  const [targetPriceRows, setTargetPriceRows] = useState<TargetPriceRow[]>([]);
  const [targetPricesLoading, setTargetPricesLoading] = useState(false);
  const [targetPricesRefreshing, setTargetPricesRefreshing] = useState(false);
  const [targetPricesUpdatedAt, setTargetPricesUpdatedAt] = useState<string | null>(null);
  const [targetPricesCooldownUntil, setTargetPricesCooldownUntil] = useState<string | null>(null);
  const [targetPricesError, setTargetPricesError] = useState<string | null>(null);
  const [targetPricesWarnings, setTargetPricesWarnings] = useState<string[]>([]);
  const [selectedPricingRow, setSelectedPricingRow] = useState<TargetPriceRow | null>(null);
  const [pricingCandidatesError, setPricingCandidatesError] = useState<string | null>(null);
  const [pricingCandidateUpdatingId, setPricingCandidateUpdatingId] = useState<number | null>(null);
  const [manualCompetitorNmId, setManualCompetitorNmId] = useState("");
  const [competitorPriceDrafts, setCompetitorPriceDrafts] = useState<Record<number, string>>({});
  const [pricingClock, setPricingClock] = useState(() => Date.now());
  const [plannerSnapshot, setPlannerSnapshot] = useState<FfPlannerSnapshot | null>(null);
  const [plannerSelectedWarehouseIds, setPlannerSelectedWarehouseIds] = useState<string[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerRefreshing, setPlannerRefreshing] = useState(false);
  const [plannerRetryAt, setPlannerRetryAt] = useState<string | null>(null);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [plannerClock, setPlannerClock] = useState(() => Date.now());
  const plannerRequestVersionRef = useRef(0);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"7d" | "14d" | "30d" | "custom">("7d");
  const [analyticsRange, setAnalyticsRange] = useState({ from: isoDate(6), to: isoDate(0) });
  const [analyticsDraft, setAnalyticsDraft] = useState({ from: isoDate(6), to: isoDate(0) });
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsChannel, setAnalyticsChannel] = useState<AnalyticsChannel>("all");
  const [analyticsHoverDate, setAnalyticsHoverDate] = useState<string | null>(null);
  const [analyticsClock, setAnalyticsClock] = useState(() => Date.now());
  const [filter, setFilter] = useState("Все");
  const [selectedFulfillmentWarehouseId, setSelectedFulfillmentWarehouseId] = useState<string | null>(null);
  const [fulfillmentList, setFulfillmentList] = useState<FulfillmentList>("available");
  const [ffOrdersExportLoading, setFfOrdersExportLoading] = useState(false);
  const [ffOrdersExportMessage, setFfOrdersExportMessage] = useState<string | null>(null);
  const [ffOrdersExportError, setFfOrdersExportError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [inventoryRetryAt, setInventoryRetryAt] = useState<string | null>(null);
  const [inventoryClock, setInventoryClock] = useState(() => Date.now());
  const [newWarehouseCity, setNewWarehouseCity] = useState("");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseMessage, setWarehouseMessage] = useState<string | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [warehouseLinkDrafts, setWarehouseLinkDrafts] = useState<Record<string, { wbWarehouseId: string; wbWarehouseName: string; serviceRate: string; openedAt: string; planningTargetDays: string }>>({});
  const [warehouseLinkSavingId, setWarehouseLinkSavingId] = useState<string | null>(null);
  const [plannerWarehouseSettingsError, setPlannerWarehouseSettingsError] = useState<string | null>(null);
  const [settlementWarehouseId, setSettlementWarehouseId] = useState("");
  const [settlementRange, setSettlementRange] = useState({ from: currentMonthStart(), to: isoDate(0) });
  const [settlement, setSettlement] = useState<FfSettlement | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [importWarehouseId, setImportWarehouseId] = useState("kazan");
  const [importMode, setImportMode] = useState<"replace" | "add">("replace");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const canManage = role === "owner";
  const isOzon = cabinet?.marketplace === "ozon";
  const isYandex = cabinet?.marketplace === "yandex";
  const marketplaceName = isOzon ? "Ozon" : isYandex ? "Яндекс Маркет" : "Wildberries";
  const marketplaceCode = isOzon ? "OZ" : isYandex ? "ЯМ" : "WB";
  const marketplaceWarehouseIdLabel = isYandex ? "ID кампании FBS ЯМ" : `ID склада ${marketplaceCode}`;
  const marketplaceFboLabel = isYandex ? "FBY" : "FBO";
  const wbCabinets = useMemo(() => availableCabinets.filter((item) => item.marketplace === "wb"), [availableCabinets]);

  const loadManualWarehouses = useCallback(async () => {
    try {
      const response = await fetch("/api/ff-warehouses", { cache: "no-store" });
      const data = await response.json() as { warehouses?: ManualWarehouse[]; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (response.ok) {
        const warehouses = data.warehouses ?? [];
        setManualWarehouses(warehouses);
        setSettlementWarehouseId((current) => warehouses.some((warehouse) => warehouse.id === current) ? current : warehouses[0]?.id ?? "");
      }
    } catch {
      // The dashboard remains usable with the built-in warehouses until D1 reconnects.
    }
  }, []);

  const requestFfPlanning = useCallback(async (refresh: boolean) => {
    const requestVersion = ++plannerRequestVersionRef.current;
    if (!ffPlanningSupported(cabinet?.marketplace)) {
      setPlannerSnapshot(null);
      setPlannerError(null);
      setPlannerLoading(false);
      setPlannerRefreshing(false);
      return;
    }
    setPlannerRefreshing(refresh);
    setPlannerLoading(!refresh);
    setPlannerError(null);
    const range = { from: isoDate(89), to: isoDate(0) };
    const withRetryAt = (message: string, retryAt?: string | null) => Object.assign(new Error(message), { retryAt: retryAt ?? null });
    try {
      const snapshot = await runCoherentFfPlannerRefresh(async () => {
        const response = await fetch(refresh ? "/api/ff-planning" : `/api/ff-planning?${new URLSearchParams(range)}`, refresh ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refresh", ...range }),
          cache: "no-store",
        } : { cache: "no-store" });
        const data = await response.json() as FfPlanningResponse;
        if (response.status === 401) {
          setAuthState("unauthenticated");
          throw withRetryAt("Сессия истекла", data.retryAt);
        }
        if (!response.ok || data.error) throw withRetryAt(data.error || data.warnings?.join(" · ") || "Не удалось загрузить спрос и продажи", data.retryAt);
        return data;
      }, async (generation) => {
        const inventoryParams = new URLSearchParams();
        if (refresh) {
          inventoryParams.set("refresh", "1");
          inventoryParams.set("plannerGeneration", generation);
        }
        const inventoryUrl = inventoryParams.size ? `/api/inventory?${inventoryParams}` : "/api/inventory";
        const response = await fetch(inventoryUrl, { cache: "no-store" });
        const data = await response.json() as InventoryResponse;
        if (response.status === 401) {
          setAuthState("unauthenticated");
          throw withRetryAt("Сессия истекла", data.retryAt);
        }
        if (!response.ok || data.error) throw withRetryAt(data.error || "Не удалось загрузить остатки Wildberries", data.retryAt);
        return data;
      }, (snapshot) => {
        if (requestVersion !== plannerRequestVersionRef.current) return;
        const data = snapshot.inventory;
        setPlannerSnapshot(snapshot);
        setManualWarehouses(snapshot.warehouses);
        setConfigured(data.configured);
        setWarnings(data.warnings ?? []);
        setInventoryRetryAt(data.retryAt ?? null);
        if (data.cabinet) setCabinet(data.cabinet);
        setWarehouseNames(data.warehouseNames ?? []);
        setRows(snapshot.rows);
        setTotals(data.totals ? { ...emptyTotals, ...data.totals, ffStock: data.totals.ffStock ?? {}, fbsByLocation: { ...emptyFbsBreakdown, ...data.totals.fbsByLocation } } : emptyTotals);
        setHandoverTiming(data.handoverTiming ? { ...emptyHandoverMetrics, ...data.handoverTiming, overall: { ...emptyHandoverMetrics.overall, ...data.handoverTiming.overall }, byLocation: data.handoverTiming.byLocation ?? {} } : emptyHandoverMetrics);
        setUpdatedAt(data.updatedAt ?? snapshot.updatedAt);
      });
      if (requestVersion === plannerRequestVersionRef.current) {
        setPlannerClock(Date.now());
        setPlannerRetryAt(snapshot.retryAt);
      }
    } catch (planningError) {
      if (requestVersion !== plannerRequestVersionRef.current) return;
      const retryAt = planningError && typeof planningError === "object" && "retryAt" in planningError
        ? (planningError as { retryAt?: string | null }).retryAt
        : null;
      setPlannerRetryAt(retryAt ?? null);
      const message = planningError instanceof Error ? planningError.message : "Не удалось загрузить план поставок";
      setPlannerError(`Согласованный снимок не обновлён: ${message}. Частичные данные не применены.`);
    } finally {
      if (requestVersion === plannerRequestVersionRef.current) {
        setPlannerRefreshing(false);
        setPlannerLoading(false);
      }
    }
  }, [cabinet?.marketplace]);

  const loadFfPlanning = useCallback(() => requestFfPlanning(false), [requestFfPlanning]);

  const loadMarketplaceConnections = useCallback(async () => {
    setMarketplaceConnectionsLoading(true);
    try {
      const response = await fetch("/api/marketplaces", { cache: "no-store" });
      const data = await response.json() as { connections?: MarketplaceConnection[] };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (response.ok) setMarketplaceConnections(data.connections ?? []);
    } finally {
      setMarketplaceConnectionsLoading(false);
    }
  }, []);

  const loadTargetPrices = useCallback(async () => {
    setTargetPricesLoading(true);
    setTargetPricesError(null);
    try {
      const response = await fetch("/api/target-prices", { cache: "no-store" });
      const data = await response.json() as TargetPricesResponse;
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить мониторинг цен");
      setTargetPriceRows(data.rows ?? []);
      setTargetPricesUpdatedAt(data.updatedAt ?? null);
      setTargetPricesWarnings(data.warnings ?? []);
      setTargetPricesCooldownUntil(data.cooldownUntil ?? null);
    } catch (pricingLoadError) {
      setTargetPricesError(pricingLoadError instanceof Error ? pricingLoadError.message : "Не удалось загрузить мониторинг цен");
    } finally {
      setTargetPricesLoading(false);
    }
  }, []);

  const refreshTargetPrices = useCallback(async () => {
    setTargetPricesRefreshing(true);
    setTargetPricesError(null);
    try {
      const response = await fetch("/api/target-prices", { method: "POST", cache: "no-store" });
      const data = await response.json() as TargetPricesResponse;
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      setTargetPricesCooldownUntil(data.cooldownUntil ?? null);
      if (!response.ok) throw new Error(data.error || "Не удалось обновить цены");
      setTargetPriceRows(data.rows ?? []);
      setTargetPricesUpdatedAt(data.updatedAt ?? new Date().toISOString());
      setTargetPricesWarnings(data.warnings ?? []);
    } catch (pricingRefreshError) {
      setTargetPricesError(pricingRefreshError instanceof Error ? pricingRefreshError.message : "Не удалось обновить цены");
    } finally {
      setTargetPricesRefreshing(false);
    }
  }, []);

  const openPricingRow = useCallback((row: TargetPriceRow) => {
    setSelectedPricingRow(row);
    setPricingCandidatesError(null);
    setManualCompetitorNmId("");
    setCompetitorPriceDrafts(Object.fromEntries(row.competitors.map((competitor) => [competitor.nmId, competitor.price ? String(competitor.price) : ""])));
  }, []);

  const updatePricingCompetitor = useCallback(async (row: TargetPriceRow, competitorNmId: number, action: "add-competitor" | "remove-competitor" | "set-competitor-price" | "refresh-competitor", competitorPrice?: string, competitorUrl?: string) => {
    setPricingCandidateUpdatingId(competitorNmId);
    setPricingCandidatesError(null);
    try {
      const response = await fetch("/api/target-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sku: row.sku, nmId: row.nmId, competitorNmId, competitorPrice, competitorUrl }),
      });
      const data = await response.json() as TargetPricesResponse;
      if (!response.ok) throw new Error(data.error || "Не удалось обновить список конкурентов");
      const updatedRows = data.rows ?? [];
      const updated = updatedRows.find((item) => item.sku === row.sku && item.nmId === row.nmId) ?? null;
      setTargetPriceRows(updatedRows);
      setSelectedPricingRow(updated);
      setManualCompetitorNmId("");
      if (updated) setCompetitorPriceDrafts(Object.fromEntries(updated.competitors.map((competitor) => [competitor.nmId, competitor.price ? String(competitor.price) : ""])));
    } catch (competitorError) {
      setPricingCandidatesError(competitorError instanceof Error ? competitorError.message : "Не удалось обновить список конкурентов");
    } finally {
      setPricingCandidateUpdatingId(null);
    }
  }, []);

  const disableMarketplaceConnection = useCallback(async (platform: "yandex" | "ozon") => {
    const response = await fetch("/api/marketplaces", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    const data = await response.json() as { disabled?: boolean; error?: string };
    if (response.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    if (!response.ok || !data.disabled) throw new Error(data.error || "Не удалось отключить подключение");
    await loadMarketplaceConnections();
  }, [loadMarketplaceConnections]);

  const loadData = useCallback(async (force = false, marketplaceOverride?: CabinetSummary["marketplace"]) => {
    setLoading(true);
    setError(null);
    try {
      const targetMarketplace = marketplaceOverride ?? cabinet?.marketplace;
      const inventoryEndpoint = targetMarketplace === "ozon" ? "/api/ozon/inventory" : targetMarketplace === "yandex" ? "/api/yandex/inventory" : "/api/inventory";
      const response = await fetch(`${inventoryEndpoint}${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as InventoryResponse;
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      setConfigured(data.configured);
      setWarnings(data.warnings ?? []);
      setInventoryRetryAt(data.retryAt ?? null);
      if (data.cabinet) setCabinet(data.cabinet);
      if (data.manualWarehouses) setManualWarehouses(data.manualWarehouses);
      const targetName = targetMarketplace === "ozon" ? "Ozon" : targetMarketplace === "yandex" ? "Яндекс Маркет" : "Wildberries";
      if (!response.ok) throw new Error(data.error || `Не удалось получить данные ${targetName}`);
      setRows(data.rows ?? []);
      setWarehouseNames(data.warehouseNames ?? []);
      setTotals(data.totals ? { ...emptyTotals, ...data.totals, ffStock: data.totals.ffStock ?? {}, fbsByLocation: { ...emptyFbsBreakdown, ...data.totals.fbsByLocation } } : emptyTotals);
      setHandoverTiming(data.handoverTiming ? { ...emptyHandoverMetrics, ...data.handoverTiming, overall: { ...emptyHandoverMetrics.overall, ...data.handoverTiming.overall }, byLocation: data.handoverTiming.byLocation ?? {} } : emptyHandoverMetrics);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось получить данные маркетплейса");
    } finally {
      setLoading(false);
    }
  }, [cabinet?.marketplace]);

  const refreshFfPlanning = useCallback(() => requestFfPlanning(true), [requestFfPlanning]);

  const loadAnalytics = useCallback(async (range = analyticsRange, force = false) => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const params = new URLSearchParams(range);
      if (force) params.set("refresh", "1");
      const response = await fetch(`/api/analytics?${params}`, { cache: "no-store" });
      const data = await response.json() as AnalyticsResponse & { error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok) throw new Error(data.error || `Не удалось получить аналитику ${marketplaceName}`);
      setAnalytics(data);
    } catch (analyticsLoadError) {
      setAnalyticsError(analyticsLoadError instanceof Error ? analyticsLoadError.message : "Не удалось получить аналитику маркетплейса");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsRange, marketplaceName]);

  const loadSettlement = useCallback(async () => {
    if (!settlementWarehouseId || !settlementRange.from || !settlementRange.to || settlementRange.from > settlementRange.to) {
      setSettlement(null);
      setSettlementError("Выберите ФФ и корректный период");
      return;
    }
    setSettlementLoading(true);
    setSettlementError(null);
    try {
      const params = new URLSearchParams({ warehouseId: settlementWarehouseId, from: settlementRange.from, to: settlementRange.to });
      const response = await fetch(`/api/ff-settlements?${params}`, { cache: "no-store" });
      const data = await response.json() as { settlement?: FfSettlement; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.settlement) throw new Error(data.error || "Не удалось посчитать оплату ФФ");
      setSettlement(data.settlement);
    } catch (settlementLoadError) {
      setSettlement(null);
      setSettlementError(settlementLoadError instanceof Error ? settlementLoadError.message : "Не удалось посчитать оплату ФФ");
    } finally {
      setSettlementLoading(false);
    }
  }, [settlementRange, settlementWarehouseId]);

  const analyticsRetryAt = analytics?.source.retryAt ?? null;
  const analyticsRetrySeconds = useMemo(() => {
    if (!analyticsRetryAt) return null;
    const milliseconds = Date.parse(analyticsRetryAt) - analyticsClock;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : null;
  }, [analyticsRetryAt, analyticsClock]);

  const inventoryRetrySeconds = useMemo(() => {
    if (!inventoryRetryAt) return null;
    const milliseconds = Date.parse(inventoryRetryAt) - inventoryClock;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : null;
  }, [inventoryRetryAt, inventoryClock]);

  const targetPricesCooldownSeconds = useMemo(() => {
    if (!targetPricesCooldownUntil) return null;
    const milliseconds = Date.parse(targetPricesCooldownUntil) - pricingClock;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : null;
  }, [pricingClock, targetPricesCooldownUntil]);

  const plannerRetrySeconds = useMemo(() => {
    if (!plannerRetryAt) return null;
    const milliseconds = Date.parse(plannerRetryAt) - plannerClock;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : null;
  }, [plannerClock, plannerRetryAt]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json() as { authenticated?: boolean; role?: UserRole | null; cabinet?: CabinetSummary | null; cabinets?: CabinetSummary[] };
        setAuthState(data.authenticated ? "authenticated" : "unauthenticated");
        setRole(data.role ?? null);
        setCabinet(data.cabinet ?? null);
        setAvailableCabinets(data.cabinets ?? []);
      } catch {
        setAuthState("unauthenticated");
      }
    })();
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      const timer = window.setTimeout(() => {
        void loadData();
        void loadManualWarehouses();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [authState, loadData, loadManualWarehouses]);

  useEffect(() => {
    if (authState === "authenticated" && activeView === "cabinets") void loadMarketplaceConnections();
  }, [activeView, authState, loadMarketplaceConnections]);

  useEffect(() => {
    if (authState !== "authenticated" || activeView !== "pricing") return;
    const timer = window.setTimeout(() => void loadTargetPrices(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, authState, loadTargetPrices]);

  useEffect(() => {
    if (authState !== "authenticated" || activeView !== "payments" || !settlementWarehouseId) return;
    const timer = window.setTimeout(() => void loadSettlement(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, authState, loadSettlement, settlementWarehouseId]);

  useEffect(() => {
    if (authState !== "authenticated" || activeView !== "analytics") return;
    const timer = window.setTimeout(() => void loadAnalytics(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, authState, analyticsRange, loadAnalytics]);

  useEffect(() => {
    if (authState !== "authenticated" || activeView !== "sales" || !ffPlanningSupported(cabinet?.marketplace)) return;
    const timer = window.setTimeout(() => void loadFfPlanning(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, authState, cabinet?.marketplace, loadFfPlanning]);

  useEffect(() => {
    if (!analyticsRetryAt) return;
    const timer = window.setInterval(() => setAnalyticsClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [analyticsRetryAt]);

  useEffect(() => {
    if (!loading && !inventoryRetryAt) return;
    const timer = window.setInterval(() => setInventoryClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [inventoryRetryAt, loading]);

  useEffect(() => {
    if (!targetPricesCooldownUntil) return;
    const timer = window.setInterval(() => setPricingClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [targetPricesCooldownUntil]);

  useEffect(() => {
    if (!plannerRetryAt) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setPlannerClock(now);
      if (Date.parse(plannerRetryAt) <= now) {
        setPlannerRetryAt((current) => current === plannerRetryAt ? null : current);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [plannerRetryAt]);

  const visibleManualWarehouses = useMemo(() => manualWarehouses.filter((warehouse) => !warehouse.isHidden), [manualWarehouses]);
  const plannerWarehouses = useMemo(
    () => mergePlannerWarehouseMetadata(plannerSnapshot?.warehouses ?? [], manualWarehouses),
    [manualWarehouses, plannerSnapshot?.warehouses],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleManualWarehouses.map((warehouse) => warehouse.id));
    if (stockFfWarehouseId !== "all" && !visibleIds.has(stockFfWarehouseId)) setStockFfWarehouseId("all");
    setStockFfCompareIds((current) => current.filter((id) => visibleIds.has(id)).slice(0, 3));
  }, [stockFfWarehouseId, visibleManualWarehouses]);

  const stockFfColumns = useMemo<StockFfColumn[]>(() => {
    const compared = stockFfCompareIds.flatMap((id) => {
      const warehouse = visibleManualWarehouses.find((item) => item.id === id);
      return warehouse ? [{ id: warehouse.id, city: warehouse.city, name: warehouse.name, warehouse }] : [];
    });
    if (compared.length) return compared;
    const selectedWarehouse = visibleManualWarehouses.find((item) => item.id === stockFfWarehouseId);
    if (selectedWarehouse) return [{ id: selectedWarehouse.id, city: selectedWarehouse.city, name: selectedWarehouse.name, warehouse: selectedWarehouse }];
    return [{ id: "all", city: "Все ФФ", name: `${visibleManualWarehouses.length} складов`, warehouse: null }];
  }, [stockFfCompareIds, stockFfWarehouseId, visibleManualWarehouses]);

  const stockFfScopeIds = useMemo(() => stockFfCompareIds.length
    ? stockFfCompareIds
    : stockFfWarehouseId === "all" ? [] : [stockFfWarehouseId], [stockFfCompareIds, stockFfWarehouseId]);
  const stockScopedRows = useMemo(() => stockFfScopeIds.length
    ? rows.filter((row) => stockFfScopeIds.some((warehouseId) => hasFfWarehouseActivity(row, warehouseId)))
    : rows, [rows, stockFfScopeIds]);

  useEffect(() => {
    const visibleIds = plannerWarehouses.filter((warehouse) => !warehouse.isHidden).map((warehouse) => warehouse.id);
    const timer = window.setTimeout(() => setPlannerSelectedWarehouseIds((current) => {
        const valid = current.filter((id) => visibleIds.includes(id));
        return valid.length ? valid : visibleIds;
      }), 0);
    return () => window.clearTimeout(timer);
  }, [plannerWarehouses]);

  const selectedImportWarehouseId = manualWarehouses.some((item) => item.id === importWarehouseId)
    ? importWarehouseId
    : manualWarehouses[0]?.id ?? "";

  const activeFbsByLocation = useMemo(() => rows.reduce<FbsBreakdown>((total, row) => {
    for (const source of [row.fbsByLocation, row.receivingByLocation]) {
      for (const [warehouseId, quantity] of Object.entries(source)) total[warehouseId] = (total[warehouseId] ?? 0) + quantity;
    }
    return total;
  }, {}), [rows]);
  const activeFbsTotal = useMemo(() => rows.reduce((sum, row) => sum + activeFbsQuantity(row), 0), [rows]);

  const fbsLocations = useMemo(() => {
    const locations = visibleManualWarehouses.map((warehouse) => ({
      id: warehouse.id,
      city: warehouse.city,
      label: warehouse.wbWarehouseId
        ? warehouse.wbWarehouseName || `${marketplaceCode} FBS №${warehouse.wbWarehouseId}`
        : `${marketplaceCode} FBS не назначен`,
    }));
    if ((activeFbsByLocation.unassigned ?? 0) > 0) locations.push({ id: "unassigned", city: "Не назначено", label: "Выберите склад ФФ" });
    return locations;
  }, [activeFbsByLocation.unassigned, marketplaceCode, visibleManualWarehouses]);
  const activeFbsLocationSummary = useMemo(
    () => summarizeActiveFbsLocations(fbsLocations, activeFbsByLocation, 2),
    [activeFbsByLocation, fbsLocations],
  );

  const ffReservedFromStockTotal = useMemo(() => visibleManualWarehouses.reduce((sum, warehouse) => (
    sum + (totals.fbsByLocation[warehouse.id] ?? 0)
  ), 0), [visibleManualWarehouses, totals.fbsByLocation]);
  const ffPhysicalTotal = totals.ffTotal;
  const ffAvailableTotal = Math.max(0, ffPhysicalTotal - ffReservedFromStockTotal);

  const fulfillmentWarehouses = useMemo(() => visibleManualWarehouses.map((warehouse) => {
    const products = rows.filter((row) => (row.ffStock[warehouse.id] ?? 0) > 0 || (row.fbsByLocation[warehouse.id] ?? 0) > 0 || (row.receivingByLocation[warehouse.id] ?? 0) > 0 || (row.toSaleByLocation[warehouse.id] ?? 0) > 0);
    const physicalStock = totals.ffStock[warehouse.id] ?? 0;
    const fbs = totals.fbsByLocation[warehouse.id] ?? 0;
    return {
      warehouse,
      products: products.length,
      physicalStock,
      stock: Math.max(0, physicalStock - fbs),
      fbs,
      receiving: products.reduce((sum, row) => sum + (row.receivingByLocation[warehouse.id] ?? 0), 0),
      toSale: products.reduce((sum, row) => sum + (row.toSaleByLocation[warehouse.id] ?? 0), 0),
    };
  }), [visibleManualWarehouses, rows, totals.ffStock, totals.fbsByLocation]);

  const selectedFulfillmentWarehouse = fulfillmentWarehouses.find((item) => item.warehouse.id === selectedFulfillmentWarehouseId) ?? null;
  const selectedHandoverTiming = selectedFulfillmentWarehouse
    ? handoverTiming.byLocation[selectedFulfillmentWarehouse.warehouse.id] ?? { sampleSize: 0, averageHours: null }
    : null;

  const fulfillmentRows = useMemo(() => {
    if (!selectedFulfillmentWarehouse) return [];
    const warehouseId = selectedFulfillmentWarehouse.warehouse.id;
    const term = query.trim().toLowerCase();
    const selectedQuantity = (row: StockRow) => {
      if (fulfillmentList === "physical") return physicalFfStock(row, warehouseId);
      if (fulfillmentList === "reserved") return row.fbsByLocation[warehouseId] ?? 0;
      if (fulfillmentList === "receiving") return row.receivingByLocation[warehouseId] ?? 0;
      if (fulfillmentList === "toSale") return row.toSaleByLocation[warehouseId] ?? 0;
      return availableFfStock(row, warehouseId);
    };
    return rows.filter((row) => {
      const matchesWarehouse = (row.ffStock[warehouseId] ?? 0) > 0 || (row.fbsByLocation[warehouseId] ?? 0) > 0 || (row.receivingByLocation[warehouseId] ?? 0) > 0 || (row.toSaleByLocation[warehouseId] ?? 0) > 0;
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      return matchesWarehouse && selectedQuantity(row) > 0 && matchesQuery;
    }).sort((left, right) => selectedQuantity(right) - selectedQuantity(left) || left.name.localeCompare(right.name, "ru"));
  }, [selectedFulfillmentWarehouse, rows, query, fulfillmentList]);

  const fulfillmentListMeta: Record<FulfillmentList, { kicker: string; title: string; empty: string; primary: string; footer: string }> = {
    physical: { kicker: "ФАКТИЧЕСКИ НА ФФ", title: "Фактический остаток по артикулам", empty: "На этом ФФ нет физического остатка", primary: "Фактически ФФ", footer: `Включает новые FBS: эти заказы ещё физически лежат на ФФ до передачи ${marketplaceName}.` },
    available: { kicker: "ОСТАТКИ НА ФФ", title: "Доступный остаток по артикулам", empty: "На этом ФФ нет доступного остатка", primary: "Доступно ФФ", footer: "Из остатка вычтены только новые и собираемые заказы FBS" },
    reserved: { kicker: "НОВЫЕ FBS", title: "Новые заказы FBS", empty: "Нет новых заказов FBS", primary: "Новые FBS", footer: "Статусы new / confirm: заказ ещё на ФФ и вычтен из доступного остатка" },
    receiving: { kicker: `В ДОСТАВКЕ ${marketplaceCode}`, title: `Заказы, переданные ${marketplaceName}`, empty: `Нет заказов, переданных ${marketplaceName}`, primary: `Переданы ${marketplaceCode}`, footer: `ФФ передал заказ ${marketplaceName}. Это одна оплачиваемая обработка, без повторного учёта после завершения.` },
    toSale: { kicker: "ПРОДАНО", title: "Фактически выкупленные товары", empty: "Нет выкупленных товаров", primary: "Продано", footer: "Заказы завершены без отмен" },
  };
  const activeFulfillmentListMeta = fulfillmentListMeta[fulfillmentList];

  const pricingRecommendations = useMemo(() => targetPriceRows.map(buildPriceRecommendation), [targetPriceRows]);
  const pricingCounts = useMemo(() => pricingRecommendations.reduce<Record<PricingFilter, number>>((counts, item) => {
    counts.all += 1;
    counts[item.action] += 1;
    return counts;
  }, { all: 0, lower: 0, raise: 0, review: 0, hold: 0 }), [pricingRecommendations]);
  const pricingRows = useMemo(() => {
    const term = pricingQuery.trim().toLocaleLowerCase("ru-RU");
    const rowsForView = pricingRecommendations.filter((item) => {
      const matchesFilter = pricingFilter === "all" || item.action === pricingFilter;
      const haystack = `${item.row.sku} ${item.row.searchQuery ?? ""} ${item.row.nmId ?? ""}`.toLocaleLowerCase("ru-RU");
      return matchesFilter && (!term || haystack.includes(term));
    });
    return rowsForView.sort((left, right) => {
      if (pricingSort === "orders") return right.row.orders - left.row.orders || right.priority - left.priority;
      if (pricingSort === "delta") return Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0) || right.priority - left.priority;
      return right.priority - left.priority || right.row.orders - left.row.orders;
    });
  }, [pricingFilter, pricingQuery, pricingRecommendations, pricingSort]);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return stockScopedRows.filter((row) => {
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      const matchesFilter = filter === "Все" || (filter === "Дефицит" && row.status !== "В норме") || (filter === "Активные FBS" && hasActiveFbsMovement(row));
      const matchesWarehouse = warehouse === "Все склады" || (row.warehouses[warehouse] ?? 0) > 0;
      const matchesView = activeView === "fbs" ? hasFbsMovement(row) : true;
      return matchesQuery && matchesFilter && matchesWarehouse && matchesView;
    });
  }, [stockScopedRows, query, filter, warehouse, activeView]);

  const counts = useMemo(() => ({
    all: stockScopedRows.length,
    risk: stockScopedRows.filter((row) => row.status !== "В норме").length,
    transit: stockScopedRows.filter(hasActiveFbsMovement).length,
  }), [stockScopedRows]);
  const viewTotal = activeView === "fbs" ? stockScopedRows.filter(hasFbsMovement).length : stockScopedRows.length;
  const stockTitle = activeView === "fbs" ? "Артикулы в FBS-движении" : `Все товары ${marketplaceName}`;
  const currentViewTitle = useMemo(() => {
    const base = viewTitles[activeView];
    if (!isOzon && !isYandex) return base;
    return {
      eyebrow: base.eyebrow.replace("WILDBERRIES", isOzon ? "OZON" : "ЯНДЕКС МАРКЕТ").replace("РЫНОК WB", isOzon ? "РЫНОК OZON" : "РЫНОК ЯНДЕКС МАРКЕТА"),
      title: base.title.replace("FBS и FBO", isOzon ? "FBS и FBO Ozon" : "FBS и FBY Яндекс Маркета"),
    };
  }, [activeView, isOzon, isYandex]);
  const analyticsFactAvailable = Boolean(analytics?.source.factAvailable);
  const analyticsTrendChannel: AnalyticsChannel = analyticsChannel;
  const analyticsTrend = useMemo(() => {
    const daily = analytics?.daily ?? [];
    const channels: Array<"fbs" | "fbo"> = analyticsTrendChannel === "all" ? ["fbs", "fbo"] : [analyticsTrendChannel];
    const max = Math.max(1, ...daily.flatMap((point) => channels.map((channel) => point[channel])));
    const width = 1000;
    const height = 250;
    const left = 18;
    const right = 18;
    const top = 17;
    const bottom = 36;
    const plotHeight = height - top - bottom;
    const pointX = (index: number) => daily.length < 2 ? width / 2 : left + (index / (daily.length - 1)) * (width - left - right);
    const valueY = (value: number) => top + (1 - value / max) * plotHeight;
    const points = daily.map((point, index) => ({ ...point, x: pointX(index), fbsY: valueY(point.fbs), fboY: valueY(point.fbo) }));
    const path = (channel: "fbs" | "fbo") => points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${channel === "fbs" ? point.fbsY.toFixed(2) : point.fboY.toFixed(2)}`).join(" ");
    const labelEvery = daily.length > 30 ? 7 : daily.length > 14 ? 4 : 1;
    return { max, width, height, top, bottom, plotHeight, points, fbsPath: path("fbs"), fboPath: path("fbo"), labelEvery };
  }, [analytics, analyticsTrendChannel]);
  const activeAnalyticsPoint = useMemo(() => analyticsHoverDate ? analytics?.daily.find((point) => point.date === analyticsHoverDate) ?? null : null, [analytics, analyticsHoverDate]);
  const activeAnalyticsTrendPoint = useMemo(() => analyticsHoverDate ? analyticsTrend.points.find((point) => point.date === analyticsHoverDate) ?? null : null, [analyticsHoverDate, analyticsTrend.points]);
  const analyticsChannelTitle = analyticsTrendChannel === "all" ? `FBS и ${marketplaceFboLabel}` : analyticsTrendChannel === "fbo" ? marketplaceFboLabel : "FBS";
  const analyticsTrendTitle = analyticsFactAvailable ? `${analyticsChannelTitle} по дням` : "Факт продаж временно недоступен";
  const strongestFbsWarehouse = useMemo(() => analytics?.fbsWarehouses.find((warehouse) => warehouse.value > 0) ?? null, [analytics]);

  const chooseAnalyticsPeriod = (period: "7d" | "14d" | "30d" | "custom") => {
    setAnalyticsPeriod(period);
    setAnalyticsHoverDate(null);
    if (period === "custom") return;
    const days = period === "7d" ? 7 : period === "14d" ? 14 : 30;
    const range = { from: isoDate(days - 1), to: isoDate(0) };
    setAnalyticsDraft(range);
    setAnalyticsRange(range);
  };

  const applyAnalyticsCustomPeriod = () => {
    if (!analyticsDraft.from || !analyticsDraft.to || analyticsDraft.from > analyticsDraft.to) {
      setAnalyticsError("Проверьте даты периода");
      return;
    }
    setAnalyticsHoverDate(null);
    setAnalyticsRange(analyticsDraft);
  };

  const navigateTo = (view: View) => {
    setActiveView(view);
    setFilter("Все");
    setQuery("");
    setSelected(null);
    setSelectedFulfillmentWarehouseId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openFulfillmentWarehouse = (warehouseId: string) => {
    setSelectedFulfillmentWarehouseId(warehouseId);
    setFulfillmentList("available");
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPlannerForWarehouse = (warehouseId: string) => {
    setPlannerSelectedWarehouseIds([warehouseId]);
    navigateTo("sales");
  };

  const openProduct = (row: StockRow) => {
    setSelected(row);
  };

  const addWarehouse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWarehouseSaving(true);
    setWarehouseMessage(null);
    setWarehouseError(null);
    try {
      const response = await fetch("/api/ff-warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: newWarehouseCity, name: newWarehouseName }),
      });
      const data = await response.json() as { warehouse?: ManualWarehouse; error?: string };
      if (!response.ok || !data.warehouse) throw new Error(data.error || "Не удалось добавить склад");
      setManualWarehouses((current) => [...current, data.warehouse as ManualWarehouse]);
      setImportWarehouseId(data.warehouse.id);
      setNewWarehouseCity("");
      setNewWarehouseName("");
      setWarehouseMessage(`${formatManualWarehouse(data.warehouse)} добавлен`);
    } catch (addError) {
      setWarehouseError(addError instanceof Error ? addError.message : "Не удалось добавить склад");
    } finally {
      setWarehouseSaving(false);
    }
  };

  const saveWarehouseLink = async (warehouseToUpdate: ManualWarehouse, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = warehouseLinkDrafts[warehouseToUpdate.id] ?? {
      wbWarehouseId: warehouseToUpdate.wbWarehouseId ? String(warehouseToUpdate.wbWarehouseId) : "",
      wbWarehouseName: warehouseToUpdate.wbWarehouseName ?? "",
      serviceRate: rateDraft(warehouseToUpdate.serviceRateKopecks),
      openedAt: warehouseToUpdate.openedAt ?? "",
      planningTargetDays: String(warehouseToUpdate.planningTargetDays || 14),
    };
    const rawWbWarehouseId = draft.wbWarehouseId.trim();
    const wbWarehouseId = rawWbWarehouseId ? Number(rawWbWarehouseId) : null;
    if (rawWbWarehouseId && (!Number.isInteger(wbWarehouseId) || wbWarehouseId <= 0 || wbWarehouseId > 2_147_483_647)) {
      setWarehouseError(`${marketplaceWarehouseIdLabel} должен быть положительным целым числом`);
      return;
    }
    const serviceRateKopecks = parseRateKopecks(draft.serviceRate);
    if (serviceRateKopecks === null) {
      setWarehouseError("Ставка должна быть числом от 0 до 100 000 ₽ за единицу");
      return;
    }
    if (!Number.isInteger(Number(draft.planningTargetDays)) || Number(draft.planningTargetDays) < 1 || Number(draft.planningTargetDays) > 365) {
      setWarehouseError("Целевой запас должен быть от 1 до 365 дней");
      return;
    }
    setWarehouseLinkSavingId(warehouseToUpdate.id);
    setWarehouseMessage(null);
    setWarehouseError(null);
    try {
      const response = await fetch("/api/ff-warehouses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: warehouseToUpdate.id,
          city: warehouseToUpdate.city,
          name: warehouseToUpdate.name,
          position: warehouseToUpdate.position,
          wbWarehouseId,
          wbWarehouseName: draft.wbWarehouseName.trim() || null,
          serviceRateKopecks,
          isHidden: warehouseToUpdate.isHidden,
          openedAt: draft.openedAt || null,
          planningTargetDays: Number(draft.planningTargetDays),
        }),
      });
      const data = await response.json() as { warehouse?: ManualWarehouse; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.warehouse) throw new Error(data.error || "Не удалось сохранить привязку к WB");
      setManualWarehouses((current) => current.map((item) => item.id === warehouseToUpdate.id ? data.warehouse as ManualWarehouse : item));
      setWarehouseLinkDrafts((current) => ({
        ...current,
        [warehouseToUpdate.id]: {
          wbWarehouseId: data.warehouse?.wbWarehouseId ? String(data.warehouse.wbWarehouseId) : "",
          wbWarehouseName: data.warehouse?.wbWarehouseName ?? "",
          serviceRate: rateDraft(data.warehouse?.serviceRateKopecks ?? 0),
          openedAt: data.warehouse?.openedAt ?? "",
          planningTargetDays: String(data.warehouse?.planningTargetDays ?? 14),
        },
      }));
      setWarehouseMessage(`Настройки ${formatManualWarehouse(warehouseToUpdate)} сохранены`);
      await loadData();
    } catch (saveError) {
      setWarehouseError(saveError instanceof Error ? saveError.message : "Не удалось сохранить привязку к WB");
    } finally {
      setWarehouseLinkSavingId(null);
    }
  };

  const savePlannerWarehouseOpenedAt = async (warehouseToUpdate: ManualWarehouse, openedAt: string) => {
    setWarehouseLinkSavingId(warehouseToUpdate.id);
    setPlannerWarehouseSettingsError(null);
    try {
      const response = await fetch("/api/ff-warehouses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: warehouseToUpdate.id,
          city: warehouseToUpdate.city,
          name: warehouseToUpdate.name,
          position: warehouseToUpdate.position,
          wbWarehouseId: warehouseToUpdate.wbWarehouseId,
          wbWarehouseName: warehouseToUpdate.wbWarehouseName,
          serviceRateKopecks: warehouseToUpdate.serviceRateKopecks,
          isHidden: warehouseToUpdate.isHidden,
          openedAt: openedAt || null,
          planningTargetDays: warehouseToUpdate.planningTargetDays,
        }),
      });
      const data = await response.json() as { warehouse?: ManualWarehouse; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.warehouse) throw new Error(data.error || "Не удалось сохранить дату открытия ФФ");
      const savedWarehouse = data.warehouse;
      setManualWarehouses((current) => current.map((item) => item.id === savedWarehouse.id ? savedWarehouse : item));
      setWarehouseLinkDrafts((current) => {
        const draft = current[savedWarehouse.id];
        return draft ? { ...current, [savedWarehouse.id]: { ...draft, openedAt: savedWarehouse.openedAt ?? "" } } : current;
      });
    } catch (saveError) {
      setPlannerWarehouseSettingsError(saveError instanceof Error ? saveError.message : "Не удалось сохранить дату открытия ФФ");
    } finally {
      setWarehouseLinkSavingId(null);
    }
  };

  const toggleWarehouseVisibility = async (warehouseToUpdate: ManualWarehouse) => {
    setWarehouseLinkSavingId(warehouseToUpdate.id);
    setWarehouseMessage(null);
    setWarehouseError(null);
    try {
      const response = await fetch("/api/ff-warehouses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: warehouseToUpdate.id,
          city: warehouseToUpdate.city,
          name: warehouseToUpdate.name,
          position: warehouseToUpdate.position,
          wbWarehouseId: warehouseToUpdate.wbWarehouseId,
          wbWarehouseName: warehouseToUpdate.wbWarehouseName,
          serviceRateKopecks: warehouseToUpdate.serviceRateKopecks,
          isHidden: !warehouseToUpdate.isHidden,
          openedAt: warehouseToUpdate.openedAt,
          planningTargetDays: warehouseToUpdate.planningTargetDays,
        }),
      });
      const data = await response.json() as { warehouse?: ManualWarehouse; error?: string };
      if (!response.ok || !data.warehouse) throw new Error(data.error || "Не удалось изменить видимость склада");
      setManualWarehouses((current) => current.map((item) => item.id === warehouseToUpdate.id ? data.warehouse as ManualWarehouse : item));
      setWarehouseMessage(data.warehouse.isHidden ? `${formatManualWarehouse(data.warehouse)} скрыт из витрины` : `${formatManualWarehouse(data.warehouse)} снова показан`);
      await loadData();
    } catch (saveError) {
      setWarehouseError(saveError instanceof Error ? saveError.message : "Не удалось изменить видимость склада");
    } finally {
      setWarehouseLinkSavingId(null);
    }
  };

  const chooseImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setImportMessage(null);
    setImportError(null);
    setImportPreview(null);
    if (!file) return;
    try {
      setImportPreview(await parseExcelFile(file));
    } catch (parseError) {
      setImportError(parseError instanceof Error ? parseError.message : "Не удалось прочитать Excel-файл");
    }
  };

  const importExcel = async () => {
    if (!importPreview || !selectedImportWarehouseId) return;
    setImportLoading(true);
    setImportMessage(null);
    setImportError(null);
    try {
      const response = await fetch("/api/ff-stock/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: selectedImportWarehouseId, mode: importMode, items: importPreview.items }),
      });
      const data = await response.json() as { imported?: number; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить остатки");
      await loadData();
      setImportMessage(`Готово: ${data.imported ?? importPreview.items.length} партий обновлено`);
    } catch (uploadError) {
      setImportError(uploadError instanceof Error ? uploadError.message : "Не удалось загрузить остатки");
    } finally {
      setImportLoading(false);
    }
  };

  const submitAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: adminLogin, password: adminPassword }),
      });
      const data = await response.json() as { authenticated?: boolean; role?: UserRole; cabinet?: CabinetSummary; cabinets?: CabinetSummary[]; error?: string };
      if (!response.ok || !data.authenticated) throw new Error(data.error || "Не удалось выполнить вход");
      setAdminPassword("");
      setRole(data.role ?? null);
      setCabinet(data.cabinet ?? null);
      setAvailableCabinets(data.cabinets ?? []);
      setAuthState("authenticated");
    } catch (authError) {
      setLoginError(authError instanceof Error ? authError.message : "Не удалось выполнить вход");
    } finally {
      setLoginLoading(false);
    }
  };

  const logoutAdmin = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    plannerRequestVersionRef.current += 1;
    setRows([]);
    setPlannerSnapshot(null);
    setPlannerSelectedWarehouseIds([]);
    setSelected(null);
    setCabinet(null);
    setAvailableCabinets([]);
    setRole(null);
    setAuthState("unauthenticated");
  };

  const switchCabinet = async (cabinetId: CabinetSummary["id"]) => {
    if (cabinetId === cabinet?.id) return;
    setCabinetSwitchingId(cabinetId);
    setCabinetSwitchError(null);
    try {
      const response = await fetch("/api/auth/switch-cabinet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId }),
      });
      const data = await response.json() as { authenticated?: boolean; role?: UserRole; cabinet?: CabinetSummary; cabinets?: CabinetSummary[]; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.cabinet) throw new Error(data.error || "Не удалось открыть кампанию");
      setRole(data.role ?? null);
      setCabinet(data.cabinet);
      setAvailableCabinets(data.cabinets ?? []);
      setRows([]);
      setWarehouseNames([]);
      setTotals(emptyTotals);
      setManualWarehouses(defaultManualWarehouses);
      plannerRequestVersionRef.current += 1;
      setPlannerSnapshot(null);
      setPlannerSelectedWarehouseIds([]);
      setPlannerRetryAt(null);
      setPlannerError(null);
      setSelected(null);
      setSelectedFulfillmentWarehouseId(null);
      setQuery("");
      setFilter("Все");
      setActiveView("overview");
      await Promise.all([loadData(false, data.cabinet.marketplace), loadManualWarehouses()]);
    } catch (switchError) {
      setCabinetSwitchError(switchError instanceof Error ? switchError.message : "Не удалось открыть кампанию");
    } finally {
      setCabinetSwitchingId(null);
    }
  };

  const downloadCsv = (sourceRows: StockRow[], suffix: string) => {
    const header = ["Артикул продавца", `ID товара ${marketplaceName}`, ...warehouseNames, `Всего на ${marketplaceName}`, ...visibleManualWarehouses.flatMap((item) => [`ФФ ${formatManualWarehouse(item)}`, `Срок годности · ${formatManualWarehouse(item)}`]), "Новые FBS", ...fbsLocations.map((location) => `Новые FBS ${location.city}`), `Переданы ${marketplaceCode}`, "Продано", "Статус"];
    const body = sourceRows.map((row) => [row.sku, row.nmId ?? "", ...warehouseNames.map((name) => row.warehouses[name] ?? 0), stockTotal(row), ...visibleManualWarehouses.flatMap((item) => [row.ffStock[item.id] ?? 0, row.ffExpiry?.[item.id] ?? ""]), row.fbs, ...fbsLocations.map((location) => row.fbsByLocation[location.id] ?? 0), row.receiving, row.toSale, row.status]);
    const content = [header, ...body].map((line) => line.map((cell) => String(cell).replaceAll(";", ",")).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadFfOrders = async (warehouse: ManualWarehouse) => {
    setFfOrdersExportMessage(null);
    setFfOrdersExportError(null);
    if (!warehouse.wbWarehouseId) {
      setFfOrdersExportError(`Сначала привяжите этот ФФ к ${isYandex ? "кампании FBS Яндекс Маркета" : `складу ${marketplaceName}`} — укажите ID в настройках.`);
      return;
    }
    setFfOrdersExportLoading(true);
    try {
      const response = await fetch(`/api/ff-orders?warehouseId=${encodeURIComponent(warehouse.id)}`, { cache: "no-store" });
      const data = await response.json() as FfOrdersExportResponse;
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok) throw new Error(data.error || `Не удалось получить FBS-заказы из ${marketplaceName}`);
      const orders = data.orders ?? [];
      if (!orders.length) {
        setFfOrdersExportMessage("Для этого ФФ нет актуальных FBS-заказов на сборке или в доставке.");
        return;
      }
      downloadFfOrdersWorkbook(warehouse, orders, marketplaceName);
      setFfOrdersExportMessage(data.missingStickers ? `Скачано ${orders.length} заказов. Для ${data.missingStickers} ${marketplaceName} пока не вернул стикер.` : `Скачано ${orders.length} актуальных FBS-заказов со стикерами ${marketplaceName}.`);
    } catch (downloadError) {
      setFfOrdersExportError(downloadError instanceof Error ? downloadError.message : "Не удалось подготовить Excel");
    } finally {
      setFfOrdersExportLoading(false);
    }
  };

  const plannerViewActive = activeView === "sales" && ffPlanningSupported(cabinet?.marketplace);

  if (authState === "checking") {
    return <main className="admin-login-shell"><section className="admin-login-card checking"><span className="login-brand-mark">С</span><div className="loader"/><strong>Проверяем доступ</strong></section></main>;
  }

  if (authState === "unauthenticated") {
    return <main className="admin-login-shell"><section className="admin-login-card"><div className="login-brand"><span className="login-brand-mark">С</span><span>СКЛАДНО</span></div><span className="login-kicker">АДМИНИСТРАТИВНАЯ ПАНЕЛЬ</span><h1>Вход в остатки и FBS</h1><p>Данные Wildberries и ручные остатки ФФ доступны только администратору.</p><form className="admin-login-form" onSubmit={submitAdminLogin}><label><span>Логин</span><input value={adminLogin} onChange={(event) => setAdminLogin(event.target.value)} autoComplete="username" autoFocus required /></label><label><span>Пароль</span><input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" required /></label>{loginError && <div className="login-error" role="alert">{loginError}</div>}<button type="submit" disabled={loginLoading}>{loginLoading ? "Входим…" : "Войти в админку"}</button></form><small className="login-security-note">Защищённый вход · данные API не передаются в браузер</small></section></main>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">С</span><span>СКЛАДНО</span></div>
        <nav className="nav-list" aria-label="Основная навигация">
          <button type="button" className={`nav-item ${activeView === "overview" ? "active" : ""}`} onClick={() => navigateTo("overview")}><span className="nav-symbol">▦</span>Обзор</button>
          <button type="button" className={`nav-item ${activeView === "stock" ? "active" : ""}`} onClick={() => navigateTo("stock")}><span className="nav-symbol">□</span>Остатки</button>
          <button type="button" className={`nav-item ${activeView === "fbs" ? "active" : ""}`} onClick={() => navigateTo("fbs")}><span className="nav-symbol">→</span>FBS-отгрузки<span className="nav-badge">{activeFbsTotal}</span></button>
          <button type="button" className={`nav-item ${activeView === "sales" ? "active" : ""}`} onClick={() => navigateTo("sales")}><span className="nav-symbol">↗</span>План поставок</button>
          <button type="button" className={`nav-item ${activeView === "analytics" ? "active" : ""}`} onClick={() => navigateTo("analytics")}><span className="nav-symbol">⌁</span>Анализ</button>
          <button type="button" className={`nav-item ${activeView === "rnp" ? "active" : ""}`} onClick={() => navigateTo("rnp")}><span className="nav-symbol">◎</span>РНП Ozon</button>
          <button type="button" className={`nav-item ${activeView === "pricing" ? "active" : ""}`} onClick={() => navigateTo("pricing")}><span className="nav-symbol">₽</span>Таргет цен</button>
          <button type="button" className={`nav-item ${activeView === "fulfillment" || activeView === "manual" ? "active" : ""}`} onClick={() => navigateTo("fulfillment")}><span className="nav-symbol">▤</span>ФФ</button>
          <button type="button" className={`nav-item ${activeView === "payments" ? "active" : ""}`} onClick={() => navigateTo("payments")}><span className="nav-symbol">₽</span>Оплаты ФФ</button>
          <button type="button" className={`nav-item ${activeView === "reports" ? "active" : ""}`} onClick={() => navigateTo("reports")}><span className="nav-symbol">≡</span>Отчёты</button>
        </nav>
        <div className="sidebar-bottom"><div className="connection"><span className={error ? "live-dot offline" : "live-dot"} />{error ? "Нужна проверка подключения" : `Подключено к API ${marketplaceName}`}</div><button type="button" className="profile" onClick={() => navigateTo("cabinets")}><span className="avatar">{marketplaceCode}</span><span><strong>{cabinet?.name ?? marketplaceName}</strong><small>{role === "viewer" ? "Гость · просмотр и обновление" : configured ? "Владелец · кабинеты и ключи" : "Владелец · ключ не добавлен"}</small></span><span className="chevron">›</span></button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{currentViewTitle.eyebrow}</p><h1>{currentViewTitle.title}</h1></div><div className="header-actions"><span className="refresh-guidance">Можно обновить вручную · рекомендуем раз в 2 мин</span><div className="sync-state"><span className={error ? "live-dot offline" : "live-dot"} /><span>Последнее обновление<br/><strong>{formatSyncTime(updatedAt)} МСК</strong></span></div><button className="logout-btn" type="button" onClick={() => void logoutAdmin()}>Выйти</button><button className="secondary-btn" type="button" onClick={() => void (plannerViewActive ? refreshFfPlanning() : loadData(true))} disabled={loading || Boolean(inventoryRetrySeconds) || (plannerViewActive && (plannerLoading || plannerRefreshing || Boolean(plannerRetrySeconds)))} title={inventoryRetrySeconds ? `Общий запрос к ${marketplaceName} уже выполняется` : plannerViewActive && plannerRetrySeconds ? "Обновление плана временно ограничено" : loading || (plannerViewActive && (plannerLoading || plannerRefreshing)) ? "Обновление займёт не больше 25 секунд" : "Можно обновить вручную в любой момент. Рекомендованный интервал — 2 минуты."}><span className={loading || (plannerViewActive && (plannerLoading || plannerRefreshing)) ? "spin" : ""}>↻</span>{loading || (plannerViewActive && (plannerLoading || plannerRefreshing)) ? "Обновляем…" : inventoryRetrySeconds ? `Через ${formatCountdown(inventoryRetrySeconds)}` : plannerViewActive && plannerRetrySeconds ? `Через ${formatCountdown(plannerRetrySeconds)}` : "Обновить"}</button><button className="primary-btn" type="button" onClick={() => downloadCsv(filteredRows, `ostatki-${isOzon ? "ozon" : isYandex ? "yandex" : "wb"}`)} disabled={!rows.length}>Экспорт<span>↓</span></button></div></header>

        <div className="content" id="overview">
          {cabinet && <section className={`cabinet-strip ${cabinet.configured ? "ready" : "waiting"}`}>
            <div><span className="cabinet-strip-mark">{marketplaceCode}</span><span><small>ТЕКУЩАЯ КАМПАНИЯ</small><strong>{cabinet.name}</strong></span></div>
            <p>{cabinet.configured ? "Свои товары, ФФ-склады и сроки годности. Переключение кабинетов не требует нового входа." : `Ожидает ключ API ${marketplaceName}. Вход и отдельные склады уже готовы.`}</p>
            <button type="button" onClick={() => navigateTo("cabinets")}>Сменить кампанию</button>
          </section>}
          {error && <section className="api-notice" role="alert"><span className="api-notice-icon">!</span><div><strong>{error}</strong><p>{configured ? isOzon ? "Проверьте права ключа Ozon на товары, остатки и FBS-заказы." : isYandex ? "Проверьте права ключа Яндекс Маркета на товары, остатки и FBS-заказы." : "Для полной загрузки токену нужны категории: Контент, Маркетплейс и Аналитика." : "Безопасный ключ хранится только на сервере и не передаётся в браузер."}</p></div><button type="button" onClick={() => void loadData(true)}>Проверить снова</button></section>}
          {!error && warnings.length > 0 && <section className="warning-strip"><span>!</span><p>{warnings.join(" · ")}</p></section>}
          {inventoryRetrySeconds !== null && inventoryRetrySeconds > 0 && <section className="inventory-retry-timer" role="status"><span>↻</span><div><strong>Текущий запрос к {marketplaceName} ещё выполняется: {formatCountdown(inventoryRetrySeconds)}</strong><p>После завершения можно обновить снова. Рекомендованный интервал — раз в 2 минуты.</p></div></section>}

          {activeView === "cabinets" ? (
            <section className="cabinet-manager">
              <div className="section-heading cabinet-manager-heading">
                <div><span className="section-kicker">МАРКЕТПЛЕЙС → КАМПАНИЯ → СВОИ ФФ</span><h2>Один вход — все ваши кампании</h2><p className="section-note">Внутри одного доступа выберите нужную кампанию. У каждой свои товары, ФФ-склады, остатки, заказы, поставки и продажи — данные не смешиваются.</p></div>
                <button className="secondary-btn cabinet-back-btn" type="button" onClick={() => navigateTo("overview")}>К обзору</button>
              </div>
              <div className="cabinet-platform-list">
                <article className="cabinet-platform-card wb-platform">
                  <div className="cabinet-platform-head"><span className="platform-mark wb-mark">WB</span><div><strong>Wildberries</strong><small>{wbCabinets.length} кампании этого доступа</small></div></div>
                  <div className="cabinet-account-list">
                    {wbCabinets.map((account) => {
                      const current = cabinet?.id === account.id;
                      return <div className={`cabinet-account ${current ? "current" : ""}`} key={account.id}><span><strong>{account.name}</strong><small>Свои ФФ и остатки</small></span>{current ? <b>Открыта</b> : <button type="button" onClick={() => void switchCabinet(account.id)} disabled={cabinetSwitchingId === account.id}>{cabinetSwitchingId === account.id ? "Открываем…" : "Открыть"}</button>}</div>;
                    })}
                  </div>
                  {cabinetSwitchError && <p className="cabinet-switch-error">{cabinetSwitchError}</p>}
                  {!cabinetSwitchError && <p>Выберите кампанию — повторный логин не нужен.</p>}
                </article>
                <MarketplaceConnectionCard platform="yandex" mark="ЯМ" title="Яндекс Маркет" connection={marketplaceConnections.find((item) => item.platform === "yandex")} onCheck={() => void loadMarketplaceConnections()} onDisable={disableMarketplaceConnection} canManage={canManage} checking={marketplaceConnectionsLoading} onOpen={() => void switchCabinet("yandex")} opening={cabinetSwitchingId === "yandex"} />
                <MarketplaceConnectionCard platform="ozon" mark="OZ" title="Ozon Seller" connection={marketplaceConnections.find((item) => item.platform === "ozon")} onCheck={() => void loadMarketplaceConnections()} onDisable={disableMarketplaceConnection} canManage={canManage} checking={marketplaceConnectionsLoading} onOpen={() => void switchCabinet("ozon")} opening={cabinetSwitchingId === "ozon"} />
              </div>
              <p className="cabinet-manager-note">Каждый маркетплейс получит отдельный контур: свои товары, склады, остатки, заказы и будущие таргет-цены. Данные между площадками не смешиваются.</p>
            </section>
          ) : activeView === "rnp" ? (
            <RnpDashboard />
          ) : activeView === "pricing" ? (
            <section className="pricing-panel">
              <div className="section-heading pricing-heading">
                <div>
                  <span className="section-kicker">МОНИТОРИНГ ЦЕН · {marketplaceName.toUpperCase()}</span>
                  <h2>Рынок, таргет и решение по цене</h2>
                  <p className="section-note">Свои цены берём из кабинета {marketplaceName}; конкуренты — из сохранённого списка. Эта витрина ничего не меняет на маркетплейсе — решение по цене остаётся за тобой.</p>
                </div>
                <button className="secondary-btn pricing-source-link" type="button" onClick={() => void refreshTargetPrices()} disabled={targetPricesRefreshing || Boolean(targetPricesCooldownSeconds)} title={targetPricesCooldownSeconds ? "Обновление цен уже запущено другим пользователем" : "Можно обновить вручную в любой момент. Рекомендованный интервал — 2 минуты."}>{targetPricesRefreshing ? "Обновляем цены…" : targetPricesCooldownSeconds ? `Цены через ${formatCountdown(targetPricesCooldownSeconds)}` : "Обновить цены"}</button>
              </div>

              <div className={`pricing-source-strip ${targetPricesError || targetPricesWarnings.length ? "has-warning" : ""}`}><span>{targetPricesError || targetPricesWarnings.length ? "!" : "✓"}</span><div><strong>{targetPricesError || targetPricesWarnings.length ? "Часть цен пока не обновилась" : isOzon ? "Сохранённый снимок цен Ozon" : isYandex ? "Сохранённый снимок цен Яндекс Маркета" : "Сохранённый снимок цен WB"}</strong><p>{targetPricesError || targetPricesWarnings[0] || (targetPricesUpdatedAt ? `Последнее обновление: ${formatDateTime(targetPricesUpdatedAt)}. Все видят этот снимок; новый запрос только вручную.` : "Пока показана стартовая база; нажмите «Обновить цены», чтобы сохранить актуальные значения для всех.")}{targetPricesCooldownSeconds && targetPricesCooldownSeconds > 0 ? ` Сейчас идёт общий запрос: ещё ${formatCountdown(targetPricesCooldownSeconds)}.` : " Рекомендованный интервал обновления — 2 минуты."}</p></div></div>

              <div className="pricing-kpi-grid">
                <article className="pricing-kpi tracked"><span>Под контролем</span><strong>{pricingCounts.all}</strong><p>карточек {marketplaceName} в мониторинге</p></article>
                <article className="pricing-kpi lower"><span>Снизить цену</span><strong>{pricingCounts.lower}</strong><p>выше целевого коридора</p></article>
                <article className="pricing-kpi raise"><span>Можно поднять</span><strong>{pricingCounts.raise}</strong><p>ниже рынка без причины</p></article>
                <article className="pricing-kpi review"><span>Проверить рынок</span><strong>{pricingCounts.review}</strong><p>нужен конкурент или валидация</p></article>
              </div>

              <div className="pricing-toolbar">
                <label className="search-field"><span>⌕</span><input value={pricingQuery} onChange={(event) => setPricingQuery(event.target.value)} placeholder={`Артикул, запрос или ID ${marketplaceName}`} aria-label="Поиск по таргету цен" /></label>
                <label className="pricing-sort"><span>Сортировка</span><select value={pricingSort} onChange={(event) => setPricingSort(event.target.value as PricingSort)} aria-label="Сортировка рекомендаций"><option value="priority">Сначала важные</option><option value="orders">По заказам</option><option value="delta">По изменению цены</option></select></label>
              </div>
              <div className="pricing-filter-row" role="tablist" aria-label="Фильтр рекомендаций">{([
                ["all", "Все"],
                ["lower", "Снизить"],
                ["raise", "Поднять"],
                ["review", "Проверить"],
                ["hold", "Оставить"],
              ] as Array<[PricingFilter, string]>).map(([value, label]) => <button type="button" key={value} className={pricingFilter === value ? "active" : ""} onClick={() => setPricingFilter(value)}>{label}<span>{pricingCounts[value]}</span></button>)}</div>

              <section className="pricing-table-card">
                <div className="pricing-table-heading"><div><span className="section-kicker">РЕКОМЕНДАЦИИ</span><h3>Что проверить в первую очередь</h3></div><span>{pricingRows.length} из {pricingCounts.all} карточек</span></div>
                <div className="pricing-table-wrap">{targetPricesLoading ? <div className="empty-state"><strong>Загружаем мониторинг цен…</strong></div> : <table><thead><tr><th>Товар / артикул</th><th>Цена на<br/>витрине {marketplaceName}</th><th>Рынок</th><th>Таргет</th><th>Изменение</th><th>Решение</th></tr></thead><tbody>{pricingRows.map((item) => <tr key={item.row.sku} className="pricing-row-open" role="button" tabIndex={0} aria-label={`Открыть рынок и конкурентов: ${item.row.sku}`} onClick={() => openPricingRow(item.row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPricingRow(item.row); } }}>
                  <td><button className="pricing-product pricing-product-open" type="button" onClick={() => openPricingRow(item.row)}><strong>{item.row.sku}</strong><small>{item.row.searchQuery || "Запрос не указан"}{item.row.nmId ? ` · ${marketplaceCode} ${item.row.nmId}` : ""}</small><span>Открыть рынок и конкурентов →</span></button></td>
                  <td><b>{item.row.currentPrice ? formatMoney.format(item.row.currentPrice) : "—"}</b><small>{item.row.sppPercent !== null ? `СПП ${Math.round(item.row.sppPercent * 100)}%` : "СПП не указан"}</small></td>
                  <td>{item.low !== null && item.high !== null ? <><b>{formatMoney.format(item.low)}–{formatMoney.format(item.high)}</b><small>{item.row.competitors.length} конкурента · середина {item.median ? formatMoney.format(item.median) : "—"}</small></> : <span className="pricing-empty">Нет цен</span>}</td>
                  <td><b>{item.target ? formatMoney.format(item.target) : "—"}</b><small>{item.target ? "после СПП" : "нужен рынок"}</small></td>
                  <td><span className={`pricing-delta ${item.delta === null || item.delta === 0 ? "flat" : item.delta < 0 ? "down" : "up"}`}>{item.delta === null ? "—" : item.delta === 0 ? "0 ₽" : `${item.delta > 0 ? "+" : ""}${formatMoney.format(item.delta)}`}</span></td>
                  <td><span className={`pricing-action ${item.action}`} title={item.detail}>{item.label}</span><small className="pricing-decision-note">{item.detail}</small></td>
                </tr>)}</tbody></table>}{!targetPricesLoading && !pricingRows.length && <div className="empty-state"><strong>Ничего не найдено</strong><span>Сбросьте фильтр или измените запрос.</span></div>}</div>
              </section>

              <section className="pricing-rules">
                <div><span className="section-kicker">ЛОГИКА ТАРГЕТА · ВЕРСИЯ 1</span><h3>Без ценовой войны</h3></div>
                <ol><li><b>Рынок:</b> берём цены доступных конкурентов и считаем середину.</li><li><b>Коридор:</b> таргет на 1,5% ниже середины, но не ниже 2% от самого дешёвого конкурента.</li><li><b>Контроль:</b> если источник сомнительный или разница мала — цена не меняется, карточка идёт на проверку.</li></ol>
              </section>
              {selectedPricingRow && (() => {
                const recommendation = buildPriceRecommendation(selectedPricingRow);
                const selectedRow = selectedPricingRow;
                return <div className="pricing-modal-backdrop" role="presentation" onMouseDown={() => setSelectedPricingRow(null)}><section className="pricing-modal" role="dialog" aria-modal="true" aria-label={`Конкуренты ${selectedPricingRow.sku}`} onMouseDown={(event) => event.stopPropagation()}>
                  <button className="pricing-modal-close" type="button" onClick={() => setSelectedPricingRow(null)} aria-label="Закрыть">×</button>
                  <span className="section-kicker">КАРТОЧКА РЫНКА</span><h3>{selectedPricingRow.sku}</h3><p>{selectedPricingRow.searchQuery || "Поисковый запрос не указан"}{selectedPricingRow.nmId ? ` · ваша карточка ${marketplaceCode} ${selectedPricingRow.nmId}` : ""}</p>
                  {selectedPricingRow.nmId && !isYandex && <a className="pricing-own-link" href={isOzon ? `https://www.ozon.ru/product/${selectedPricingRow.nmId}` : `https://www.wildberries.ru/catalog/${selectedPricingRow.nmId}/detail.aspx`} target="_blank" rel="noreferrer">{isOzon ? "Открыть свою карточку на Ozon ↗" : "Открыть свою карточку на WB ↗"}</a>}
                  <div className="pricing-modal-summary"><span>Цена на витрине {marketplaceName} <b>{selectedPricingRow.currentPrice ? formatMoney.format(selectedPricingRow.currentPrice) : "—"}</b></span><span>Таргет <b>{recommendation.target ? formatMoney.format(recommendation.target) : "—"}</b></span><span>Решение <b>{recommendation.label}</b></span></div>
                  <div className="pricing-competitor-list"><h4>В сравнении</h4>{selectedPricingRow.competitors.map((competitor) => <article key={competitor.nmId}><div><strong>{competitor.name || `Карточка ${marketplaceCode} ${competitor.nmId}`}</strong><small>{competitor.source || "добавлен в мониторинг"}{competitor.updatedAt ? ` · ${formatDateTime(competitor.updatedAt)}` : ""}</small>{competitor.error && <em>{competitor.error}</em>}</div><div className="pricing-competitor-actions">{isOzon && canManage && <label className="pricing-competitor-price"><span>Цена, ₽</span><input value={competitorPriceDrafts[competitor.nmId] ?? ""} onChange={(event) => setCompetitorPriceDrafts((current) => ({ ...current, [competitor.nmId]: event.target.value.replace(/[^0-9,.]/g, "") }))} inputMode="decimal" placeholder="0" /></label>}{!isYandex && <a href={isOzon ? competitor.url || `https://www.ozon.ru/product/${competitor.nmId}` : `https://www.wildberries.ru/catalog/${competitor.nmId}/detail.aspx`} target="_blank" rel="noreferrer">{competitor.price ? formatMoney.format(competitor.price) : "Нет цены"} ↗</a>}{isYandex && competitor.url && <a href={competitor.url} target="_blank" rel="noreferrer">{competitor.price ? formatMoney.format(competitor.price) : "Нет цены"} ↗</a>}{isYandex && !competitor.url && <span>{competitor.price ? formatMoney.format(competitor.price) : "Нет цены"}</span>}{(isOzon || isYandex) && canManage && <button type="button" className="pricing-competitor-refresh" onClick={() => void updatePricingCompetitor(selectedRow, competitor.nmId, "refresh-competitor")} disabled={pricingCandidateUpdatingId === competitor.nmId}>{pricingCandidateUpdatingId === competitor.nmId ? "…" : "Обновить цену"}</button>}{isOzon && canManage && <button type="button" className="pricing-competitor-save" onClick={() => void updatePricingCompetitor(selectedRow, competitor.nmId, "set-competitor-price", competitorPriceDrafts[competitor.nmId])} disabled={!competitorPriceDrafts[competitor.nmId] || pricingCandidateUpdatingId === competitor.nmId}>{pricingCandidateUpdatingId === competitor.nmId ? "…" : "Сохранить"}</button>}{canManage && <button type="button" className="pricing-competitor-remove" onClick={() => void updatePricingCompetitor(selectedRow, competitor.nmId, "remove-competitor")} disabled={pricingCandidateUpdatingId === competitor.nmId}>{pricingCandidateUpdatingId === competitor.nmId ? "…" : "Убрать"}</button>}</div></article>)}{!selectedPricingRow.competitors.length && <p>Для этой карточки пока не назначены конкуренты.</p>}</div>
                  {canManage && <section className="pricing-candidate-picker"><div className="pricing-candidate-heading"><div><span className="section-kicker">КОНКУРЕНТЫ</span><h4>Добавить вручную</h4><p>{isOzon ? "Вставь полную ссылку карточки Ozon. При обычном обновлении сервис попробует подтянуть её цену и сохранит последнюю удачную." : isYandex ? "Вставь полную ссылку карточки Яндекс Маркета. При обычном обновлении сервис попробует подтянуть её цену и сохранит последнюю удачную." : "Вставь артикул WB нужной карточки. Цена конкурента появится после отдельного обновления цен."}</p></div></div>
                    <form className="pricing-manual-candidate" onSubmit={(event) => { event.preventDefault(); const nmId = Number(manualCompetitorNmId); if (isOzon || isYandex ? manualCompetitorNmId.trim() : Number.isInteger(nmId) && nmId > 0) void updatePricingCompetitor(selectedRow, nmId, "add-competitor", undefined, isOzon || isYandex ? manualCompetitorNmId : undefined); }}><label><span>{isOzon ? "Ссылка конкурента Ozon" : isYandex ? "Ссылка конкурента Яндекс Маркета" : "Артикул WB конкурента"}</span><input value={manualCompetitorNmId} onChange={(event) => setManualCompetitorNmId(isOzon || isYandex ? event.target.value : event.target.value.replace(/\D/g, ""))} inputMode={isOzon || isYandex ? "url" : "numeric"} placeholder={isOzon ? "https://www.ozon.ru/product/..." : isYandex ? "https://market.yandex.ru/product--.../..." : "Например, 123456789"} /></label><button className="primary-btn" type="submit" disabled={!manualCompetitorNmId || pricingCandidateUpdatingId !== null}>{pricingCandidateUpdatingId ? "Добавляем…" : "Добавить"}</button></form>
                    {pricingCandidatesError && <p className="pricing-candidate-error">{pricingCandidatesError}</p>}</section>}
                  <footer>{recommendation.detail}{selectedPricingRow.refreshError ? ` ${selectedPricingRow.refreshError}` : ""}</footer>
                </section></div>;
              })()}
            </section>
          ) : activeView === "payments" ? (
            <section className="settlement-panel">
              <div className="settlement-heading">
                  <div><span className="section-kicker">СВЕРКА С ФУЛФИЛМЕНТОМ</span><h2>Сколько оплатить ФФ</h2><p>Оплата возникает, когда заказ впервые перешёл во «В доставке»: ФФ передал его {marketplaceName}. Поздний переход в «Завершённые», выкуп или отмена повторно не оплачиваются.</p></div>
                {canManage && <button type="button" className="secondary-btn" onClick={() => navigateTo("manual")}>Настроить ставки</button>}
              </div>
              <form className="settlement-controls" onSubmit={(event) => { event.preventDefault(); void loadSettlement(); }}>
                <label><span>ФФ</span><select value={settlementWarehouseId} onChange={(event) => setSettlementWarehouseId(event.target.value)}>{manualWarehouses.map((item) => <option value={item.id} key={item.id}>{formatManualWarehouse(item)}{item.isHidden ? " · скрыт" : ""}</option>)}</select></label>
                <label><span>Период с</span><input type="date" value={settlementRange.from} max={settlementRange.to} onChange={(event) => setSettlementRange((current) => ({ ...current, from: event.target.value }))} required /></label>
                <label><span>по</span><input type="date" value={settlementRange.to} min={settlementRange.from} max={isoDate(0)} onChange={(event) => setSettlementRange((current) => ({ ...current, to: event.target.value }))} required /></label>
                <button className="primary-btn" type="submit" disabled={settlementLoading || !settlementWarehouseId}>{settlementLoading ? "Считаем…" : "Рассчитать"}</button>
              </form>
              {settlementError && <div className="settlement-error" role="alert">{settlementError}</div>}
              {settlement && <>
                <div className="settlement-summary">
                  <article><span>В доставке {marketplaceCode} · к оплате</span><strong>{formatNumber.format(settlement.quantity)} <small>ед.</small></strong><p>За {shortDate(settlement.from)} — {shortDate(settlement.to)}</p></article>
                  <article><span>Ставка ФФ</span><strong>{settlement.rateKopecks > 0 ? `${formatRate.format(kopecksToRubles(settlement.rateKopecks))} ₽` : "—"}<small>{settlement.rateKopecks > 0 ? " / ед." : ""}</small></strong><p>{settlement.rateKopecks > 0 ? "Настроена владельцем" : "Ставка пока не задана"}</p></article>
                  <article className="settlement-total"><span>К оплате</span><strong>{settlement.rateKopecks > 0 ? formatMoney.format(kopecksToRubles(settlement.totalKopecks)) : "—"}</strong><p>{settlement.rateKopecks > 0 ? `${formatNumber.format(settlement.quantity)} ед. × ${formatRate.format(kopecksToRubles(settlement.rateKopecks))} ₽` : "Владелец должен задать ставку ФФ"}</p></article>
                  {settlement.untrackedHandoverQuantity > 0 && <article className="settlement-safety"><span>Не включены автоматически</span><strong>{formatNumber.format(settlement.untrackedHandoverQuantity)} <small>ед.</small></strong><p>Они уже были «В доставке» при старте учёта; точное время передачи {marketplaceCode} неизвестно.</p></article>}
                </div>
                <section className="settlement-orders">
                  <div className="settlement-orders-heading"><div><span className="section-kicker">ОСНОВАНИЕ ДЛЯ СЧЁТА</span><h3>Заказы, переданные {marketplaceName}</h3></div><span>{settlement.orders.length} ед.</span></div>
                  <div className="settlement-table-wrap"><table><thead><tr><th>Заказ {marketplaceCode}</th><th>Передан {marketplaceCode}</th><th>Количество</th><th>Сумма</th></tr></thead><tbody>{settlement.orders.map((order) => <tr key={order.orderId}><td><b>№ {order.orderId}</b></td><td>{formatDateTime(order.handedOverAt)}</td><td>1 ед.</td><td>{settlement.rateKopecks > 0 ? formatMoney.format(kopecksToRubles(settlement.rateKopecks)) : "—"}</td></tr>)}</tbody></table>{!settlement.orders.length && <div className="empty-state"><strong>За этот период новых передач {marketplaceCode} пока нет</strong><span>Сумма появится после перехода заказа из «Новые / На сборке» во «В доставке».</span></div>}</div>
                  <footer>Уникальный ID заказа попадает в сверку один раз — в момент передачи {marketplaceCode}. Дальнейшие статусы, стикер доставки, «Завершённые», выкуп и отмена сумму не дублируют.</footer>
                </section>
                <p className="settlement-note">{settlement.trackingStartedAt ? `Учёт переходов ведётся с ${formatDateTime(settlement.trackingStartedAt)}. Для прошлых периодов до этой даты ${marketplaceName} не передаёт точный момент передачи заказа.` : `После ближайшего обновления начнём фиксировать передачи ${marketplaceCode} для сверки.`}</p>
              </>}
            </section>
          ) : activeView === "fulfillment" ? (
            <section className="fulfillment-panel">
              {!selectedFulfillmentWarehouse ? <>
                <div className="section-heading fulfillment-heading">
                  <div><span className="section-kicker">ВЫБЕРИТЕ СКЛАД ФФ</span><h2>Куда смотреть остатки и движение</h2><p className="section-note">Откройте склад, чтобы увидеть его остаток и FBS-движение по каждому артикулу.</p></div>
                  {canManage && <button className="secondary-btn" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button>}
                </div>
                <div className="fulfillment-warehouse-grid">{fulfillmentWarehouses.map((item) => <button className="fulfillment-warehouse-card" type="button" key={item.warehouse.id} onClick={() => openFulfillmentWarehouse(item.warehouse.id)}><span className="fulfillment-card-top"><i>□</i><small>{item.warehouse.wbWarehouseId ? `${marketplaceCode} FBS · ${item.warehouse.wbWarehouseName || `№${item.warehouse.wbWarehouseId}`}` : `${marketplaceCode} FBS не назначен`}</small><b>›</b></span><strong>{item.warehouse.city}</strong><span className="fulfillment-card-name">{item.warehouse.name}</span><span className="fulfillment-card-stock"><b>{formatNumber.format(item.physicalStock)}</b> шт. на ФФ</span><span className="fulfillment-card-stats">Свободно {formatNumber.format(item.stock)} · новые FBS {item.fbs}</span></button>)}</div>
                {!fulfillmentWarehouses.length && <div className="empty-state"><strong>Добавьте первый склад ФФ</strong><span>После этого сюда будут попадать остатки из Excel и заказы WB.</span></div>}
                <p className="fulfillment-note">«Продано» показывает только выкупленные заказы WB — отмены и отказы не попадают в этот показатель.</p>
              </> : <>
                <div className="section-heading fulfillment-heading">
                  <div><button className="back-link" type="button" onClick={() => { setSelectedFulfillmentWarehouseId(null); setQuery(""); }}>‹ Все склады ФФ</button><span className="section-kicker">ФФ · СКЛАД В РАБОТЕ</span><h2>{formatManualWarehouse(selectedFulfillmentWarehouse.warehouse)}</h2><p className="section-note">Остатки на этом ФФ и FBS-заказы, отгруженные с привязанного склада {marketplaceName}.</p></div>
                  <div className="fulfillment-heading-actions"><button className="primary-btn" type="button" onClick={() => openPlannerForWarehouse(selectedFulfillmentWarehouse.warehouse.id)}>Рассчитать поставку</button><button className="secondary-btn fulfillment-export-btn" type="button" onClick={() => void downloadFfOrders(selectedFulfillmentWarehouse.warehouse)} disabled={ffOrdersExportLoading || !selectedFulfillmentWarehouse.warehouse.wbWarehouseId}>{ffOrdersExportLoading ? "Собираем стикеры…" : "Excel: заказы + стикеры ↓"}</button>{canManage && <button className="secondary-btn" type="button" onClick={() => navigateTo("manual")}>Настроить склад</button>}</div>
                </div>
                <div className="fulfillment-export-note"><span>Только актуальные FBS-заказы этого ФФ. Одна строка — один заказ: артикул, количество и {isOzon ? "номер отправления Ozon" : "стикер WB"}.</span>{ffOrdersExportMessage && <strong className="success">{ffOrdersExportMessage}</strong>}{ffOrdersExportError && <strong className="error">{ffOrdersExportError}</strong>}</div>
                <aside className="fulfillment-handover-timing" aria-label={`Скорость передачи заказов ${marketplaceName}`}><div><span>СКОРОСТЬ ЭТОГО ФФ</span><strong>{formatHandoverTime(selectedHandoverTiming?.averageHours ?? null)}</strong><p>Среднее от создания заказа до передачи {marketplaceCode}</p></div><small>{selectedHandoverTiming?.sampleSize ? `Выборка: ${selectedHandoverTiming.sampleSize} заказов за 30 дней` : "Собираем историю переходов на следующий этап"}</small></aside>
                <div className="fulfillment-metric-grid fulfillment-metric-grid-five" role="group" aria-label="Списки по статусу товара">
                  <button type="button" className={`fulfillment-metric physical ${fulfillmentList === "physical" ? "active" : ""}`} aria-pressed={fulfillmentList === "physical"} onClick={() => { setFulfillmentList("physical"); setQuery(""); }}><span>Фактически на ФФ</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.physicalStock)} <small>шт.</small></strong><p>Свободный остаток + новые FBS, которые ещё лежат на ФФ</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "available" ? "active" : ""}`} aria-pressed={fulfillmentList === "available"} onClick={() => { setFulfillmentList("available"); setQuery(""); }}><span>Свободно к продаже</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.stock)} <small>шт.</small></strong><p>{formatNumber.format(selectedFulfillmentWarehouse.physicalStock)} на ФФ − {formatNumber.format(selectedFulfillmentWarehouse.fbs)} новых FBS</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "reserved" ? "active" : ""}`} aria-pressed={fulfillmentList === "reserved"} onClick={() => { setFulfillmentList("reserved"); setQuery(""); }}><span>Новые FBS</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.fbs)} <small>шт.</small></strong><p>new / confirm · ещё на ФФ, уже в резерве</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "receiving" ? "active" : ""}`} aria-pressed={fulfillmentList === "receiving"} onClick={() => { setFulfillmentList("receiving"); setQuery(""); }}><span>Переданы {marketplaceCode}</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.receiving)} <small>шт.</small></strong><p>Передано · без второго вычета</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "toSale" ? "active" : ""}`} aria-pressed={fulfillmentList === "toSale"} onClick={() => { setFulfillmentList("toSale"); setQuery(""); }}><span>Продано</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.toSale)} <small>шт.</small></strong><p>Завершённые заказы без отмен</p></button>
                </div>
                <section className="stock-card fulfillment-stock-card"><div className="stock-header"><div><span className="section-kicker">{activeFulfillmentListMeta.kicker}</span><h2 aria-live="polite">{activeFulfillmentListMeta.title}</h2><p className="fulfillment-list-note">Нажмите на карточку выше, чтобы переключить список.</p></div><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по выбранному списку склада ФФ" /></label></div><div className="fulfillment-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{activeFulfillmentListMeta.primary}</th><th>{fulfillmentList === "physical" || fulfillmentList === "available" ? "Новые FBS" : "Свободно ФФ"}</th><th>{fulfillmentList === "receiving" ? "Новые FBS" : `Переданы ${marketplaceCode}`}</th><th>Статус ФФ</th><th /></tr></thead><tbody>{fulfillmentRows.map((row) => { const warehouseId = selectedFulfillmentWarehouse.warehouse.id; const physicalStock = row.ffStock[warehouseId] ?? 0; const availableStock = availableFfStock(row, warehouseId); const fbsReserve = row.fbsByLocation[warehouseId] ?? 0; const waitingForWb = row.receivingByLocation[warehouseId] ?? 0; const sold = row.toSaleByLocation[warehouseId] ?? 0; const primaryValue = fulfillmentList === "physical" ? physicalStock : fulfillmentList === "reserved" ? fbsReserve : fulfillmentList === "receiving" ? waitingForWb : fulfillmentList === "toSale" ? sold : availableStock; const secondaryValue = fulfillmentList === "physical" || fulfillmentList === "available" ? fbsReserve : availableStock; const thirdValue = fulfillmentList === "receiving" ? fbsReserve : waitingForWb; const status = fulfillmentStockStatus(availableStock); const primaryClass = fulfillmentList === "physical" || fulfillmentList === "available" ? `manual-stock-value ${primaryValue === 0 ? "zero" : ""}` : fulfillmentList === "reserved" ? "number-pill blue-pill" : fulfillmentList === "receiving" ? "number-pill amber-pill" : "number-pill green-pill"; const secondaryClass = fulfillmentList === "physical" || fulfillmentList === "available" ? "number-pill blue-pill" : `manual-stock-value ${availableStock === 0 ? "zero" : ""}`; const thirdClass = fulfillmentList === "receiving" ? "number-pill blue-pill" : "number-pill amber-pill"; return <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · ${marketplaceCode} ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><span className={primaryClass}>{formatNumber.format(primaryValue)}{(fulfillmentList === "physical" || fulfillmentList === "available") && <small> шт.</small>}</span></td><td><span className={secondaryClass}>{formatNumber.format(secondaryValue)}{fulfillmentList !== "physical" && fulfillmentList !== "available" && <small> шт.</small>}</span></td><td><span className={thirdClass}>{formatNumber.format(thirdValue)}</span></td><td><span className={`status ${status === "В норме" ? "ok" : status === "Мало" ? "low" : "critical"}`}><i />{status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>; })}</tbody></table>{!loading && !fulfillmentRows.length && <div className="empty-state"><strong>{activeFulfillmentListMeta.empty}</strong><span>Выберите другую карточку или проверьте привязку ФФ к складу {marketplaceName}.</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{fulfillmentRows.length} артикулов в выбранном списке</span><span>{activeFulfillmentListMeta.footer}</span></footer></section>
              </>}
            </section>
          ) : activeView === "manual" && canManage ? (
            <section className="manual-warehouses-panel">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">СКЛАДЫ ФУЛФИЛМЕНТА</span>
                  <h2>Куда отправляем товар</h2>
                  <p className="section-note">Склады FBS подтягиваются из {marketplaceName} автоматически. Excel и партии остаются резервным ручным учётом, если склад не ведётся в {marketplaceName}.</p>
                </div>
              </div>
              <div className="manual-layout">
                <article className="manual-card">
                  <h3>Ваши склады</h3>
                  <div className="manual-warehouse-list">{manualWarehouses.map((item) => {
                    const linkDraft = warehouseLinkDrafts[item.id] ?? {
                      wbWarehouseId: item.wbWarehouseId ? String(item.wbWarehouseId) : "",
                      wbWarehouseName: item.wbWarehouseName ?? "",
                      serviceRate: rateDraft(item.serviceRateKopecks),
                      openedAt: item.openedAt ?? "",
                      planningTargetDays: String(item.planningTargetDays || 14),
                    };
                    return <div className="manual-warehouse-item" key={item.id}>
                      <span className="warehouse-pin">□</span>
                      <div className="manual-warehouse-details"><strong>{item.city}</strong><small>{item.name}</small><em>{item.isHidden ? "Скрыт из витрины" : item.wbWarehouseId ? `Привязан к ${marketplaceCode} FBS · ${item.wbWarehouseName || `№${item.wbWarehouseId}`}` : `${marketplaceCode} FBS не назначен`}</em></div>
                      <form className="warehouse-link-form" onSubmit={(event) => void saveWarehouseLink(item, event)}>
                        <label><span>{marketplaceWarehouseIdLabel}</span><input value={linkDraft.wbWarehouseId} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseId: event.target.value } }))} inputMode="numeric" placeholder={isYandex ? "Например, 48566976" : "Например, 1987385"} /></label>
                        <label><span>Название в {marketplaceName}</span><input value={linkDraft.wbWarehouseName} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseName: event.target.value } }))} maxLength={120} placeholder="Например, Волгоград Upakovka" /></label>
                        <label><span>Ставка, ₽ / ед.</span><input value={linkDraft.serviceRate} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, serviceRate: event.target.value } }))} inputMode="decimal" placeholder="Например, 10" /></label>
                        <label><span>Дата открытия</span><input type="date" max={isoDate(0)} value={linkDraft.openedAt} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, openedAt: event.target.value } }))} /></label>
                        <label><span>Целевой запас по умолчанию</span><input type="number" min="1" max="365" value={linkDraft.planningTargetDays} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, planningTargetDays: event.target.value.replace(/\D/g, "") } }))} /><small>дн.</small></label>
                        <button type="submit" disabled={warehouseLinkSavingId === item.id}>{warehouseLinkSavingId === item.id ? "Сохраняем…" : "Сохранить"}</button>
                      </form>
                      <button className="warehouse-visibility-btn" type="button" onClick={() => void toggleWarehouseVisibility(item)} disabled={warehouseLinkSavingId === item.id}>{item.isHidden ? "Показать" : "Скрыть"}</button>
                    </div>;
                  })}</div>
                  <form className="warehouse-add-form" onSubmit={addWarehouse}>
                    <h4>Добавить склад</h4>
                    <label><span>Город</span><input value={newWarehouseCity} onChange={(event) => setNewWarehouseCity(event.target.value)} placeholder="Например, Екатеринбург" maxLength={80} required /></label>
                    <label><span>Название</span><input value={newWarehouseName} onChange={(event) => setNewWarehouseName(event.target.value)} placeholder="Например, ФФ Урал" maxLength={120} required /></label>
                    <button className="drawer-primary" type="submit" disabled={warehouseSaving}>{warehouseSaving ? "Добавляем…" : "Добавить склад"}</button>
                    {warehouseMessage && <p className="form-status success">{warehouseMessage}</p>}
                    {warehouseError && <p className="form-status error">{warehouseError}</p>}
                  </form>
                </article>
                <article className="manual-card import-card">
                  <div>
                    <span className="section-kicker">EXCEL-ИМПОРТ</span>
                    <h3>Загрузить остатки и сроки</h3>
                    <p>Укажите «Артикул продавца» или ID товара {marketplaceName} и «Количество». Для отдельных партий добавьте «Партия» и «Срок годности».</p>
                  </div>
                  <div className="import-file-actions">
                    <a className="import-template-link" href="/ff-stock-import-template.xlsx" download="Шаблон_остатков_ФФ.xlsx">Скачать шаблон Excel ↓</a>
                    <label className="import-file"><span>Выбрать заполненный файл</span><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void chooseImportFile(event)} /></label>
                  </div>
                  {importPreview && <div className="import-preview"><strong>{importPreview.fileName}</strong><span>Лист: {importPreview.sheetName} · {importPreview.items.length} партий{importPreview.hasBatchColumn ? " · номера партий считаны" : ""}{importPreview.hasExpiryColumn ? " · сроки считаны" : " · без сроков"}{importPreview.skipped ? ` · пропущено строк: ${importPreview.skipped}` : ""}</span></div>}
                  <div className="import-controls">
                    <label><span>Склад</span><select value={selectedImportWarehouseId} onChange={(event) => setImportWarehouseId(event.target.value)}>{manualWarehouses.map((item) => <option value={item.id} key={item.id}>{formatManualWarehouse(item)}</option>)}</select></label>
                    <label><span>Как применить</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as "replace" | "add")}><option value="replace">Заменить остатки из файла</option><option value="add">Прибавить к текущим остаткам</option></select></label>
                  </div>
                  <p className="import-hint">Каждая строка — отдельная партия. «Заменить» удалит прежние партии только для артикулов из файла на выбранном складе.</p>
                  <button className="drawer-primary import-button" type="button" onClick={() => void importExcel()} disabled={!importPreview || !selectedImportWarehouseId || importLoading}>{importLoading ? "Загружаем…" : "Загрузить в выбранный склад"}</button>
                  {importMessage && <p className="form-status success">{importMessage}</p>}
                  {importError && <p className="form-status error">{importError}</p>}
                </article>
              </div>
              <ExpiryManager rows={rows} warehouses={manualWarehouses} />
            </section>
          ) : activeView === "analytics" ? (
            <section className="analytics-panel">
              <div className="analytics-heading">
                <div><span className="section-kicker">УПРАВЛЕНЧЕСКИЙ ОБЗОР · {marketplaceName.toUpperCase()}</span><h2>Продажи по каналам</h2><p>Сравнение FBS и FBO, а также эффективность каждого вашего ФФ за выбранный период.</p></div>
                <button className="secondary-btn analytics-refresh" type="button" onClick={() => void loadAnalytics(analyticsRange, true)} disabled={analyticsLoading || Boolean(analyticsRetrySeconds)} title={analyticsRetrySeconds ? `${marketplaceName} временно ограничил запросы` : "Можно обновить вручную в любой момент. Рекомендованный интервал — 2 минуты."}><span className={analyticsLoading ? "spin" : ""}>↻</span>{analyticsLoading ? "Считаем" : analyticsRetrySeconds ? `Через ${formatCountdown(analyticsRetrySeconds)}` : "Обновить"}</button>
              </div>

              <div className="analytics-controls"><div className="analytics-periods" role="group" aria-label="Период аналитики">{[{ id: "7d", label: "Неделя" }, { id: "14d", label: "2 недели" }, { id: "30d", label: "Месяц" }, { id: "custom", label: "Свои даты" }].map((item) => <button type="button" key={item.id} className={analyticsPeriod === item.id ? "active" : ""} onClick={() => chooseAnalyticsPeriod(item.id as "7d" | "14d" | "30d" | "custom")}>{item.label}</button>)}</div><span className="analytics-period-label">{shortDate(analyticsRange.from)} — {shortDate(analyticsRange.to)}</span></div>
              {analyticsPeriod === "custom" && <div className="analytics-custom-dates"><label><span>С</span><input type="date" value={analyticsDraft.from} min={isoDate(89)} max={isoDate(0)} onChange={(event) => setAnalyticsDraft((value) => ({ ...value, from: event.target.value }))} /></label><label><span>По</span><input type="date" value={analyticsDraft.to} min={isoDate(89)} max={isoDate(0)} onChange={(event) => setAnalyticsDraft((value) => ({ ...value, to: event.target.value }))} /></label><button type="button" onClick={applyAnalyticsCustomPeriod}>Применить</button><small>Максимум 90 дней</small></div>}
              {analytics?.warnings.length ? <div className="analytics-warning">{analytics.warnings.map((warning) => <span key={warning}>! {warning}</span>)}</div> : null}
              {analyticsRetrySeconds !== null && analyticsRetrySeconds > 0 && <div className="analytics-retry-timer" role="status"><span>↻</span><div><strong>{marketplaceName} разрешит повторный запрос через {formatCountdown(analyticsRetrySeconds)}</strong><p>{analytics?.source.retryExact ? "После таймера нажмите «Обновить» вручную." : `${marketplaceName} не прислал точное время — дождитесь окончания интервала и обновите вручную.`}</p></div></div>}

              {analyticsLoading && !analytics ? <div className="analytics-loading"><span className="loader"/><strong>Собираем аналитику {marketplaceName}</strong><small>Сверяем продажи и каналы за выбранный период</small></div> : analyticsError && !analytics ? <div className="empty-state"><strong>Аналитика пока недоступна</strong><span>{analyticsError}</span></div> : analytics ? <>
                <div className="analytics-kpi-grid">{analyticsFactAvailable ? <><article className="analytics-kpi total"><span>Продажи за период</span><strong>{formatNumber.format(analytics.summary.total)} <small>шт.</small></strong><p>FBS и FBO вместе</p></article><article className="analytics-kpi fbo"><span>Продажи FBO</span><strong>{formatNumber.format(analytics.summary.fbo)} <small>шт.</small></strong><p>{analytics.summary.fboShare}% от продаж</p></article><article className="analytics-kpi fbs"><span>Продажи FBS</span><strong>{formatNumber.format(analytics.summary.fbs)} <small>шт.</small></strong><p>{analytics.summary.fbsShare}% от продаж</p></article><article className="analytics-kpi share"><span>Доля FBS</span><strong>{analytics.summary.fbsShare}<small>%</small></strong><p>По факту продаж</p></article></> : <><article className="analytics-kpi total unavailable"><span>Факт продаж</span><strong>—</strong><p>WB временно не отдал статистику</p></article><article className="analytics-kpi fbo unavailable"><span>Продажи FBO</span><strong>—</strong><p>Не подменяем нулём</p></article><article className="analytics-kpi fbs unavailable"><span>Продажи FBS</span><strong>—</strong><p>Не подменяем заказами</p></article><article className="analytics-kpi share unavailable"><span>Сравнение каналов</span><strong>—</strong><p>Нет факта продаж для сравнения</p></article></>}</div>

                <div className="analytics-grid">
                  <section className={`analytics-card analytics-trend-card ${analyticsFactAvailable ? "" : "fact-unavailable"}`}><div className="analytics-card-heading"><div><span className="section-kicker">ДИНАМИКА</span><h3>{analyticsTrendTitle}</h3></div>{analyticsFactAvailable ? <div className="analytics-channel-toggle" role="group" aria-label="Канал на графике"><button type="button" className={analyticsChannel === "all" ? "active" : ""} aria-pressed={analyticsChannel === "all"} onClick={() => { setAnalyticsChannel("all"); setAnalyticsHoverDate(null); }}>Вместе</button><button type="button" className={analyticsChannel === "fbs" ? "active fbs" : "fbs"} aria-pressed={analyticsChannel === "fbs"} onClick={() => { setAnalyticsChannel("fbs"); setAnalyticsHoverDate(null); }}>FBS</button><button type="button" className={analyticsChannel === "fbo" ? "active fbo" : "fbo"} aria-pressed={analyticsChannel === "fbo"} onClick={() => { setAnalyticsChannel("fbo"); setAnalyticsHoverDate(null); }}>FBO</button></div> : <span className="analytics-total-badge">Данные WB</span>}</div><div className="analytics-line-chart" onMouseLeave={() => setAnalyticsHoverDate(null)}><svg viewBox={`0 0 ${analyticsTrend.width} ${analyticsTrend.height}`} role="img" aria-label={`Линейный график ${analyticsTrendTitle}`} preserveAspectRatio="none"><g className="analytics-line-grid">{[0, 1, 2, 3, 4].map((index) => { const y = analyticsTrend.top + (analyticsTrend.plotHeight / 4) * index; const value = Math.round(analyticsTrend.max * (1 - index / 4)); return <g key={index}><line x1="18" x2="982" y1={y} y2={y}/><text x="2" y={y + 3}>{value}</text></g>; })}</g>{analyticsTrendChannel !== "fbs" && <path className="analytics-line fbo" d={analyticsTrend.fboPath}/>} {analyticsTrendChannel !== "fbo" && <path className="analytics-line fbs" d={analyticsTrend.fbsPath}/>} {analyticsTrend.points.map((point, index) => <g key={point.date}>{analyticsTrendChannel !== "fbs" && <circle className={`analytics-line-point fbo ${analyticsHoverDate === point.date ? "active" : ""}`} cx={point.x} cy={point.fboY} r={analyticsHoverDate === point.date ? 5 : 2.6}/>} {analyticsTrendChannel !== "fbo" && <circle className={`analytics-line-point fbs ${analyticsHoverDate === point.date ? "active" : ""}`} cx={point.x} cy={point.fbsY} r={analyticsHoverDate === point.date ? 5 : 2.6}/>} {(index === 0 || index === analyticsTrend.points.length - 1 || index % analyticsTrend.labelEvery === 0) && <text className="analytics-line-label" x={point.x} y={analyticsTrend.height - 8}>{shortDate(point.date)}</text>}</g>)}</svg><div className="analytics-line-hit-zones">{analyticsTrend.points.map((point) => <button type="button" key={point.date} className={analyticsHoverDate === point.date ? "active" : ""} style={{ left: `${(point.x / analyticsTrend.width) * 100}%`, width: `${Math.max(4, 100 / Math.max(1, analyticsTrend.points.length))}%` }} onMouseEnter={() => setAnalyticsHoverDate(point.date)} onFocus={() => setAnalyticsHoverDate(point.date)} onClick={() => setAnalyticsHoverDate(point.date)} aria-label={`${shortDate(point.date)}: FBS ${point.fbs}, FBO ${point.fbo}`} />)}</div>{activeAnalyticsPoint && activeAnalyticsTrendPoint && <div className="analytics-line-tooltip" style={{ left: `${Math.min(88, Math.max(12, (activeAnalyticsTrendPoint.x / analyticsTrend.width) * 100))}%` }}><strong>{shortDate(activeAnalyticsPoint.date)}</strong><span><i className="fbs"/>FBS <b>{formatNumber.format(activeAnalyticsPoint.fbs)} шт.</b></span><span><i className="fbo"/>FBO <b>{formatNumber.format(activeAnalyticsPoint.fbo)} шт.</b></span></div>}</div>{!analyticsFactAvailable && <div className="analytics-channel-unavailable"><span>!</span><div><strong>Не показываем созданные заказы вместо продаж</strong><p>Повторим запрос автоматически после ограничения WB. На графике и в показателях появятся только фактические продажи FBS и FBO.</p></div></div>}<p className="analytics-card-note">{analyticsFactAvailable ? "Наведите на точку или дату — увидите продажи FBS и FBO за конкретный день." : "Показатели не подменяются созданными заказами."}</p></section>
                  <section className="analytics-card analytics-channel-card"><div className="analytics-card-heading"><div><span className="section-kicker">СТРУКТУРА</span><h3>{analyticsFactAvailable ? "Соотношение каналов" : "Факт продаж временно недоступен"}</h3></div><span className="analytics-total-badge">{analyticsFactAvailable ? `${formatNumber.format(analytics.summary.total)} шт.` : "Данные WB"}</span></div>{analyticsFactAvailable ? <><div className="analytics-channel-body"><div className="analytics-donut" style={{ background: `conic-gradient(#365df2 0 ${analytics.summary.fbsShare}%, #20a16d ${analytics.summary.fbsShare}% 100%)` }}><span><b>{analytics.summary.fbsShare}%</b><small>FBS</small></span></div><div className="analytics-channel-list"><div><span><i className="fbs"/>FBS</span><strong>{formatNumber.format(analytics.summary.fbs)} <small>шт.</small></strong></div><div><span><i className="fbo"/>FBO</span><strong>{formatNumber.format(analytics.summary.fbo)} <small>шт.</small></strong></div></div></div><p className="analytics-card-note">Факт продаж: возвраты не включены.</p></> : <div className="analytics-channel-unavailable"><span>!</span><div><strong>Не строим соотношение из разных показателей</strong><p>Когда WB вернёт статистику, появятся фактические продажи и корректное соотношение каналов.</p></div></div>}</section>
                </div>

                <section className="analytics-card analytics-ff-card"><div className="analytics-card-heading"><div><span className="section-kicker">СРАВНЕНИЕ ФФ</span><h3>{analyticsFactAvailable ? "Продажи FBS между складами" : "Факт продаж FBS временно недоступен"}</h3></div><span className="analytics-total-badge">{analyticsFactAvailable ? "Факт продаж" : "Данные WB"}</span></div>{analyticsFactAvailable ? <><div className="analytics-ff-bars">{analytics.fbsWarehouses.map((warehouse) => { const max = Math.max(1, ...analytics.fbsWarehouses.map((item) => item.value)); return <div className="analytics-ff-row" key={warehouse.id}><div><strong>{warehouse.name}</strong><small>{warehouse.sublabel}</small></div><span className="analytics-ff-track"><i style={{ width: `${(warehouse.value / max) * 100}%` }} /></span><b>{formatNumber.format(warehouse.value)} <small>шт.</small></b></div>; })}</div><div className="analytics-insight"><span>Итог периода</span><strong>{strongestFbsWarehouse ? `${strongestFbsWarehouse.name} лидирует среди ФФ: ${formatNumber.format(strongestFbsWarehouse.value)} продаж FBS.` : "За выбранный период продаж FBS по привязанным ФФ пока нет."}</strong></div></> : <div className="analytics-channel-unavailable"><span>!</span><div><strong>Ждём фактические продажи FBS</strong><p>Сравнение ФФ появится после ответа статистики WB, без подмены созданными заказами.</p></div></div>}</section>
                <p className="analytics-source-note">{analyticsFactAvailable ? "FBO и FBS считаются по оперативной статистике WB. Возвраты не включены." : "WB временно ограничил статистику. Не подменяем продажи созданными заказами — повторим запрос автоматически."}</p>
              </> : null}
            </section>
          ) : activeView === "sales" && ffPlanningSupported(cabinet?.marketplace) ? (
            <FfSupplyPlanner
              warehouses={plannerWarehouses}
              daily={plannerSnapshot?.daily ?? []}
              rows={plannerSnapshot?.rows ?? []}
              dataAvailable={Boolean(plannerSnapshot)}
              selectedWarehouseIds={plannerSelectedWarehouseIds}
              onSelectedWarehouseIdsChange={setPlannerSelectedWarehouseIds}
              canEditWarehouseSettings={canManage}
              warehouseOpeningSavingId={warehouseLinkSavingId}
              onWarehouseOpenedAtChange={(warehouse, openedAt) => void savePlannerWarehouseOpenedAt(warehouse, openedAt)}
              warehouseSettingsError={plannerWarehouseSettingsError}
              onRefresh={() => void refreshFfPlanning()}
              loading={plannerLoading}
              refreshing={plannerRefreshing}
              updatedAt={plannerSnapshot?.updatedAt ?? null}
              retrySeconds={plannerRetrySeconds}
              error={plannerError}
              warnings={plannerSnapshot?.warnings ?? []}
              source={plannerSnapshot?.source ?? defaultFfPlanningSource}
            />
          ) : activeView === "sales" ? (
            <FfPlannerMarketplaceUnavailable marketplaceName={marketplaceName} />
          ) : <>
            <section className={`metric-grid ${activeView !== "overview" ? "view-hidden" : ""}`} aria-label="Ключевые показатели">
              <article className="metric-card featured"><div className="metric-top"><span>Остаток на складах {marketplaceName}</span><span className="trend up">● {marketplaceCode} API</span></div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.available)} <small>шт.</small></strong><div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, index) => <i key={index} style={{ height }} />)}</div><p>Фактический остаток FBO · отдельно от FBS</p></article>
              <article className="metric-card"><div className="metric-icon green">□</div><div className="metric-label">Свободно к продаже на ФФ</div><strong className="metric-value">{loading ? "—" : formatNumber.format(ffAvailableTotal)} <small>шт.</small></strong><p>Фактически на ФФ {formatNumber.format(ffPhysicalTotal)} · новые FBS в резерве {formatNumber.format(ffReservedFromStockTotal)}</p></article>
              <article className="metric-card"><div className="metric-icon blue">→</div><div className="metric-label">Активные FBS</div><strong className="metric-value">{loading ? "—" : formatNumber.format(activeFbsTotal)} <small>шт.</small></strong><p className="metric-location-summary">{activeFbsLocationSummary.items.length ? <><span>{activeFbsLocationSummary.items.map((location) => `${location.city} ${formatNumber.format(location.quantity)}`).join(" · ")}</span>{activeFbsLocationSummary.hiddenLabel && <small>{activeFbsLocationSummary.hiddenLabel}</small>}</> : <span>Нет активных заказов</span>}</p></article>
              <article className="metric-card"><div className="metric-icon amber">◷</div><div className="metric-label">Продано</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.toSale)} <small>шт.</small></strong><p>Факт выкупа · без отмен</p></article>
            </section>

            <section className={`movement-card ${activeView !== "overview" && activeView !== "fbs" ? "view-hidden" : ""}`} id="movement"><div className="section-heading"><div><span className="section-kicker">ОСТАТКИ {marketplaceCode}, ФФ И ДВИЖЕНИЕ FBS</span><h2>Фактические и свободные остатки отдельно</h2></div><span className="period-pill">Актуальные заказы за 30 дней</span></div><div className="movement-grid"><article className="wb-stock-fact"><span className="wb-stock-mark">{marketplaceCode}</span><div><small>ФАКТИЧЕСКИЙ ОСТАТОК НА {marketplaceCode}</small><strong>{formatNumber.format(totals.available)} <em>шт.</em></strong><p>Уже находится на складах {marketplaceName} и не является доступным запасом для FBS.</p></div></article><div className="fbs-overview"><div className="movement-subhead"><span>ОСТАТКИ ФФ · {marketplaceCode} API</span>{canManage && <button className="text-action" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button>}</div><div className="fbs-location-grid manual-location-grid dynamic-locations">{visibleManualWarehouses.map((item) => { const physical = totals.ffStock[item.id] ?? 0; const reserved = totals.fbsByLocation[item.id] ?? 0; const free = Math.max(0, physical - reserved); return <article className="fbs-location-card manual" key={item.id}><span>{item.city}</span><strong>{formatNumber.format(physical)}</strong><small>{item.name} · свободно {free} · новые FBS {reserved}</small></article>; })}</div><div className="movement-subhead orders"><span>FBS-ЗАКАЗЫ ПО ЭТАПАМ</span><small>По данным {marketplaceCode} API</small></div><div className="fbs-location-grid order-location-grid">{fbsLocations.map((location) => <article className="fbs-location-card" key={location.id}><span>{location.city}</span><strong>{formatNumber.format(activeFbsByLocation[location.id] ?? 0)}</strong><small>{location.label}</small></article>)}</div><div className="fbs-stage-strip"><span><b>{totals.fbs}</b> новые · ещё на ФФ</span><i>→</i><span><b>{totals.receiving}</b> переданы {marketplaceCode}</span><i>→</i><span className="sale-stage"><b>{totals.toSale}</b> продано</span></div></div></div></section>

            <section className={`stock-card ${activeView === "reports" ? "view-hidden" : ""}`} id="stock">
              <div className="stock-header stock-overview-header">
                <div>
                  <span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span>
                  <h2>{stockTitle}</h2>
                </div>
                <div className="stock-tools stock-overview-tools">
                  <label className="search-field">
                    <span>⌕</span>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам" />
                  </label>
                  <label className="select-wrap stock-warehouse-select">
                    <span>Склад WB:</span>
                    <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Выбрать склад маркетплейса">
                      <option>Все склады</option>
                      {warehouseNames.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="select-wrap stock-ff-select">
                    <span>Склад ФФ:</span>
                    <select
                      value={stockFfCompareIds.length ? "compare" : stockFfWarehouseId}
                      onChange={(event) => {
                        setStockFfWarehouseId(event.target.value);
                        setStockFfCompareIds([]);
                      }}
                      aria-label="Выбрать склад ФФ"
                    >
                      {stockFfCompareIds.length > 0 && <option value="compare">Сравнение: {stockFfCompareIds.length}</option>}
                      <option value="all">Все ФФ</option>
                      {visibleManualWarehouses.map((item) => <option value={item.id} key={item.id}>{item.city} — {item.name}</option>)}
                    </select>
                  </label>
                  <div className="ff-compare-control">
                    <button
                      className={`ff-compare-btn ${stockFfCompareIds.length ? "active" : ""}`}
                      type="button"
                      onClick={() => setStockFfCompareOpen((current) => !current)}
                      aria-expanded={stockFfCompareOpen}
                    >
                      {stockFfCompareIds.length ? `Сравниваем: ${stockFfCompareIds.length}` : "Сравнить ФФ"}
                    </button>
                    {stockFfCompareOpen && (
                      <div className="ff-compare-popover">
                        <div className="ff-compare-heading">
                          <strong>Выберите до 3 складов</strong>
                          <small>Они появятся рядом отдельными колонками</small>
                        </div>
                        <div className="ff-compare-options">
                          {visibleManualWarehouses.map((item) => {
                            const selected = stockFfCompareIds.includes(item.id);
                            const disabled = !selected && stockFfCompareIds.length >= 3;
                            return (
                              <label className={disabled ? "disabled" : ""} key={item.id} title={formatManualWarehouse(item)}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={disabled}
                                  onChange={() => setStockFfCompareIds((current) => selected
                                    ? current.filter((id) => id !== item.id)
                                    : current.length >= 3 ? current : [...current, item.id])}
                                />
                                <span><strong>{item.city}</strong><small>{item.name}</small></span>
                              </label>
                            );
                          })}
                        </div>
                        <footer>
                          <button type="button" onClick={() => setStockFfCompareIds([])}>Сбросить</button>
                          <button type="button" onClick={() => setStockFfCompareOpen(false)}>Готово</button>
                        </footer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="filter-row">
                <div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">
                  {[{ name: "Все", count: counts.all }, { name: "Дефицит", count: counts.risk }, { name: "Активные FBS", count: counts.transit }].map((item) => (
                    <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>
                  ))}
                </div>
                <span className="result-count">Показано {filteredRows.length} из {viewTotal} артикулов</span>
              </div>
              <div className="table-wrap compact-stock-table-wrap">
                <table className={`stock-overview-table ff-column-count-${stockFfColumns.length}`}>
                  <thead>
                    <tr>
                      <th>Товар / артикул</th>
                      <th>{warehouse === "Все склады" ? `Остаток ${marketplaceCode}` : `Выбранный склад ${marketplaceCode}`}</th>
                      {stockFfColumns.map((column) => (
                        <th
                          className="ff-column-head"
                          key={column.id}
                          title={column.warehouse ? formatManualWarehouse(column.warehouse) : "Свободный остаток по всем ФФ"}
                        >
                          <span>{column.city}</span>
                          <small>{column.name}</small>
                        </th>
                      ))}
                      <th>Активные FBS</th>
                      <th>Продано</th>
                      <th>Статус</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}>
                        <td>
                          <div className="product-cell">
                            <span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span>
                            <span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · ${marketplaceCode} ${row.nmId}` : ""} · {row.category}</small></span>
                          </div>
                        </td>
                        <td><b>{formatNumber.format(warehouse === "Все склады" ? stockTotal(row) : row.warehouses[warehouse] ?? 0)}</b><small> шт.</small></td>
                        {stockFfColumns.map((column) => {
                          const free = column.warehouse
                            ? availableFfStock(row, column.id)
                            : visibleManualWarehouses.reduce((sum, item) => sum + availableFfStock(row, item.id), 0);
                          return (
                            <td key={column.id}>
                              <span className={`manual-stock-value ${free === 0 ? "zero" : ""}`} title={column.warehouse ? `Свободно к продаже: ${formatManualWarehouse(column.warehouse)}` : "Свободно к продаже на всех ФФ"}>
                                {formatNumber.format(free)}<small> шт.</small>
                              </span>
                            </td>
                          );
                        })}
                        <td><span className="number-pill blue-pill">{row.fbs + row.receiving}</span></td>
                        <td><span className="number-pill green-pill">{row.toSale}</span></td>
                        <td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td>
                        <td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loading && <div className="loading-state"><span className="loader" /><strong>Загружаем данные из {marketplaceName}</strong><small>Остатки и статусы FBS собираются в единый отчёт</small></div>}
                {!loading && !filteredRows.length && <div className="empty-state"><strong>{error ? "Данные пока не загружены" : "Ничего не найдено"}</strong><span>{error ? `Проверьте подключение ${marketplaceCode} API.` : "Попробуйте изменить поиск или фильтры."}</span></div>}
              </div>
              <footer className="table-footer">
                <span><i className={error ? "live-dot offline" : "live-dot"} />{updatedAt ? `Остатки обновлены в ${formatSyncTime(updatedAt)} МСК` : "Ожидаем синхронизацию"}</span>
                <button type="button" onClick={() => { setQuery(""); setFilter("Все"); setWarehouse("Все склады"); setStockFfWarehouseId("all"); setStockFfCompareIds([]); setStockFfCompareOpen(false); }}>Сбросить фильтры</button>
              </footer>
            </section>

            {activeView === "reports" && <section className="reports-panel" id="reports"><div className="section-heading"><div><span className="section-kicker">ГОТОВЫЕ ВЫГРУЗКИ</span><h2>Скачать данные из кабинета</h2></div><span className="period-pill">CSV · Excel</span></div><div className="reports-grid"><article className="report-card"><span className="report-symbol blue">□</span><div><strong>Все остатки</strong><p>Артикулы и количество по каждому складу</p><small>{rows.length} артикулов · {warehouseNames.length} складов {marketplaceCode}</small></div><button type="button" onClick={() => downloadCsv(rows, `vse-ostatki-${isOzon ? "ozon" : "wb"}`)} disabled={!rows.length}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol amber">→</span><div><strong>FBS-движение</strong><p>Новые, переданные {marketplaceCode} и завершённые товары</p><small>{counts.transit} артикулов · {activeFbsTotal} активных единиц</small></div><button type="button" onClick={() => downloadCsv(rows.filter(hasFbsMovement), `fbs-${isOzon ? "ozon" : "wb"}`)} disabled={!counts.transit}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol green">▤</span><div><strong>Остатки ФФ из {marketplaceCode} API</strong><p>Видимые FBS-склады и остатки по артикулам</p><small>{visibleManualWarehouses.length} складов ФФ</small></div><button type="button" onClick={() => downloadCsv(rows, "ostatki-ff")} disabled={!rows.length}>Скачать ↓</button></article></div></section>}
          </>}
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <aside className="drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`Карточка товара ${selected.name}`}>
            <button className="close-btn" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <span className="drawer-kicker">КАРТОЧКА ТОВАРА · {marketplaceCode} API</span>
            <div className="drawer-product"><span className="product-swatch large" style={{ background: selected.color }}>{selected.name.charAt(0).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.sku}{selected.nmId ? ` · ${marketplaceCode} ${selected.nmId}` : ""}</p></div></div>
            <div className="drawer-total"><span>Фактический остаток на {marketplaceCode}</span><strong>{formatNumber.format(stockTotal(selected))} <small>шт.</small></strong></div>
            <div className="warehouse-list">{Object.entries(selected.warehouses).sort((a, b) => b[1] - a[1]).map(([name, value]) => <div key={name}><span><i />{name}</span><strong>{formatNumber.format(value)} шт.</strong></div>)}{!Object.keys(selected.warehouses).length && <div><span>Нет остатков</span><strong>0 шт.</strong></div>}</div>
            <p className="drawer-stock-note">Этот остаток уже находится на складах {marketplaceName} и недоступен для FBS.</p>
            <h3>Остатки на складах ФФ</h3>
            <div className="warehouse-list ff-stock-readonly">{visibleManualWarehouses.map((item) => <div key={item.id}><span><i />{formatManualWarehouse(item)}</span><strong>{formatNumber.format(selected.ffStock[item.id] ?? 0)} шт.</strong></div>)}</div>
            <p className="drawer-stock-note">Остатки FBS получены из {marketplaceCode} API. Ручной Excel сохраняется только как резерв для непубличных остатков и партий.</p>
            <h3>Активные FBS по складам</h3>
            <div className="drawer-fbs-locations">{fbsLocations.map((location) => <div key={location.id}><span><strong>{location.city}</strong><small>{location.label}</small></span><b>{(selected.fbsByLocation?.[location.id] ?? 0) + (selected.receivingByLocation?.[location.id] ?? 0)} шт.</b></div>)}</div>
            <h3>Текущее движение FBS</h3>
            <div className="timeline"><div className="timeline-item done"><i>1</i><div><strong>Новые FBS</strong><span>{selected.fbs} шт. в статусах новых заказов</span></div></div><div className="timeline-item active"><i>2</i><div><strong>Переданы {marketplaceCode}</strong><span>{selected.receiving} шт. в доставке или на сортировке {marketplaceName}</span></div></div><div className="timeline-item"><i>3</i><div><strong>Продано</strong><span>{selected.toSale} шт. завершено без отмен</span></div></div></div>
            <p className="drawer-note">Данные {marketplaceName} обновлены в {selected.updated} МСК</p>
          </aside>
        </div>
      )}
    </main>
  );
}
