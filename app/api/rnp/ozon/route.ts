import { env, waitUntil } from "cloudflare:workers";
import {
  acquireOzonRefresh,
  cacheAgeMs,
  failOzonRefresh,
  parseCachedPayload,
  readOzonCache,
  saveOzonCache,
  type OzonCacheRow,
} from "../../../../db/ozon-cache";

type RuntimeSecrets = {
  OZON_PERFORMANCE_CLIENT_ID?: string;
  OZON_PERFORMANCE_CLIENT_SECRET?: string;
};

type OzonCampaign = {
  id?: string | number;
  campaignId?: string | number;
  title?: string;
  name?: string;
  paymentType?: string;
  PaymentType?: string;
  advObjectType?: string;
  state?: string;
};

type OzonStatRow = {
  id?: string | number;
  title?: string;
  sku?: string | number;
  campaignId?: string | number;
  campaign_id?: string | number;
  date?: string;
  views?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  expense?: string | number;
  moneySpent?: string | number;
  spent?: string | number;
  orders?: string | number;
  directOrders?: string | number;
  ordersCount?: string | number;
  modelOrders?: string | number;
  model_orders?: string | number;
  postViewOrders?: string | number;
  post_view_orders?: string | number;
  sales?: string | number;
  directSales?: string | number;
  ordersMoney?: string | number;
  revenue?: string | number;
  modelSales?: string | number;
  model_sales?: string | number;
  modelRevenue?: string | number;
  postViewSales?: string | number;
  postViewOrdersSum?: string | number;
};

type DailyCell = {
  views: number;
  clicks: number;
  expense: number;
  directOrders: number;
  modelOrders: number;
  directSales: number;
  modelSales: number;
};

type GroupedCampaigns = Map<string, Record<string, DailyCell>>;

type ReportPayload = {
  mode: "live";
  articles: unknown[];
  lastSync: string;
  message: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function campaignList(payload: unknown): OzonCampaign[] {
  if (Array.isArray(payload)) return payload as OzonCampaign[];
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  const list = source.list ?? source.items ?? source.campaigns;
  if (Array.isArray(list)) return list as OzonCampaign[];
  if (list && typeof list === "object") {
    const nested = list as Record<string, unknown>;
    if (Array.isArray(nested.list)) return nested.list as OzonCampaign[];
    return [list as OzonCampaign];
  }
  return [];
}

function statRows(payload: unknown): OzonStatRow[] {
  if (Array.isArray(payload)) return payload as OzonStatRow[];
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  const rows = source.rows ?? source.list ?? source.items ?? source.result;
  if (Array.isArray(rows)) return rows as OzonStatRow[];
  if (rows && typeof rows === "object") {
    const nested = rows as Record<string, unknown>;
    if (Array.isArray(nested.rows)) return nested.rows as OzonStatRow[];
  }
  return [];
}

function campaignId(campaign: OzonCampaign) {
  return String(campaign.id ?? campaign.campaignId ?? "").trim();
}

function campaignTitle(campaign: OzonCampaign | undefined, fallbackId: string) {
  return campaign?.title ?? campaign?.name ?? "Рекламная кампания № " + fallbackId;
}

function campaignPaymentType(campaign: OzonCampaign | undefined): "CPM" | "CPC" {
  return (campaign?.paymentType ?? campaign?.PaymentType) === "CPM" ? "CPM" : "CPC";
}

function isMediaCampaign(campaign: OzonCampaign) {
  return ["BANNER", "VIDEO_BANNER"].includes(campaign.advObjectType ?? "");
}

function mediaArticleFromTitle(title: string) {
  const original = title.trim();
  let clean = original;
  let previous = "";

  while (clean && clean !== previous) {
    previous = clean;
    clean = clean
      .replace(/[_\s.-]+(?:CPM|CPC)$/iu, "")
      .replace(/[_\s.-]+Б\d+$/iu, "")
      .replace(/[_\s.-]+[A-Za-zА-Яа-яЁё]\d+$/u, "")
      .trim();
  }

  return clean || original || "Медийная реклама";
}

function rowCell(row: OzonStatRow): DailyCell {
  return {
    views: numberValue(firstValue(row.views, row.impressions)),
    clicks: numberValue(row.clicks),
    expense: numberValue(firstValue(row.expense, row.moneySpent, row.spent)),
    directOrders: numberValue(firstValue(row.orders, row.directOrders, row.ordersCount)),
    modelOrders: numberValue(firstValue(row.modelOrders, row.model_orders, row.postViewOrders, row.post_view_orders)),
    directSales: numberValue(firstValue(row.sales, row.directSales, row.ordersMoney, row.revenue)),
    modelSales: numberValue(firstValue(row.modelSales, row.model_sales, row.modelRevenue, row.postViewSales, row.postViewOrdersSum)),
  };
}

function addRow(
  grouped: Map<string, GroupedCampaigns>,
  groupKey: string,
  id: string,
  date: string,
  cell: DailyCell,
) {
  if (!grouped.has(groupKey)) grouped.set(groupKey, new Map());
  const campaigns = grouped.get(groupKey)!;
  if (!campaigns.has(id)) campaigns.set(id, {});
  const dates = campaigns.get(id)!;
  const current = dates[date];
  dates[date] = current
    ? {
        views: current.views + cell.views,
        clicks: current.clicks + cell.clicks,
        expense: current.expense + cell.expense,
        directOrders: current.directOrders + cell.directOrders,
        modelOrders: current.modelOrders + cell.modelOrders,
        directSales: current.directSales + cell.directSales,
        modelSales: current.modelSales + cell.modelSales,
      }
    : cell;
}

async function ozonJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error("Ozon API: " + response.status + " " + text.slice(0, 180));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Ozon вернул отчёт в неожиданном формате");
  }
}

