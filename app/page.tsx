"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as CFB from "cfb";
import * as XLSX from "xlsx";

type StockStatus = "В норме" | "Мало" | "Заканчивается";
type View = "overview" | "stock" | "fbs" | "sales" | "analytics" | "reports" | "fulfillment" | "manual" | "cabinets";
type FulfillmentList = "available" | "reserved" | "receiving" | "toSale";
type AnalyticsChannel = "all" | "fbs" | "fbo";
type FbsBreakdown = Record<string, number>;
type FfStock = Record<string, number>;
type FfExpiry = Record<string, string | null>;
type FfBatch = { location: string; batchCode: string; expiresAt: string | null; quantity: number };
type FfBatches = Record<string, FfBatch[]>;
type CabinetSummary = { id: "metanutrix"; name: string; configured: boolean };

type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
  wbWarehouseId: number | null;
  wbWarehouseName: string | null;
  isHidden: boolean;
};

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

type InventoryResponse = {
  configured: boolean;
  cabinet?: CabinetSummary | null;
  rows?: StockRow[];
  warehouseNames?: string[];
  manualWarehouses?: ManualWarehouse[];
  totals?: DashboardTotals;
  warnings?: string[];
  updatedAt?: string;
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
  source: { fbs: "sales" | "orders"; fboAvailable: boolean; retryAt: string | null; retryExact: boolean };
  warnings: string[];
  updatedAt: string;
};

type ImportItem = { sku: string; nmId: number | null; quantity: number; batchCode: string; expiresAt?: string | null };
type ImportPreview = { fileName: string; sheetName: string; items: ImportItem[]; skipped: number; hasExpiryColumn: boolean; hasBatchColumn: boolean };
type FfOrderExport = { orderId: number; article: string; quantity: number; sticker: string | null };
type FfOrdersExportResponse = {
  warehouse?: { id: string; city: string; name: string };
  orders?: FfOrderExport[];
  missingStickers?: number;
  error?: string;
};

const defaultManualWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10, wbWarehouseId: 1692397, wbWarehouseName: null, isHidden: false },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20, wbWarehouseId: null, wbWarehouseName: null, isHidden: false },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30, wbWarehouseId: null, wbWarehouseName: null, isHidden: false },
];
const emptyFbsBreakdown: FbsBreakdown = {};
const emptyTotals: DashboardTotals = { available: 0, ffTotal: 0, ffStock: {}, fbs: 0, fbsByLocation: emptyFbsBreakdown, sales7d: 0, receiving: 0, toSale: 0, risk: 0, activeSupplies: 0 };
const formatNumber = new Intl.NumberFormat("ru-RU");
const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "WILDBERRIES · ОПЕРАЦИИ", title: "Остатки и движение товаров" },
  stock: { eyebrow: "СКЛАДЫ · АРТИКУЛЫ", title: "Остатки по всем складам" },
  fbs: { eyebrow: "FBS · ПОСЛЕДНИЕ 30 ДНЕЙ", title: "Отгрузки и приёмка" },
  sales: { eyebrow: "ПРОДАЖИ · ПОТРЕБНОСТЬ", title: "Продажи и потребность ФФ" },
  analytics: { eyebrow: "АНАЛИТИКА · РУКОВОДИТЕЛЮ", title: "Продажи FBS и FBO" },
  reports: { eyebrow: "ВЫГРУЗКИ · CSV", title: "Отчёты по кабинету" },
  fulfillment: { eyebrow: "ФУЛФИЛМЕНТ · СКЛАДЫ", title: "ФФ — остатки и движение" },
  manual: { eyebrow: "ФУЛФИЛМЕНТ · РУЧНЫЕ ОСТАТКИ", title: "Склады ФФ и импорт Excel" },
  cabinets: { eyebrow: "КАБИНЕТЫ · МАРКЕТПЛЕЙСЫ", title: "Выберите кабинет" },
};

function stockTotal(row: StockRow) {
  return Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
}

