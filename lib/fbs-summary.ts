export type FbsSummaryLocation = {
  id: string;
  city: string;
  label: string;
};

export type ActiveFbsSummaryItem = FbsSummaryLocation & {
  quantity: number;
};

function warehouseCountLabel(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "складов"
    : lastDigit === 1
      ? "склад"
      : lastDigit >= 2 && lastDigit <= 4
        ? "склада"
        : "складов";

  return `ещё ${count} ${noun}`;
}

export function summarizeActiveFbsLocations(
  locations: FbsSummaryLocation[],
  quantities: Record<string, number>,
  limit = 2,
) {
  const visibleLimit = Math.max(0, Math.floor(limit));
  const activeLocations = locations
    .map((location) => ({ ...location, quantity: quantities[location.id] ?? 0 }))
    .filter((location) => location.quantity > 0)
    .sort((left, right) => right.quantity - left.quantity || left.city.localeCompare(right.city, "ru"));

  const hiddenCount = Math.max(0, activeLocations.length - visibleLimit);

  return {
    items: activeLocations.slice(0, visibleLimit),
    hiddenCount,
    hiddenLabel: hiddenCount > 0 ? warehouseCountLabel(hiddenCount) : null,
    activeLocationCount: activeLocations.length,
  };
}
