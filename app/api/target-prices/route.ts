import { NextResponse } from "next/server";
import { getTargetPriceRefreshCooldown, listTargetPrices, releaseTargetPriceRefresh, reserveTargetPriceRefresh, saveTargetPrices, type TargetPriceCompetitor, type TargetPriceRow } from "@/db/target-prices";
import { cabinetToken, getAdminCabinet, getAdminSession } from "@/lib/admin-auth";
import { normalizeOzonProductUrl, refreshOzonCompetitorQuote, refreshOzonTargetPrices } from "@/lib/ozon-target-prices";
import { refreshYandexTargetPrices } from "@/lib/yandex-target-prices";
import { normalizeYandexMarketProductUrl, refreshYandexMarketCompetitorQuote } from "@/lib/yandex-public-prices";

export const dynamic = "force-dynamic";

const WB_CARDS_API = "https://card.wb.ru/cards/v4/detail";
const WB_SELLER_PRICES_API = "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter";
const MOSCOW_DESTINATION = "-1257786";
const CHUNK_SIZE = 50;
// A short lock protects WB from two simultaneous refreshes. It is not a
// schedule: any user can make a new manual refresh as soon as it completes.
const TARGET_PRICE_REFRESH_REQUEST_LOCK_MS = 30 * 1000;

