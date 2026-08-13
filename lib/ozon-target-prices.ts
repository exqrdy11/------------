import { type TargetPriceCompetitor, type TargetPriceRow } from "@/db/target-prices";
import { ozonFetch, type OzonApiError } from "@/lib/ozon-api";

const OZON_PUBLIC_CARD_API = "https://www.ozon.ru/api/composer-api.bx/page/json/v2";
const PUBLIC_CARD_TIMEOUT_MS = 12_000;
const PUBLIC_CARD_REQUEST_PAUSE_MS = 700;
const MAX_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH = 12;

type OzonPriceItem = {
  product_id?: number;
  marketing_price?: string | number;
  price?: { marketing_price?: string | number; price?: string | number; old_price?: string | number };
};

function numberPrice(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function normalizeOzonProductUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!/(^|\.)ozon\.ru$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/product\/(?:[^/]*-)?(\d+)(?:\/|$)/i);
    if (!match) return null;
    return {
      id: Number(match[1]),
      url: `https://www.ozon.ru${parsed.pathname.replace(/\/+$/, "/")}`,
      path: `${parsed.pathname.replace(/\/+$/, "/")}${parsed.search}`,
    };
  } catch {
    return null;
  }
}

type PublicCardQuote = { price: number | null; name: string | null; error: string | null };

function parsePublicPrice(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePublicCardQuote(payload: unknown): PublicCardQuote {
  if (!payload || typeof payload !== "object") return { price: null, name: null, error: "Ozon не вернул данные карточки." };
  const data = payload as { seo?: { title?: unknown; script?: Array<{ innerHTML?: unknown }> }; widgetStates?: Record<string, unknown> };
  const seoScript = data.seo?.script?.find((item) => typeof item?.innerHTML === "string")?.innerHTML;
  if (typeof seoScript === "string") {
    try {
      const parsed = JSON.parse(seoScript) as { name?: unknown; offers?: { price?: unknown } };
      const price = parsePublicPrice(parsed.offers?.price);
      if (price !== null) return { price, name: typeof parsed.name === "string" ? parsed.name : typeof data.seo?.title === "string" ? data.seo.title : null, error: null };
    } catch {
      // Different card layouts keep the price in widgetStates below.
    }
  }
  for (const [key, raw] of Object.entries(data.widgetStates ?? {})) {
    if (!/webSale|webPrice|price/i.test(key) || typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw) as { cellTrackingInfo?: { product?: { title?: unknown; price?: unknown; finalPrice?: unknown } } };
      const product = parsed.cellTrackingInfo?.product;
      const price = parsePublicPrice(product?.finalPrice) ?? parsePublicPrice(product?.price);
      if (price !== null) return { price, name: typeof product?.title === "string" ? product.title : typeof data.seo?.title === "string" ? data.seo.title : null, error: null };
    } catch {
      // Skip a widget that has changed its JSON shape.
    }
  }
  return { price: null, name: typeof data.seo?.title === "string" ? data.seo.title : null, error: "Ozon не отдал цену этой карточки." };
}

