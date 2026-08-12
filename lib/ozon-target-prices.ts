import { type TargetPriceCompetitor, type TargetPriceRow } from "@/db/target-prices";
import { ozonFetch, type OzonApiError } from "@/lib/ozon-api";

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
  const refreshed = rows.map<TargetPriceRow>((row) => {
    const currentPrice = row.nmId ? prices.get(row.nmId) ?? row.currentPrice : row.currentPrice;
    const competitors = row.competitors.map<TargetPriceCompetitor>((competitor) => {
      // Ozon Seller API exposes only the prices of this seller. Keep a price
      // entered by the owner, but never present it as an automatic market quote.
      const price = competitor.price && competitor.price > 0 ? competitor.price : null;
      return {
        ...competitor,
        price,
        error: price ? null : "Нет сохранённой цены. Ozon Seller не выдаёт цены чужих карточек.",
      };
    });
    return {
      ...row,
      currentPrice,
      priceBeforeSpp: currentPrice,
      sppPercent: null,
      competitors,
      updatedAt: currentPrice !== null ? refreshedAt : row.updatedAt,
      refreshedAt,
      refreshError: warnings[0] ?? null,
      reason: currentPrice === null ? "Ozon не вернул цену этой карточки. Проверьте, что товар активен и доступен в кабинете." : "Своя цена обновлена из Ozon Seller. Цены конкурентов указываются вручную и участвуют в таргете.",
    };
  });
  return { rows: refreshed, updatedAt: refreshedAt, warnings: [...new Set(warnings)] };
}
