"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type StockStatus = "В норме" | "Мало" | "Заканчивается";
type View = "overview" | "stock" | "fbs" | "sales" | "reports" | "fulfillment" | "manual" | "cabinets";
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

type ImportItem = { sku: string; nmId: number | null; quantity: number; batchCode: string; expiresAt?: string | null };
type ImportPreview = { fileName: string; sheetName: string; items: ImportItem[]; skipped: number; hasExpiryColumn: boolean; hasBatchColumn: boolean };

const defaultManualWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10, wbWarehouseId: 1692397, wbWarehouseName: null },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20, wbWarehouseId: null, wbWarehouseName: null },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30, wbWarehouseId: null, wbWarehouseName: null },
];
const emptyFbsBreakdown: FbsBreakdown = {};
const emptyTotals: DashboardTotals = { available: 0, ffTotal: 0, ffStock: {}, fbs: 0, fbsByLocation: emptyFbsBreakdown, sales7d: 0, receiving: 0, toSale: 0, risk: 0, activeSupplies: 0 };
const formatNumber = new Intl.NumberFormat("ru-RU");
const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "WILDBERRIES · ОПЕРАЦИИ", title: "Остатки и движение товаров" },
  stock: { eyebrow: "СКЛАДЫ · АРТИКУЛЫ", title: "Остатки по всем складам" },
  fbs: { eyebrow: "FBS · ПОСЛЕДНИЕ 30 ДНЕЙ", title: "Отгрузки и приёмка" },
  sales: { eyebrow: "ПРОДАЖИ · ПОТРЕБНОСТЬ", title: "Продажи и потребность ФФ" },
  reports: { eyebrow: "ВЫГРУЗКИ · CSV", title: "Отчёты по кабинету" },
  fulfillment: { eyebrow: "ФУЛФИЛМЕНТ · СКЛАДЫ", title: "ФФ — остатки и движение" },
  manual: { eyebrow: "ФУЛФИЛМЕНТ · РУЧНЫЕ ОСТАТКИ", title: "Склады ФФ и импорт Excel" },
  cabinets: { eyebrow: "КАБИНЕТЫ · МАРКЕТПЛЕЙСЫ", title: "Выберите кабинет" },
};