async function statisticsRows(
  endpoint: "product" | "daily",
  ids: string[],
  dateFrom: string,
  dateTo: string,
  token: string,
) {
  const rows: OzonStatRow[] = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const params = new URLSearchParams({ dateFrom, dateTo });
    batch.forEach((id) => params.append("campaignIds", id));
    const path = endpoint === "product"
      ? "/api/client/statistics/campaign/product/json?"
      : "/api/client/statistics/daily/json?";
    const payload = await ozonJson(
      "https://api-performance.ozon.ru" + path + params.toString(),
      token,
    );
    rows.push(...statRows(payload));
  }
  return rows;
}

async function fetchLiveReport(
  dateFrom: string,
  dateTo: string,
  secrets: Required<RuntimeSecrets>,
): Promise<ReportPayload> {
    const tokenResponse = await fetch("https://api-performance.ozon.ru/api/client/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: secrets.OZON_PERFORMANCE_CLIENT_ID,
        client_secret: secrets.OZON_PERFORMANCE_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(tokenPayload.error || "Ozon отклонил Client ID или Client Secret");
    }

    const campaignsPayload = await ozonJson(
      "https://api-performance.ozon.ru/api/client/campaign?page=1&pageSize=100",
      tokenPayload.access_token,
    );
    const campaigns = campaignList(campaignsPayload);
    const campaignMap = new Map<string, OzonCampaign>();
    campaigns.forEach((campaign) => {
      const id = campaignId(campaign);
      if (id) campaignMap.set(id, campaign);
    });

    if (!campaignMap.size) {
      return {
        mode: "live",
        articles: [],
        lastSync: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
        message: "Подключение работает, но рекламных кампаний в кабинете не найдено.",
      };
    }

    const productIds = campaigns.filter((campaign) => !isMediaCampaign(campaign)).map(campaignId).filter(Boolean);
    const mediaIds = campaigns.filter(isMediaCampaign).map(campaignId).filter(Boolean);
    const [productRows, mediaRows] = await Promise.all([
      statisticsRows("product", productIds, dateFrom, dateTo, tokenPayload.access_token),
      statisticsRows("daily", mediaIds, dateFrom, dateTo, tokenPayload.access_token),
    ]);

    const productGrouped = new Map<string, GroupedCampaigns>();
    productRows.forEach((row) => {
      const sku = String(row.sku ?? "").trim();
      const id = String(row.campaignId ?? row.campaign_id ?? row.id ?? "").trim();
      const date = String(row.date ?? "").slice(0, 10);
      if (sku && id && date) addRow(productGrouped, sku, id, date, rowCell(row));
    });

    const mediaGrouped = new Map<string, GroupedCampaigns>();
    const mediaTitles = new Map<string, string>();
    mediaRows.forEach((row) => {
      const id = String(row.campaignId ?? row.campaign_id ?? row.id ?? "").trim();
      const date = String(row.date ?? "").slice(0, 10);
      const title = row.title?.trim() || campaignTitle(campaignMap.get(id), id);
      const article = mediaArticleFromTitle(title);
      if (!id || !date) return;
      mediaTitles.set(id, title);
      addRow(mediaGrouped, article, id, date, rowCell(row));
    });

    const productArticles = Array.from(productGrouped.entries()).map(([sku, campaignsBySku]) => ({
      sku,
      offerId: sku,
      name: "Товар Ozon · SKU " + sku,
      source: "product",
      campaigns: Array.from(campaignsBySku.entries()).map(([id, dates]) => {
        const source = campaignMap.get(id);
        return {
          id,
          name: campaignTitle(source, id),
          type: source?.advObjectType ?? "Продвижение товара",
          paymentType: campaignPaymentType(source),
          status: source?.state === "CAMPAIGN_STATE_RUNNING" ? "running" : "paused",
          dates,
        };
      }),
    }));

    const mediaArticles = Array.from(mediaGrouped.entries()).map(([article, campaignsByArticle]) => ({
      sku: "media:" + article,
      offerId: article,
      name: "Медийная реклама · артикул определён из названия кампании",
      source: "media",
      campaigns: Array.from(campaignsByArticle.entries()).map(([id, dates]) => {
        const source = campaignMap.get(id);
        return {
          id,
          name: mediaTitles.get(id) ?? campaignTitle(source, id),
          type: "Баннерная реклама",
          paymentType: campaignPaymentType(source),
          status: source?.state === "CAMPAIGN_STATE_RUNNING" ? "running" : "paused",
          dates,
        };
      }),
    }));

    const articles = [...mediaArticles, ...productArticles];
    return {
      mode: "live",
      articles,
      lastSync: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      message: articles.length
        ? ""
        : "Подключение работает, но за выбранный период статистики не найдено.",
    };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось получить данные Ozon";
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function cachedResponse(
  report: ReportPayload,
  row: OzonCacheRow | null,
  options: { refreshing?: boolean; stale?: boolean; message?: string } = {},
) {
  return json({
    ...report,
    refreshedAt: row?.refreshed_at ?? null,
    refreshing: options.refreshing ?? false,
    stale: options.stale ?? false,
    message: options.message ?? report.message,
  });
}

async function refreshAndSave(
  cacheKey: string,
  dateFrom: string,
  dateTo: string,
  secrets: Required<RuntimeSecrets>,
) {
  try {
    const report = await fetchLiveReport(dateFrom, dateTo, secrets);
    await saveOzonCache(cacheKey, report);
    return report;
  } catch (error) {
    await failOzonRefresh(cacheKey, errorText(error));
    throw error;
  }
}

async function waitForFirstSnapshot(cacheKey: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const row = await readOzonCache(cacheKey);
    const report = parseCachedPayload<ReportPayload>(row);
    if (report) return { row, report };
  }
  return null;
}

