import { type TargetPriceCompetitor, type TargetPriceRow } from "@/db/target-prices";
import { ozonFetch, type OzonApiError } from "@/lib/ozon-api";

type OzonPriceItem = {
  product_id?: number;
  marketing_price?: string | number;
  price?: { marketing_price?: string | number; price?: string | number; old_price?: string | number };
  price_indexes?: { ozon_index_data?: { minimal_price?: string | number } };
};

function numberPrice(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

export async function refreshOzonTargetPrices(rows: TargetPriceRow[]) {
  const ids = [...new Set(rows.map((row) => row.nmId).filter((id): id is number => Number.isInteger(id) && id > 0))];
  const ownPrices = new Map<number, number>();
  const marketPrices = new Map<number, number>();
  const warnings: string[] = [];

  for (const group of chunks(ids, 1000)) {
    try {
      const data = await ozonFetch<{ items?: OzonPriceItem[]; result?: { items?: OzonPriceItem[] } }>("/v5/product/info/prices", {
        method: "POST",
        body: JSON.stringify({ filter: { product_id: group, offer_id: [], visibility: "ALL" }, limit: 1000, cursor: "" }),
      });
      for (const item of data.items ?? data.result?.items ?? []) {
        const productId = Number(item.product_id);
        if (!Number.isInteger(productId) || productId <= 0) continue;
        const ownPrice = numberPrice(item.marketing_price) ?? numberPrice(item.price?.marketing_price) ?? numberPrice(item.price?.price);
        const marketPrice = numberPrice(item.price_indexes?.ozon_index_data?.minimal_price);
        if (ownPrice !== null) ownPrices.set(productId, ownPrice);
        // Ozon calculates this price itself: it is the lowest price of similar
        // products on Ozon and needs no seller-configured pricing strategy.
        if (marketPrice !== null) marketPrices.set(productId, marketPrice);
      }
    } catch (error) {
      const status = (error as OzonApiError).status;
      warnings.push(status === 429 ? "Ozon временно ограничил обновление цен — оставили предыдущий снимок." : "Ozon не отдал часть цен продавца — оставили предыдущий снимок.");
    }
  }

  const refreshedAt = new Date().toISOString();
  const refreshed = rows.map<TargetPriceRow>((row) => {
    const currentPrice = row.nmId ? ownPrices.get(row.nmId) ?? row.currentPrice : row.currentPrice;
    const marketPrice = row.nmId ? marketPrices.get(row.nmId) : undefined;
    const manualCompetitors = row.competitors
      // The price index is a snapshot, not a user-selected product. Do not
      // retain its old value when Ozon no longer gives an index for the SKU.
      .filter((competitor) => competitor.source !== "Ozon · ценовой индекс" && competitor.source !== "Ozon · стратегия цен")
      .map<TargetPriceCompetitor>((competitor) => {
        const price = competitor.price && competitor.price > 0 ? competitor.price : null;
        return {
          ...competitor,
          price,
          error: price ? null : "Нет сохранённой цены этой карточки. Ориентир рынка Ozon появится после обновления, либо укажите цену вручную.",
        };
      });
    const marketBenchmark: TargetPriceCompetitor | null = marketPrice !== undefined && row.nmId
      ? {
        // Negative id is only a local marker for Ozon's anonymous benchmark;
        // it deliberately cannot be opened or edited as a product card.
        nmId: -row.nmId,
        name: "Минимальная цена аналогов на Ozon",
        price: marketPrice,
        source: "Ozon · ценовой индекс",
        updatedAt: refreshedAt,
        error: null,
      }
      : null;
    return {
      ...row,
      currentPrice,
      priceBeforeSpp: currentPrice,
      sppPercent: null,
      competitors: marketBenchmark ? [marketBenchmark, ...manualCompetitors] : manualCompetitors,
      updatedAt: currentPrice !== null ? refreshedAt : row.updatedAt,
      refreshedAt,
      refreshError: warnings[0] ?? null,
      reason: currentPrice === null
        ? "Ozon не вернул цену этой карточки. Проверьте, что товар активен и доступен в кабинете."
        : marketBenchmark
          ? "Своя цена и минимальная цена аналогов на Ozon обновлены автоматически."
          : "Своя цена обновлена из Ozon Seller. Ozon не вернул ценовой индекс для этого товара; добавленные вручную карточки можно использовать отдельно.",
    };
  });
  return { rows: refreshed, updatedAt: refreshedAt, warnings: [...new Set(warnings)] };
}