type WbCard = {
  id?: number;
  name?: string;
  brand?: string;
  salePriceU?: number;
  priceU?: number;
  sizes?: Array<{ price?: { product?: number } }>;
};
// WB returns `products` at the root of this public endpoint. Older examples
// used `data.products`, so accept both shapes while the public API evolves.
type WbCardsResponse = { products?: WbCard[]; data?: { products?: WbCard[] } };
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
  if (prices.length) return Math.min(...prices) / 100;
  const price = card.salePriceU ?? card.priceU;
  return Number.isFinite(price) && (price ?? 0) > 0 ? price! / 100 : null;
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
      const cards = data.products ?? data.data?.products ?? [];
      for (const card of cards) {
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

function findTargetPriceRow(rows: TargetPriceRow[], sku: unknown, nmId: unknown) {
  const normalizedSku = typeof sku === "string" ? sku.trim() : "";
  const normalizedNmId = Number(nmId);
  return rows.find((row) => (normalizedNmId && row.nmId === normalizedNmId) || (normalizedSku && row.sku === normalizedSku));
}

function cooldownMessage() {
  return "Цены уже обновляет другой пользователь. Дождитесь завершения текущего запроса и повторите попытку.";
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
  const cooldownUntil = await getTargetPriceRefreshCooldown(cabinetId, "prices");
  return NextResponse.json({ rows, updatedAt: latest, cooldownUntil }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => null) as { action?: unknown; sku?: unknown; nmId?: unknown; competitorNmId?: unknown; competitorUrl?: unknown; competitorPrice?: unknown } | null;
  if (body?.action === "add-competitor" || body?.action === "remove-competitor" || body?.action === "set-competitor-price" || body?.action === "refresh-competitor") {
    if (session.role !== "owner") return NextResponse.json({ error: "Менять список конкурентов может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const rows = await listTargetPrices(session.cabinetId);
    const row = findTargetPriceRow(rows, body.sku, body.nmId);
    if (!row) return NextResponse.json({ error: "Товар для изменения конкурентов не найден" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const ozonCompetitor = session.cabinetId === "ozon" ? normalizeOzonProductUrl(body.competitorUrl) : null;
    const yandexCompetitor = session.cabinetId === "yandex" ? normalizeYandexMarketProductUrl(body.competitorUrl) : null;
    const competitorNmId = ozonCompetitor?.id ?? yandexCompetitor?.id ?? Number(body.competitorNmId);
    if (!Number.isInteger(competitorNmId) || competitorNmId <= 0 || competitorNmId === row.nmId) return NextResponse.json({ error: session.cabinetId === "ozon" ? "Укажите корректный ID товара Ozon конкурента" : session.cabinetId === "yandex" ? "Укажите корректный ID карточки Яндекс Маркета" : "Укажите корректный артикул WB конкурента" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    let competitors = row.competitors;
    if (body.action === "refresh-competitor") {
      if (session.cabinetId !== "ozon" && session.cabinetId !== "yandex") return NextResponse.json({ error: "Точечное обновление по ссылке доступно для Ozon и Яндекс Маркета" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const existing = competitors.find((competitor) => competitor.nmId === competitorNmId);
      if (!existing) return NextResponse.json({ error: "Сначала добавьте карточку конкурента в сравнение" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      const refreshedAt = new Date().toISOString();
      const updated = session.cabinetId === "ozon"
        ? await refreshOzonCompetitorQuote(existing, refreshedAt)
        : await refreshYandexMarketCompetitorQuote(existing, refreshedAt);
      competitors = competitors.map((competitor) => competitor.nmId === competitorNmId ? updated : competitor);
    } else if (body.action === "remove-competitor") {
      competitors = competitors.filter((competitor) => competitor.nmId !== competitorNmId);
    } else if (body.action === "set-competitor-price") {
      const competitorPrice = typeof body.competitorPrice === "string"
        ? Number(body.competitorPrice.replace(",", "."))
        : Number(body.competitorPrice);
      if (!Number.isFinite(competitorPrice) || competitorPrice <= 0 || competitorPrice > 10_000_000) {
        return NextResponse.json({ error: "Укажите корректную цену конкурента в рублях" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      if (!competitors.some((competitor) => competitor.nmId === competitorNmId)) {
        return NextResponse.json({ error: "Сначала добавьте карточку конкурента в сравнение" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const updatedAt = new Date().toISOString();
      competitors = competitors.map((competitor) => competitor.nmId === competitorNmId
        ? {
          ...competitor,
          price: Math.round(competitorPrice * 100) / 100,
          source: "введено вручную",
          updatedAt,
          error: null,
        }
        : competitor);
    } else if (!competitors.some((competitor) => competitor.nmId === competitorNmId)) {
      competitors = [...competitors, {
        nmId: competitorNmId,
        url: ozonCompetitor?.url ?? yandexCompetitor?.url ?? null,
        price: null,
        source: "выбран вручную",
        name: null,
        updatedAt: null,
        error: session.cabinetId === "ozon" || session.cabinetId === "yandex" ? "Цена появится после обычного обновления цен." : "Цена появится после обновления цен.",
      }];
    }
    const updatedRows = rows.map((item) => item.sku === row.sku && item.nmId === row.nmId
      ? {
        ...item,
        competitors,
        candidateNmId: body.action === "add-competitor" ? competitorNmId : body.action === "remove-competitor" && item.candidateNmId === competitorNmId ? null : item.candidateNmId,
        sourceStatus: body.action === "add-competitor" ? "подтверждён вручную" : item.sourceStatus,
      }
      : item);
    await saveTargetPrices(session.cabinetId, updatedRows);
    return NextResponse.json({ rows: updatedRows }, { headers: { "Cache-Control": "no-store" } });
  }
  if (session.cabinetId === "ozon") {
    const reservation = await reserveTargetPriceRefresh(session.cabinetId, "prices", TARGET_PRICE_REFRESH_REQUEST_LOCK_MS);
    if (!reservation.reserved) return NextResponse.json({ error: cooldownMessage(), cooldownUntil: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
    try {
      const refreshed = await refreshOzonTargetPrices(await listTargetPrices(session.cabinetId));
      await saveTargetPrices(session.cabinetId, refreshed.rows);
      return NextResponse.json({ ...refreshed, cooldownUntil: null }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      await releaseTargetPriceRefresh(session.cabinetId, "prices").catch(() => undefined);
    }
  }
  if (session.cabinetId === "yandex") {
    const reservation = await reserveTargetPriceRefresh(session.cabinetId, "prices", TARGET_PRICE_REFRESH_REQUEST_LOCK_MS);
    if (!reservation.reserved) return NextResponse.json({ error: cooldownMessage(), cooldownUntil: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
    try {
      const refreshed = await refreshYandexTargetPrices(await listTargetPrices(session.cabinetId));
      await saveTargetPrices(session.cabinetId, refreshed.rows);
      return NextResponse.json({ ...refreshed, cooldownUntil: null }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      await releaseTargetPriceRefresh(session.cabinetId, "prices").catch(() => undefined);
    }
  }
  const token = cabinetToken(session.cabinetId);
  if (!token) return NextResponse.json({ error: "Токен Wildberries ещё не подключён" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const reservation = await reserveTargetPriceRefresh(session.cabinetId, "prices", TARGET_PRICE_REFRESH_REQUEST_LOCK_MS);
  if (!reservation.reserved) return NextResponse.json({ error: cooldownMessage(), cooldownUntil: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });

  try {
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
    return NextResponse.json({ rows: refreshed, updatedAt: refreshedAt, warnings: sharedErrors, cooldownUntil: null }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    await releaseTargetPriceRefresh(session.cabinetId, "prices").catch(() => undefined);
  }
}
