"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { articleReferenceMatches, mergeCampaignReportArticles } from "../../lib/report-domain.mjs";
import CampaignReportUpload from "./CampaignReportUpload";
import MediaQueries from "./MediaQueries";

type DailyCell = {
  views: number;
  clicks: number;
  expense: number;
  directOrders: number;
  modelOrders: number;
  directSales: number;
  modelSales: number;
};

type Campaign = {
  id: string;
  name: string;
  type: string;
  paymentType: "CPC" | "CPM";
  status: "running" | "paused";
  dates: Record<string, DailyCell>;
  periodTotals?: DailyCell;
  sourceFile?: string;
  mappingSource?: "auto" | "manual" | "unmapped";
};

type Article = {
  sku: string;
  offerId: string;
  name: string;
  source?: "product" | "media" | "imported" | "unmapped";
  campaigns: Campaign[];
};

type Task = {
  id: number;
  article: string;
  campaignId: string;
  task: string;
  solution: string;
  status: "open" | "done";
  activityDate: string;
  createdAt: string;
};

type CatalogProduct = {
  sku: string;
  offerId: string;
  name: string;
};

type SharedPeriod = {
  dateFrom: string;
  dateTo: string;
  preset: "7" | "14" | "30" | "custom";
};

type KpiBreakdownRow = {
  id: string;
  article: string;
  campaign: string;
  paymentType: "CPC" | "CPM";
  cell: DailyCell;
  sales: number;
  orders: number;
  drr: number | null;
  ctr: number;
};

const API_HEADERS = { "ngrok-skip-browser-warning": "1" } as const;

type Tab = "campaigns" | "queries" | "notes" | "settings";
type CampaignFilter = "all" | "running" | "paused";
type MetricKey = "views" | "clicks" | "ctr" | "cost" | "expense" | "directOrders" | "postViewOrders" | "orders" | "directSales" | "postViewSales" | "sales" | "drr";
type KpiKey = "expense" | "sales" | "orders" | "drr" | "ctr";

const zeroCell: DailyCell = {
  views: 0,
  clicks: 0,
  expense: 0,
  directOrders: 0,
  modelOrders: 0,
  directSales: 0,
  modelSales: 0,
};

const metricRows: Array<{ key: MetricKey; label: string; hint: string }> = [
  { key: "views", label: "Показы", hint: "шт." },
  { key: "clicks", label: "Клики", hint: "шт." },
  { key: "ctr", label: "CTR", hint: "%" },
  { key: "cost", label: "CPM / CPC", hint: "₽" },
  { key: "expense", label: "Расход", hint: "₽" },
  { key: "directOrders", label: "Продажи во время РК", hint: "шт. · прямые" },
  { key: "postViewOrders", label: "Продажи после РК", hint: "шт. · post-view" },
  { key: "orders", label: "Продажи всего", hint: "шт. · во время + после" },
  { key: "directSales", label: "Продажи во время РК", hint: "₽ · прямые" },
  { key: "postViewSales", label: "Продажи после РК", hint: "₽ · post-view" },
  { key: "sales", label: "Продажи всего", hint: "₽ · во время + после" },
  { key: "drr", label: "ДРР", hint: "%" },
];

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function dateRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  return { from: isoDate(start), to: isoDate(end) };
}