function periodFromRequest(request: Request) {
  const url = new URL(request.url);
  const dateFrom = validDate(url.searchParams.get("dateFrom"));
  const dateTo = validDate(url.searchParams.get("dateTo"));
  if (!dateFrom || !dateTo) return null;
  const from = Date.parse(dateFrom + "T00:00:00Z");
  const to = Date.parse(dateTo + "T00:00:00Z");
  if (to < from || to - from > 31 * 24 * 60 * 60 * 1000) return null;
  return { dateFrom, dateTo };
}

async function handleReport(request: Request, force: boolean) {
  const period = periodFromRequest(request);
  if (!period) return json({ error: "Укажите корректный период до 31 дня" }, 400);

  const runtime = env as unknown as RuntimeSecrets;
  if (!runtime.OZON_PERFORMANCE_CLIENT_ID || !runtime.OZON_PERFORMANCE_CLIENT_SECRET) {
    return json({
      mode: "error",
      articles: [],
      error: "Performance API не подключён: серверные ключи отсутствуют.",
    }, 503);
  }
  const secrets = runtime as Required<RuntimeSecrets>;
  const cacheKey = `performance:v2:${period.dateFrom}:${period.dateTo}`;

  let row: OzonCacheRow | null;
  try {
    row = await readOzonCache(cacheKey);
  } catch {
    try {
      const report = await fetchLiveReport(period.dateFrom, period.dateTo, secrets);
      return json({ ...report, refreshedAt: new Date().toISOString() });
    } catch (error) {
      return json({ mode: "error", articles: [], error: errorText(error) }, 502);
    }
  }

  const cached = parseCachedPayload<ReportPayload>(row);
  if (force && cached && cacheAgeMs(row) <= MANUAL_REFRESH_COOLDOWN_MS) {
    return cachedResponse(cached, row, {
      message: cached.message || "Общий снимок уже обновлён меньше минуты назад.",
    });
  }
  if (!force && cached && cacheAgeMs(row) <= CACHE_TTL_MS) {
    return cachedResponse(cached, row);
  }

  const acquired = await acquireOzonRefresh(cacheKey);
  if (acquired) {
    if (cached && !force) {
      waitUntil(refreshAndSave(cacheKey, period.dateFrom, period.dateTo, secrets).catch(() => undefined));
      return cachedResponse(cached, row, {
        refreshing: true,
        stale: true,
        message: cached.message || "Данные обновляются в фоне.",
      });
    }
    try {
      const report = await refreshAndSave(cacheKey, period.dateFrom, period.dateTo, secrets);
      const freshRow = await readOzonCache(cacheKey);
      return cachedResponse(report, freshRow);
    } catch (error) {
      if (cached) {
        return cachedResponse(cached, row, {
          stale: true,
          message: "Ozon временно недоступен. Показан последний успешный снимок: " + errorText(error),
        });
      }
      return json({ mode: "error", articles: [], error: errorText(error) }, 502);
    }
  }

  if (cached) {
    return cachedResponse(cached, row, {
      refreshing: !row?.last_error,
      stale: true,
      message: row?.last_error
        ? "Ozon временно недоступен. Показан последний успешный снимок."
        : "Другой пользователь уже запустил обновление. Показан общий снимок.",
    });
  }

  const completed = await waitForFirstSnapshot(cacheKey);
  if (completed) return cachedResponse(completed.report, completed.row);
  return json({
    mode: "loading",
    articles: [],
    refreshing: true,
    message: "Первый общий снимок формируется. Страница обновится автоматически.",
  }, 202);
}

export async function GET(request: Request) {
  return handleReport(request, false);
}

export async function POST(request: Request) {
  return handleReport(request, true);
}

