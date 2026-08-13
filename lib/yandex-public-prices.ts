import type { TargetPriceCompetitor } from "@/db/target-prices";

const YANDEX_MARKET_PUBLIC_CARD_TIMEOUT_MS = 12_000;
const YANDEX_MARKET_PUBLIC_CARD_REQUEST_PAUSE_MS = 700;
const MAX_YANDEX_MARKET_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH = 12;

type PublicCardQuote = { price: number | null; name: string | null; error: string | null };

type PublicRefreshQuota = { remaining: number; skipped: number };

function parsePrice(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/[^0-9,.-]/g, "")
    .replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function textFromHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function quoteFromStructuredData(value: unknown): { price: number | null; name: string | null } {
  if (Array.isArray(value)) {
    for (const item of value) {
      const quote = quoteFromStructuredData(item);
      if (quote.price !== null) return quote;
    }
    return { price: null, name: null };
  }
  if (!value || typeof value !== "object") return { price: null, name: null };
  const item = value as Record<string, unknown>;
  const offers = item.offers;
  const nestedOffer = Array.isArray(offers) ? offers[0] : offers;
  const offer = nestedOffer && typeof nestedOffer === "object" ? nestedOffer as Record<string, unknown> : null;
  const price = parsePrice(offer?.price) ?? parsePrice(offer?.lowPrice) ?? parsePrice(item.price) ?? parsePrice(item.lowPrice);
  const name = firstString(item.name, item.title, offer?.name);
  if (price !== null) return { price, name };
  for (const nested of Object.values(item)) {
    const quote = quoteFromStructuredData(nested);
    if (quote.price !== null) return { price: quote.price, name: name ?? quote.name };
  }
  return { price: null, name };
}

export function normalizeYandexMarketProductUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!/(^|\.)market\.yandex\.ru$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/(?:product--[^/]+|product)\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    const id = Number(match[1]);
    if (!Number.isInteger(id) || id <= 0) return null;
    return {
      id,
      url: `${parsed.origin}${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return null;
  }
}

export function parseYandexMarketPublicCard(html: string): PublicCardQuote {
  const title = firstString(
    html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] && textFromHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
  );
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of jsonLd) {
    try {
      const quote = quoteFromStructuredData(JSON.parse(script[1]));
      if (quote.price !== null) return { price: quote.price, name: quote.name ?? title, error: null };
    } catch {
      // Ignore a malformed JSON-LD block and check the next public hint.
    }
  }
  const metaPrice = firstString(
    html.match(/<meta[^>]+(?:property|itemprop)=["'](?:product:price:amount|price)["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|itemprop)=["'](?:product:price:amount|price)["']/i)?.[1],
  );
  const directPrice = parsePrice(metaPrice);
  if (directPrice !== null) return { price: directPrice, name: title, error: null };
  return { price: null, name: title, error: "Яндекс Маркет не отдал цену этой карточки. Сохранили последнюю цену." };
}

export async function fetchPublicYandexMarketCard(url: string): Promise<PublicCardQuote> {
  const normalized = normalizeYandexMarketProductUrl(url);
  if (!normalized) return { price: null, name: null, error: "Ссылка конкурента Яндекс Маркета некорректна." };
  try {
    const response = await fetch(normalized.url, {
      headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "ru-RU,ru;q=0.9", "User-Agent": "SkladnoPriceMonitor/1.0" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(YANDEX_MARKET_PUBLIC_CARD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        price: null,
        name: null,
        error: response.status === 403 ? "Яндекс Маркет запросил проверку карточки. Сохранили последнюю цену." : response.status === 429 ? "Яндекс Маркет временно ограничил запросы. Сохранили последнюю цену." : "Яндекс Маркет временно не отдал цену. Сохранили последнюю цену.",
      };
    }
    const html = await response.text();
    if (/smartcaptcha|showcaptcha|captcha/i.test(html)) return { price: null, name: null, error: "Яндекс Маркет запросил проверку карточки. Сохранили последнюю цену." };
    return parseYandexMarketPublicCard(html);
  } catch {
    return { price: null, name: null, error: "Не удалось связаться с публичной витриной Яндекс Маркета. Сохранили последнюю цену." };
  }
}

export async function refreshYandexMarketCompetitorQuote(competitor: TargetPriceCompetitor, refreshedAt: string): Promise<TargetPriceCompetitor> {
  if (!competitor.url) return { ...competitor, error: competitor.price ? competitor.error : "Добавьте ссылку карточки Яндекс Маркета для автоматического обновления." };
  const quote = await fetchPublicYandexMarketCard(competitor.url);
  return {
    ...competitor,
    price: quote.price ?? competitor.price,
    name: quote.name ?? competitor.name,
    source: quote.price !== null ? "публичная витрина Яндекс Маркета" : competitor.source,
    updatedAt: quote.price !== null ? refreshedAt : competitor.updatedAt,
    error: quote.error,
  };
}

export async function refreshYandexMarketCompetitorQuotes(competitors: TargetPriceCompetitor[], refreshedAt: string, quota: PublicRefreshQuota) {
  const refreshed: TargetPriceCompetitor[] = [];
  for (const [index, competitor] of competitors.entries()) {
    if (!competitor.url) {
      refreshed.push({ ...competitor, error: competitor.price ? competitor.error : "Добавьте ссылку карточки Яндекс Маркета для автоматического обновления." });
      continue;
    }
    if (quota.remaining <= 0) {
      quota.skipped += 1;
      refreshed.push(competitor);
      continue;
    }
    quota.remaining -= 1;
    refreshed.push(await refreshYandexMarketCompetitorQuote(competitor, refreshedAt));
    if (index < competitors.length - 1) await new Promise<void>((resolve) => setTimeout(resolve, YANDEX_MARKET_PUBLIC_CARD_REQUEST_PAUSE_MS));
  }
  return refreshed;
}

export function createYandexMarketPublicRefreshQuota(): PublicRefreshQuota {
  return { remaining: MAX_YANDEX_MARKET_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH, skipped: 0 };
}

export function yandexMarketPublicRefreshLimitWarning(skipped: number) {
  return skipped ? `За одно обновление проверяем до ${MAX_YANDEX_MARKET_PUBLIC_COMPETITOR_REQUESTS_PER_REFRESH} карточек Яндекс Маркета. Остальные ссылки можно обновить точечно в карточке товара.` : null;
}
