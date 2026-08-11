import { NextResponse } from "next/server";
import { listTargetPrices, saveTargetPrices, type TargetPriceCompetitor, type TargetPriceRow } from "@/db/target-prices";
import { cabinetToken, getAdminCabinet, getOwnerSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const WB_CARDS_API = "https://card.wb.ru/cards/v4/detail";
const WB_SELLER_PRICES_API = "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter";
const MOSCOW_DESTINATION = "-1257786";
const CHUNK_SIZE = 50;

type WbCard = {
  id?: number;
  name?: string;
  brand?: string;
  sizes?: Array<{ price?: { product?: number } }>;
};
type WbCardsResponse = { data?: { products?: WbCard[] } };
type SellerPrice = { nmId?: number; discountedPrice?: number };
type SellerPricesResponse = { data?: { listGoods?: SellerPrice[] } };
type PricePoint = { price: number | null; name: string | null };

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function priceFromCard(card: WbCard): number | null {
  const prices = (card.sizes ?? []).map((size) => size.price?.product).filter((price): price is number => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) / 100 : null;
}

function publicRefreshError(status?: number) {
  if (status === 429) return "WB временно ограничил обновление цен — оставили последние корректные значения.";
  return "WB временно не отдал часть цен — оставили последние корректные значения.";
}

async function fetchPublicPrices(nmIds: number[]) {
  const prices = new Map<number, PricePoint>();
  const errors: string[] = [];
  const groups = chunks(nmIds, CHUNK_SIZE);
  for (const [index, group] of groups.entries()) {
    try {
      const params = new URLSearchParams({ appType: "1", curr: "rub", dest: MOSCOW_DESTINATION, spp: "30", nm: group.join(";") });
      const response = await fetch(`${WB_CARDS_API}?${params}`, {
        headers: { Accept: "application/json", "Accept-Language": "ru-RU,ru;q=0.9" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        errors.push(publicRefreshError(response.status));
        continue;
      }
      const data = await response.json() as WbCardsResponse;
      for (const card of data.data?.products ?? []) {
        if (!card.id) continue;
        prices.set(card.id, {
          price: priceFromCard(card),
          name: [card.brand, card.name].filter(Boolean).join(" · ") || null,
        });
      }
    } catch {
      errors.push(publicRefreshError());
    }
    if (index < groups.length - 1) await pause(150);
  }
  return { prices, errors: [...new Set(errors)] };
}

async function fetchSellerPrices(token: string, nmIds: number[]) {
  try {
    const response = await fetch(WB_SELLER_PRICES_API, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ nmList: nmIds }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { prices: new Map<number, number>(), error: response.status === 429 ? "WB временно ограничил обновление цен продавца." : "WB не отдал цены продавца: проверьте доступ токена к разделу «Цены и скидки»." };
    const data = await response.json() as SellerPricesResponse;
    return {
      prices: new Map((data.data?.listGoods ?? []).flatMap((item): Array<[number, number]> => item.nmId && Number.isFinite(item.discountedPrice) ? [[item.nmId, item.discountedPrice!]] : [])),
      error: null,
    };
  } catch {
    return { prices: new Map<number, number>(), error: "WB не ответил при обновлении цен продавца." };
  }
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const rows = await listTargetPrices(cabinetId);
  const latest = rows.reduce<string | null>((result, row) => row.refreshedAt && (!result || row.refreshedAt > result) ? row.refreshedAt : result, null);
  return NextResponse.json({ rows, updatedAt: latest }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Обновлять цены может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const token = cabinetToken(session.cabinetId);
  if (!token) return NextResponse.json({ error: "Токен Wildberries ещё не подключён" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const rows = await listTargetPrices(session.cabinetId);
  const publicIds = [...new Set(rows.flatMap((row) => [row.nmId, ...row.competitors.map((competitor) => competitor.nmId)]).filter((id): id is number => Boolean(id)))];
  const ownIds = [...new Set(rows.map((row) => row.nmId).filter((id): id is number => Boolean(id)))];
  const [publicResult, sellerResult] = await Promise.all([fetchPublicPrices(publicIds), fetchSellerPrices(token, ownIds)]);
  const refreshedAt = new Date().toISOString();
  const sharedErrors = [...publicResult.errors, ...(sellerResult.error ? [sellerResult.error] : [])];
  const refreshed = rows.map<TargetPriceRow>((row) => {
    const publicOwn = row.nmId ? publicResult.prices.get(row.nmId) : undefined;
    const sellerPrice = row.nmId ? sellerResult.prices.get(row.nmId) : undefined;
    const competitors = row.competitors.map<TargetPriceCompetitor>((competitor) => {
      const point = publicResult.prices.get(competitor.nmId);
      if (!point) return { ...competitor, error: publicResult.errors[0] ?? competitor.error };
      return { ...competitor, price: point.price ?? competitor.price, name: point.name ?? competitor.name, updatedAt: refreshedAt, error: point.price === null ? "WB не отдал цену этой карточки" : null };
    });
    const currentPrice = publicOwn?.price ?? row.currentPrice;
    const priceBeforeSpp = sellerPrice ?? row.priceBeforeSpp;
    const sppPercent = sellerPrice && currentPrice && sellerPrice > currentPrice ? 1 - currentPrice / sellerPrice : row.sppPercent;
    const rowErrors = [...sharedErrors, ...competitors.flatMap((competitor) => competitor.error ? [competitor.error] : [])];
    return {
      ...row,
      currentPrice,
      priceBeforeSpp,
      sppPercent,
      competitors,
      updatedAt: publicOwn?.price !== undefined || sellerPrice !== undefined ? refreshedAt : row.updatedAt,
      refreshedAt,
      refreshError: rowErrors.length ? [...new Set(rowErrors)].join(" ") : null,
    };
  });
  await saveTargetPrices(session.cabinetId, refreshed);
  return NextResponse.json({ rows: refreshed, updatedAt: refreshedAt, warnings: sharedErrors }, { headers: { "Cache-Control": "no-store" } });
}