export async function fetchPublicOzonCard(url: string): Promise<PublicCardQuote> {
  const normalized = normalizeOzonProductUrl(url);
  if (!normalized) return { price: null, name: null, error: "Ссылка конкурента Ozon некорректна." };
  try {
    const response = await fetch(`${OZON_PUBLIC_CARD_API}?${new URLSearchParams({ url: normalized.path })}`, {
      headers: { Accept: "application/json", "Accept-Language": "ru-RU,ru;q=0.9", "User-Agent": "SkladnoPriceMonitor/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLIC_CARD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        price: null,
        name: null,
        error: response.status === 403 ? "Ozon временно запросил проверку карточки. Сохранили последнюю цену." : response.status === 429 ? "Ozon временно ограничил запросы. Сохранили последнюю цену." : "Ozon временно не отдал цену. Сохранили последнюю цену.",
      };
    }
    return parsePublicCardQuote(await response.json());
  } catch {
    return { price: null, name: null, error: "Не удалось связаться с публичной витриной Ozon. Сохранили последнюю цену." };
  }
}

export async function refreshOzonCompetitorQuote(competitor: TargetPriceCompetitor, refreshedAt: string): Promise<TargetPriceCompetitor> {
  if (!competitor.url) return { ...competitor, error: competitor.price ? competitor.error : "Добавьте ссылку карточки Ozon для автоматического обновления." };
  const quote = await fetchPublicOzonCard(competitor.url);
  return {
    ...competitor,
    price: quote.price ?? competitor.price,
    name: quote.name ?? competitor.name,
    source: quote.price !== null ? "публичная витрина Ozon" : competitor.source,
    updatedAt: quote.price !== null ? refreshedAt : competitor.updatedAt,
    error: quote.error,
  };
}

type PublicRefreshQuota = { remaining: number; skipped: number };

async function refreshOzonCompetitorQuotes(competitors: TargetPriceCompetitor[], refreshedAt: string, quota: PublicRefreshQuota) {
  const refreshed: TargetPriceCompetitor[] = [];
  for (const [index, competitor] of competitors.entries()) {
    if (!competitor.url) {
      refreshed.push({ ...competitor, error: competitor.price ? competitor.error : "Добавьте ссылку карточки Ozon для автоматического обновления." });
      continue;
    }
    if (quota.remaining <= 0) {
      quota.skipped += 1;
      refreshed.push(competitor);
      continue;
    }
    quota.remaining -= 1;
    refreshed.push(await refreshOzonCompetitorQuote(competitor, refreshedAt));
    if (index < competitors.length - 1) await pause(PUBLIC_CARD_REQUEST_PAUSE_MS);
  }
  return refreshed;
}

export async function refreshOzonTargetPrices(rows: TargetPriceRow[]) {
  const ids = [...new Set(rows.map((row) => row.nmId).filter((id): id is number => Number.isInteger(id) && id > 0))];
  const prices = new Map<number, number>();
  const warnings: string[] = [];
  for (const group of chunks(ids, 1000)) {
    try {
      const data = await ozonFetch<{ items?: OzonPriceItem[]; result?: { items?: OzonPriceItem[] } }>("/v5/product/info/prices", {
        method: "POST",
        body: JSON.stringify({ filter: { product_id: group, offer_id: [], visibility: "ALL" }, limit: 1000, cursor: "" }),
      });
      for (const item of data.items ?? data.result?.items ?? []) {
        const productId = Number(item.product_id);
        const price = numberPrice(item.marketing_price) ?? numberPrice(item.price?.marketing_price) ?? numberPrice(item.price?.price);
        if (Number.isInteger(productId) && productId > 0 && price !== null) prices.set(productId, price);
      }
    } catch (error) {
      const status = (error as OzonApiError).status;
      warnings.push(status === 429 ? "Ozon временно ограничил обновление цен — оставили предыдущий снимок." : "Ozon не отдал часть цен продавца — оставили предыдущий снимок.");
    }
  }
  const refreshedAt = new Date().toISOString();
  const quota: PublicRefreshQuota = { remaining: MAX_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH, skipped: 0 };
  const refreshed: TargetPriceRow[] = [];
  for (const row of rows) {
    const currentPrice = row.nmId ? prices.get(row.nmId) ?? row.currentPrice : row.currentPrice;
    const competitors = await refreshOzonCompetitorQuotes(row.competitors, refreshedAt, quota);
    refreshed.push({
      ...row,
      currentPrice,
      priceBeforeSpp: currentPrice,
      sppPercent: null,
      competitors,
      updatedAt: currentPrice !== null ? refreshedAt : row.updatedAt,
      refreshedAt,
      refreshError: warnings[0] ?? null,
      reason: currentPrice === null ? "Ozon не вернул цену этой карточки. Проверьте, что товар активен и доступен в кабинете." : "Своя цена обновлена из Ozon Seller. Цены конкурентов обновляются по сохранённым ссылкам публичной витрины Ozon.",
    });
  }
  if (quota.skipped) warnings.push(`За одно обновление проверяем до ${MAX_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH} карточек Ozon. Остальные ссылки можно обновить точечно в карточке товара.`);
  return { rows: refreshed, updatedAt: refreshedAt, warnings: [...new Set(warnings)] };
}