function availableFfStock(row: StockRow, warehouseId: string) {
  return Math.max(0, (row.ffStock[warehouseId] ?? 0) - (row.fbsByLocation[warehouseId] ?? 0));
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

function downloadFfOrdersWorkbook(warehouse: { city: string; name: string }, orders: FfOrderExport[]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Артикул продавца", "Кол-во", "Стикер WB"],
    ...orders.map((order) => [order.article, order.quantity, order.sticker ? "" : "Стикер не получен"]),
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

  const images = orders.flatMap((order, orderIndex) => order.sticker ? [{ orderIndex, data: base64ToBytes(order.sticker) }] : []);
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

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [cabinet, setCabinet] = useState<CabinetSummary | null>(null);
  const [availableCabinets, setAvailableCabinets] = useState<CabinetSummary[]>([]);
  const [cabinetSwitchingId, setCabinetSwitchingId] = useState<CabinetSummary["id"] | null>(null);
  const [cabinetSwitchError, setCabinetSwitchError] = useState<string | null>(null);
  const [adminLogin, setAdminLogin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("overview");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [warehouseNames, setWarehouseNames] = useState<string[]>([]);
  const [manualWarehouses, setManualWarehouses] = useState<ManualWarehouse[]>(defaultManualWarehouses);
  const [totals, setTotals] = useState<DashboardTotals>(emptyTotals);
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("Все склады");
  const [salesWarehouseId, setSalesWarehouseId] = useState("all");
  const [salesProductScope, setSalesProductScope] = useState<"ff" | "all">("ff");
  const [salesTargetDays, setSalesTargetDays] = useState(14);
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
  const [newWarehouseCity, setNewWarehouseCity] = useState("");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseMessage, setWarehouseMessage] = useState<string | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [warehouseLinkDrafts, setWarehouseLinkDrafts] = useState<Record<string, { wbWarehouseId: string; wbWarehouseName: string }>>({});
  const [warehouseLinkSavingId, setWarehouseLinkSavingId] = useState<string | null>(null);
  const [importWarehouseId, setImportWarehouseId] = useState("kazan");
  const [importMode, setImportMode] = useState<"replace" | "add">("replace");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const loadManualWarehouses = useCallback(async () => {
    try {
      const response = await fetch("/api/ff-warehouses", { cache: "no-store" });
      const data = await response.json() as { warehouses?: ManualWarehouse[]; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (response.ok && data.warehouses?.length) setManualWarehouses(data.warehouses);
    } catch {
      // The dashboard remains usable with the built-in warehouses until D1 reconnects.
    }
  }, []);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as InventoryResponse;
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      setConfigured(data.configured);
      setWarnings(data.warnings ?? []);
      if (data.cabinet) setCabinet(data.cabinet);
      if (data.manualWarehouses?.length) setManualWarehouses(data.manualWarehouses);
      if (!response.ok) throw new Error(data.error || "Не удалось получить данные Wildberries");
      setRows(data.rows ?? []);
      setWarehouseNames(data.warehouseNames ?? []);
      setTotals(data.totals ? { ...emptyTotals, ...data.totals, ffStock: data.totals.ffStock ?? {}, fbsByLocation: { ...emptyFbsBreakdown, ...data.totals.fbsByLocation } } : emptyTotals);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось получить данные Wildberries");
    } finally {
      setLoading(false);
    }
  }, []);

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
      if (!response.ok) throw new Error(data.error || "Не удалось получить аналитику Wildberries");
      setAnalytics(data);
    } catch (analyticsLoadError) {
      setAnalyticsError(analyticsLoadError instanceof Error ? analyticsLoadError.message : "Не удалось получить аналитику Wildberries");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsRange]);

  const analyticsRetryAt = analytics?.source.retryAt ?? null;
  const analyticsRetrySeconds = useMemo(() => {
    if (!analyticsRetryAt) return null;
    const milliseconds = Date.parse(analyticsRetryAt) - analyticsClock;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : null;
  }, [analyticsRetryAt, analyticsClock]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json() as { authenticated?: boolean; cabinet?: CabinetSummary | null; cabinets?: CabinetSummary[] };
        setAuthState(data.authenticated ? "authenticated" : "unauthenticated");
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
    if (authState !== "authenticated" || activeView !== "analytics") return;
    const timer = window.setTimeout(() => void loadAnalytics(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, authState, analyticsRange, loadAnalytics]);

  useEffect(() => {
    if (!analyticsRetryAt) return;
    const timer = window.setInterval(() => setAnalyticsClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [analyticsRetryAt]);

  useEffect(() => {
    if (authState !== "authenticated" || activeView !== "analytics" || !analyticsRetryAt) return;
    const delay = Math.max(0, Date.parse(analyticsRetryAt) - Date.now()) + 250;
    const timer = window.setTimeout(() => void loadAnalytics(analyticsRange, true), delay);
    return () => window.clearTimeout(timer);
  }, [activeView, analyticsRange, analyticsRetryAt, authState, loadAnalytics]);

  const visibleManualWarehouses = useMemo(() => manualWarehouses.filter((warehouse) => !warehouse.isHidden), [manualWarehouses]);

  const selectedImportWarehouseId = manualWarehouses.some((item) => item.id === importWarehouseId)
    ? importWarehouseId
    : manualWarehouses[0]?.id ?? "";

  const fbsLocations = useMemo(() => {
    const locations = visibleManualWarehouses.map((warehouse) => ({
      id: warehouse.id,
      city: warehouse.city,
      label: warehouse.wbWarehouseId
        ? warehouse.wbWarehouseName || `WB FBS №${warehouse.wbWarehouseId}`
        : "WB FBS не назначен",
    }));
    if ((totals.fbsByLocation.unassigned ?? 0) > 0) locations.push({ id: "unassigned", city: "Не назначено", label: "Выберите склад ФФ" });
    return locations;
  }, [visibleManualWarehouses, totals.fbsByLocation.unassigned]);

  const ffReservedFromStockTotal = useMemo(() => visibleManualWarehouses.reduce((sum, warehouse) => {
    const physicalStock = totals.ffStock[warehouse.id] ?? 0;
    const reserved = totals.fbsByLocation[warehouse.id] ?? 0;
    return sum + Math.min(physicalStock, reserved);
  }, 0), [visibleManualWarehouses, totals.ffStock, totals.fbsByLocation]);
  const ffAvailableTotal = Math.max(0, totals.ffTotal - ffReservedFromStockTotal);

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

  const fulfillmentRows = useMemo(() => {
    if (!selectedFulfillmentWarehouse) return [];
    const warehouseId = selectedFulfillmentWarehouse.warehouse.id;
    const term = query.trim().toLowerCase();
    const selectedQuantity = (row: StockRow) => {
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
    available: { kicker: "ОСТАТКИ НА ФФ", title: "Доступный остаток по артикулам", empty: "На этом ФФ нет доступного остатка", primary: "Доступно ФФ", footer: "Товары, которые можно отгружать прямо сейчас" },
    reserved: { kicker: "FBS В РЕЗЕРВЕ", title: "Заказы FBS в резерве", empty: "Нет товаров в резерве FBS", primary: "FBS в резерве", footer: "Эти единицы уже вычтены из доступного остатка" },
    receiving: { kicker: "ОЖИДАЮТ WB", title: "Товары, ожидающие приёмку WB", empty: "Нет товаров со статусом waiting", primary: "Ожидают WB", footer: "Заказы отгружены и ожидают приёмки Wildberries" },
    toSale: { kicker: "ОЖИДАЮТ ПРОДАЖИ", title: "Товары, ожидающие продажи", empty: "Нет заказов, готовых к продаже", primary: "Ожидают продажи", footer: "Статусы WB: sorted / ready for pickup" },
  };
  const activeFulfillmentListMeta = fulfillmentListMeta[fulfillmentList];

  const selectedSalesWarehouse = visibleManualWarehouses.find((item) => item.id === salesWarehouseId) ?? null;
  const salesRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.map((row) => {
      const stock = selectedSalesWarehouse
        ? availableFfStock(row, selectedSalesWarehouse.id)
        : visibleManualWarehouses.reduce((sum, warehouse) => sum + availableFfStock(row, warehouse.id), 0);
      const sales = selectedSalesWarehouse
        ? row.sales7dByLocation[selectedSalesWarehouse.id] ?? 0
        : row.sales7d;
      const averagePerDay = sales / 7;
      const targetStock = Math.ceil(averagePerDay * salesTargetDays);
      const need = Math.max(0, targetStock - stock);
      const coverageDays = sales > 0 ? Math.floor(stock / averagePerDay) : null;
      return { row, stock, sales, averagePerDay, targetStock, need, coverageDays };
    }).filter(({ row, stock }) => {
      const hasStockOnFf = stock > 0;
      const matchesScope = salesProductScope === "all" || hasStockOnFf;
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      return matchesScope && matchesQuery;
    }).sort((left, right) => right.need - left.need || right.sales - left.sales || left.row.name.localeCompare(right.row.name, "ru"));
  }, [rows, query, selectedSalesWarehouse, salesProductScope, salesTargetDays, visibleManualWarehouses]);

  const salesTotals = useMemo(() => salesRows.reduce((total, item) => ({ sales: total.sales + item.sales, stock: total.stock + item.stock, need: total.need + item.need }), { sales: 0, stock: 0, need: 0 }), [salesRows]);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      const matchesFilter = filter === "Все" || (filter === "Дефицит" && row.status !== "В норме") || (filter === "Активные FBS" && row.fbs > 0);
      const matchesWarehouse = warehouse === "Все склады" || (row.warehouses[warehouse] ?? 0) > 0;
      const matchesView = activeView === "fbs" ? row.fbs > 0 : true;
      return matchesQuery && matchesFilter && matchesWarehouse && matchesView;
    });
  }, [rows, query, filter, warehouse, activeView]);

  const counts = useMemo(() => ({
    all: rows.length,
    risk: rows.filter((row) => row.status !== "В норме").length,
    transit: rows.filter((row) => row.fbs > 0).length,
  }), [rows]);
  const viewTotal = activeView === "fbs" ? rows.filter((row) => row.fbs > 0).length : rows.length;
  const stockTitle = activeView === "fbs" ? "Артикулы в FBS-движении" : "Все товары Wildberries";
  const analyticsFactAvailable = Boolean(analytics?.source.fboAvailable);
  const analyticsTrendChannel: AnalyticsChannel = analyticsFactAvailable ? analyticsChannel : "fbs";
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
  const analyticsChannelTitle = analyticsTrendChannel === "all" ? "FBS и FBO" : analyticsTrendChannel.toUpperCase();
  const analyticsTrendTitle = analyticsFactAvailable ? `${analyticsChannelTitle} по дням` : "Созданные FBS-заказы по дням";
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
    };
    const rawWbWarehouseId = draft.wbWarehouseId.trim();
    const wbWarehouseId = rawWbWarehouseId ? Number(rawWbWarehouseId) : null;
    if (rawWbWarehouseId && (!Number.isInteger(wbWarehouseId) || wbWarehouseId <= 0 || wbWarehouseId > 2_147_483_647)) {
      setWarehouseError("ID склада WB должен быть положительным целым числом");
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
          isHidden: warehouseToUpdate.isHidden,
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
        },
      }));
      setWarehouseMessage(wbWarehouseId ? `${formatManualWarehouse(warehouseToUpdate)} привязан к WB` : `${formatManualWarehouse(warehouseToUpdate)} отвязан от WB`);
      await loadData(true);
    } catch (saveError) {
      setWarehouseError(saveError instanceof Error ? saveError.message : "Не удалось сохранить привязку к WB");
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
          isHidden: !warehouseToUpdate.isHidden,
        }),
      });
      const data = await response.json() as { warehouse?: ManualWarehouse; error?: string };
      if (!response.ok || !data.warehouse) throw new Error(data.error || "Не удалось изменить видимость склада");
      setManualWarehouses((current) => current.map((item) => item.id === warehouseToUpdate.id ? data.warehouse as ManualWarehouse : item));
      setWarehouseMessage(data.warehouse.isHidden ? `${formatManualWarehouse(data.warehouse)} скрыт из витрины` : `${formatManualWarehouse(data.warehouse)} снова показан`);
      await loadData(true);
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
      const data = await response.json() as { authenticated?: boolean; cabinet?: CabinetSummary; cabinets?: CabinetSummary[]; error?: string };
      if (!response.ok || !data.authenticated) throw new Error(data.error || "Не удалось выполнить вход");
      setAdminPassword("");
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
    setRows([]);
    setSelected(null);
    setCabinet(null);
    setAvailableCabinets([]);
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
      const data = await response.json() as { authenticated?: boolean; cabinet?: CabinetSummary; cabinets?: CabinetSummary[]; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.cabinet) throw new Error(data.error || "Не удалось открыть кампанию");
      setCabinet(data.cabinet);
      setAvailableCabinets(data.cabinets ?? []);
      setRows([]);
      setWarehouseNames([]);
      setTotals(emptyTotals);
      setManualWarehouses(defaultManualWarehouses);
      setSelected(null);
      setSelectedFulfillmentWarehouseId(null);
      setQuery("");
      setFilter("Все");
      setActiveView("overview");
      await Promise.all([loadData(true), loadManualWarehouses()]);
    } catch (switchError) {
      setCabinetSwitchError(switchError instanceof Error ? switchError.message : "Не удалось открыть кампанию");
    } finally {
      setCabinetSwitchingId(null);
    }
  };

  const downloadCsv = (sourceRows: StockRow[], suffix: string) => {
    const header = ["Артикул продавца", "Артикул WB", ...warehouseNames, "Всего на WB", ...visibleManualWarehouses.flatMap((item) => [`ФФ ${formatManualWarehouse(item)}`, `Срок годности · ${formatManualWarehouse(item)}`]), "FBS всего", ...fbsLocations.map((location) => `FBS ${location.city}`), "На приёмке", "Ожидают продажи", "Статус"];
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
      setFfOrdersExportError("Сначала привяжите этот ФФ к складу WB — укажите ID склада в настройках.");
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
      if (!response.ok) throw new Error(data.error || "Не удалось получить FBS-заказы из Wildberries");
      const orders = data.orders ?? [];
      if (!orders.length) {
        setFfOrdersExportMessage("Для этого ФФ нет актуальных FBS-заказов на сборке или в доставке.");
        return;
      }
      downloadFfOrdersWorkbook(warehouse, orders);
      setFfOrdersExportMessage(data.missingStickers ? `Скачано ${orders.length} заказов. Для ${data.missingStickers} WB пока не вернул стикер.` : `Скачано ${orders.length} актуальных FBS-заказов со стикерами WB.`);
    } catch (downloadError) {
      setFfOrdersExportError(downloadError instanceof Error ? downloadError.message : "Не удалось подготовить Excel");
    } finally {
      setFfOrdersExportLoading(false);
    }
  };

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
          <button type="button" className={`nav-item ${activeView === "fbs" ? "active" : ""}`} onClick={() => navigateTo("fbs")}><span className="nav-symbol">→</span>FBS-отгрузки<span className="nav-badge">{totals.fbs}</span></button>
          <button type="button" className={`nav-item ${activeView === "sales" ? "active" : ""}`} onClick={() => navigateTo("sales")}><span className="nav-symbol">↗</span>Продажи</button>
          <button type="button" className={`nav-item ${activeView === "analytics" ? "active" : ""}`} onClick={() => navigateTo("analytics")}><span className="nav-symbol">⌁</span>Анализ</button>
          <button type="button" className={`nav-item ${activeView === "fulfillment" || activeView === "manual" ? "active" : ""}`} onClick={() => navigateTo("fulfillment")}><span className="nav-symbol">▤</span>ФФ</button>
          <button type="button" className={`nav-item ${activeView === "reports" ? "active" : ""}`} onClick={() => navigateTo("reports")}><span className="nav-symbol">≡</span>Отчёты</button>
        </nav>
        <div className="sidebar-bottom"><div className="connection"><span className={error ? "live-dot offline" : "live-dot"} />{error ? "Нужна проверка подключения" : "Подключено к WB API"}</div><button type="button" className="profile" onClick={() => navigateTo("cabinets")}><span className="avatar">WB</span><span><strong>{cabinet?.name ?? "Wildberries"}</strong><small>{configured ? "Кабинеты и подключения" : "Токен не добавлен"}</small></span><span className="chevron">›</span></button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{viewTitles[activeView].eyebrow}</p><h1>{viewTitles[activeView].title}</h1></div><div className="header-actions"><div className="sync-state"><span className={error ? "live-dot offline" : "live-dot"} /><span>Последнее обновление<br/><strong>{formatSyncTime(updatedAt)} МСК</strong></span></div><button className="logout-btn" type="button" onClick={() => void logoutAdmin()}>Выйти</button><button className="secondary-btn" type="button" onClick={() => void loadData(true)} disabled={loading}><span className={loading ? "spin" : ""}>↻</span>{loading ? "Обновляем" : "Обновить"}</button><button className="primary-btn" type="button" onClick={() => downloadCsv(filteredRows, "ostatki-wb")} disabled={!rows.length}>Экспорт<span>↓</span></button></div></header>

        <div className="content" id="overview">
          {cabinet && <section className={`cabinet-strip ${cabinet.configured ? "ready" : "waiting"}`}>
            <div><span className="cabinet-strip-mark">WB</span><span><small>ТЕКУЩАЯ КАМПАНИЯ</small><strong>{cabinet.name}</strong></span></div>
            <p>{cabinet.configured ? "Свои товары, ФФ-склады и сроки годности. Переключение кампаний не требует нового входа." : "Ожидает API-токен Wildberries. Вход и отдельные склады уже готовы."}</p>
            <button type="button" onClick={() => navigateTo("cabinets")}>Сменить кампанию</button>
          </section>}
          {error && <section className="api-notice" role="alert"><span className="api-notice-icon">!</span><div><strong>{error}</strong><p>{configured ? "Для полной загрузки токену нужны категории: Контент, Маркетплейс и Аналитика." : "Безопасный токен хранится только на сервере и не передаётся в браузер."}</p></div><button type="button" onClick={() => void loadData(true)}>Проверить снова</button></section>}
          {!error && warnings.length > 0 && <section className="warning-strip"><span>!</span><p>{warnings.join(" · ")}</p></section>}

          {activeView === "cabinets" ? (
            <section className="cabinet-manager">
              <div className="section-heading cabinet-manager-heading">
                <div><span className="section-kicker">МАРКЕТПЛЕЙС → КАМПАНИЯ → СВОИ ФФ</span><h2>Один вход — все ваши кампании</h2><p className="section-note">Внутри одного доступа выберите нужную кампанию. У каждой свои товары, ФФ-склады, остатки, заказы, поставки и продажи — данные не смешиваются.</p></div>
                <button className="secondary-btn cabinet-back-btn" type="button" onClick={() => navigateTo("overview")}>К обзору</button>
              </div>
              <div className="cabinet-platform-list">
                <article className="cabinet-platform-card wb-platform">
                  <div className="cabinet-platform-head"><span className="platform-mark wb-mark">WB</span><div><strong>Wildberries</strong><small>{availableCabinets.length} кампании этого доступа</small></div></div>
                  <div className="cabinet-account-list">
                    {availableCabinets.map((account) => {
                      const current = cabinet?.id === account.id;
                      return <div className={`cabinet-account ${current ? "current" : ""}`} key={account.id}><span><strong>{account.name}</strong><small>Свои ФФ и остатки</small></span>{current ? <b>Открыта</b> : <button type="button" onClick={() => void switchCabinet(account.id)} disabled={cabinetSwitchingId === account.id}>{cabinetSwitchingId === account.id ? "Открываем…" : "Открыть"}</button>}</div>;
                    })}
                  </div>
                  {cabinetSwitchError && <p className="cabinet-switch-error">{cabinetSwitchError}</p>}
                  {!cabinetSwitchError && <p>Выберите кампанию — повторный логин не нужен.</p>}
                </article>
                <article className="cabinet-platform-card pending-platform">
                  <div className="cabinet-platform-head"><span className="platform-mark ym-mark">ЯМ</span><div><strong>Яндекс Маркет</strong><small>Кабинет не подключён</small></div></div>
                  <div className="platform-connect"><strong>Подключим отдельный кабинет</strong><span>Понадобятся API-ключ и ID кампании продавца.</span></div>
                  <p>После подключения это будет ещё одна кампания в этом же входе.</p>
                </article>
                <article className="cabinet-platform-card pending-platform">
                  <div className="cabinet-platform-head"><span className="platform-mark oz-mark">OZ</span><div><strong>Ozon Seller</strong><small>Кабинет не подключён</small></div></div>
                  <div className="platform-connect"><strong>Подключим отдельный кабинет</strong><span>Понадобятся Client ID и API-ключ Ozon.</span></div>
                  <p>После подключения это будет ещё одна кампания в этом же входе.</p>
                </article>
              </div>
              <p className="cabinet-manager-note">Новая кампания добавляется в этот же доступ, но получает свой отдельный контур и собственные ФФ-склады. Никакие остатки между кампаниями не копируются.</p>
            </section>
          ) : activeView === "fulfillment" ? (
            <section className="fulfillment-panel">
              {!selectedFulfillmentWarehouse ? <>
                <div className="section-heading fulfillment-heading">
                  <div><span className="section-kicker">ВЫБЕРИТЕ СКЛАД ФФ</span><h2>Куда смотреть остатки и движение</h2><p className="section-note">Откройте склад, чтобы увидеть его остаток и FBS-движение по каждому артикулу.</p></div>
                  <button className="secondary-btn" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button>
                </div>
                <div className="fulfillment-warehouse-grid">{fulfillmentWarehouses.map((item) => <button className="fulfillment-warehouse-card" type="button" key={item.warehouse.id} onClick={() => openFulfillmentWarehouse(item.warehouse.id)}><span className="fulfillment-card-top"><i>□</i><small>{item.warehouse.wbWarehouseId ? `WB FBS · ${item.warehouse.wbWarehouseName || `№${item.warehouse.wbWarehouseId}`}` : "WB FBS не назначен"}</small><b>›</b></span><strong>{item.warehouse.city}</strong><span className="fulfillment-card-name">{item.warehouse.name}</span><span className="fulfillment-card-stock"><b>{formatNumber.format(item.stock)}</b> шт. доступно</span><span className="fulfillment-card-stats">В базе {formatNumber.format(item.physicalStock)} · резерв FBS {item.fbs}</span></button>)}</div>
                {!fulfillmentWarehouses.length && <div className="empty-state"><strong>Добавьте первый склад ФФ</strong><span>После этого сюда будут попадать остатки из Excel и заказы WB.</span></div>}
                <p className="fulfillment-note">«Ожидают продажи» показывает FBS-заказы в пути. Финансовый факт продажи и возвраты добавляются через Finance API WB.</p>
              </> : <>
                <div className="section-heading fulfillment-heading">
                  <div><button className="back-link" type="button" onClick={() => { setSelectedFulfillmentWarehouseId(null); setQuery(""); }}>‹ Все склады ФФ</button><span className="section-kicker">ФФ · СКЛАД В РАБОТЕ</span><h2>{formatManualWarehouse(selectedFulfillmentWarehouse.warehouse)}</h2><p className="section-note">Остатки на этом ФФ и FBS-заказы, отгруженные с привязанного склада WB.</p></div>
                  <div className="fulfillment-heading-actions"><button className="secondary-btn fulfillment-export-btn" type="button" onClick={() => void downloadFfOrders(selectedFulfillmentWarehouse.warehouse)} disabled={ffOrdersExportLoading || !selectedFulfillmentWarehouse.warehouse.wbWarehouseId}>{ffOrdersExportLoading ? "Собираем стикеры…" : "Excel: заказы + стикеры ↓"}</button><button className="secondary-btn" type="button" onClick={() => navigateTo("manual")}>Настроить склад</button></div>
                </div>
                <div className="fulfillment-export-note"><span>Только актуальные FBS-заказы этого ФФ. Одна строка — один заказ: артикул, количество и стикер WB.</span>{ffOrdersExportMessage && <strong className="success">{ffOrdersExportMessage}</strong>}{ffOrdersExportError && <strong className="error">{ffOrdersExportError}</strong>}</div>
                <div className="fulfillment-metric-grid" role="group" aria-label="Списки по статусу товара">
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "available" ? "active" : ""}`} aria-pressed={fulfillmentList === "available"} onClick={() => { setFulfillmentList("available"); setQuery(""); }}><span>Доступно на ФФ</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.stock)} <small>шт.</small></strong><p>В базе {formatNumber.format(selectedFulfillmentWarehouse.physicalStock)} · резерв FBS {selectedFulfillmentWarehouse.fbs}</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "reserved" ? "active" : ""}`} aria-pressed={fulfillmentList === "reserved"} onClick={() => { setFulfillmentList("reserved"); setQuery(""); }}><span>FBS в резерве</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.fbs)} <small>шт.</small></strong><p>Вычтено из доступного остатка</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "receiving" ? "active" : ""}`} aria-pressed={fulfillmentList === "receiving"} onClick={() => { setFulfillmentList("receiving"); setQuery(""); }}><span>Ожидают WB</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.receiving)} <small>шт.</small></strong><p>Статус waiting</p></button>
                  <button type="button" className={`fulfillment-metric ${fulfillmentList === "toSale" ? "active" : ""}`} aria-pressed={fulfillmentList === "toSale"} onClick={() => { setFulfillmentList("toSale"); setQuery(""); }}><span>Ожидают продажи</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.toSale)} <small>шт.</small></strong><p>sorted / ready for pickup</p></button>
                </div>
                <section className="stock-card fulfillment-stock-card"><div className="stock-header"><div><span className="section-kicker">{activeFulfillmentListMeta.kicker}</span><h2 aria-live="polite">{activeFulfillmentListMeta.title}</h2><p className="fulfillment-list-note">Нажмите на карточку выше, чтобы переключить список.</p></div><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по выбранному списку склада ФФ" /></label></div><div className="fulfillment-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{activeFulfillmentListMeta.primary}</th><th>{fulfillmentList === "available" ? "FBS в резерве" : "Доступно ФФ"}</th><th>{fulfillmentList === "receiving" ? "FBS в резерве" : "Ожидают WB"}</th><th>Статус ФФ</th><th /></tr></thead><tbody>{fulfillmentRows.map((row) => { const warehouseId = selectedFulfillmentWarehouse.warehouse.id; const availableStock = availableFfStock(row, warehouseId); const fbsReserve = row.fbsByLocation[warehouseId] ?? 0; const waitingForWb = row.receivingByLocation[warehouseId] ?? 0; const waitingForSale = row.toSaleByLocation[warehouseId] ?? 0; const primaryValue = fulfillmentList === "reserved" ? fbsReserve : fulfillmentList === "receiving" ? waitingForWb : fulfillmentList === "toSale" ? waitingForSale : availableStock; const secondaryValue = fulfillmentList === "available" ? fbsReserve : availableStock; const thirdValue = fulfillmentList === "receiving" ? fbsReserve : waitingForWb; const status = fulfillmentStockStatus(availableStock); const primaryClass = fulfillmentList === "available" ? `manual-stock-value ${availableStock === 0 ? "zero" : ""}` : fulfillmentList === "reserved" ? "number-pill blue-pill" : fulfillmentList === "receiving" ? "number-pill amber-pill" : "number-pill green-pill"; const secondaryClass = fulfillmentList === "available" ? "number-pill blue-pill" : `manual-stock-value ${availableStock === 0 ? "zero" : ""}`; const thirdClass = fulfillmentList === "receiving" ? "number-pill blue-pill" : "number-pill amber-pill"; return <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><span className={primaryClass}>{formatNumber.format(primaryValue)}{fulfillmentList === "available" && <small> шт.</small>}</span></td><td><span className={secondaryClass}>{formatNumber.format(secondaryValue)}{fulfillmentList !== "available" && <small> шт.</small>}</span></td><td><span className={thirdClass}>{formatNumber.format(thirdValue)}</span></td><td><span className={`status ${status === "В норме" ? "ok" : status === "Мало" ? "low" : "critical"}`}><i />{status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>; })}</tbody></table>{!loading && !fulfillmentRows.length && <div className="empty-state"><strong>{activeFulfillmentListMeta.empty}</strong><span>Выберите другую карточку или проверьте привязку ФФ к складу WB.</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{fulfillmentRows.length} артикулов в выбранном списке</span><span>{activeFulfillmentListMeta.footer}</span></footer></section>
              </>}
            </section>
          ) : activeView === "manual" ? (
            <section className="manual-warehouses-panel">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">СКЛАДЫ ФУЛФИЛМЕНТА</span>
                  <h2>Куда отправляем товар</h2>
                  <p className="section-note">Склады FBS подтягиваются из WB автоматически. Excel и партии остаются резервным ручным учётом, если склад не ведётся в WB.</p>
                </div>
              </div>
              <div className="manual-layout">
                <article className="manual-card">
                  <h3>Ваши склады</h3>
                  <div className="manual-warehouse-list">{manualWarehouses.map((item) => {
                    const linkDraft = warehouseLinkDrafts[item.id] ?? {
                      wbWarehouseId: item.wbWarehouseId ? String(item.wbWarehouseId) : "",
                      wbWarehouseName: item.wbWarehouseName ?? "",
                    };
                    return <div className="manual-warehouse-item" key={item.id}>
                      <span className="warehouse-pin">□</span>
                      <div className="manual-warehouse-details"><strong>{item.city}</strong><small>{item.name}</small><em>{item.isHidden ? "Скрыт из витрины" : item.wbWarehouseId ? `Привязан к WB FBS · ${item.wbWarehouseName || `№${item.wbWarehouseId}`}` : "WB FBS не назначен"}</em></div>
                      <form className="warehouse-link-form" onSubmit={(event) => void saveWarehouseLink(item, event)}>
                        <label><span>ID склада WB</span><input value={linkDraft.wbWarehouseId} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseId: event.target.value } }))} inputMode="numeric" placeholder="Например, 1987385" /></label>
                        <label><span>Название в WB</span><input value={linkDraft.wbWarehouseName} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseName: event.target.value } }))} maxLength={120} placeholder="Например, Волгоград Upakovka" /></label>
                        <button type="submit" disabled={warehouseLinkSavingId === item.id}>{warehouseLinkSavingId === item.id ? "Сохраняем…" : "Связать с WB"}</button>
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
                    <p>Укажите «Артикул WB» (nmID) или «Артикул продавца» и «Количество». Для отдельных партий добавьте «Партия» и «Срок годности».</p>
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
                <div><span className="section-kicker">УПРАВЛЕНЧЕСКИЙ ОБЗОР · WILDBERRIES</span><h2>Продажи по каналам</h2><p>Сравнение FBS и FBO, а также эффективность каждого вашего ФФ за выбранный период.</p></div>
                <button className="secondary-btn analytics-refresh" type="button" onClick={() => void loadAnalytics(analyticsRange, true)} disabled={analyticsLoading || Boolean(analyticsRetrySeconds)} title={analyticsRetrySeconds ? "WB временно ограничил запросы" : undefined}><span className={analyticsLoading ? "spin" : ""}>↻</span>{analyticsLoading ? "Считаем" : analyticsRetrySeconds ? `Через ${formatCountdown(analyticsRetrySeconds)}` : "Обновить"}</button>
              </div>

              <div className="analytics-controls"><div className="analytics-periods" role="group" aria-label="Период аналитики">{[{ id: "7d", label: "Неделя" }, { id: "14d", label: "2 недели" }, { id: "30d", label: "Месяц" }, { id: "custom", label: "Свои даты" }].map((item) => <button type="button" key={item.id} className={analyticsPeriod === item.id ? "active" : ""} onClick={() => chooseAnalyticsPeriod(item.id as "7d" | "14d" | "30d" | "custom")}>{item.label}</button>)}</div><span className="analytics-period-label">{shortDate(analyticsRange.from)} — {shortDate(analyticsRange.to)}</span></div>
              {analyticsPeriod === "custom" && <div className="analytics-custom-dates"><label><span>С</span><input type="date" value={analyticsDraft.from} min={isoDate(89)} max={isoDate(0)} onChange={(event) => setAnalyticsDraft((value) => ({ ...value, from: event.target.value }))} /></label><label><span>По</span><input type="date" value={analyticsDraft.to} min={isoDate(89)} max={isoDate(0)} onChange={(event) => setAnalyticsDraft((value) => ({ ...value, to: event.target.value }))} /></label><button type="button" onClick={applyAnalyticsCustomPeriod}>Применить</button><small>Максимум 90 дней</small></div>}
              {analytics?.warnings.length ? <div className="analytics-warning">{analytics.warnings.map((warning) => <span key={warning}>! {warning}</span>)}</div> : null}
              {analyticsRetrySeconds !== null && analyticsRetrySeconds > 0 && <div className="analytics-retry-timer" role="status"><span>↻</span><div><strong>WB разрешит повторный запрос через {formatCountdown(analyticsRetrySeconds)}</strong><p>{analytics?.source.retryExact ? "Повторим автоматически, когда закончится ограничение WB." : "WB не прислал точное время — повторим автоматически по безопасному интервалу."}</p></div></div>}

              {analyticsLoading && !analytics ? <div className="analytics-loading"><span className="loader"/><strong>Собираем аналитику Wildberries</strong><small>Сверяем продажи и каналы за выбранный период</small></div> : analyticsError && !analytics ? <div className="empty-state"><strong>Аналитика пока недоступна</strong><span>{analyticsError}</span></div> : analytics ? <>
                <div className="analytics-kpi-grid">{analyticsFactAvailable ? <><article className="analytics-kpi total"><span>Продажи за период</span><strong>{formatNumber.format(analytics.summary.total)} <small>шт.</small></strong><p>FBS и FBO вместе</p></article><article className="analytics-kpi fbo"><span>Продажи FBO</span><strong>{formatNumber.format(analytics.summary.fbo)} <small>шт.</small></strong><p>{analytics.summary.fboShare}% от продаж</p></article><article className="analytics-kpi fbs"><span>Продажи FBS</span><strong>{formatNumber.format(analytics.summary.fbs)} <small>шт.</small></strong><p>{analytics.summary.fbsShare}% от продаж</p></article><article className="analytics-kpi share"><span>Доля FBS</span><strong>{analytics.summary.fbsShare}<small>%</small></strong><p>По факту продаж</p></article></> : <><article className="analytics-kpi total unavailable"><span>Факт продаж</span><strong>—</strong><p>WB временно не отдал статистику</p></article><article className="analytics-kpi fbo unavailable"><span>Продажи FBO</span><strong>—</strong><p>Не подменяем нулём</p></article><article className="analytics-kpi fbs orders"><span>Создано FBS-заказов</span><strong>{formatNumber.format(analytics.summary.fbs)} <small>шт.</small></strong><p>Это заказы, не продажи</p></article><article className="analytics-kpi share unavailable"><span>Сравнение каналов</span><strong>—</strong><p>Нет факта FBO для сравнения</p></article></>}</div>

                <div className="analytics-grid">
                  <section className="analytics-card analytics-trend-card"><div className="analytics-card-heading"><div><span className="section-kicker">ДИНАМИКА</span><h3>{analyticsTrendTitle}</h3></div>{analyticsFactAvailable ? <div className="analytics-channel-toggle" role="group" aria-label="Канал на графике"><button type="button" className={analyticsChannel === "all" ? "active" : ""} aria-pressed={analyticsChannel === "all"} onClick={() => { setAnalyticsChannel("all"); setAnalyticsHoverDate(null); }}>Вместе</button><button type="button" className={analyticsChannel === "fbs" ? "active fbs" : "fbs"} aria-pressed={analyticsChannel === "fbs"} onClick={() => { setAnalyticsChannel("fbs"); setAnalyticsHoverDate(null); }}>FBS</button><button type="button" className={analyticsChannel === "fbo" ? "active fbo" : "fbo"} aria-pressed={analyticsChannel === "fbo"} onClick={() => { setAnalyticsChannel("fbo"); setAnalyticsHoverDate(null); }}>FBO</button></div> : <span className="analytics-total-badge">Не факт продаж</span>}</div><div className="analytics-line-chart" onMouseLeave={() => setAnalyticsHoverDate(null)}><svg viewBox={`0 0 ${analyticsTrend.width} ${analyticsTrend.height}`} role="img" aria-label={`Линейный график ${analyticsTrendTitle}`} preserveAspectRatio="none"><g className="analytics-line-grid">{[0, 1, 2, 3, 4].map((index) => { const y = analyticsTrend.top + (analyticsTrend.plotHeight / 4) * index; const value = Math.round(analyticsTrend.max * (1 - index / 4)); return <g key={index}><line x1="18" x2="982" y1={y} y2={y}/><text x="2" y={y + 3}>{value}</text></g>; })}</g>{analyticsTrendChannel !== "fbs" && <path className="analytics-line fbo" d={analyticsTrend.fboPath}/>} {analyticsTrendChannel !== "fbo" && <path className="analytics-line fbs" d={analyticsTrend.fbsPath}/>} {analyticsTrend.points.map((point, index) => <g key={point.date}>{analyticsTrendChannel !== "fbs" && <circle className={`analytics-line-point fbo ${analyticsHoverDate === point.date ? "active" : ""}`} cx={point.x} cy={point.fboY} r={analyticsHoverDate === point.date ? 5 : 2.6}/>} {analyticsTrendChannel !== "fbo" && <circle className={`analytics-line-point fbs ${analyticsHoverDate === point.date ? "active" : ""}`} cx={point.x} cy={point.fbsY} r={analyticsHoverDate === point.date ? 5 : 2.6}/>} {(index === 0 || index === analyticsTrend.points.length - 1 || index % analyticsTrend.labelEvery === 0) && <text className="analytics-line-label" x={point.x} y={analyticsTrend.height - 8}>{shortDate(point.date)}</text>}</g>)}</svg><div className="analytics-line-hit-zones">{analyticsTrend.points.map((point) => <button type="button" key={point.date} className={analyticsHoverDate === point.date ? "active" : ""} style={{ left: `${(point.x / analyticsTrend.width) * 100}%`, width: `${Math.max(4, 100 / Math.max(1, analyticsTrend.points.length))}%` }} onMouseEnter={() => setAnalyticsHoverDate(point.date)} onFocus={() => setAnalyticsHoverDate(point.date)} onClick={() => setAnalyticsHoverDate(point.date)} aria-label={`${shortDate(point.date)}: ${analyticsFactAvailable ? `FBS ${point.fbs}, FBO ${point.fbo}` : `создано FBS-заказов ${point.fbs}`}`} />)}</div>{activeAnalyticsPoint && activeAnalyticsTrendPoint && <div className="analytics-line-tooltip" style={{ left: `${Math.min(88, Math.max(12, (activeAnalyticsTrendPoint.x / analyticsTrend.width) * 100))}%` }}><strong>{shortDate(activeAnalyticsPoint.date)}</strong>{analyticsFactAvailable ? <><span><i className="fbs"/>FBS <b>{formatNumber.format(activeAnalyticsPoint.fbs)} шт.</b></span><span><i className="fbo"/>FBO <b>{formatNumber.format(activeAnalyticsPoint.fbo)} шт.</b></span></> : <span><i className="fbs"/>Создано FBS <b>{formatNumber.format(activeAnalyticsPoint.fbs)} шт.</b></span>}</div>}</div><p className="analytics-card-note">{analyticsFactAvailable ? "Наведите на точку или дату — увидите продажи FBS и FBO за конкретный день." : "WB временно ограничил статистику: на графике только созданные FBS-заказы, не продажи."}</p></section>
                  <section className="analytics-card analytics-channel-card"><div className="analytics-card-heading"><div><span className="section-kicker">СТРУКТУРА</span><h3>{analyticsFactAvailable ? "Соотношение каналов" : "Факт продаж временно недоступен"}</h3></div><span className="analytics-total-badge">{analyticsFactAvailable ? `${formatNumber.format(analytics.summary.total)} шт.` : "Данные WB"}</span></div>{analyticsFactAvailable ? <><div className="analytics-channel-body"><div className="analytics-donut" style={{ background: `conic-gradient(#365df2 0 ${analytics.summary.fbsShare}%, #20a16d ${analytics.summary.fbsShare}% 100%)` }}><span><b>{analytics.summary.fbsShare}%</b><small>FBS</small></span></div><div className="analytics-channel-list"><div><span><i className="fbs"/>FBS</span><strong>{formatNumber.format(analytics.summary.fbs)} <small>шт.</small></strong></div><div><span><i className="fbo"/>FBO</span><strong>{formatNumber.format(analytics.summary.fbo)} <small>шт.</small></strong></div></div></div><p className="analytics-card-note">Факт продаж: возвраты не включены.</p></> : <div className="analytics-channel-unavailable"><span>!</span><div><strong>Не суммируем FBS-заказы с продажами FBO</strong><p>Когда WB вернёт статистику, появятся фактические продажи и корректное соотношение каналов.</p></div></div>}</section>
                </div>

                <section className="analytics-card analytics-ff-card"><div className="analytics-card-heading"><div><span className="section-kicker">СРАВНЕНИЕ ФФ</span><h3>{analyticsFactAvailable ? "Продажи FBS между складами" : "Созданные FBS-заказы между складами"}</h3></div><span className="analytics-total-badge">{analyticsFactAvailable ? "Факт продаж" : "Не продажи"}</span></div><div className="analytics-ff-bars">{analytics.fbsWarehouses.map((warehouse) => { const max = Math.max(1, ...analytics.fbsWarehouses.map((item) => item.value)); return <div className="analytics-ff-row" key={warehouse.id}><div><strong>{warehouse.name}</strong><small>{warehouse.sublabel}</small></div><span className="analytics-ff-track"><i style={{ width: `${(warehouse.value / max) * 100}%` }} /></span><b>{formatNumber.format(warehouse.value)} <small>шт.</small></b></div>; })}</div><div className="analytics-insight"><span>Итог периода</span><strong>{strongestFbsWarehouse ? `${strongestFbsWarehouse.name} лидирует среди ФФ: ${formatNumber.format(strongestFbsWarehouse.value)} ${analyticsFactAvailable ? "продаж" : "созданных заказов"} FBS.` : `За выбранный период ${analyticsFactAvailable ? "продаж" : "созданных заказов"} FBS по привязанным ФФ пока нет.`}</strong></div></section>
                <p className="analytics-source-note">{analyticsFactAvailable ? "FBO и FBS считаются по оперативной статистике WB. Возвраты не включены." : "WB временно ограничил статистику. Показанные FBS — только созданные заказы; они не входят в факт продаж, общий итог и доли каналов."}</p>
              </> : null}
            </section>
          ) : activeView === "sales" ? (
            <section className="sales-panel">
              <div className="section-heading sales-heading">
                <div>
                  <span className="section-kicker">ПРОДАЖИ И ПОТРЕБНОСТЬ · FBS</span>
                  <h2>{selectedSalesWarehouse ? formatManualWarehouse(selectedSalesWarehouse) : "Все склады ФФ"}</h2>
                  <p className="section-note">Выберите ФФ: увидите по каждому артикулу остаток на нём, FBS-заказы за 7 дней и сколько нужно довезти для выбранного запаса в днях.</p>
                </div>
              </div>

              <div className="sales-toolbar">
                <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по продажам" /></label>
                <label className="sales-warehouse-select"><span>Склад ФФ</span><select value={salesWarehouseId} onChange={(event) => setSalesWarehouseId(event.target.value)} aria-label="Выбрать склад ФФ для продаж"><option value="all">Все склады ФФ</option>{visibleManualWarehouses.map((item) => <option value={item.id} key={item.id}>{formatManualWarehouse(item)}</option>)}</select></label>
                <label className="sales-turnover-control"><span>Запас на</span><input type="number" min="1" max="999" value={salesTargetDays} onChange={(event) => setSalesTargetDays(Math.max(1, Math.min(999, Number(event.target.value) || 1)))} aria-label="Целевой запас в днях" /><small>дн.</small></label>
              </div>
              <div className="sales-scope" role="group" aria-label="Какие товары показывать"><span>Показывать</span><div><button type="button" className={salesProductScope === "ff" ? "active" : ""} onClick={() => setSalesProductScope("ff")}>{selectedSalesWarehouse ? "Только есть на этом ФФ" : "Только есть на ФФ"}</button><button type="button" className={salesProductScope === "all" ? "active" : ""} onClick={() => setSalesProductScope("all")}>Все товары</button></div></div>

              <div className="sales-metric-grid">
                <article><span>Заказы FBS · 7 дней</span><strong>{formatNumber.format(salesTotals.sales)} <small>шт.</small></strong><p>{selectedSalesWarehouse ? "Только выбранный ФФ" : "По всем ФФ"}</p></article>
                <article><span>Доступно на ФФ</span><strong>{formatNumber.format(salesTotals.stock)} <small>шт.</small></strong><p>{selectedSalesWarehouse ? `${selectedSalesWarehouse.city} · без FBS-резерва` : "Сумма по всем ФФ · без FBS-резерва"}</p></article>
                <article><span>Нужно довезти на {salesTargetDays} дней</span><strong>{formatNumber.format(salesTotals.need)} <small>шт.</small></strong><p>Продажи × {salesTargetDays} дней минус остаток</p></article>
              </div>

              {selectedSalesWarehouse && !selectedSalesWarehouse.wbWarehouseId && <p className="sales-link-notice">Для этого ФФ ещё не указан склад WB FBS. Свяжите их в разделе «Склады ФФ и импорт Excel», чтобы продажи попадали в расчёт.</p>}

              <section className="sales-table-card">
                <div className="sales-table-heading"><div><span className="section-kicker">ПО АРТИКУЛАМ</span><h3>Что продавалось и что довезти</h3></div><span>{salesRows.length} из {rows.length} артикулов</span></div>
                <div className="sales-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>Доступно {selectedSalesWarehouse ? selectedSalesWarehouse.city : "ФФ"}</th><th>Заказы 7 дней</th><th>Среднее в день</th><th>Потребность {salesTargetDays} дней</th><th>Хватит на</th><th /></tr></thead><tbody>{salesRows.map((item) => <tr key={item.row.key} onClick={() => openProduct(item.row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(item.row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: item.row.color }}>{item.row.name.charAt(0).toUpperCase()}</span><span><strong>{item.row.name}</strong><small>{item.row.sku}{item.row.nmId ? ` · WB ${item.row.nmId}` : ""} · {item.row.category}</small></span></div></td><td><span className={`manual-stock-value ${item.stock === 0 ? "zero" : ""}`}>{formatNumber.format(item.stock)}<small> шт.</small></span></td><td><span className="number-pill blue-pill">{formatNumber.format(item.sales)}</span></td><td><b className="sales-average">{item.sales ? (item.sales / 7).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "0"}</b></td><td><span className={`sales-need ${item.need ? "needed" : "covered"}`}>{item.need ? `+${formatNumber.format(item.need)}` : "Запаса достаточно"}</span></td><td><span className={`sales-coverage ${item.coverageDays !== null && item.coverageDays < salesTargetDays ? "low" : ""}`}>{item.coverageDays === null ? "Нет продаж" : `${item.coverageDays} дн.`}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${item.row.name}`}>›</button></td></tr>)}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Загружаем продажи из Wildberries</strong><small>Считаем FBS-заказы за последние 7 дней</small></div>}{!loading && !salesRows.length && <div className="empty-state"><strong>Ничего не найдено</strong><span>Попробуйте изменить поиск или выберите другой склад ФФ.</span></div>}</div>
                <footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />Данные WB API · FBS-заказы за 7 дней</span><span>Потребность = продажи × {salesTargetDays} дней − остаток ФФ</span></footer>
              </section>
            </section>
          ) : <>
            <section className={`metric-grid ${activeView !== "overview" ? "view-hidden" : ""}`} aria-label="Ключевые показатели">
              <article className="metric-card featured"><div className="metric-top"><span>Остаток на складах WB</span><span className="trend up">● WB API</span></div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.available)} <small>шт.</small></strong><div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, index) => <i key={index} style={{ height }} />)}</div><p>Фактический остаток · для FBS недоступен</p></article>
              <article className="metric-card"><div className="metric-icon green">□</div><div className="metric-label">Доступно на ФФ</div><strong className="metric-value">{loading ? "—" : formatNumber.format(ffAvailableTotal)} <small>шт.</small></strong><p>В базе {formatNumber.format(totals.ffTotal)} · вычтено FBS {formatNumber.format(ffReservedFromStockTotal)}</p></article>
              <article className="metric-card"><div className="metric-icon blue">→</div><div className="metric-label">Активные FBS</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.fbs)} <small>шт.</small></strong><p>{fbsLocations.map((location) => <span key={location.id}>{location.city} <b>{totals.fbsByLocation[location.id] ?? 0}</b>{" · "}</span>)}</p></article>
              <article className="metric-card"><div className="metric-icon amber">◷</div><div className="metric-label">Ожидают продажи</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.toSale)} <small>шт.</small></strong><p><b>{totals.receiving}</b> ожидают приёмки WB</p></article>
            </section>

            <section className={`movement-card ${activeView !== "overview" && activeView !== "fbs" ? "view-hidden" : ""}`} id="movement"><div className="section-heading"><div><span className="section-kicker">ОСТАТКИ WB, ФФ И ДВИЖЕНИЕ FBS</span><h2>Фактические и доступные остатки отдельно</h2></div><span className="period-pill">Актуальные заказы за 30 дней</span></div><div className="movement-grid"><article className="wb-stock-fact"><span className="wb-stock-mark">WB</span><div><small>ФАКТИЧЕСКИЙ ОСТАТОК НА WB</small><strong>{formatNumber.format(totals.available)} <em>шт.</em></strong><p>Уже находится на складах Wildberries и не является доступным запасом для FBS.</p></div></article><div className="fbs-overview"><div className="movement-subhead"><span>ДОСТУПНО НА ФФ · WB API</span><button className="text-action" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button></div><div className="fbs-location-grid manual-location-grid dynamic-locations">{visibleManualWarehouses.map((item) => { const physicalStock = totals.ffStock[item.id] ?? 0; const reserved = totals.fbsByLocation[item.id] ?? 0; return <article className="fbs-location-card manual" key={item.id}><span>{item.city}</span><strong>{formatNumber.format(Math.max(0, physicalStock - reserved))}</strong><small>{item.name} · WB {physicalStock} · резерв {reserved}</small></article>; })}</div><div className="movement-subhead orders"><span>АКТИВНЫЕ FBS-ЗАКАЗЫ</span><small>По данным WB API</small></div><div className="fbs-location-grid order-location-grid">{fbsLocations.map((location) => <article className="fbs-location-card" key={location.id}><span>{location.city}</span><strong>{formatNumber.format(totals.fbsByLocation[location.id] ?? 0)}</strong><small>{location.label}</small></article>)}</div><div className="fbs-stage-strip"><span><b>{totals.fbs}</b> активные FBS</span><i>→</i><span><b>{totals.receiving}</b> ожидают WB</span><i>→</i><span className="sale-stage"><b>{totals.toSale}</b> к продаже</span></div></div></div></section>

            <section className={`stock-card ${activeView === "reports" ? "view-hidden" : ""}`} id="stock"><div className="stock-header"><div><span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span><h2>{stockTitle}</h2></div><div className="stock-tools"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам"/></label><label className="select-wrap"><span>Склад:</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Выбрать склад"><option>Все склады</option>{warehouseNames.map((item) => <option key={item}>{item}</option>)}</select></label></div></div><div className="filter-row"><div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">{[{ name: "Все", count: counts.all }, { name: "Дефицит", count: counts.risk }, { name: "Активные FBS", count: counts.transit }].map((item) => <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>)}</div><span className="result-count">Показано {filteredRows.length} из {viewTotal} артикулов</span></div><div className="table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{warehouse === "Все склады" ? "Остаток WB" : "Выбранный склад WB"}</th>{visibleManualWarehouses.map((item) => <th className="ff-column-head" key={item.id}><span>{item.city}</span><small>{item.name}</small></th>)}<th>Активные FBS</th><th>К продаже</th><th>Статус</th><th /></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><b>{formatNumber.format(warehouse === "Все склады" ? stockTotal(row) : row.warehouses[warehouse] ?? 0)}</b><small> шт.</small></td>{visibleManualWarehouses.map((item) => <td key={item.id}><span className={`manual-stock-value ${(row.ffStock[item.id] ?? 0) === 0 ? "zero" : ""}`} title={`Остаток WB FBS: ${formatManualWarehouse(item)}`}>{formatNumber.format(row.ffStock[item.id] ?? 0)}<small> шт.</small></span></td>)}<td><span className="number-pill blue-pill">{row.fbs}</span></td><td><span className="number-pill green-pill">{row.toSale}</span></td><td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>)}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Загружаем данные из Wildberries</strong><small>Остатки и статусы FBS собираются в единый отчёт</small></div>}{!loading && !filteredRows.length && <div className="empty-state"><strong>{error ? "Данные пока не загружены" : "Ничего не найдено"}</strong><span>{error ? "Проверьте подключение WB API." : "Попробуйте изменить поиск или фильтры."}</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{updatedAt ? `Остатки обновлены в ${formatSyncTime(updatedAt)} МСК` : "Ожидаем синхронизацию"}</span><button type="button" onClick={() => { setQuery(""); setFilter("Все"); setWarehouse("Все склады"); }}>Сбросить фильтры</button></footer></section>

            {activeView === "reports" && <section className="reports-panel" id="reports"><div className="section-heading"><div><span className="section-kicker">ГОТОВЫЕ ВЫГРУЗКИ</span><h2>Скачать данные из кабинета</h2></div><span className="period-pill">CSV · Excel</span></div><div className="reports-grid"><article className="report-card"><span className="report-symbol blue">□</span><div><strong>Все остатки</strong><p>Артикулы и количество по каждому складу</p><small>{rows.length} артикулов · {warehouseNames.length} складов WB</small></div><button type="button" onClick={() => downloadCsv(rows, "vse-ostatki-wb")} disabled={!rows.length}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol amber">→</span><div><strong>FBS-движение</strong><p>Отгружено, на приёмке и ожидает продажи</p><small>{counts.transit} артикулов · {totals.fbs} единиц</small></div><button type="button" onClick={() => downloadCsv(rows.filter((row) => row.fbs > 0), "fbs-wb")} disabled={!counts.transit}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol green">▤</span><div><strong>Остатки ФФ из WB API</strong><p>Видимые FBS-склады и остатки по артикулам</p><small>{visibleManualWarehouses.length} складов ФФ</small></div><button type="button" onClick={() => downloadCsv(rows, "ostatki-ff")} disabled={!rows.length}>Скачать ↓</button></article></div></section>}
          </>}
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <aside className="drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`Карточка товара ${selected.name}`}>
            <button className="close-btn" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <span className="drawer-kicker">КАРТОЧКА ТОВАРА · WB API</span>
            <div className="drawer-product"><span className="product-swatch large" style={{ background: selected.color }}>{selected.name.charAt(0).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.sku}{selected.nmId ? ` · WB ${selected.nmId}` : ""}</p></div></div>
            <div className="drawer-total"><span>Фактический остаток на WB</span><strong>{formatNumber.format(stockTotal(selected))} <small>шт.</small></strong></div>
            <div className="warehouse-list">{Object.entries(selected.warehouses).sort((a, b) => b[1] - a[1]).map(([name, value]) => <div key={name}><span><i />{name}</span><strong>{formatNumber.format(value)} шт.</strong></div>)}{!Object.keys(selected.warehouses).length && <div><span>Нет остатков</span><strong>0 шт.</strong></div>}</div>
            <p className="drawer-stock-note">Этот остаток уже находится на складах Wildberries и недоступен для FBS.</p>
            <h3>Остатки на складах ФФ</h3>
            <div className="warehouse-list ff-stock-readonly">{visibleManualWarehouses.map((item) => <div key={item.id}><span><i />{formatManualWarehouse(item)}</span><strong>{formatNumber.format(selected.ffStock[item.id] ?? 0)} шт.</strong></div>)}</div>
            <p className="drawer-stock-note">Остатки FBS получены из WB API. Ручной Excel сохраняется только как резерв для непубличных остатков и партий.</p>
            <h3>Активные FBS по складам</h3>
            <div className="drawer-fbs-locations">{fbsLocations.map((location) => <div key={location.id}><span><strong>{location.city}</strong><small>{location.label}</small></span><b>{selected.fbsByLocation?.[location.id] ?? 0} шт.</b></div>)}</div>
            <h3>Текущее движение FBS</h3>
            <div className="timeline"><div className="timeline-item done"><i>✓</i><div><strong>Отгружено на FBS</strong><span>{selected.fbs} шт. в доставке</span></div></div><div className="timeline-item active"><i>2</i><div><strong>Ожидает приёмки WB</strong><span>{selected.receiving} шт. в статусе waiting</span></div></div><div className="timeline-item"><i>3</i><div><strong>Ожидает продажи</strong><span>{selected.toSale} шт. отсортировано или готово к выдаче</span></div></div></div>
            <p className="drawer-note">Данные Wildberries обновлены в {selected.updated} МСК</p>
          </aside>
        </div>
      )}
    </main>
  );
}
