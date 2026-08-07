"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type StockStatus = "В норме" | "Мало" | "Заканчивается";
type View = "overview" | "stock" | "fbs" | "sales" | "reports" | "manual";
type FbsLocationKey = "kazan" | "moscow" | "spb" | "other";
type FbsBreakdown = Record<FbsLocationKey, number>;
type FfStock = Record<string, number>;
type FfExpiry = Record<string, string | null>;
type CabinetSummary = { id: "metanutrix" | "trusthome"; name: string; configured: boolean };

type ManualWarehouse = {
  id: string;
  city: string;
  name: string;
  position: number;
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
  fbs: number;
  fbsByLocation: FbsBreakdown;
  receiving: number;
  toSale: number;
  status: StockStatus;
  updated: string;
};

type DashboardTotals = {
  available: number;
  ffTotal: number;
  ffStock: FfStock;
  fbs: number;
  fbsByLocation: FbsBreakdown;
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

type ImportItem = { sku: string; quantity: number; expiresAt?: string | null };
type ImportPreview = { fileName: string; sheetName: string; items: ImportItem[]; skipped: number; hasExpiryColumn: boolean };

const defaultManualWarehouses: ManualWarehouse[] = [
  { id: "kazan", city: "Казань", name: "Наш склад", position: 10 },
  { id: "moscow", city: "Москва", name: "БИК ФФ", position: 20 },
  { id: "spb", city: "Питер", name: "Rus ФФ", position: 30 },
];
const fbsLocations: Array<{ key: Exclude<FbsLocationKey, "other">; city: string; label: string }> = [
  { key: "kazan", city: "Казань", label: "Наш склад" },
  { key: "moscow", city: "Москва", label: "БИК ФФ" },
  { key: "spb", city: "Питер", label: "Rus ФФ" },
];
const emptyFbsBreakdown: FbsBreakdown = { kazan: 0, moscow: 0, spb: 0, other: 0 };
const emptyTotals: DashboardTotals = { available: 0, ffTotal: 0, ffStock: {}, fbs: 0, fbsByLocation: emptyFbsBreakdown, receiving: 0, toSale: 0, risk: 0, activeSupplies: 0 };
const formatNumber = new Intl.NumberFormat("ru-RU");
const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "WILDBERRIES · ОПЕРАЦИИ", title: "Остатки и движение товаров" },
  stock: { eyebrow: "СКЛАДЫ · АРТИКУЛЫ", title: "Остатки по всем складам" },
  fbs: { eyebrow: "FBS · ПОСЛЕДНИЕ 30 ДНЕЙ", title: "Отгрузки и приёмка" },
  sales: { eyebrow: "ПРОДАЖИ · ОЖИДАНИЕ", title: "Товары на пути к продаже" },
  reports: { eyebrow: "ВЫГРУЗКИ · CSV", title: "Отчёты по кабинету" },
  manual: { eyebrow: "ФУЛФИЛМЕНТ · РУЧНЫЕ ОСТАТКИ", title: "Склады ФФ и импорт Excel" },
};

function stockTotal(row: StockRow) {
  return Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
}

function formatSyncTime(value: string | null) {
  if (!value) return "ожидаем данные";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function formatManualWarehouse(warehouse: ManualWarehouse) {
  return `${warehouse.city} — ${warehouse.name}`;
}

function blankFfStock(warehouses: ManualWarehouse[], stock: FfStock = {}) {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, Math.max(0, Number(stock[warehouse.id]) || 0)]));
}

function blankFfExpiry(warehouses: ManualWarehouse[], expiry: FfExpiry = {}) {
  return Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, expiry[warehouse.id] || null]));
}

