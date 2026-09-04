import { env, waitUntil } from "cloudflare:workers";
import {
  acquireOzonRefresh,
  cacheAgeMs,
  failOzonRefresh,
  parseCachedPayload,
  readOzonCache,
  saveOzonCache,
  type OzonCacheRow,
} from "../../../../../db/ozon-cache";

type SellerSecrets = {
  OZON_SELLER_CLIENT_ID?: string;
  OZON_SELLER_API_KEY?: string;
  OZON_CLIENT_ID?: string;
  OZON_API_KEY?: string;
};

type SellerProduct = {
  sku?: string | number;
  offer_id?: string;
};

type QueryItem = {
  query?: string;
  sku?: string | number;
  unique_search_users?: number;
  unique_view_users?: number;
  position?: number;
  view_conversion?: number;
};

type QueryReport = {
  mode: "seller";
  rows: Array<{
    query: string;
    sku: string;
    impressions: number | null;
    clicks: null;
    ctr: null;
    cpm: null;
    position: number | null;
    conversion: number | null;
  }>;
  products: number;
  message: string;
};

const CACHE_TTL_MS = 30 * 60 * 1000;

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Seller API: " + status;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось получить данные Seller API";
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function sellerJson(url: string, body: unknown, secrets: Required<SellerSecrets>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Client-Id": secrets.OZON_SELLER_CLIENT_ID,
      "Api-Key": secrets.OZON_SELLER_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return payload;
}

function skuFingerprint(skus: string[]) {
  let hash = 2166136261;
  for (const character of [...skus].sort().join(",")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function fetchSellerReport(
  dateFrom: string,
  dateTo: string,
  requestedSkus: string[],
  secrets: Required<SellerSecrets>,
): Promise<QueryReport> {
  const productsPayload = await sellerJson(
    "https://api-seller.ozon.ru/v3/product/list",
    { filter: { visibility: "ALL" }, last_id: "", limit: 1000 },
    secrets,
  ) as { result?: { items?: SellerProduct[] } };

  const products = productsPayload.result?.items ?? [];
  const sellerSkus = Array.from(new Set(
    products.map((item) => String(item.sku ?? "").trim()).filter(Boolean),
  ));
  const sellerSkuSet = new Set(sellerSkus);
  const matchedRequestedSkus = requestedSkus.filter((sku) => sellerSkuSet.has(sku));
  const skus = (matchedRequestedSkus.length ? matchedRequestedSkus : sellerSkus).slice(0, 1000);

  if (!skus.length) {
    return {
      mode: "seller",
      rows: [],
      products: 0,
      message: "Seller API подключён, но в кабинете не найдено товаров.",
    };
  }

  try {
    const queriesPayload = await sellerJson(
      "https://api-seller.ozon.ru/v1/analytics/product-queries/details",
      {
        date_from: dateFrom + "T00:00:00.000Z",
        date_to: dateTo + "T23:59:59.999Z",
        limit_by_sku: 15,
        page: 1,
        page_size: 100,
        skus,
        sort_by: "BY_SEARCHES",
        sort_dir: "DESCENDING",
      },
      secrets,
    ) as { queries?: QueryItem[] };

    const rows = (queriesPayload.queries ?? []).map((item) => ({
      query: item.query ?? "Без названия",
      sku: String(item.sku ?? ""),
      impressions: item.unique_search_users ?? null,
      clicks: null,
      ctr: null,
      cpm: null,
      position: item.position ?? null,
      conversion: item.view_conversion ?? null,
    }));

    return {
      mode: "seller",
      rows,
      products: products.length,
      message: rows.length ? "" : "Seller API подключён, но за выбранный период запросов нет.",
    };
  } catch (error) {
    if (/no data for the specified period/i.test(errorText(error))) {
      return {
        mode: "seller",
        rows: [],
        products: products.length,
        message: "Seller API подключён. Ozon не вернул поисковые запросы за выбранный период — для этого отчёта может требоваться Premium Analytics.",
      };
    }
    throw error;
  }
}

function cachedResponse(
  report: QueryReport,
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
  requestedSkus: string[],
  secrets: Required<SellerSecrets>,
) {
  try {
    const report = await fetchSellerReport(dateFrom, dateTo, requestedSkus, secrets);
    await saveOzonCache(cacheKey, report);
    return report;
  } catch (error) {
    await failOzonRefresh(cacheKey, errorText(error));
    throw error;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateFrom = validDate(url.searchParams.get("dateFrom"));
  const dateTo = validDate(url.searchParams.get("dateTo"));
  const requestedSkus = (url.searchParams.get("skus") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value))
    .slice(0, 1000);

  if (!dateFrom || !dateTo) return json({ error: "Укажите корректный период" }, 400);

  const runtime = env as unknown as SellerSecrets;
  const clientId = runtime.OZON_SELLER_CLIENT_ID ?? runtime.OZON_CLIENT_ID;
  const apiKey = runtime.OZON_SELLER_API_KEY ?? runtime.OZON_API_KEY;
  if (!clientId || !apiKey) {
    return json({ mode: "error", rows: [], error: "Seller API не подключён" }, 503);
  }
  const secrets = { OZON_SELLER_CLIENT_ID: clientId, OZON_SELLER_API_KEY: apiKey };
  const cacheKey = `seller-queries:${dateFrom}:${dateTo}:${skuFingerprint(requestedSkus)}`;

  let row: OzonCacheRow | null;
  try {
    row = await readOzonCache(cacheKey);
  } catch {
    try {
      return json(await fetchSellerReport(dateFrom, dateTo, requestedSkus, secrets));
    } catch (error) {
      return json({ mode: "error", rows: [], error: errorText(error) }, 502);
    }
  }

  const cached = parseCachedPayload<QueryReport>(row);
  if (cached && cacheAgeMs(row) <= CACHE_TTL_MS) return cachedResponse(cached, row);

  const acquired = await acquireOzonRefresh(cacheKey);
  if (acquired && cached) {
    waitUntil(refreshAndSave(cacheKey, dateFrom, dateTo, requestedSkus, secrets).catch(() => undefined));
    return cachedResponse(cached, row, { refreshing: true, stale: true });
  }
  if (acquired) {
    try {
      const report = await refreshAndSave(cacheKey, dateFrom, dateTo, requestedSkus, secrets);
      return cachedResponse(report, await readOzonCache(cacheKey));
    } catch (error) {
      return json({ mode: "error", rows: [], error: errorText(error) }, 502);
    }
  }
  if (cached) {
    return cachedResponse(cached, row, {
      refreshing: !row?.last_error,
      stale: true,
      message: row?.last_error
        ? "Seller API временно недоступен. Показан последний успешный снимок."
        : cached.message,
    });
  }

  return json({
    mode: "loading",
    rows: [],
    refreshing: true,
    message: "Отчёт по запросам уже формируется для другого пользователя.",
  }, 202);
}
