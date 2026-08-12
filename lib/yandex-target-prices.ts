import type { TargetPriceRow } from "@/db/target-prices";
import { yandexMarketFetch, type YandexMarketApiError } from "@/lib/yandex-market-api";

type YandexCampaign = {
  id?: number;
  placementType?: string;
  apiAvailability?: string;
};

type YandexOfferPrice = {
  offerId?: string;
  updatedAt?: string;
  price?: {
    value?: string | number;
    discountBase?: string | number;
  };
};

type YandexOfferPriceResponse = {
  result?: {
    offers?: YandexOfferPrice[];
    paging?: { nextPageToken?: string };
  };
};

function asPrice(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function campaigns() {
  const result: YandexCampaign[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<{ campaigns?: YandexCampaign[]; paging?: { nextPageToken?: string } }>(`/v2/campaigns?${params}`);
    result.push(...(data.campaigns ?? []));
    const next = data.paging?.nextPageToken ?? "";
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  return result.flatMap((campaign) => Number.isInteger(campaign.id) && campaign.id! > 0 ? [{ ...campaign, id: campaign.id! }] : []);
}

async function campaignPrices(campaignId: number) {
  const offers: YandexOfferPrice[] = [];
  let pageToken = "";
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await yandexMarketFetch<YandexOfferPriceResponse>(`/v2/campaigns/${campaignId}/offer-prices?${params}`, {
      method: "POST",
      body: "{}",
    });
    const batch = data.result?.offers ?? [];
    offers.push(...batch);
    const next = data.result?.paging?.nextPageToken ?? "";
    if (!batch.length || !next || next === pageToken) break;
    pageToken = next;
  }
  return offers;
}

function warningFor(error: unknown) {
  const status = (error as YandexMarketApiError).status;
  if (status === 429) return "Яндекс Маркет временно ограничил обновление цен — оставили последний снимок.";
  return "Яндекс Маркет не отдал часть цен — оставили последний снимок.";
}

/**
 * Seller API provides only the seller's offer prices. Competitor prices remain
 * explicitly manual until a legal, dedicated market-data source is connected.
 */
export async function refreshYandexTargetPrices(previousRows: TargetPriceRow[]) {
  const warnings: string[] = [];
  const prices = new Map<string, { currentPrice: number | null; priceBeforeSpp: number | null; updatedAt: string | null }>();
  let activeCampaigns: YandexCampaign[] = [];
  try {
    activeCampaigns = (await campaigns()).filter((campaign) => {
      const type = campaign.placementType?.toUpperCase();
      return (type === "FBS" || type === "FBY") && campaign.apiAvailability !== "DISABLED_BY_INACTIVITY";
    });
  } catch (error) {
    return { rows: previousRows, updatedAt: null, warnings: [warningFor(error)] };
  }

  const batches = await Promise.allSettled(activeCampaigns.map((campaign) => campaignPrices(campaign.id!)));
  for (const batch of batches) {
    if (batch.status === "rejected") {
      warnings.push(warningFor(batch.reason));
      continue;
    }
    for (const offer of batch.value) {
      const sku = offer.offerId?.trim();
      if (!sku) continue;
      const next = {
        currentPrice: asPrice(offer.price?.value),
        priceBeforeSpp: asPrice(offer.price?.discountBase) ?? asPrice(offer.price?.value),
        updatedAt: offer.updatedAt ?? null,
      };
      const current = prices.get(sku);
      if (!current || (next.updatedAt && (!current.updatedAt || next.updatedAt > current.updatedAt))) prices.set(sku, next);
    }
  }

  const refreshedAt = new Date().toISOString();
  const previousBySku = new Map(previousRows.map((row) => [row.sku, row]));
  const rows = [...prices.entries()].map<TargetPriceRow>(([sku, price]) => {
    const old = previousBySku.get(sku);
    return {
      sku,
      nmId: null,
      orders: old?.orders ?? 0,
      priceBeforeSpp: price.priceBeforeSpp ?? old?.priceBeforeSpp ?? null,
      sppPercent: null,
      currentPrice: price.currentPrice ?? old?.currentPrice ?? null,
      updatedAt: price.updatedAt ?? old?.updatedAt ?? refreshedAt,
      searchQuery: old?.searchQuery ?? sku,
      competitors: old?.competitors ?? [],
      candidateNmId: old?.candidateNmId ?? null,
      score: old?.score ?? null,
      reason: "Своя цена обновлена из Яндекс Маркета. Конкурентов можно добавить вручную; их цены не подменяются данными другого маркетплейса.",
      sourceStatus: price.currentPrice === null ? "цена не получена" : "цена Яндекс Маркета",
      refreshedAt,
      refreshError: price.currentPrice === null ? "Яндекс Маркет не отдал цену этой карточки." : null,
    };
  }).sort((left, right) => left.sku.localeCompare(right.sku, "ru"));

  // Do not delete manually curated rows when the API temporarily omits an offer.
  for (const old of previousRows) if (!prices.has(old.sku)) rows.push({ ...old, refreshedAt, refreshError: warnings[0] ?? "Карточка временно не пришла в ответе Яндекс Маркета." });
  return { rows, updatedAt: refreshedAt, warnings: [...new Set(warnings)] };
}