function sumFfStock(stock: FfStock) {
  return Object.values(stock).reduce((sum, value) => sum + (Number(value) || 0), 0);
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
    return headers.some((header) => ["артикул", "артикулпродавца", "sku", "vendorcode"].includes(header))
      && headers.some((header) => ["количество", "колво", "остаток", "qty", "quantity"].includes(header));
  });
  if (headerRowIndex < 0) throw new Error("Нужны столбцы «Артикул» и «Количество»");

  const headers = rows[headerRowIndex].map(normalizedHeader);
  const skuColumn = headers.findIndex((header) => ["артикул", "артикулпродавца", "sku", "vendorcode"].includes(header));
  const quantityColumn = headers.findIndex((header) => ["количество", "колво", "остаток", "qty", "quantity"].includes(header));
  const expiryColumn = headers.findIndex((header) => ["срокгодности", "годендо", "датаокончаниясрокагодности", "expiry", "expirydate", "expirationdate"].includes(header));
  const hasExpiryColumn = expiryColumn >= 0;
  const grouped = new Map<string, ImportItem>();
  let skipped = 0;

  for (const row of rows.slice(headerRowIndex + 1)) {
    const sku = String(row[skuColumn] ?? "").trim();
    const quantity = parseQuantity(row[quantityColumn]);
    const expiryValue = hasExpiryColumn ? String(row[expiryColumn] ?? "").trim() : "";
    const expiresAt = hasExpiryColumn ? parseExpiryDate(row[expiryColumn]) : undefined;
    if (!sku && !String(row[quantityColumn] ?? "").trim()) continue;
    if (!sku || !normalizedSku(sku) || !Number.isFinite(quantity) || quantity < 0 || quantity > 10_000_000 || (hasExpiryColumn && Boolean(expiryValue) && !expiresAt)) {
      skipped += 1;
      continue;
    }
    const key = normalizedSku(sku);
    const previous = grouped.get(key);
    const previousExpiry = previous?.expiresAt;
    const combinedExpiry = hasExpiryColumn
      ? [previousExpiry, expiresAt].filter((value): value is string => Boolean(value)).sort()[0] ?? null
      : undefined;
    grouped.set(key, { sku, quantity: (previous?.quantity ?? 0) + quantity, ...(hasExpiryColumn ? { expiresAt: combinedExpiry } : {}) });
  }

  const items = [...grouped.values()];
  if (!items.length) throw new Error("Не нашли ни одной корректной строки с артикулом и количеством");
  if (items.some((item) => item.quantity > 10_000_000)) throw new Error("Количество по одному артикулу не должно превышать 10 000 000");
  return { fileName: file.name, sheetName, items, skipped, hasExpiryColumn };
}

