import { NextResponse } from "next/server";
import {
  getTargetPriceCandidateSnapshot,
  getTargetPriceRefreshCooldown,
  listTargetPrices,
  reserveTargetPriceRefresh,
  saveTargetPriceCandidateSnapshot,
  saveTargetPrices,
  type TargetPriceCompetitor,
  type TargetPriceRow,
} from "@/db/target-prices";
import { cabinetToken, getAdminCabinet, getOwnerSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const WB_CARDS_API = "https://card.wb.ru/cards/v4/detail";
const WB_SEARCH_API = "https://search.wb.ru/exactmatch/ru/common/v18/search";
const WB_SELLER_PRICES_API = "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter";
const MOSCOW_DESTINATION = "-1257786";
const CHUNK_SIZE = 50;
const TARGET_PRICE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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
type WbSearchResponse = { products?: WbCard[]; data?: { products?: WbCard[] } };
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

async function fetchSearchCandidates(query: string) {
  try {
    const params = new URLSearchParams({
      appType: "1",
      curr: "rub",
      dest: MOSCOW_DESTINATION,
      lang: "ru",
      query,
      resultset: "catalog",
      sort: "popular",
      spp: "30",
    });
    const response = await fetch(`${WB_SEARCH_API}?${params}`, {
      headers: { Accept: "application/json", "Accept-Language": "ru-RU,ru;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { candidates: [] as WbCard[], error: publicRefreshError(response.status) };
    const data = await response.json() as WbSearchResponse;
    return { candidates: data.products ?? data.data?.products ?? [], error: null };
  } catch {
    return { candidates: [] as WbCard[], error: publicRefreshError() };
  }
}

function cardToCompetitor(card: WbCard, source: string): TargetPriceCompetitor | null {
  if (!card.id) return null;
  return {
    nmId: card.id,
    price: priceFromCard(card),
    source,
    name: [card.brand, card.name].filter(Boolean).join(" · ") || null,
    updatedAt: null,
    error: null,
  };
}

function findTargetPriceRow(rows: TargetPriceRow[], sku: unknown, nmId: unknown) {
  const normalizedSku = typeof sku === "string" ? sku.trim() : "";
  const normalizedNmId = Number(nmId);
  return rows.find((row) => (normalizedNmId && row.nmId === normalizedNmId) || (normalizedSku && row.sku === normalizedSku));
}

function cooldownMessage(cooldownUntil: string | null, kind: "prices" | "competitors") {
  const subject = kind === "prices" ? "Цены" : "Подбор конкурентов";
  return `${subject} уже обновляются или были обновлены недавно. Следующая попытка доступна после общего 5-минутного таймера.`;
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
  const url = new URL(request.url);
  const sku = url.searchParams.get("sku");
  const nmId = url.searchParams.get("nmId");
  if (url.searchParams.get("candidates") === "1") {
    const row = findTargetPriceRow(rows, sku, nmId);
    if (!row) return NextResponse.json({ error: "Товар для подбора конкурента не найден" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const [snapshot, cooldownUntil] = await Promise.all([
      getTargetPriceCandidateSnapshot(cabinetId, row),
      getTargetPriceRefreshCooldown(cabinetId, "competitors"),
    ]);
    return NextResponse.json({
      candidates: snapshot?.candidates ?? [],
      query: snapshot?.query ?? row.searchQuery?.trim() ?? row.sku,
      updatedAt: snapshot?.updatedAt ?? null,
      warning: snapshot?.warning ?? null,
      cooldownUntil,
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const latest = rows.reduce<string | null>((result, row) => row.refreshedAt && (!result || row.refreshedAt > result) ? row.refreshedAt : result, null);
  const cooldownUntil = await getTargetPriceRefreshCooldown(cabinetId, "prices");
  return NextResponse.json({ rows, updatedAt: latest, cooldownUntil }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Обновлять цены может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => null) as { action?: unknown; sku?: unknown; nmId?: unknown; competitorNmId?: unknown } | null;
  if (body?.action === "refresh-candidates") {
    const rows = await listTargetPrices(session.cabinetId);
    const row = findTargetPriceRow(rows, body.sku, body.nmId);
    if (!row) return NextResponse.json({ error: "Товар для подбора конкурента не найден" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const reservation = await reserveTargetPriceRefresh(session.cabinetId, "competitors", TARGET_PRICE_REFRESH_COOLDOWN_MS);
    if (!reservation.reserved) return NextResponse.json({ error: cooldownMessage(reservation.cooldownUntil, "competitors"), cooldownUntil: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });

    const previous = await getTargetPriceCandidateSnapshot(session.cabinetId, row);
    const query = row.searchQuery?.trim() || row.sku;
    const excluded = new Set([row.nmId, ...row.competitors.map((competitor) => competitor.nmId)].filter((id): id is number => Boolean(id)));
    const result = query ? await fetchSearchCandidates(query) : { candidates: [] as WbCard[], error: "У товара нет запроса для поиска конкурентов" };
    const candidates = result.candidates
      .flatMap((card) => {
        const competitor = cardToCompetitor(card, "поиск WB");
        return competitor && !excluded.has(competitor.nmId) ? [competitor] : [];
      })
      .filter((candidate, index, all) => all.findIndex((item) => item.nmId === candidate.nmId) === index)
      .slice(0, 12)
      .map((candidate) => ({ ...candidate, updatedAt: new Date().toISOString() }));
    const warning = result.error ? `${result.error}${previous?.candidates.length ? " Показана предыдущая сохранённая подборка." : ""}` : null;
    const snapshot = result.error && previous
      ? { ...previous, warning }
      : { query, candidates, updatedAt: new Date().toISOString(), warning };
    if (!result.error) await saveTargetPriceCandidateSnapshot(session.cabinetId, row, snapshot);
    return NextResponse.json({ ...snapshot, cooldownUntil: reservation.cooldownUntil }, { headers: { "Cache-Control": "no-store" } });
  }
  if (body?.action === "add-competitor" || body?.action === "remove-competitor") {
    const rows = await listTargetPrices(session.cabinetId);
    const row = findTargetPriceRow(rows, body.sku, body.nmId);
    if (!row) return NextResponse.json({ error: "Товар для изменения конкурентов не найден" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const competitorNmId = Number(body.competitorNmId);
    if (!Number.isInteger(competitorNmId) || competitorNmId <= 0 || competitorNmId === row.nmId) return NextResponse.json({ error: "Укажите корректный артикул WB конкурента" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    let competitors = row.competitors;
    if (body.action === "remove-competitor") {
      competitors = competitors.filter((competitor) => competitor.nmId !== competitorNmId);
    } else if (!competitors.some((competitor) => competitor.nmId === competitorNmId)) {
      const snapshot = await getTargetPriceCandidateSnapshot(session.cabinetId, row);
      const selectedCandidate = snapshot?.candidates.find((candidate) => candidate.nmId === competitorNmId);
      competitors = [...competitors, {
        nmId: competitorNmId,
        price: selectedCandidate?.price ?? null,
        source: "выбран вручную",
        name: selectedCandidate?.name ?? null,
        updatedAt: selectedCandidate?.updatedAt ?? null,
        error: selectedCandidate ? selectedCandidate.error : "Цена появится после отдельного обновления цен.",
      }];
    }
    const updatedRows = rows.map((item) => item.sku === row.sku && item.nmId === row.nmId
      ? {
        ...item,
        competitors,
        candidateNmId: body.action === "add-competitor" ? competitorNmId : item.candidateNmId === competitorNmId ? null : item.candidateNmId,
        sourceStatus: body.action === "add-competitor" ? "подтверждён вручную" : item.sourceStatus,
      }
      : item);
    await saveTargetPrices(session.cabinetId, updatedRows);
    return NextResponse.json({ rows: updatedRows }, { headers: { "Cache-Control": "no-store" } });
  }
  const token = cabinetToken(session.cabinetId);
  if (!token) return NextResponse.json({ error: "Токен Wildberries ещё не подключён" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const reservation = await reserveTargetPriceRefresh(session.cabinetId, "prices", TARGET_PRICE_REFRESH_COOLDOWN_MS);
  if (!reservation.reserved) return NextResponse.json({ error: cooldownMessage(reservation.cooldownUntil, "prices"), cooldownUntil: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });

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
  return NextResponse.json({ rows: refreshed, updatedAt: refreshedAt, warnings: sharedErrors, cooldownUntil: reservation.cooldownUntil }, { headers: { "Cache-Control": "no-store" } });
}
