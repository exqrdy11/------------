export const WB_SELLABLE_TAG = "продаем";
export const WB_SELLABLE_FILTER_VERSION = 1;

export type WbSellableFilter = {
  marketplace: "wb";
  tag: typeof WB_SELLABLE_TAG;
  version: typeof WB_SELLABLE_FILTER_VERSION;
};

export const WB_SELLABLE_FILTER: WbSellableFilter = {
  marketplace: "wb",
  tag: WB_SELLABLE_TAG,
  version: WB_SELLABLE_FILTER_VERSION,
};

export type WbTaggedCard = {
  nmID?: number;
  nmId?: number;
  tags?: Array<{ id?: number; name?: string; color?: string }>;
};

function normalizeTagName(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ru-RU") : "";
}

export function hasWbSellableTag(card: WbTaggedCard) {
  return (card.tags ?? []).some((tag) => normalizeTagName(tag.name) === WB_SELLABLE_TAG);
}

export function selectSellableWbCards<T extends WbTaggedCard>(cards: T[]) {
  return cards.filter(hasWbSellableTag);
}

export function sellableWbProductIds(cards: WbTaggedCard[]) {
  return new Set(
    selectSellableWbCards(cards)
      .map((card) => card.nmID ?? card.nmId)
      .filter((nmId): nmId is number => Number.isInteger(nmId) && (nmId ?? 0) > 0),
  );
}

export function isSellableWbProduct(nmIds: ReadonlySet<number>, nmId: unknown) {
  const normalized = Number(nmId);
  return Number.isInteger(normalized) && normalized > 0 && nmIds.has(normalized);
}

type WbInventorySnapshot = {
  productFilter?: Partial<WbSellableFilter> | null;
  rows?: Array<{ nmId?: number | null }>;
};

export function isCurrentWbSellableSnapshot(snapshot: unknown): snapshot is WbInventorySnapshot {
  if (!snapshot || typeof snapshot !== "object") return false;
  const filter = (snapshot as WbInventorySnapshot).productFilter;
  return filter?.marketplace === WB_SELLABLE_FILTER.marketplace
    && filter.tag === WB_SELLABLE_FILTER.tag
    && filter.version === WB_SELLABLE_FILTER.version;
}

export function sellableWbProductIdsFromSnapshot(snapshot: unknown) {
  if (!isCurrentWbSellableSnapshot(snapshot)) return new Set<number>();
  return new Set(
    (snapshot.rows ?? [])
      .map((row) => Number(row.nmId))
      .filter((nmId) => Number.isInteger(nmId) && nmId > 0),
  );
}
