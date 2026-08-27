# FF Supply Planner Design

## Goal

Turn the existing fixed seven-day single-warehouse sales screen into one supply-planning workspace where a user can compare several fulfillment warehouses, give each warehouse its own analysis period, see demand and buyouts separately, and calculate replenishment per SKU.

## Roles and authentication

- The local owner account is `exqrdy`; its password stays only in `.env.local`.
- `Metanutrix` remains a viewer.
- Both roles may view the planner and refresh shared marketplace data.
- Only the owner may edit fulfillment metadata such as opening date, marketplace warehouse mapping, visibility, service rate, and default target coverage.

## Data semantics

- **Demand** is created FBS quantity minus canceled FBS quantity for the selected period.
- **Sold** is marketplace-confirmed buyout without cancellations.
- **Free stock** is the existing FF free-stock value: physical stock minus new/confirm FBS reserve. Orders already handed to the marketplace are not deducted a second time.
- Demand and sold are displayed separately and never presented as the same measure.
- Unmapped marketplace warehouses remain visible as `unassigned`; they are never silently attributed to an FF.

## Periods

- The planner offers 7, 14, 30 days and custom dates.
- A common period and target coverage can be applied to all selected FFs.
- Every selected FF may override `from`, `to`, and target coverage days.
- Each FF has an owner-managed `openedAt`. Effective start is the later of the selected `from` and `openedAt`, preventing pre-opening zero days from diluting demand.
- Periods are inclusive and limited to 90 days.

## Calculations

All calculations run independently for every SKU and FF before any totals are summed.

```text
effectiveDays = inclusive days from max(selectedFrom, openedAt) through selectedTo
averageDemandPerDay = demand / effectiveDays
coverageDays = freeStock / averageDemandPerDay
targetStock = ceil(averageDemandPerDay * targetCoverageDays)
recommendedSupply = max(0, targetStock - freeStock)
```

When demand is zero, coverage is shown as `Нет спроса` and recommended supply is zero.

## Persistence and refresh

- Daily SKU × FF metrics are stored in D1 instead of recalculated from a new marketplace request every time a period changes.
- A manual refresh writes a shared snapshot of demand and sold facts. All users read the same snapshot.
- The existing two-minute recommended refresh interval/cooldown is retained.
- WB is the first fully factual implementation. Other marketplace cabinets may show created-order demand until their financial buyout source is connected, with an explicit source label.

## User interface

- Rename the `Продажи` workspace to `План поставок`.
- Top bulk bar: period preset/custom dates, target days, and `Применить выбранным`.
- FF selector: checkbox plus per-FF date range and target-days override.
- Per-FF summary: demand, sold, free stock, average/day, coverage, and recommended supply.
- SKU table: aggregate selected FFs by default; each SKU expands into per-FF rows with the same measures.
- The existing operational FF drill-down remains unchanged and gets a `Рассчитать поставку` link that opens the planner with that FF selected.
- Owner-only FF settings gain opening date and default target coverage controls in the existing all-warehouses settings screen.

## Non-goals

- Do not edit marketplace prices or create marketplace supplies automatically.
- Do not infer historical data that the marketplace did not return.
- Do not mix FBO stock or sales into the FF replenishment calculation.
