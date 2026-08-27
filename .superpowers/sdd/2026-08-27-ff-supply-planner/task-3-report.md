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
- Commit: `b897154` — `fix: restrict planning source events`.

## Fix round 2

- Added negative coverage for missing FBS/created metadata and missing buyout confirmation, plus nested record mapping names.
- RED command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 5 passed, 3 failed (demand/sold missing metadata were included; nested mapping resolved to `unassigned`).
- GREEN command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 8/8 passed.
- Full verification: `npm test`; build completed, rendered 12/12, TypeScript 17/17 passed.
- Fixes are fail-closed: demand requires affirmative FBS and created signals; sold requires affirmative confirmed-buyout signal or canonical status; nested record mapping names are indexed.
- Commit: `d52b447` — `fix: fail closed planning source metadata`.

## Fix round 3

- Added regressions for contradictory FBS/created aliases and explicit unconfirmed buyout with a sold status.
- RED command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 8 passed, 2 failed (conflicting order and unconfirmed sale were included).
- GREEN command: `node --experimental-strip-types --test tests/ff-planning-source.test.ts`; 10/10 passed.
- Full verification: `npm test`; build completed, rendered 12/12, TypeScript 19/19 passed.
- Fixes: explicit false/non-FBS/not-created aliases veto demand; explicit unconfirmed signals veto sold; buyout statuses use exact normalized canonical matching.
- Commit: `affe1da` — `fix: veto conflicting planning event metadata`.