function ExpiryManager({ rows, warehouses, onSaved }: {
  rows: StockRow[];
  warehouses: ManualWarehouse[];
  onSaved: (key: string, stock: FfStock, expiresAt: FfExpiry) => void;
}) {
  const [productKey, setProductKey] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expiryOverride, setExpiryOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === productKey) ?? rows[0] ?? null;
  const selectedWarehouseId = warehouses.some((warehouse) => warehouse.id === warehouseId) ? warehouseId : warehouses[0]?.id ?? "";
  const expiresAt = expiryOverride ?? selected?.ffExpiry?.[selectedWarehouseId] ?? "";

  const save = async () => {
    if (!selected || !selectedWarehouseId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/ff-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productKey: selected.key,
          nmId: selected.nmId,
          sku: selected.sku,
          stock: selected.ffStock,
          expiresAt: { ...selected.ffExpiry, [selectedWarehouseId]: expiresAt || null },
        }),
      });
      const data = await response.json() as { stock?: FfStock; expiresAt?: FfExpiry; error?: string };
      if (!response.ok || !data.stock || !data.expiresAt) throw new Error(data.error || "Не удалось сохранить срок годности");
      onSaved(selected.key, data.stock, data.expiresAt);
      setMessage(expiresAt ? "Срок годности сохранён" : "Срок годности очищен");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить срок годности");
    } finally {
      setSaving(false);
    }
  };

  if (!rows.length || !warehouses.length) return null;

  return <section className="expiry-manager" aria-label="Срок годности товара">
    <div>
      <span className="section-kicker">СРОК ГОДНОСТИ</span>
      <h3>Указать вручную</h3>
      <p>Срок привязан к товару и складу ФФ. Оставьте дату пустой, чтобы очистить её.</p>
    </div>
    <div className="expiry-editor">
      <label><span>Товар</span><select value={selected?.key ?? ""} onChange={(event) => { setProductKey(event.target.value); setExpiryOverride(null); }}>{rows.map((row) => <option key={row.key} value={row.key}>{row.sku} · {row.name}</option>)}</select></label>
      <label><span>Склад ФФ</span><select value={selectedWarehouseId} onChange={(event) => { setWarehouseId(event.target.value); setExpiryOverride(null); }}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{formatManualWarehouse(warehouse)}</option>)}</select></label>
      <label><span>Годен до</span><input type="date" value={expiresAt} onChange={(event) => setExpiryOverride(event.target.value)} /></label>
      <button className="drawer-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить срок"}</button>
    </div>
    {message && <p className="form-status success">{message}</p>}
    {error && <p className="form-status error">{error}</p>}
  </section>;
}

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [cabinet, setCabinet] = useState<CabinetSummary | null>(null);
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
  const [filter, setFilter] = useState("Все");
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [ffDraft, setFfDraft] = useState<FfStock>({});
  const [ffExpiryDraft, setFfExpiryDraft] = useState<FfExpiry>({});
  const [ffSaving, setFfSaving] = useState(false);
  const [ffSaveMessage, setFfSaveMessage] = useState<string | null>(null);
  const [ffSaveError, setFfSaveError] = useState<string | null>(null);
  const [newWarehouseCity, setNewWarehouseCity] = useState("");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseMessage, setWarehouseMessage] = useState<string | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
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
        const data = await response.json() as { authenticated?: boolean; cabinet?: CabinetSummary | null };
        setAuthState(data.authenticated ? "authenticated" : "unauthenticated");
        setCabinet(data.cabinet ?? null);
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

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      const matchesFilter = filter === "Все" || (filter === "Дефицит" && row.status !== "В норме") || (filter === "Активные FBS" && row.fbs > 0);
      const matchesWarehouse = warehouse === "Все склады" || (row.warehouses[warehouse] ?? 0) > 0;
      const matchesView = activeView === "fbs" ? row.fbs > 0 : activeView === "sales" ? row.toSale > 0 : true;
      return matchesQuery && matchesFilter && matchesWarehouse && matchesView;
    });
  }, [rows, query, filter, warehouse, activeView]);

  const counts = useMemo(() => ({
    all: rows.length,
    risk: rows.filter((row) => row.status !== "В норме").length,
    transit: rows.filter((row) => row.fbs > 0).length,
  }), [rows]);
  const viewTotal = activeView === "fbs" ? rows.filter((row) => row.fbs > 0).length : activeView === "sales" ? rows.filter((row) => row.toSale > 0).length : rows.length;
  const stockTitle = activeView === "fbs" ? "Артикулы в FBS-движении" : activeView === "sales" ? "Артикулы, ожидающие продажи" : "Все товары Wildberries";

  const navigateTo = (view: View) => {
    setActiveView(view);
    setFilter("Все");
    setQuery("");
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openProduct = (row: StockRow) => {
    setSelected(row);
    setFfDraft(blankFfStock(manualWarehouses, row.ffStock));
    setFfExpiryDraft(blankFfExpiry(manualWarehouses, row.ffExpiry));
    setFfSaveMessage(null);
    setFfSaveError(null);
  };

  const saveManualFfStock = async () => {
    if (!selected) return;
    setFfSaving(true);
    setFfSaveMessage(null);
    setFfSaveError(null);
    try {
      const response = await fetch("/api/ff-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey: selected.key, nmId: selected.nmId, sku: selected.sku, stock: ffDraft, expiresAt: ffExpiryDraft }),
      });
      const data = await response.json() as { stock?: FfStock; expiresAt?: FfExpiry; error?: string };
      if (response.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!response.ok || !data.stock) throw new Error(data.error || "Не удалось сохранить остатки ФФ");
      const previous = blankFfStock(manualWarehouses, selected.ffStock);
      const nextStock = blankFfStock(manualWarehouses, data.stock);
      const nextSelected = { ...selected, ffStock: nextStock, ffExpiry: blankFfExpiry(manualWarehouses, data.expiresAt) };
      setRows((current) => current.map((row) => row.key === selected.key ? nextSelected : row));
      setSelected(nextSelected);
      setTotals((current) => {
        const ffStock = { ...current.ffStock };
        for (const manualWarehouse of manualWarehouses) ffStock[manualWarehouse.id] = (ffStock[manualWarehouse.id] ?? 0) - (previous[manualWarehouse.id] ?? 0) + (nextStock[manualWarehouse.id] ?? 0);
        return { ...current, ffStock, ffTotal: sumFfStock(ffStock) };
      });
      setFfSaveMessage("Остатки и срок годности сохранены");
    } catch (saveError) {
      setFfSaveError(saveError instanceof Error ? saveError.message : "Не удалось сохранить остатки ФФ");
    } finally {
      setFfSaving(false);
    }
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
      const importedBySku = new Map(importPreview.items.map((item) => [normalizedSku(item.sku), item]));
      setRows((current) => current.map((row) => {
        const imported = importedBySku.get(normalizedSku(row.sku));
        if (!imported) return row;
        const previous = row.ffStock[selectedImportWarehouseId] ?? 0;
        return {
          ...row,
          ffStock: { ...row.ffStock, [selectedImportWarehouseId]: importMode === "add" ? previous + imported.quantity : imported.quantity },
          ffExpiry: imported.expiresAt === undefined ? row.ffExpiry : { ...row.ffExpiry, [selectedImportWarehouseId]: imported.expiresAt },
        };
      }));
      setTotals((current) => {
        const existingRows = rows.filter((row) => importedBySku.has(normalizedSku(row.sku)));
        const previousTotal = existingRows.reduce((sum, row) => sum + (row.ffStock[selectedImportWarehouseId] ?? 0), 0);
        const nextTotal = existingRows.reduce((sum, row) => {
          const quantity = importedBySku.get(normalizedSku(row.sku))?.quantity ?? 0;
          return sum + (importMode === "add" ? (row.ffStock[selectedImportWarehouseId] ?? 0) + quantity : quantity);
        }, 0);
        const ffStock = { ...current.ffStock, [selectedImportWarehouseId]: (current.ffStock[selectedImportWarehouseId] ?? 0) - previousTotal + nextTotal };
        return { ...current, ffStock, ffTotal: sumFfStock(ffStock) };
      });
      setImportMessage(`Готово: ${data.imported ?? importPreview.items.length} артикулов обновлено`);
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
      const data = await response.json() as { authenticated?: boolean; cabinet?: CabinetSummary; error?: string };
      if (!response.ok || !data.authenticated) throw new Error(data.error || "Не удалось выполнить вход");
      setAdminPassword("");
      setCabinet(data.cabinet ?? null);
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
    setAuthState("unauthenticated");
  };

  const downloadCsv = (sourceRows: StockRow[], suffix: string) => {
    const header = ["Артикул продавца", "Артикул WB", ...warehouseNames, "Всего на WB", ...manualWarehouses.flatMap((item) => [`ФФ ${formatManualWarehouse(item)}`, `Срок годности · ${formatManualWarehouse(item)}`]), "FBS всего", "FBS Казань", "FBS Москва", "FBS Питер", "На приёмке", "Ожидают продажи", "Статус"];
    const body = sourceRows.map((row) => [row.sku, row.nmId ?? "", ...warehouseNames.map((name) => row.warehouses[name] ?? 0), stockTotal(row), ...manualWarehouses.flatMap((item) => [row.ffStock[item.id] ?? 0, row.ffExpiry?.[item.id] ?? ""]), row.fbs, row.fbsByLocation.kazan, row.fbsByLocation.moscow, row.fbsByLocation.spb, row.receiving, row.toSale, row.status]);
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
          <button type="button" className={`nav-item ${activeView === "manual" ? "active" : ""}`} onClick={() => navigateTo("manual")}><span className="nav-symbol">▤</span>Склады ФФ</button>
          <button type="button" className={`nav-item ${activeView === "reports" ? "active" : ""}`} onClick={() => navigateTo("reports")}><span className="nav-symbol">≡</span>Отчёты</button>
        </nav>
        <div className="sidebar-bottom"><div className="connection"><span className={error ? "live-dot offline" : "live-dot"} />{error ? "Нужна проверка подключения" : "Подключено к WB API"}</div><div className="profile"><span className="avatar">WB</span><span><strong>Wildberries</strong><small>{configured ? "Рабочий кабинет" : "Токен не добавлен"}</small></span><span className="chevron">›</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{viewTitles[activeView].eyebrow}</p><h1>{viewTitles[activeView].title}</h1></div><div className="header-actions"><div className="sync-state"><span className={error ? "live-dot offline" : "live-dot"} /><span>Последнее обновление<br/><strong>{formatSyncTime(updatedAt)} МСК</strong></span></div><button className="logout-btn" type="button" onClick={() => void logoutAdmin()}>Выйти</button><button className="secondary-btn" type="button" onClick={() => void loadData(true)} disabled={loading}><span className={loading ? "spin" : ""}>↻</span>{loading ? "Обновляем" : "Обновить"}</button><button className="primary-btn" type="button" onClick={() => downloadCsv(filteredRows, "ostatki-wb")} disabled={!rows.length}>Экспорт<span>↓</span></button></div></header>

        <div className="content" id="overview">
          {cabinet && <section className={`cabinet-strip ${cabinet.configured ? "ready" : "waiting"}`}>
            <div><span className="cabinet-strip-mark">WB</span><span><small>ТЕКУЩИЙ КАБИНЕТ</small><strong>{cabinet.name}</strong></span></div>
            <p>{cabinet.configured ? "Данные, склады ФФ и сроки годности отделены от второго кабинета." : "Ожидает API-токен Wildberries. Вход и отдельные склады уже готовы."}</p>
            <button type="button" onClick={() => void logoutAdmin()}>Сменить кабинет</button>
          </section>}
          {error && <section className="api-notice" role="alert"><span className="api-notice-icon">!</span><div><strong>{error}</strong><p>{configured ? "Для полной загрузки токену нужны категории: Контент, Маркетплейс и Аналитика." : "Безопасный токен хранится только на сервере и не передаётся в браузер."}</p></div><button type="button" onClick={() => void loadData(true)}>Проверить снова</button></section>}
          {!error && warnings.length > 0 && <section className="warning-strip"><span>!</span><p>{warnings.join(" · ")}</p></section>}

          {activeView === "manual" ? (
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
                  <div className="manual-warehouse-list">{manualWarehouses.map((item) => <div key={item.id}><span className="warehouse-pin">□</span><div><strong>{item.city}</strong><small>{item.name}</small></div></div>)}</div>
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
                    <p>Нужны «Артикул» и «Количество». Необязательный столбец «Срок годности» — в формате 31.12.2026. Выберите склад для файла.</p>
                  </div>
                  <div className="import-file-actions">
                    <a className="import-template-link" href="/ff-stock-import-template.xlsx" download="Шаблон_остатков_ФФ.xlsx">Скачать шаблон Excel ↓</a>
                    <label className="import-file"><span>Выбрать заполненный файл</span><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void chooseImportFile(event)} /></label>
                  </div>
                  {importPreview && <div className="import-preview"><strong>{importPreview.fileName}</strong><span>Лист: {importPreview.sheetName} · {importPreview.items.length} артикулов{importPreview.hasExpiryColumn ? " · сроки считаны" : " · без сроков"}{importPreview.skipped ? ` · пропущено строк: ${importPreview.skipped}` : ""}</span></div>}
                  <div className="import-controls">
                    <label><span>Склад</span><select value={selectedImportWarehouseId} onChange={(event) => setImportWarehouseId(event.target.value)}>{manualWarehouses.map((item) => <option value={item.id} key={item.id}>{formatManualWarehouse(item)}</option>)}</select></label>
                    <label><span>Как применить</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as "replace" | "add")}><option value="replace">Заменить остатки из файла</option><option value="add">Прибавить к текущим остаткам</option></select></label>
                  </div>
                  <p className="import-hint">Если в файле нет столбца срока годности, сохранённые даты не меняются. «Заменить» обновляет только артикулы из файла.</p>
                  <button className="drawer-primary import-button" type="button" onClick={() => void importExcel()} disabled={!importPreview || !selectedImportWarehouseId || importLoading}>{importLoading ? "Загружаем…" : "Загрузить в выбранный склад"}</button>
                  {importMessage && <p className="form-status success">{importMessage}</p>}
                  {importError && <p className="form-status error">{importError}</p>}
                </article>
              </div>
              <ExpiryManager
                rows={rows}
                warehouses={manualWarehouses}
                onSaved={(key, stock, expiresAt) => setRows((current) => current.map((row) => row.key === key ? { ...row, ffStock: stock, ffExpiry: expiresAt } : row))}
              />
            </section>
          ) : <>
            <section className={`metric-grid ${activeView !== "overview" ? "view-hidden" : ""}`} aria-label="Ключевые показатели"><article className="metric-card featured"><div className="metric-top"><span>Остаток на складах WB</span><span className="trend up">● WB API</span></div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.available)} <small>шт.</small></strong><div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, index) => <i key={index} style={{ height }} />)}</div><p>Фактический остаток · для FBS недоступен</p></article><article className="metric-card"><div className="metric-icon green">□</div><div className="metric-label">Остатки ФФ · вручную</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.ffTotal)} <small>шт.</small></strong><p>{manualWarehouses.map((item) => `${item.city} ${totals.ffStock[item.id] ?? 0}`).join(" · ")}</p></article><article className="metric-card"><div className="metric-icon blue">→</div><div className="metric-label">Активные FBS</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.fbs)} <small>шт.</small></strong><p>Казань <b>{totals.fbsByLocation.kazan}</b> · Москва <b>{totals.fbsByLocation.moscow}</b> · Питер <b>{totals.fbsByLocation.spb}</b></p></article><article className="metric-card"><div className="metric-icon amber">◷</div><div className="metric-label">Ожидают продажи</div><strong className="metric-value">{loading ? "—" : formatNumber.format(totals.toSale)} <small>шт.</small></strong><p><b>{totals.receiving}</b> ожидают приёмки WB</p></article></section>

            <section className={`movement-card ${activeView !== "overview" && activeView !== "fbs" ? "view-hidden" : ""}`} id="movement"><div className="section-heading"><div><span className="section-kicker">ОСТАТКИ WB, ФФ И ДВИЖЕНИЕ FBS</span><h2>Фактические и ручные остатки отдельно</h2></div><span className="period-pill">Актуальные заказы за 30 дней</span></div><div className="movement-grid"><article className="wb-stock-fact"><span className="wb-stock-mark">WB</span><div><small>ФАКТИЧЕСКИЙ ОСТАТОК НА WB</small><strong>{formatNumber.format(totals.available)} <em>шт.</em></strong><p>Уже находится на складах Wildberries и не является доступным запасом для FBS.</p></div></article><div className="fbs-overview"><div className="movement-subhead"><span>РУЧНЫЕ ОСТАТКИ ФФ</span><button className="text-action" type="button" onClick={() => navigateTo("manual")}>Настроить склады</button></div><div className="fbs-location-grid manual-location-grid dynamic-locations">{manualWarehouses.map((item) => <article className="fbs-location-card manual" key={item.id}><span>{item.city}</span><strong>{formatNumber.format(totals.ffStock[item.id] ?? 0)}</strong><small>{item.name}</small></article>)}</div><div className="movement-subhead orders"><span>АКТИВНЫЕ FBS-ЗАКАЗЫ</span><small>По данным WB API</small></div><div className="fbs-location-grid order-location-grid">{fbsLocations.map((location) => <article className="fbs-location-card" key={location.key}><span>{location.city}</span><strong>{formatNumber.format(totals.fbsByLocation[location.key])}</strong><small>{location.label}</small></article>)}</div><div className="fbs-stage-strip"><span><b>{totals.fbs}</b> активные FBS</span><i>→</i><span><b>{totals.receiving}</b> ожидают WB</span><i>→</i><span className="sale-stage"><b>{totals.toSale}</b> к продаже</span></div></div></div></section>

            <section className={`stock-card ${activeView === "reports" ? "view-hidden" : ""}`} id="stock"><div className="stock-header"><div><span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span><h2>{stockTitle}</h2></div><div className="stock-tools"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам"/></label><label className="select-wrap"><span>Склад:</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Выбрать склад"><option>Все склады</option>{warehouseNames.map((item) => <option key={item}>{item}</option>)}</select></label></div></div><div className="filter-row"><div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">{[{ name: "Все", count: counts.all }, { name: "Дефицит", count: counts.risk }, { name: "Активные FBS", count: counts.transit }].map((item) => <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>)}</div><span className="result-count">Показано {filteredRows.length} из {viewTotal} артикулов</span></div><div className="table-wrap"><table><thead><tr><th>Товар / артикул</th><th>{warehouse === "Все склады" ? "Остаток WB" : "Выбранный склад WB"}</th>{manualWarehouses.map((item) => <th className="ff-column-head" key={item.id}><span>{item.city}</span><small>{item.name}</small></th>)}<th>Активные FBS</th><th>К продаже</th><th>Статус</th><th /></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.key} onClick={() => openProduct(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProduct(row); }}><td><div className="product-cell"><span className="product-swatch" style={{ background: row.color }}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td><td><b>{formatNumber.format(warehouse === "Все склады" ? stockTotal(row) : row.warehouses[warehouse] ?? 0)}</b><small> шт.</small></td>{manualWarehouses.map((item) => <td key={item.id}><span className={`manual-stock-value ${(row.ffStock[item.id] ?? 0) === 0 ? "zero" : ""}`} title={`Открыть и изменить: ${formatManualWarehouse(item)}`}>{formatNumber.format(row.ffStock[item.id] ?? 0)}<small> шт.</small></span></td>)}<td><span className="number-pill blue-pill">{row.fbs}</span></td><td><span className="number-pill green-pill">{row.toSale}</span></td><td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td><td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td></tr>)}</tbody></table>{loading && <div className="loading-state"><span className="loader"/><strong>Загружаем данные из Wildberries</strong><small>Остатки и статусы FBS собираются в единый отчёт</small></div>}{!loading && !filteredRows.length && <div className="empty-state"><strong>{error ? "Данные пока не загружены" : "Ничего не найдено"}</strong><span>{error ? "Проверьте подключение WB API." : "Попробуйте изменить поиск или фильтры."}</span></div>}</div><footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{updatedAt ? `Остатки обновлены в ${formatSyncTime(updatedAt)} МСК` : "Ожидаем синхронизацию"}</span><button type="button" onClick={() => { setQuery(""); setFilter("Все"); setWarehouse("Все склады"); }}>Сбросить фильтры</button></footer></section>

            {activeView === "reports" && <section className="reports-panel" id="reports"><div className="section-heading"><div><span className="section-kicker">ГОТОВЫЕ ВЫГРУЗКИ</span><h2>Скачать данные из кабинета</h2></div><span className="period-pill">CSV · Excel</span></div><div className="reports-grid"><article className="report-card"><span className="report-symbol blue">□</span><div><strong>Все остатки</strong><p>Артикулы и количество по каждому складу</p><small>{rows.length} артикулов · {warehouseNames.length} складов WB</small></div><button type="button" onClick={() => downloadCsv(rows, "vse-ostatki-wb")} disabled={!rows.length}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol amber">→</span><div><strong>FBS-движение</strong><p>Отгружено, на приёмке и ожидает продажи</p><small>{counts.transit} артикулов · {totals.fbs} единиц</small></div><button type="button" onClick={() => downloadCsv(rows.filter((row) => row.fbs > 0), "fbs-wb")} disabled={!counts.transit}>Скачать ↓</button></article><article className="report-card"><span className="report-symbol green">▤</span><div><strong>Ручные остатки ФФ</strong><p>Все добавленные склады и остатки по артикулам</p><small>{manualWarehouses.length} складов ФФ</small></div><button type="button" onClick={() => downloadCsv(rows, "ostatki-ff")} disabled={!rows.length}>Скачать ↓</button></article></div></section>}
          </>}
        </div>
      </section>

      {selected && <div className="drawer-backdrop" onMouseDown={() => setSelected(null)} role="presentation"><aside className="drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`Карточка товара ${selected.name}`}><button className="close-btn" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button><span className="drawer-kicker">КАРТОЧКА ТОВАРА · WB API</span><div className="drawer-product"><span className="product-swatch large" style={{ background: selected.color }}>{selected.name.charAt(0).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.sku}{selected.nmId ? ` · WB ${selected.nmId}` : ""}</p></div></div><div className="drawer-total"><span>Фактический остаток на WB</span><strong>{formatNumber.format(stockTotal(selected))} <small>шт.</small></strong></div><div className="warehouse-list">{Object.entries(selected.warehouses).sort((a, b) => b[1] - a[1]).map(([name, value]) => <div key={name}><span><i />{name}</span><strong>{formatNumber.format(value)} шт.</strong></div>)}{!Object.keys(selected.warehouses).length && <div><span>Нет остатков</span><strong>0 шт.</strong></div>}</div><p className="drawer-stock-note">Этот остаток уже находится на складах Wildberries и недоступен для FBS.</p><h3>Ручные остатки ФФ</h3><div className="ff-stock-editor">{manualWarehouses.map((item) => <label key={item.id}><span><strong>{item.city}</strong><small>{item.name}</small></span><input type="number" min="0" max="10000000" step="1" inputMode="numeric" value={ffDraft[item.id] ?? 0} onChange={(event) => setFfDraft((current) => ({ ...current, [item.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} aria-label={`Остаток ФФ: ${formatManualWarehouse(item)}`} /></label>)}</div><button className="drawer-primary ff-save-button" type="button" onClick={() => void saveManualFfStock()} disabled={ffSaving}>{ffSaving ? "Сохраняем…" : "Сохранить остатки ФФ"}</button>{ffSaveMessage && <p className="ff-save-status success">{ffSaveMessage}</p>}{ffSaveError && <p className="ff-save-status error">{ffSaveError}</p>}<h3>Активные FBS по складам</h3><div className="drawer-fbs-locations">{fbsLocations.map((location) => <div key={location.key}><span><strong>{location.city}</strong><small>{location.label}</small></span><b>{selected.fbsByLocation?.[location.key] ?? 0} шт.</b></div>)}</div><h3>Текущее движение FBS</h3><div className="timeline"><div className="timeline-item done"><i>✓</i><div><strong>Отгружено на FBS</strong><span>{selected.fbs} шт. в доставке</span></div></div><div className="timeline-item active"><i>2</i><div><strong>Ожидает приёмки WB</strong><span>{selected.receiving} шт. в статусе waiting</span></div></div><div className="timeline-item"><i>3</i><div><strong>Ожидает продажи</strong><span>{selected.toSale} шт. отсортировано или готово к выдаче</span></div></div></div><p className="drawer-note">Данные Wildberries обновлены в {selected.updated} МСК</p></aside></div>}
    </main>
  );
}