function stockTotal(row: StockRow) {
  return Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
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
  const [filter, setFilter] = useState("Все");
  const [selectedFulfillmentWarehouseId, setSelectedFulfillmentWarehouseId] = useState<string | null>(null);
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

  const selectedImportWarehouseId = manualWarehouses.some((item) => item.id === importWarehouseId)
    ? importWarehouseId
    : manualWarehouses[0]?.id ?? "";

  const fbsLocations = useMemo(() => {
    const locations = manualWarehouses.map((warehouse) => ({
      id: warehouse.id,
      city: warehouse.city,
      label: warehouse.wbWarehouseId
        ? warehouse.wbWarehouseName || `WB FBS №${warehouse.wbWarehouseId}`
        : "WB FBS не назначен",
    }));
    if ((totals.fbsByLocation.unassigned ?? 0) > 0) locations.push({ id: "unassigned", city: "Не назначено", label: "Выберите склад ФФ" });
    return locations;
  }, [manualWarehouses, totals.fbsByLocation.unassigned]);

  const fulfillmentWarehouses = useMemo(() => manualWarehouses.map((warehouse) => {
    const products = rows.filter((row) => (row.ffStock[warehouse.id] ?? 0) > 0 || (row.fbsByLocation[warehouse.id] ?? 0) > 0 || (row.receivingByLocation[warehouse.id] ?? 0) > 0 || (row.toSaleByLocation[warehouse.id] ?? 0) > 0);
    return {
      warehouse,
      products: products.length,
      stock: totals.ffStock[warehouse.id] ?? 0,
      fbs: totals.fbsByLocation[warehouse.id] ?? 0,
      receiving: products.reduce((sum, row) => sum + (row.receivingByLocation[warehouse.id] ?? 0), 0),
      toSale: products.reduce((sum, row) => sum + (row.toSaleByLocation[warehouse.id] ?? 0), 0),
    };
  }), [manualWarehouses, rows, totals.ffStock, totals.fbsByLocation]);

  const selectedFulfillmentWarehouse = fulfillmentWarehouses.find((item) => item.warehouse.id === selectedFulfillmentWarehouseId) ?? null;

  const fulfillmentRows = useMemo(() => {
    if (!selectedFulfillmentWarehouse) return [];
    const warehouseId = selectedFulfillmentWarehouse.warehouse.id;
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesWarehouse = (row.ffStock[warehouseId] ?? 0) > 0 || (row.fbsByLocation[warehouseId] ?? 0) > 0 || (row.receivingByLocation[warehouseId] ?? 0) > 0 || (row.toSaleByLocation[warehouseId] ?? 0) > 0;
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      return matchesWarehouse && matchesQuery;
    });
  }, [selectedFulfillmentWarehouse, rows, query]);

  const selectedSalesWarehouse = manualWarehouses.find((item) => item.id === salesWarehouseId) ?? null;
  const salesRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.map((row) => {
      const stock = selectedSalesWarehouse
        ? row.ffStock[selectedSalesWarehouse.id] ?? 0
        : Object.values(row.ffStock).reduce((sum, value) => sum + value, 0);
      const sales = selectedSalesWarehouse
        ? row.sales7dByLocation[selectedSalesWarehouse.id] ?? 0
        : row.sales7d;
      const averagePerDay = sales / 7;
      const targetStock = Math.ceil(averagePerDay * 14);
      const need = Math.max(0, targetStock - stock);
      const coverageDays = sales > 0 ? Math.floor(stock / averagePerDay) : null;
      return { row, stock, sales, averagePerDay, targetStock, need, coverageDays };
    }).filter(({ row, stock }) => {
      const hasStockOnFf = stock > 0;
      const matchesScope = salesProductScope === "all" || hasStockOnFf;
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      return matchesScope && matchesQuery;
    }).sort((left, right) => right.need - left.need || right.sales - left.sales || left.row.name.localeCompare(right.row.name, "ru"));
  }, [rows, query, selectedSalesWarehouse, salesProductScope]);

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
    const header = ["Артикул продавца", "Артикул WB", ...warehouseNames, "Всего на WB", ...manualWarehouses.flatMap((item) => [`ФФ ${formatManualWarehouse(item)}`, `Срок годности · ${formatManualWarehouse(item)}`]), "FBS всего", ...fbsLocations.map((location) => `FBS ${location.city}`), "На приёмке", "Ожидают продажи", "Статус"];
    const body = sourceRows.map((row) => [row.sku, row.nmId ?? "", ...warehouseNames.map((name) => row.warehouses[name] ?? 0), stockTotal(row), ...manualWarehouses.flatMap((item) => [row.ffStock[item.id] ?? 0, row.ffExpiry?.[item.id] ?? ""]), row.fbs, ...fbsLocations.map((location) => row.fbsByLocation[location.id] ?? 0), row.receiving, row.toSale, row.status]);
    const content = [header, ...body].map((line) => line.map((cell) => String(cell).replaceAll(";", ",")).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
                <div className="fulfillment-warehouse-grid">{fulfillmentWarehouses.map((item) => <button className="fulfillment-warehouse-card" type="button" key={item.warehouse.id} onClick={() => openFulfillmentWarehouse(item.warehouse.id)}><span className="fulfillment-card-top"><i>□</i><small>{item.warehouse.wbWarehouseId ? `WB FBS · ${item.warehouse.wbWarehouseName || `№${item.warehouse.wbWarehouseId}`}` : "WB FBS не назначен"}</small><b>›</b></span><strong>{item.warehouse.city}</strong><span className="fulfillment-card-name">{item.warehouse.name}</span><span className="fulfillment-card-stock"><b>{formatNumber.format(item.stock)}</b> шт. на ФФ</span><span className="fulfillment-card-stats">{item.products} артикулов · {item.fbs} FBS в движении</span></button>)}</div>
                {!fulfillmentWarehouses.length && <div className="empty-state"><strong>Добавьте первый склад ФФ</strong><span>После этого сюда будут попадать остатки из Excel и заказы WB.</span></div>}
                <p className="fulfillment-note">«Ожидают продажи» показывает FBS-заказы в пути. Финансовый факт продажи и возвраты добавляются через Finance API WB.</p>
              </> : <>
                <div className="section-heading fulfillment-heading">
                  <div><button className="back-link" type="button" onClick={() => { setSelectedFulfillmentWarehouseId(null); setQuery(""); }}>‹ Все склады ФФ</button><span className="section-kicker">ФФ · СКЛАД В РАБОТЕ</span><h2>{formatManualWarehouse(selectedFulfillmentWarehouse.warehouse)}</h2><p className="section-note">Остатки на этом ФФ и FBS-заказы, отгруженные с привязанного склада WB.</p></div>
                  <button className="secondary-btn" type="button" onClick={() => navigateTo("manual")}>Настроить склад</button>
                </div>
                <div className="fulfillment-metric-grid"><article><span>Остаток на ФФ</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.stock)} <small>шт.</small></strong><p>По загруженным партиям</p></article><article><span>FBS в движении</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.fbs)} <small>шт.</small></strong><p>Отгружено с этого ФФ</p></article><article><span>Ожидают WB</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.receiving)} <small>шт.</small></strong><p>Статус waiting</p></article><article><span>Ожидают продажи</span><strong>{formatNumber.format(selectedFulfillmentWarehouse.toSale)} <small>шт.</small></strong><p>sorted / ready for pickup</p></article></div>
                <section className="stock-card fulfillment-stock-card"><div className="stock-header"><div><span className="section-kicker">ПО АРТИКУЛАМ</span><h2>Остатки и FBS-движение</h2></div><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по выбранному складу ФФ" /></label></div><div className="fulfillment-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>Остаток ФФ</th><th>FBS в движении</th><th>Ожидают продажи</th><th>Статус ФФ</th><th /></tr></thead><tbody>{fulfillmentRows.map((row) => { const status = fulfillmentStockStatus(row.ffStock[selectedFulfillmentWarehouse.warehouse.id] ?? 0); return <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><span className={`manual-stock-value ${(row.ffStock[selectedFulfillmentWarehouse.warehouse.id] ?? 0) === 0 ? "zero" : ""}`}>{formatNumber.format(row.ffStock[selectedFulfillmentWarehouse.warehouse.id] ?? 0)}<small> шт.</small></span></td><td><span className="number-pill blue-pill">{formatNumber.format(row.fbsByLocation[selectedFulfillmentWarehouse.warehouse.id] ?? 0)}</span></td><td><span className="number-pill green-pill">{formatNumber.format(row.toSaleByLocation[selectedFulfillmentWarehouse.warehouse.id] ?? 0)}</span></td><td><span className={`status ${status === "В норме" ? "ok" : status === "Мало" ? "low" : "critical"}`}><i />{status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>; })}</tbody></table>{!loading && !fulfillmentRows.length && <div className="empty-state"><strong>На этом складе пока нет движения</strong><span>Загрузите остатки Excel или свяжите склад с FBS WB.</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{fulfillmentRows.length} артикулов на выбранном ФФ</span><span>Факт выкупа появится после подключения Finance API WB</span></footer></section>
              </>}
            </section>
          ) : activeView === "manual" ? (
            <section className="manual-warehouses-panel">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">СКЛАДЫ ФУЛФИЛМЕНТА</span>
                  <h2>Куда отправляем товар</h2>
                  <p className="section-note">Добавляйте свои склады, сроки годности и загружайте остатки из Excel в нужный из них.</p>
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
                      <div className="manual-warehouse-details"><strong>{item.city}</strong><small>{item.name}</small><em>{item.wbWarehouseId ? `Привязан к WB FBS · ${item.wbWarehouseName || `№${item.wbWarehouseId}`}` : "WB FBS не назначен"}</em></div>
                      <form className="warehouse-link-form" onSubmit={(event) => void saveWarehouseLink(item, event)}>
                        <label><span>ID склада WB</span><input value={linkDraft.wbWarehouseId} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseId: event.target.value } }))} inputMode="numeric" placeholder="Например, 1987385" /></label>
                        <label><span>Название в WB</span><input value={linkDraft.wbWarehouseName} onChange={(event) => setWarehouseLinkDrafts((current) => ({ ...current, [item.id]: { ...linkDraft, wbWarehouseName: event.target.value } }))} maxLength={120} placeholder="Например, Волгоград Upakovka" /></label>
                        <button type="submit" disabled={warehouseLinkSavingId === item.id}>{warehouseLinkSavingId === item.id ? "Сохраняем…" : "Связать с WB"}</button>
                      </form>
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
          ) : activeView === "sales" ? (
            <section className="sales-panel">
              <div className="section-heading sales-heading">
                <div>
                  <span className="section-kicker">ПРОДАЖИ И ПОТРЕБНОСТЬ · FBS</span>
                  <h2>{selectedSalesWarehouse ? formatManualWarehouse(selectedSalesWarehouse) : "Все склады ФФ"}</h2>
                  <p className="section-note">Выберите ФФ: увидите по каждому артикулу остаток на нём, FBS-заказы за 7 дней и сколько нужно довезти для запаса на 14 дней.</p>
                </div>
              </div>

              <div className="sales-toolbar">
                <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по продажам" /></label>
                <label className="sales-warehouse-select"><span>Склад ФФ</span><select value={salesWarehouseId} onChange={(event) => setSalesWarehouseId(event.target.value)} aria-label="Выбрать склад ФФ для продаж"><option value="all">Все склады ФФ</option>{manualWarehouses.map((item) => <option value={item.id} key={item.id}>{formatManualWarehouse(item)}</option>)}</select></label>
              </div>
              <div className="sales-scope" role="group" aria-label="Какие товары показывать"><span>Показывать</span><div><button type="button" className={salesProductScope === "ff" ? "active" : ""} onClick={() => setSalesProductScope("ff")}>{selectedSalesWarehouse ? "Только есть на этом ФФ" : "Только есть на ФФ"}</button><button type="button" className={salesProductScope === "all" ? "active" : ""} onClick={() => setSalesProductScope("all")}>Все товары</button></div></div>

              <div className="sales-metric-grid">
                <article><span>Заказы FBS · 7 дней</span><strong>{formatNumber.format(salesTotals.sales)} <small>шт.</small></strong><p>{selectedSalesWarehouse ? "Только выбранный ФФ" : "По всем ФФ"}</p></article>
                <article><span>Остаток на ФФ</span><strong>{formatNumber.format(salesTotals.stock)} <small>шт.</small></strong><p>{selectedSalesWarehouse ? selectedSalesWarehouse.city : "Сумма по всем ФФ"}</p></article>
                <article><span>Нужно довезти на 14 дней</span><strong>{formatNumber.format(salesTotals.need)} <small>шт.</small></strong><p>Продажи × 14 дней минус остаток</p></article>
              </div>

              {selectedSalesWarehouse && !selectedSalesWarehouse.wbWarehouseId && <p className="sales-link-notice">Для этого ФФ ещё не указан склад WB FBS. Свяжите их в разделе «Склады ФФ и импорт Excel», чтобы продажи попадали в расчёт.</p>}

              <section className="sales-table-card">
                <div className="sales-table-heading"><div><span className="section-kicker">ПО АРТИКУЛАМ</span><h3>Что продавалось и что довезти</h3></div><span>{salesRows.length} из {rows.length} артикулов</span></div>
                <div className="sales-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>Остаток {selectedSalesWarehouse ? selectedSalesWarehouse.city : "ФФ"}</th><th>Заказы 7 дней</th><th>Среднее в день</th><th>Потребность 14 дней</th><th>Хватит на</th><th /></tr></thead><tbody>{salesRows.map((item) => <tr key={item.row.key} onClick={() => openProduct(item.row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(item.row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: item.row.color }}>{item.row.name.charAt(0).toUpperCase()}</span><span><strong>{item.row.name}</strong><small>{item.row.sku}{item.row.nmId ? ` · WB ${item.row.nmId}` : ""} · {item.row.category}</small></span></div></td><td><span className={`manual-stock-value ${item.stock === 0 ? "zero" : ""}`}>{formatNumber.format(item.stock)}<small> шт.</small></span></td><td><span className="number-pill blue-pill">{formatNumber.format(item.sales)}</span></td><td><b className="sales-average">{item.sales ? (item.sales / 7).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "0"}</b></td><td><span className={`sales-need ${item.need ? "needed" : "covered"}`}>{item.need ? `+${formatNumber.format(item.need)}` : "Запаса достаточно"}</span></td><td><span className={`sales-coverage ${item.coverageDays !== null && item.coverageDays < 14 ? "low" : ""}`}>{item.coverageDays === null ? "Нет продаж" : `${item.coverageDays} дн.`}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${item.row.name}`}>›</button></td></tr>)}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Загружаем продажи из Wildberries</strong><small>Считаем FBS-заказы за последние 7 дней</small></div>}{!loading && !salesRows.length && <div className="empty-state"><strong>Ничего не найдено</strong><span>Попробуйте изменить поиск или выберите другой склад ФФ.</span></div>}</div>
                <footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />Данные WB API · FBS-заказы за 7 дней</span><span>Потребность = продажи × 14 дней − остаток ФФ</span></footer>
              </section>
            </section>
          ) : <>
            <section className={`metric-grid ${activeView !== "overview" ? "view-hidden" : ""}`} aria-label="Ключевые показатели"><article className="metric-card featured"><div className="metric-top"><span>Остаток на складах WB</span><span className="trend up">● WB API</span></div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.available)} <small>шт.</small></strong><div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, index) => <i key={index} style={{ height }} />)}</div><p>Фактический остаток · для FBS недоступен</p></article><article className="metric-card"><div className="metric-icon green">□</div><div className="metric-label">Остатки ФФ · вручную</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.ffTotal)} <small>шт.</small></strong><p>{manualWarehouses.map((item) => `${item.city} ${totals.ffStock[item.id] ?? 0}`).join(" · ")}</p></article><article className="metric-card"><div className="metric-icon blue">→</div><div className="metric-label">Активные FBS</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.fbs)} <small>шт.</small></strong><p>{fbsLocations.map((location) => <span key={location.id}>{location.city} <b>{totals.fbsByLocation[location.id] ?? 0}</b>{" · "}</span>)}</p></article><article className="metric-card"><div className="metric-icon amber">◷</div><div className="metric-label">Ожидают продажи</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.toSale)} <small>шт.</small></strong><p><b>{totals.receiving}</b> ожидают приёмки WB</p></article></section>

            <section className={`movement-card ${activeView !== "overview" && activeView !== "fbs" ? "view-hidden" : ""}`} id="movement"><div className="section-heading"><div><span className="section-kicker">ОСТАТКИ WB, ФФ И ДВИЖЕНИЕ FBS</span><h2>Фактические и ручные остатки отдельно</h2></div><span className="period-pill">Актуальные заказы за 30 дней</span></div><div className="movement-grid"><article className="wb-stock-fact"><span className="wb-stock-mark">WB</span><div><small>ФАКТИЧЕСКИЙ ОСТАТОК НА WB</small><strong>{formatNumber.format(totals.available)} <em>шт.</em></strong><p>Уже находится на складах Wildberries и не является доступным запасом для FBS.</p></div></article><div className="fbs-overview"><div className="movement-subhead"><span>РУЧНЫЕ ОСТАТКИ ФФ</span><button className="text-action" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button></div><div className="fbs-location-grid manual-location-grid dynamic-locations">{manualWarehouses.map((item) => <article className="fbs-location-card manual" key={item.id}><span>{item.city}</span><strong>{formatNumber.format(totals.ffStock[item.id] ?? 0)}</strong><small>{item.name}</small></article>)}</div><div className="movement-subhead orders"><span>АКТИВНЫЕ FBS-ЗАКАЗЫ</span><small>По данным WB API</small></div><div className="fbs-location-grid order-location-grid">{fbsLocations.map((location) => <article className="fbs-location-card" key={location.id}><span>{location.city}</span><strong>{formatNumber.format(totals.fbsByLocation[location.id] ?? 0)}</strong><small>{location.label}</small></article>)}</div><div className="fbs-stage-strip"><span><b>{totals.fbs}</b> активные FBS</span><i>→</i><span><b>{totals.receiving}</b> ожидают WB</span><i>→</i><span className="sale-stage"><b>{totals.toSale}</b> к продаже</span></div></div></div></section>

            <section className={`stock-card ${activeView === "reports" ? "view-hidden" : ""}`} id="stock"><div className="stock-header"><div><span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span><h2>{stockTitle}</h2></div><div className="stock-tools"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам"/></label><label className="select-wrap"><span>Склад:</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Выбрать склад"><option>Все склады</option>{warehouseNames.map((item) => <option key={item}>{item}</option>)}</select></label></div></div><div className="filter-row"><div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">{[{ name: "Все", count: counts.all }, { name: "Дефицит", count: counts.risk }, { name: "Активные FBS", count: counts.transit }].map((item) => <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>)}</div><span className="result-count">Показано {filteredRows.length} из {viewTotal} артикулов</span></div><div className="table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{warehouse === "Все склады" ? "Остаток WB" : "Выбранный склад WB"}</th>{manualWarehouses.map((item) => <th className="ff-column-head" key={item.id}><span>{item.city}</span><small>{item.name}</small></th>)}<th>Активные FBS</th><th>К продаже</th><th>Статус</th><th /></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><b>{formatNumber.format(warehouse === "Все склады" ? stockTotal(row) : row.warehouses[warehouse] ?? 0)}</b><small> шт.</small></td>{manualWarehouses.map((item) => <td key={item.id}><span className={`manual-stock-value ${(row.ffStock[item.id] ?? 0) === 0 ? "zero" : ""}`} title={`Открыть и изменить: ${formatManualWarehouse(item)}`}>{formatNumber.format(row.ffStock[item.id] ?? 0)}<small> шт.</small></span></td>)}<td><span className="number-pill blue-pill">{row.fbs}</span></td><td><span className="number-pill green-pill">{row.toSale}</span></td><td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>)}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Загружаем данные из Wildberries</strong><small>Остатки и статусы FBS собираются в единый отчёт</small></div>}{!loading && !filteredRows.length && <div className="empty-state"><strong>{error ? "Данные пока не загружены" : "Ничего не найдено"}</strong><span>{error ? "Проверьте подключение WB API." : "Попробуйте изменить поиск или фильтры."}</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{updatedAt ? `Остатки обновлены в ${formatSyncTime(updatedAt)} МСК` : "Ожидаем синхронизацию"}</span><button type="button" onClick={() => { setQuery(""); setFilter("Все"); setWarehouse("Все склады"); }}>Сбросить фильтры</button></footer></section>

            {activeView === "reports" && <section className="reports-panel" id="reports"><div className="section-heading"><div><span className="section-kicker">ГОТОВЫЕ ВЫГРУЗКИ</span><h2>Скачать данные из кабинета</h2></div><span className="period-pill">CSV · Excel</span></div><div className="reports-grid"><article className="report-card"><span className="report-symbol blue">□</span><div><strong>Все остатки</strong><p>Артикулы и количество по каждому складу</p><small>{rows.length} артикулов · {warehouseNames.length} складов WB</small></div><button type="button" onClick={() => downloadCsv(rows, "vse-ostatki-wb")} disabled={!rows.length}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol amber">→</span><div><strong>FBS-движение</strong><p>Отгружено, на приёмке и ожидает продажи</p><small>{counts.transit} артикулов · {totals.fbs} единиц</small></div><button type="button" onClick={() => downloadCsv(rows.filter((row) => row.fbs > 0), "fbs-wb")} disabled={!counts.transit}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol green">▤</span><div><strong>Ручные остатки ФФ</strong><p>Все добавленные склады и остатки по артикулам</p><small>{manualWarehouses.length} складов ФФ</small></div><button type="button" onClick={() => downloadCsv(rows, "ostatki-ff")} disabled={!rows.length}>Скачать ↓</button></article></div></section>}
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
            <div className="warehouse-list ff-stock-readonly">{manualWarehouses.map((item) => <div key={item.id}><span><i />{formatManualWarehouse(item)}</span><strong>{formatNumber.format(selected.ffStock[item.id] ?? 0)} шт.</strong></div>)}</div>
            <p className="drawer-stock-note">Остатки доступны только для просмотра: FBS и склады WB обновляются по API. Ручные поля и дубли партий убраны.</p>
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