function listDates(from: string, to: string) {
  const dates: string[] = [];
  const current = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (current <= end && dates.length < 31) {
    dates.push(isoDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function sumCells(cells: DailyCell[]) {
  return cells.reduce(
    (sum, cell) => ({
      views: sum.views + cell.views,
      clicks: sum.clicks + cell.clicks,
      expense: sum.expense + cell.expense,
      directOrders: sum.directOrders + cell.directOrders,
      modelOrders: sum.modelOrders + cell.modelOrders,
      directSales: sum.directSales + cell.directSales,
      modelSales: sum.modelSales + cell.modelSales,
    }),
    { ...zeroCell },
  );
}

function metricNumber(cell: DailyCell, key: MetricKey, paymentType: "CPC" | "CPM") {
  const sales = cell.directSales + cell.modelSales;
  if (key === "views") return cell.views;
  if (key === "clicks") return cell.clicks;
  if (key === "ctr") return cell.views ? (cell.clicks / cell.views) * 100 : 0;
  if (key === "cost") {
    return paymentType === "CPM"
      ? cell.views ? (cell.expense / cell.views) * 1000 : 0
      : cell.clicks ? cell.expense / cell.clicks : 0;
  }
  if (key === "expense") return cell.expense;
  if (key === "directOrders") return cell.directOrders;
  if (key === "postViewOrders") return cell.modelOrders;
  if (key === "orders") return cell.directOrders + cell.modelOrders;
  if (key === "directSales") return cell.directSales;
  if (key === "postViewSales") return cell.modelSales;
  if (key === "sales") return sales;
  return sales ? (cell.expense / sales) * 100 : 0;
}

function money(value: number, digits = 0) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function compact(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMetric(cell: DailyCell, key: MetricKey, paymentType: "CPC" | "CPM") {
  const value = metricNumber(cell, key, paymentType);
  if (key === "ctr" || key === "drr") return value.toFixed(1).replace(".", ",") + "%";
  if (["cost", "expense", "directSales", "postViewSales", "sales"].includes(key)) return money(value, key === "cost" ? 2 : 0);
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" })
    .format(new Date(date + "T12:00:00"))
    .replace(".", "");
}

function localSyncTime(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T") + "Z"
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeCampaignMatch(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export default function Dashboard() {
  const initialRange = useMemo(() => dateRange(7), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [days, setDays] = useState("7");
  const [customDateFrom, setCustomDateFrom] = useState(initialRange.from);
  const [customDateTo, setCustomDateTo] = useState(initialRange.to);
  const [periodReady, setPeriodReady] = useState(false);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [periodNotice, setPeriodNotice] = useState("");
  const dates = useMemo(() => listDates(dateFrom, dateTo), [dateFrom, dateTo]);
  const [apiArticles, setApiArticles] = useState<Article[]>([]);
  const [reportArticles, setReportArticles] = useState<Article[]>([]);
  const [reportExact, setReportExact] = useState(false);
  const [reportSourceFiles, setReportSourceFiles] = useState<string[]>([]);
  const articles = useMemo(
    () => mergeCampaignReportArticles(reportArticles, apiArticles),
    [reportArticles, apiArticles],
  );
  const [tab, setTab] = useState<Tab>("campaigns");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedArticles, setCollapsedArticles] = useState<Set<string>>(() => new Set());
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const [search, setSearch] = useState("");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [mode, setMode] = useState<"loading" | "live" | "xlsx" | "error">("loading");
  const [syncing, setSyncing] = useState(false);
  const [serverRefreshing, setServerRefreshing] = useState(true);
  const [lastSync, setLastSync] = useState("загрузка…");
  const [notice, setNotice] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTarget, setTaskTarget] = useState<Article | null>(null);
  const [logTarget, setLogTarget] = useState<Article | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [taskText, setTaskText] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [taskDate, setTaskDate] = useState(initialRange.to);
  const [savingTask, setSavingTask] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [noteFilter, setNoteFilter] = useState<"all" | "advertised" | "not-advertised">("all");
  const [noteValues, setNoteValues] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [queryReloadToken, setQueryReloadToken] = useState(0);
  const [mappingCampaignId, setMappingCampaignId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/rnp/tasks", { cache: "no-store", headers: API_HEADERS });
      const payload = (await response.json()) as {
        tasks?: Task[];
        error?: string;
      };
      if (response.ok && Array.isArray(payload.tasks)) setTasks(payload.tasks);
    } catch {
      setTasks([]);
    }
  }, []);

  const loadSharedPeriod = useCallback(async () => {
    try {
      const response = await fetch("/api/rnp/settings/period", { cache: "no-store", headers: API_HEADERS });
      const payload = await response.json() as { period?: SharedPeriod | null };
      const period = payload.period;
      if (response.ok && period) {
        setDays(period.preset);
        setDateFrom(period.dateFrom);
        setDateTo(period.dateTo);
        setCustomDateFrom(period.dateFrom);
        setCustomDateTo(period.dateTo);
      }
    } catch {
      // При временной недоступности D1 остаётся текущий период в браузере.
    } finally {
      setPeriodReady(true);
    }
  }, []);

  const saveSharedPeriod = useCallback(async (period: SharedPeriod) => {
    setPeriodSaving(true);
    setPeriodNotice("");
    try {
      const response = await fetch("/api/rnp/settings/period", {
        method: "PUT",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(period),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить период");
      setDays(period.preset);
      setDateFrom(period.dateFrom);
      setDateTo(period.dateTo);
      setCustomDateFrom(period.dateFrom);
      setCustomDateTo(period.dateTo);
      setPeriodNotice("Период сохранён для всех пользователей.");
    } catch (error) {
      setPeriodNotice(error instanceof Error ? error.message : "Не удалось сохранить период");
    } finally {
      setPeriodSaving(false);
    }
  }, []);

  const loadCampaignReport = useCallback(async () => {
    try {
      const response = await fetch("/api/rnp/campaign-reports?dateFrom=" + encodeURIComponent(dateFrom) + "&dateTo=" + encodeURIComponent(dateTo), { cache: "no-store", headers: API_HEADERS });
      const payload = await response.json() as { articles?: Article[]; exact?: boolean; sourceFiles?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить контрольный отчёт");
      const nextArticles = Array.isArray(payload.articles) ? payload.articles : [];
      setReportArticles(nextArticles);
      setReportExact(Boolean(payload.exact));
      setReportSourceFiles(Array.isArray(payload.sourceFiles) ? payload.sourceFiles : []);
      if (nextArticles.length) setMode("xlsx");
    } catch (error) {
      setReportArticles([]);
      setReportExact(false);
      setReportSourceFiles([]);
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить контрольный отчёт");
    }
  }, [dateFrom, dateTo]);

  const refreshData = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) {
      setSyncing(true);
      setNotice("");
    }
    try {
      const response = await fetch(
        "/api/rnp/ozon?dateFrom=" + encodeURIComponent(dateFrom) + "&dateTo=" + encodeURIComponent(dateTo),
        { method: options.force ? "POST" : "GET", cache: "no-store", headers: API_HEADERS },
      );
      const payload = (await response.json()) as {
        articles?: Article[];
        mode?: "loading" | "live" | "error";
        lastSync?: string;
        refreshedAt?: string | null;
        message?: string;
        error?: string;
        refreshing?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Не удалось получить данные Ozon");
      if (payload.mode === "live" && Array.isArray(payload.articles)) {
        setApiArticles(payload.articles);
        setMode("live");
      } else if (payload.mode === "loading") {
        setMode((current) => current === "live" ? current : "loading");
      }
      setServerRefreshing(Boolean(payload.refreshing));
      if (payload.refreshedAt) setLastSync(localSyncTime(payload.refreshedAt));
      else if (payload.lastSync) setLastSync(payload.lastSync);
      setNotice(payload.message || "");
    } catch (error) {
      setServerRefreshing(false);
      setMode((current) => current === "xlsx" ? current : "error");
      setNotice(error instanceof Error ? error.message : "Данные временно недоступны");
    } finally {
      if (!options.silent) setSyncing(false);
    }
  }, [dateFrom, dateTo]);

  const loadNotes = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const [productsResponse, notesResponse] = await Promise.all([
        fetch("/api/rnp/ozon/products", { cache: "no-store", headers: API_HEADERS }),
        fetch("/api/rnp/notes?dateFrom=" + encodeURIComponent(dateFrom) + "&dateTo=" + encodeURIComponent(dateTo), { cache: "no-store", headers: API_HEADERS }),
      ]);
      const productsPayload = await productsResponse.json() as { products?: CatalogProduct[]; error?: string };
      const notesPayload = await notesResponse.json() as { notes?: Array<{ article: string; noteDate: string; note: string }>; error?: string };
      if (!productsResponse.ok) throw new Error(productsPayload.error || "Не удалось загрузить товары из кабинета");
      if (!notesResponse.ok) throw new Error(notesPayload.error || "Не удалось загрузить заметки");
      setCatalogProducts(Array.isArray(productsPayload.products) ? productsPayload.products : []);
      setNoteValues(Object.fromEntries((notesPayload.notes ?? []).map((note) => [note.article + ":" + note.noteDate, note.note])));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Не удалось загрузить таблицу заметок");
    } finally {
      setCatalogLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadCatalogProducts = useCallback(async () => {
    try {
      const response = await fetch("/api/rnp/ozon/products", { cache: "no-store", headers: API_HEADERS });
      const payload = await response.json() as { products?: CatalogProduct[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить товары");
      setCatalogProducts(Array.isArray(payload.products) ? payload.products : []);
    } catch {
      // Сопоставление можно выполнить позже; импорт статистики остаётся доступен.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSharedPeriod(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSharedPeriod]);

  useEffect(() => {
    if (!periodReady) return;
    const initialTimer = window.setTimeout(() => {
      void (async () => {
        await loadCampaignReport();
        await refreshData();
      })();
      void loadTasks();
      void loadCatalogProducts();
    }, 0);
    const timer = window.setInterval(() => void refreshData({ silent: true }), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [periodReady, refreshData, loadTasks, loadCampaignReport, loadCatalogProducts]);

  useEffect(() => {
    if (!serverRefreshing) return;
    const timer = window.setInterval(() => void refreshData({ silent: true }), 3_000);
    return () => window.clearInterval(timer);
  }, [serverRefreshing, refreshData]);

  useEffect(() => {
    if (!periodReady) return;
    if (tab !== "notes") return;
    const timer = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [periodReady, tab, loadNotes]);

  const allCampaigns = useMemo(
    () => articles.flatMap((article) => article.campaigns.map((campaign) => ({ ...campaign, sku: article.sku, offerId: article.offerId }))),
    [articles],
  );

  const totals = useMemo(() => {
    const cells = articles.flatMap((article) => article.campaigns.map((campaign) =>
      campaign.periodTotals ?? sumCells(Object.values(campaign.dates)),
    ));
    return sumCells(cells);
  }, [articles]);

  const totalSales = totals.directSales + totals.modelSales;
  const totalOrders = totals.directOrders + totals.modelOrders;
  const totalDrr = totalSales ? (totals.expense / totalSales) * 100 : 0;
  const totalCtr = totals.views ? (totals.clicks / totals.views) * 100 : 0;

  const kpiRows = useMemo(() => {
    if (!activeKpi) return [];
    const rows = articles.flatMap((article) => article.campaigns.map((campaign) => {
      const cell = campaign.periodTotals ?? sumCells(Object.values(campaign.dates));
      const sales = cell.directSales + cell.modelSales;
      const orders = cell.directOrders + cell.modelOrders;
      return {
        id: article.sku + ":" + campaign.id,
        article: article.offerId,
        campaign: campaign.name,
        paymentType: campaign.paymentType,
        cell,
        sales,
        orders,
        drr: sales ? (cell.expense / sales) * 100 : null,
        ctr: cell.views ? (cell.clicks / cell.views) * 100 : 0,
      };
    }));

    const filtered = rows.filter((row) => {
      if (activeKpi === "expense") return row.cell.expense > 0;
      if (activeKpi === "sales") return row.sales > 0;
      if (activeKpi === "orders") return row.orders > 0;
      if (activeKpi === "drr") return row.cell.expense > 0;
      return row.cell.views > 0;
    });

    return filtered.sort((left, right) => {
      if (activeKpi === "expense") return right.cell.expense - left.cell.expense;
      if (activeKpi === "sales") return right.sales - left.sales;
      if (activeKpi === "orders") return right.orders - left.orders || right.sales - left.sales;
      if (activeKpi === "ctr") return right.ctr - left.ctr;
      const leftScore = left.drr == null ? 1_000_000 + left.cell.expense : left.drr;
      const rightScore = right.drr == null ? 1_000_000 + right.cell.expense : right.drr;
      return rightScore - leftScore;
    });
  }, [activeKpi, articles]);

  const filteredArticles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return articles
      .filter((article) => !needle || [article.sku, article.offerId, article.name, ...article.campaigns.map((campaign) => campaign.name)]
        .join(" ")
        .toLowerCase()
        .includes(needle))
      .map((article) => ({
        ...article,
        campaigns: article.campaigns.filter((campaign) => campaignFilter === "all" || campaign.status === campaignFilter),
      }))
      .filter((article) => article.campaigns.length > 0);
  }, [articles, search, campaignFilter]);

  const visibleCampaigns = useMemo(
    () => filteredArticles.flatMap((article) => article.campaigns),
    [filteredArticles],
  );

  const campaignStateCounts = useMemo(() => ({
    all: allCampaigns.length,
    running: allCampaigns.filter((campaign) => campaign.status === "running").length,
    paused: allCampaigns.filter((campaign) => campaign.status === "paused").length,
  }), [allCampaigns]);

  const advertisedProductSkus = useMemo(() => {
    const directProductSkus = new Set(
      articles
        .filter((article) => article.source === "product" || article.source === "imported")
        .map((article) => article.sku),
    );
    const mediaCampaignLabels = articles
      .filter((article) => article.source === "media")
      .flatMap((article) => [article.offerId, ...article.campaigns.map((campaign) => campaign.name)])
      .map(normalizeCampaignMatch);

    return new Set(catalogProducts
      .filter((product) => {
        if (directProductSkus.has(product.sku)) return true;
        const offerId = normalizeCampaignMatch(product.offerId);
        return offerId.length >= 5 && mediaCampaignLabels.some((label) => label.includes(offerId));
      })
      .map((product) => product.sku));
  }, [articles, catalogProducts]);

  const filteredCatalogProducts = useMemo(() => catalogProducts.filter((product) => {
    const advertised = advertisedProductSkus.has(product.sku);
    return noteFilter === "all" || noteFilter === "advertised" ? advertised || noteFilter === "all" : !advertised;
  }), [catalogProducts, advertisedProductSkus, noteFilter]);

  function changePreset(value: string) {
    if (value === "custom") {
      setDays("custom");
      setCustomDateFrom(dateFrom);
      setCustomDateTo(dateTo);
      return;
    }
    const next = dateRange(Number(value));
    void saveSharedPeriod({ dateFrom: next.from, dateTo: next.to, preset: value as SharedPeriod["preset"] });
  }

  function applyCustomPeriod() {
    if (customDateFrom > customDateTo) {
      setPeriodNotice("Дата «От» должна быть раньше даты «До».");
      return;
    }
    void saveSharedPeriod({ dateFrom: customDateFrom, dateTo: customDateTo, preset: "custom" });
  }

  function toggleCampaign(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleArticle(sku: string) {
    setCollapsedArticles((current) => {
      const next = new Set(current);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  function openTaskEditor(article: Article, task?: Task) {
    setTaskTarget(article);
    setEditingTaskId(task?.id ?? null);
    setTaskText(task?.task ?? "");
    setSolutionText(task?.solution ?? "");
    setTaskDate(task?.activityDate ?? dateTo);
  }

  function closeTaskEditor() {
    setTaskTarget(null);
    setEditingTaskId(null);
    setTaskText("");
    setSolutionText("");
    setTaskDate(dateTo);
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTarget || !taskText.trim()) return;
    setSavingTask(true);
    try {
      const response = await fetch("/api/rnp/tasks", {
        method: editingTaskId ? "PATCH" : "POST",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(editingTaskId
          ? { id: editingTaskId, status: "open", task: taskText, solution: solutionText, activityDate: taskDate }
          : { article: taskTarget.sku, campaignId: "", task: taskText, solution: solutionText, activityDate: taskDate }),
      });
      if (!response.ok) throw new Error();
      closeTaskEditor();
      await loadTasks();
    } catch {
      setNotice("Не удалось сохранить задачу. Повторите попытку.");
    } finally {
      setSavingTask(false);
    }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm("Удалить эту запись из журнала? Восстановить её будет нельзя.")) return;
    try {
      const response = await fetch("/api/rnp/tasks?id=" + encodeURIComponent(String(task.id)), { method: "DELETE", headers: API_HEADERS });
      if (!response.ok) throw new Error();
      closeTaskEditor();
      await loadTasks();
    } catch {
      setNotice("Не удалось удалить запись. Повторите попытку.");
    }
  }

  async function saveNote(article: string, noteDate: string) {
    const key = article + ":" + noteDate;
    setSavingNote(key);
    try {
      const response = await fetch("/api/rnp/notes", {
        method: "PUT",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ article, noteDate, note: noteValues[key] ?? "" }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setNotice("Не удалось сохранить заметку. Повторите попытку.");
    } finally {
      setSavingNote(null);
    }
  }

  async function mapCampaign(campaignId: string, productSku: string) {
    const product = catalogProducts.find((item) => item.sku === productSku);
    if (!product) return;
    setMappingCampaignId(campaignId);
    try {
      const response = await fetch("/api/rnp/campaign-reports", {
        method: "PATCH",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, product }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сопоставить РК");
      await loadCampaignReport();
      setNotice("Кампания сопоставлена с артикулом " + product.offerId + ".");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось сопоставить кампанию");
    } finally {
      setMappingCampaignId(null);
    }
  }

  return (
    <section className="rnp-control-root">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Р</span>
          <div>
            <strong>Медийная реклама</strong>
            <span>Управление рекламой Ozon</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="Основная навигация">
          <button className={tab === "campaigns" ? "active" : ""} onClick={() => setTab("campaigns")}>Кампании</button>
          <button className={tab === "queries" ? "active" : ""} onClick={() => setTab("queries")}>Ключи РК</button>
          <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Заметки</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Подключение</button>
        </nav>
        <div className="sync-status">
          <span className={"status-dot " + mode} />
          <div>
            <strong>{mode === "live" ? "Ozon подключён" : mode === "xlsx" ? "Данные из XLSX Ozon" : mode === "loading" ? "Загружаем данные" : "Ошибка обновления"}</strong>
            <span>Обновлено: {lastSync}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Операционный отчёт</p>
            <h1>{tab === "campaigns" ? "Реклама по артикулам" : tab === "queries" ? "Ключи медийных РК" : tab === "notes" ? "Заметки по артикулам" : "Подключение Ozon API"}</h1>
            <p className="heading-note">
              {tab === "campaigns" && "Данные по дням, решения — рядом с цифрами."}
              {tab === "queries" && "По каким поисковым запросам Ozon показывает каждую медийную кампанию."}
              {tab === "notes" && "Ежедневные выводы по реальным товарам из кабинета Ozon."}
              {tab === "settings" && "Ключи хранятся только на сервере и никогда не отправляются в браузер."}
            </p>
          </div>
          {tab !== "settings" && (
            <div className="date-controls">
              <label>
                Период
                <select value={days} onChange={(event) => changePreset(event.target.value)}>
                  <option value="7">7 дней</option>
                  <option value="14">14 дней</option>
                  <option value="30">30 дней</option>
                  <option value="custom">Свой период</option>
                </select>
              </label>
              {days === "custom" && (
                <div className="custom-period-controls">
                  <label>От<input type="date" value={customDateFrom} onChange={(event) => setCustomDateFrom(event.target.value)} /></label>
                  <label>До<input type="date" value={customDateTo} onChange={(event) => setCustomDateTo(event.target.value)} /></label>
                  <button type="button" className="apply-period-button" onClick={applyCustomPeriod} disabled={periodSaving}>{periodSaving ? "Сохраняю" : "Применить для всех"}</button>
                </div>
              )}
              <button className="primary-button" onClick={() => tab === "notes" ? void loadNotes() : tab === "queries" ? setQueryReloadToken((value) => value + 1) : void refreshData({ force: true })} disabled={syncing || catalogLoading}>
                <span className={(syncing || catalogLoading) ? "spin" : ""}>↻</span>
                {(syncing || catalogLoading) ? "Обновляю" : "Обновить"}
              </button>
              {periodNotice && <span className="period-notice">{periodNotice}</span>}
            </div>
          )}
        </div>

        {tab === "campaigns" && (
          <>
            <CampaignReportUpload
              exact={reportExact}
              sourceFiles={reportSourceFiles}
              onImported={async (nextFrom, nextTo) => {
                if (nextFrom !== dateFrom || nextTo !== dateTo) {
                  await saveSharedPeriod({ dateFrom: nextFrom, dateTo: nextTo, preset: "custom" });
                } else {
                  await loadCampaignReport();
                }
              }}
            />
            <section className="kpi-grid" aria-label="Ключевые показатели">
              <Kpi label="Расход" value={money(totals.expense)} tone="blue" onClick={() => setActiveKpi("expense")} />
              <Kpi label="Продажи всего · во время + после" value={money(totalSales)} tone="green" onClick={() => setActiveKpi("sales")} />
              <Kpi label="Продано всего · во время + после" value={compact(totalOrders) + " шт."} tone="violet" onClick={() => setActiveKpi("orders")} />
              <Kpi label="ДРР" value={totalDrr.toFixed(1).replace(".", ",") + "%"} tone={totalDrr > 15 ? "coral" : "green"} onClick={() => setActiveKpi("drr")} />
              <Kpi label="CTR" value={totalCtr.toFixed(2).replace(".", ",") + "%"} tone="blue" onClick={() => setActiveKpi("ctr")} />
            </section>

            {activeKpi && (
              <KpiDrilldown metric={activeKpi} rows={kpiRows} onClose={() => setActiveKpi(null)} />
            )}

            {taskTarget && (
              <TaskEditor
                article={taskTarget}
                task={taskText}
                solution={solutionText}
                editing={editingTaskId !== null}
                saving={savingTask}
                activityDate={taskDate}
                onTaskChange={setTaskText}
                onSolutionChange={setSolutionText}
                onActivityDateChange={setTaskDate}
                onDelete={() => { if (editingTaskId !== null) void deleteTask({ id: editingTaskId } as Task); }}
                onClose={closeTaskEditor}
                onSubmit={saveTask}
              />
            )}

            {logTarget && (
              <ActivityLog
                article={logTarget}
                tasks={tasks.filter((task) => articleReferenceMatches(task.article, logTarget))}
                onClose={() => setLogTarget(null)}
                onAdd={() => { setLogTarget(null); openTaskEditor(logTarget); }}
                onEdit={(task) => { setLogTarget(null); openTaskEditor(logTarget, task); }}
                onDelete={(task) => void deleteTask(task)}
              />
            )}

            <section className="report-card">
              <div className="report-toolbar">
                <div>
                  <h2>Детализация по РК</h2>
                  <span>{filteredArticles.length} артикула · {visibleCampaigns.length}{campaignFilter === "all" ? "" : " из " + allCampaigns.length} кампаний · {tasks.filter((task) => task.status === "open").length} записей в работе</span>
                </div>
                <div className="toolbar-actions">
                  <label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Артикул или кампания" /></label>
                  <div className="campaign-filter" role="group" aria-label="Фильтр статуса рекламных кампаний">
                    <button className={campaignFilter === "all" ? "active" : ""} onClick={() => setCampaignFilter("all")}>Все · {campaignStateCounts.all}</button>
                    <button className={campaignFilter === "running" ? "active" : ""} onClick={() => setCampaignFilter("running")}>Запущены · {campaignStateCounts.running}</button>
                    <button className={campaignFilter === "paused" ? "active" : ""} onClick={() => setCampaignFilter("paused")}>Не запущены · {campaignStateCounts.paused}</button>
                  </div>
                  <button className="ghost-button" onClick={() => setExpanded(new Set(visibleCampaigns.map((campaign) => campaign.id)))}>Развернуть всё</button>
                  <button className="ghost-button" onClick={() => {
                    const allCollapsed = filteredArticles.length > 0 && filteredArticles.every((article) => collapsedArticles.has(article.sku));
                    setCollapsedArticles(allCollapsed ? new Set() : new Set(filteredArticles.map((article) => article.sku)));
                  }}>
                    {filteredArticles.length > 0 && filteredArticles.every((article) => collapsedArticles.has(article.sku)) ? "Развернуть артикулы" : "Свернуть артикулы"}
                  </button>
                </div>
              </div>
              {notice && (
                <div className="inline-notice">
                  <span>i</span>
                  <p><strong>Сообщение Ozon</strong> {notice}</p>
                  <button onClick={() => setTab("settings")}>Настроить</button>
                </div>
              )}
              <div className="table-scroll">
                <table className="campaign-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">Артикул / рекламная кампания</th>
                      {dates.map((date) => <th key={date}><strong>{shortDate(date)}</strong><span>расход</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredArticles.map((article) => {
                      const isArticleCollapsed = collapsedArticles.has(article.sku);
                      const articleLogs = tasks.filter((task) => articleReferenceMatches(task.article, article) && task.activityDate === dateTo);
                      const articleTask = articleLogs.find((task) => task.status === "open") ?? articleLogs[0];
                      const articleByDate = Object.fromEntries(dates.map((date) => [
                        date,
                        sumCells(article.campaigns.map((campaign) => campaign.dates[date] ?? zeroCell)),
                      ]));
                      return [
                        <tr className="article-row" key={"article-" + article.sku}>
                          <td className="sticky-col">
                            <div className="article-header-stack">
                              <button className="article-toggle" onClick={() => toggleArticle(article.sku)} aria-expanded={!isArticleCollapsed}>
                                <span className={"chevron article-chevron " + (!isArticleCollapsed ? "open" : "")}>›</span>
                                <span className="article-monogram">{article.offerId.slice(0, 2)}</span>
                                <span className="article-copy"><strong>{article.offerId}</strong><span>{article.source === "media" || article.source === "unmapped" ? article.name : "SKU " + article.sku + " · " + article.name}</span></span>
                                <em>{article.campaigns.length} РК</em>
                              </button>
                              <div className={"article-task-strip " + (articleTask ? "active" : "empty")}>
                                <span className="task-strip-icon">✓</span>
                                <span className="task-strip-copy">
                                  <small>Лог за {shortDate(dateTo)} · {articleLogs.length} записей</small>
                                  <strong>{articleTask?.task ?? "Запись за этот день не добавлена"}</strong>
                                  {articleTask?.solution && <em>{articleTask.solution}</em>}
                                </span>
                                <button type="button" onClick={() => openTaskEditor(article)}>+ Запись</button>
                                {articleLogs.length > 0 && <button type="button" className="complete-task" onClick={() => setLogTarget(article)} title="Открыть все записи журнала">Журнал</button>}
                              </div>
                            </div>
                          </td>
                          {dates.map((date) => <td key={date}><strong>{money(articleByDate[date].expense)}</strong><span className="cell-sub">{articleByDate[date].clicks.toLocaleString("ru-RU")} кликов</span></td>)}
                        </tr>,
                        ...(isArticleCollapsed ? [] : article.campaigns.flatMap((campaign) => {
                          const isOpen = expanded.has(campaign.id);
                          const rows = [
                            <tr className="campaign-row" key={"campaign-" + campaign.id}>
                              <td className="sticky-col">
                                <button className="campaign-toggle" onClick={() => toggleCampaign(campaign.id)} aria-expanded={isOpen}>
                                  <span className={"chevron " + (isOpen ? "open" : "")}>›</span>
                                  <span className={"campaign-state " + campaign.status} title={campaign.status === "running" ? "Запущена в Ozon" : "Не запущена в Ozon: на паузе или завершена"} />
                                  <div><strong>{campaign.name}</strong><span>№ {campaign.id} · {campaign.type} · {campaign.paymentType}</span></div>
                                </button>
                                {article.source === "unmapped" && (
                                  <label className="campaign-mapping-select">Артикул
                                    <select defaultValue="" disabled={mappingCampaignId === campaign.id || !catalogProducts.length} onChange={(event) => {
                                      if (event.target.value) void mapCampaign(campaign.id, event.target.value);
                                    }}>
                                      <option value="">{catalogProducts.length ? "Сопоставить…" : "Товары загружаются…"}</option>
                                      {catalogProducts.map((product) => <option key={product.sku} value={product.sku}>{product.offerId}</option>)}
                                    </select>
                                  </label>
                                )}
                              </td>
                              {dates.map((date) => {
                                const cell = campaign.dates[date] ?? zeroCell;
                                return <td key={date}><strong>{money(cell.expense)}</strong><span className="cell-sub">ДРР {formatMetric(cell, "drr", campaign.paymentType)}</span></td>;
                              })}
                            </tr>,
                          ];
                          if (isOpen) {
                            const periodCell = campaign.periodTotals ?? sumCells(Object.values(campaign.dates));
                            metricRows.forEach((metric) => rows.push(
                              <tr className="metric-row" key={campaign.id + "-" + metric.key}>
                                <td className="sticky-col">
                                  <div className="metric-label">
                                    <span />
                                    <div><strong>{metric.label}</strong><small>{metric.hint}</small></div>
                                    <em title={`Показатель за ${shortDate(dateFrom)} — ${shortDate(dateTo)}`}>
                                      <small>{metric.key === "cost" ? "Ср. CPM / CPC" : metric.key === "ctr" || metric.key === "drr" ? "За период" : "Итого"}</small>
                                      <b>{formatMetric(periodCell, metric.key, campaign.paymentType)}</b>
                                    </em>
                                  </div>
                                </td>
                                {dates.map((date) => {
                                  const cell = campaign.dates[date] ?? zeroCell;
                                  const value = metricNumber(cell, metric.key, campaign.paymentType);
                                  return <td key={date} className={metric.key === "drr" && value > 15 ? "bad-value" : ""}>{formatMetric(cell, metric.key, campaign.paymentType)}</td>;
                                })}
                              </tr>,
                            ));
                          }
                          return rows;
                        })),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "notes" && (
          <section className="notes-layout">
            <div className="notes-intro">
              <div>
                <h2>Рабочие заметки по товарам</h2>
                <p>Одна ячейка — один вывод по артикулу за выбранный день. Товары загружаются из Seller API, записи хранятся в общей базе. Статус рекламы — по статистике Ozon за выбранный период.</p>
              </div>
              <div className="notes-filter" role="group" aria-label="Фильтр товаров">
                <button className={noteFilter === "all" ? "active" : ""} onClick={() => setNoteFilter("all")}>Все · {catalogProducts.length}</button>
                <button className={noteFilter === "advertised" ? "active" : ""} onClick={() => setNoteFilter("advertised")}>В рекламе · {advertisedProductSkus.size}</button>
                <button className={noteFilter === "not-advertised" ? "active" : ""} onClick={() => setNoteFilter("not-advertised")}>Не в рекламе · {catalogProducts.length - advertisedProductSkus.size}</button>
              </div>
            </div>
            {catalogError && <div className="inline-notice"><span>i</span><p><strong>Заметки не загружены.</strong> {catalogError}</p></div>}
            <div className="notes-card">
              <div className="table-scroll">
                <table className="notes-table">
                  <thead><tr><th className="sticky-col">Артикул / товар</th>{dates.map((date) => <th key={date}>{shortDate(date)}</th>)}</tr></thead>
                  <tbody>
                    {!catalogLoading && !filteredCatalogProducts.length && <tr><td colSpan={dates.length + 1}>Товары не найдены. Проверьте подключение Seller API.</td></tr>}
                    {catalogLoading && <tr><td colSpan={dates.length + 1}>Загружаем артикулы из кабинета Ozon…</td></tr>}
                    {filteredCatalogProducts.map((product) => (
                      <tr key={product.sku}>
                        <td className="sticky-col">
                          <div className="note-product"><strong>{product.offerId}</strong><span>{product.name}</span><em className={advertisedProductSkus.has(product.sku) ? "advertised" : ""}>{advertisedProductSkus.has(product.sku) ? "В рекламе" : "Не в рекламе"}</em></div>
                        </td>
                        {dates.map((date) => {
                          const key = product.sku + ":" + date;
                          return <td className="note-cell" key={date}>
                            <textarea aria-label={"Заметка " + product.offerId + " за " + date} value={noteValues[key] ?? ""} onChange={(event) => setNoteValues((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void saveNote(product.sku, date)} placeholder="Добавить" />
                            {savingNote === key && <span className="note-saving">сохраняю</span>}
                          </td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "queries" && (
          <MediaQueries
            dateFrom={dateFrom}
            dateTo={dateTo}
            reloadToken={queryReloadToken}
            onPeriodChange={(nextFrom, nextTo) => saveSharedPeriod({ dateFrom: nextFrom, dateTo: nextTo, preset: "custom" })}
          />
        )}

        {tab === "settings" && (
          <section className="settings-layout">
            <div className="connection-card primary-connection">
              <div className="connection-head"><span className="api-icon">P</span><div><p>Обязательное подключение</p><h2>Ozon Performance API</h2></div><StatusBadge live={mode === "live"} /></div>
              <p className="connection-description">Загружает рекламные кампании и дневные отчёты: показы, клики, расход, прямые и модельные продажи.</p>
              <div className="secret-fields">
                <SecretField label="Client ID" name="OZON_PERFORMANCE_CLIENT_ID" />
                <SecretField label="Client Secret" name="OZON_PERFORMANCE_CLIENT_SECRET" />
              </div>
              <div className="connection-actions"><button className="primary-button" onClick={() => void refreshData({ force: true })} disabled={syncing}>↻ Проверить подключение</button><span>Ключи задаются как защищённые секреты сайта</span></div>
            </div>
            <div className="connection-card">
              <div className="connection-head"><span className="api-icon seller">S</span><div><p>Для артикулов и заметок</p><h2>Ozon Seller API</h2></div><StatusBadge live={catalogProducts.length > 0} optional /></div>
              <p className="connection-description">Загружает реальные товары из кабинета и сопоставляет SKU с вашим offer_id для рабочих заметок.</p>
              <div className="secret-fields">
                <SecretField label="Seller Client ID" name="OZON_SELLER_CLIENT_ID" />
                <SecretField label="API Key" name="OZON_SELLER_API_KEY" />
              </div>
            </div>
            <aside className="setup-guide">
              <p className="eyebrow">Как подключить</p>
              <h2>Два коротких шага</h2>
              <ol>
                <li><span>1</span><div><strong>Создайте Performance-ключ</strong><p>Ozon Seller → Продвижение → Настройки → Обмен данными → Performance API.</p></div></li>
                <li><span>2</span><div><strong>Добавьте два значения в секреты сайта</strong><p>Client ID и Client Secret. Не вставляйте их в публичный код или таблицу.</p></div></li>
              </ol>
              <div className="security-note"><span>◆</span><p><strong>Безопасно по умолчанию</strong> Браузер видит только готовые цифры. Ключи остаются на сервере.</p></div>
            </aside>
            <div className="data-map">
              <h2>Карта данных</h2>
              <div><span className="map-status ready">✓</span><p><strong>Кампании и дневная статистика</strong><small>Performance API · готово</small></p></div>
              <div><span className="map-status ready">✓</span><p><strong>CTR, CPC, CPM и ДРР</strong><small>Рассчитываются на сайте · готово</small></p></div>
              <div><span className="map-status pending">~</span><p><strong>Артикул продавца offer_id</strong><small>Seller API · после подключения</small></p></div>
              <div><span className="map-status ready">✓</span><p><strong>Запросы медийных РК</strong><small>Отчёт «Показы и клики» XLSX · готово</small></p></div>
            </div>
          </section>
        )}
      </section>
    </section>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" className={"kpi " + tone} onClick={onClick} aria-label={label + ": показать детализацию"}>
      <div><span>{label}</span><strong>{value}</strong></div>
      <em>состав ›</em>
      <span className="sparkline"><i /><i /><i /><i /><i /></span>
    </button>
  );
}

const kpiTitles: Record<KpiKey, { title: string; note: string; value: string }> = {
  expense: { title: "Кто расходует бюджет", note: "Кампании отсортированы по расходу — самые затратные сверху.", value: "Расход" },
  sales: { title: "Что продалось с рекламой", note: "Итого в рублях: продажи во время РК + продажи после РК (post-view).", value: "Продажи" },
  orders: { title: "Какие товары проданы", note: "Итого в штуках: продажи во время РК + продажи после РК (post-view).", value: "Штук" },
  drr: { title: "Кто сильнее всего разгоняет ДРР", note: "Сначала кампании без продаж, затем — с самым высоким ДРР.", value: "ДРР" },
  ctr: { title: "CTR по кампаниям", note: "Кампании отсортированы по кликабельности объявлений.", value: "CTR" },
};

function KpiDrilldown({ metric, rows, onClose }: { metric: KpiKey; rows: KpiBreakdownRow[]; onClose: () => void }) {
  const meta = kpiTitles[metric];

  function primaryValue(row: KpiBreakdownRow) {
    if (metric === "expense") return money(row.cell.expense);
    if (metric === "sales") return money(row.sales);
    if (metric === "orders") return Math.round(row.orders).toLocaleString("ru-RU") + " шт.";
    if (metric === "drr") return row.drr == null ? "нет продаж" : row.drr.toFixed(1).replace(".", ",") + "%";
    return row.ctr.toFixed(2).replace(".", ",") + "%";
  }

  function contextValue(row: KpiBreakdownRow) {
    if (metric === "expense") return "Продажи " + money(row.sales) + " · " + (row.drr == null ? "без продаж" : "ДРР " + row.drr.toFixed(1).replace(".", ",") + "%");
    if (metric === "sales") return "Во время " + money(row.cell.directSales) + " · после " + money(row.cell.modelSales) + " · " + Math.round(row.orders).toLocaleString("ru-RU") + " шт.";
    if (metric === "orders") return "Во время " + Math.round(row.cell.directOrders).toLocaleString("ru-RU") + " · после " + Math.round(row.cell.modelOrders).toLocaleString("ru-RU") + " · продажи " + money(row.sales);
    if (metric === "drr") return "Расход " + money(row.cell.expense) + " · продажи " + money(row.sales);
    return row.cell.views.toLocaleString("ru-RU") + " показов · " + row.cell.clicks.toLocaleString("ru-RU") + " кликов";
  }

  return (
    <div className="drilldown-backdrop" role="button" tabIndex={0} aria-label="Закрыть детализацию" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape" || (event.key === "Enter" && event.target === event.currentTarget)) onClose(); }}>
      <section className="drilldown-dialog" role="dialog" aria-modal="true" aria-labelledby="drilldown-title">
        <div className="drilldown-head">
          <div><p className="eyebrow">Детализация показателя</p><h2 id="drilldown-title">{meta.title}</h2><span>{meta.note}</span></div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="drilldown-scroll">
          <table className="drilldown-table">
            <thead><tr><th>Артикул</th><th>Рекламная кампания</th><th>{meta.value}</th><th>Контекст</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={4}>За выбранный период данных для детализации нет.</td></tr>}
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td><span className="rank">{index + 1}</span><strong>{row.article}</strong></td>
                  <td><strong>{row.campaign}</strong><span>{row.paymentType}</span></td>
                  <td className={metric === "drr" && (row.drr == null || row.drr > 15) ? "hot-metric" : ""}><strong>{primaryValue(row)}</strong></td>
                  <td>{contextValue(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TaskEditor({
  article,
  task,
  solution,
  activityDate,
  editing,
  saving,
  onTaskChange,
  onSolutionChange,
  onActivityDateChange,
  onDelete,
  onClose,
  onSubmit,
}: {
  article: Article;
  task: string;
  solution: string;
  activityDate: string;
  editing: boolean;
  saving: boolean;
  onTaskChange: (value: string) => void;
  onSolutionChange: (value: string) => void;
  onActivityDateChange: (value: string) => void;
  onDelete: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="drilldown-backdrop" role="button" tabIndex={0} aria-label="Закрыть редактор записи" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <form className="task-editor" onSubmit={onSubmit}>
        <div className="task-editor-head">
          <div><p className="eyebrow">Запись в журнале артикула</p><h2>{article.offerId}</h2><span>Фиксирует действие и вывод на конкретную дату. Можно добавить несколько записей за один день.</span></div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="task-editor-body">
          <label>Дата действия
            <input type="date" value={activityDate} onChange={(event) => onActivityDateChange(event.target.value)} />
          </label>
          <label>Что сделали / решили
            <textarea value={task} onChange={(event) => onTaskChange(event.target.value)} placeholder="Например: снизили ставку и исключили неэффективные товары" />
          </label>
          <label>Вывод / что проверить дальше
            <textarea value={solution} onChange={(event) => onSolutionChange(event.target.value)} placeholder="Например: завтра сравнить CTR и ДРР" />
          </label>
        </div>
        <div className="task-editor-footer">
          <span>{editing ? "Редактирование записи" : "Новая запись в журнал"}</span>
          {editing && <button type="button" className="delete-task-button" onClick={onDelete}>Удалить</button>}
          <button type="button" className="ghost-button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary-button" disabled={saving || !task.trim()}>{saving ? "Сохраняю…" : "Сохранить"}</button>
        </div>
      </form>
    </div>
  );
}

function ActivityLog({
  article,
  tasks,
  onClose,
  onAdd,
  onEdit,
  onDelete,
}: {
  article: Article;
  tasks: Task[];
  onClose: () => void;
  onAdd: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const ordered = [...tasks].sort((left, right) => right.activityDate.localeCompare(left.activityDate) || right.id - left.id);
  return (
    <div className="drilldown-backdrop" role="button" tabIndex={0} aria-label="Закрыть журнал действий" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape" || (event.key === "Enter" && event.target === event.currentTarget)) onClose(); }}>
      <section className="activity-log-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-log-title">
        <div className="activity-log-head">
          <div><p className="eyebrow">Журнал действий</p><h2 id="activity-log-title">{article.offerId}</h2><span>{ordered.length} записей по артикулу</span></div>
          <div><button className="primary-button" onClick={onAdd}>+ Запись</button><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>
        </div>
        <div className="activity-log-list">
          {!ordered.length && <p className="activity-log-empty">Записей пока нет.</p>}
          {ordered.map((task) => (
            <article className="activity-log-item" key={task.id}>
              <time>{shortDate(task.activityDate)}</time>
              <div><strong>{task.task}</strong>{task.solution && <p>{task.solution}</p>}</div>
              <span className={"activity-status " + task.status}>{task.status === "done" ? "Готово" : "В работе"}</span>
              <div className="activity-log-actions"><button onClick={() => onEdit(task)}>Изменить</button><button className="danger" onClick={() => onDelete(task)}>Удалить</button></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ live, optional = false }: { live: boolean; optional?: boolean }) {
  return <span className={"connection-status " + (live ? "connected" : "")}>{live ? "Подключено" : optional ? "Опционально" : "Не подключено"}</span>;
}

function SecretField({ label, name }: { label: string; name: string }) {
  return (
    <div className="secret-field">
      <span>{label}</span>
      <code>{name}</code>
      <b>••••••••</b>
    </div>
  );
}
