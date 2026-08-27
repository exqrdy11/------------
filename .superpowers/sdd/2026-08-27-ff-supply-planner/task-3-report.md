# Task 3 report — daily FF source metrics

## RED/GREEN evidence

- RED: `node --experimental-strip-types --test tests/ff-planning-source.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the intentionally missing `lib/ff-planning-source.ts`.
- Focused GREEN: the same command passed, 2/2 tests.
- Full GREEN: `npm test` passed: build completed, rendered suite 12/12, TypeScript suite 11/11.

## Changes

- Added `lib/ff-planning-source.ts` with pure `aggregateDailyFfMetrics()` normalization.
- Demand counts created FBS quantity less cancellation quantity; sold counts only non-canceled buyouts.
- Metrics preserve date × fulfillment warehouse × product/SKU dimensions and use `unassigned` for unmapped warehouses.
- Added focused tests in `tests/ff-planning-source.test.ts` and included them in `npm test`.

## Self-review

- No network, database, or marketplace calls are used.
- Cancellation events without an explicit quantity cancel the full order; explicit quantities are capped at order quantity.
- Supports warehouse mappings by marketplace ID and normalized warehouse name, with deterministic output ordering.
- Build emits existing non-failing chunk-size/deprecation warnings only.

## Commit

`791d579` — `feat: aggregate daily FF planning metrics`

## Fix round 1

- Added regression coverage for created FBS-only demand, confirmed-buyout-only sold, and record-form warehouse-name mappings.
- RED command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 2 passed, 3 failed with demand `9 !== 2`, sold `9 !== 2`, and `unassigned` vs `ff-name`.
- GREEN command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 5/5 passed.
- Full verification: `npm test`; build completed, rendered 12/12, TypeScript 14/14 passed.
- Fixes: explicit FBS/created filters for demand, confirmed buyout filters for sold, and normalized record-name mapping lookup.
- Commit: recorded below after verification.
