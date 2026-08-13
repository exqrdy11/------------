import { yandexMarketFetch } from "@/lib/yandex-market-api";

type YandexOffer = {
  offerId?: string;
  name?: string;
  category?: string;
  tags?: unknown;
  archived?: boolean;
};

type YandexMapping = {
  marketSku?: number;
  marketSkuName?: string;
  marketCategoryId?: number;
  marketCategoryName?: string;
};

type YandexOfferMapping = {
  offer?: YandexOffer;
  mapping?: YandexMapping;
  showcaseUrls?: Array<{ showcaseType?: string; showcaseUrl?: string }>;
};

type OfferMappingsResponse = {
  result?: {
    offerMappings?: YandexOfferMapping[];
    paging?: { nextPageToken?: string };
  };
};

export type YandexCatalogOffer = {
  sku: string;
  name: string;
  category: string;
  tags: string[];
  marketSku: number | null;
  storefrontUrl: string | null;
};

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * We intentionally use only catalogue metadata received from Yandex:
 * seller tags and the marketplace/seller category. Product titles are not a
 * filter, so a word that happens to occur in a name can never add a product.
 */
export function isYandexSupplementMetadata(input: Pick<YandexCatalogOffer, "category" | "tags">) {
  const metadata = normalize([input.category, ...input.tags].join(" "));
  return /(^| )бад(ы|ов|ами|ах)?($| )/u.test(metadata)
    || metadata.includes("биологически активн")
    || metadata.includes("пищев(ая|ые) добавк");
}

function toCatalogOffer(item: YandexOfferMapping): YandexCatalogOffer | null {
  const sku = item.offer?.offerId?.trim();
  if (!sku) return null;
  const tags = [...new Set(strings(item.offer?.tags).map((tag) => tag.trim()).filter(Boolean))];
  const mapping = item.mapping;
  const category = [mapping?.marketCategoryName, item.offer?.category].find((value) => value?.trim())?.trim() ?? "Категория Яндекс Маркета не указана";
  const name = item.offer?.name?.trim() || mapping?.marketSkuName?.trim() || sku;
  const storefrontUrl = item.showcaseUrls?.find((item) => item.showcaseType === "B2C")?.showcaseUrl?.trim()
    || item.showcaseUrls?.find((item) => item.showcaseUrl?.trim())?.showcaseUrl?.trim()
    || null;
  const marketSku = Number(mapping?.marketSku);
  return { sku, name, category, tags, marketSku: Number.isInteger(marketSku) && marketSku > 0 ? marketSku : null, storefrontUrl };
}

/**
 * Reads the seller's real catalogue with pagination. We don't guess the tag
 * name: Yandex returns all active offers and we select only catalogued dietary
 * supplements by their tag/category metadata.
 */
export async function loadYandexSupplementOffers(businessId: number, signal?: AbortSignal) {
  const catalog: YandexCatalogOffer[] = [];
  let pageToken = "";
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams({ limit: "100", language: "RU" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<OfferMappingsResponse>(
      `/v2/businesses/${businessId}/offer-mappings?${params}`,
      { method: "POST", body: JSON.stringify({ archived: false }) },
      signal,
    );
    const batch = (data.result?.offerMappings ?? []).map(toCatalogOffer).filter((item): item is YandexCatalogOffer => Boolean(item));
    catalog.push(...batch.filter(isYandexSupplementMetadata));
    const next = data.result?.paging?.nextPageToken ?? "";
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  return [...new Map(catalog.map((item) => [item.sku, item])).values()];
}
