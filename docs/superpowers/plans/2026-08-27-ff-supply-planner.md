# FF Supply Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared multi-FF supply planner with per-warehouse periods, demand and buyouts kept separate, and SKU-level replenishment recommendations, while restoring the local `exqrdy` owner login.

**Architecture:** Add pure date/calculation and source-aggregation modules, persist daily metrics and FF planning metadata in D1, expose a planner API that reads the shared snapshot, then evolve the existing sales view into the planner. Keep the existing fulfillment drill-down and stock semantics intact.

**Tech Stack:** TypeScript 5.9, React 19, vinext/Next route handlers, Cloudflare D1/SQLite, Node test runner, CSS.

**Spec:** `docs/superpowers/specs/2026-08-27-ff-supply-planner.md`

## Global Constraints

- Preserve all pre-existing uncommitted changes in `app/page.tsx`, `app/globals.css`, `package.json`, `lib/fbs-summary.ts`, and `tests/fbs-summary.test.ts`.
- No secrets enter Git, logs, API payloads, or browser state.
- Periods are inclusive and at most 90 days.
- Demand is non-canceled created FBS quantity; sold is confirmed buyout without cancellations.
- Calculate each SKU × FF independently before summing.
- `Metanutrix` remains viewer; only owner edits FF metadata.
- Do not push or deploy unless the user explicitly requests it after local verification.

---

### Task 1: Restore the local owner account

**Files:**
- Modify: `.env.local`

**Interfaces:**
- Consumes: `ownerCredentials()` precedence in `lib/admin-auth.ts`.
- Produces: a local owner session for `exqrdy`; no tracked source change.

- [ ] **Step 1: Add `OWNER_LOGIN` and `OWNER_PASSWORD` to `.env.local` without printing the password.**
- [ ] **Step 2: Restart the local dev server so vinext reloads environment variables.**
- [ ] **Step 3: POST the configured owner credentials to `/api/auth/login` and verify HTTP 200 with role `owner`; verify a wrong password remains HTTP 401.**

### Task 2: Add pure planning calculations

**Files:**
- Create: `tests/ff-planning.test.ts`
- Create: `lib/ff-planning.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `effectivePeriod(input)`, `calculateFfPlan(input)`, `groupSupplyPlans(input)` and exported planning types.

- [ ] **Step 1: Write failing tests proving inclusive dates, opening-date clamping, zero-demand behavior, and independent per-FF calculation before summing.**
- [ ] **Step 2: Run `node --experimental-strip-types --test tests/ff-planning.test.ts` and verify failure because `lib/ff-planning.ts` is missing.**
- [ ] **Step 3: Implement the smallest pure calculation module that satisfies the tests.**
- [ ] **Step 4: Re-run the focused test and verify it passes.**
- [ ] **Step 5: Add the focused test to `npm test` without removing existing suites.**

### Task 3: Aggregate marketplace events into daily FF metrics

**Files:**
- Create: `tests/ff-planning-source.test.ts`
- Create: `lib/ff-planning-source.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: normalized WB order/status/sale events and `warehouseId`/warehouse-name mappings.
- Produces: `aggregateDailyFfMetrics()` returning `{ warehouseId, productKey, nmId, sku, date, demand, sold }[]` plus unassigned entries.

- [ ] **Step 1: Write failing tests proving canceled orders are excluded from demand, sold cancellations are excluded, SKU/FF/date remain distinct, and unmapped events stay unassigned.**
- [ ] **Step 2: Run the focused source test and verify expected missing-module failure.**
- [ ] **Step 3: Implement normalized aggregation without network or database dependencies.**
- [ ] **Step 4: Re-run the focused source test and verify it passes.**
- [ ] **Step 5: Add the suite to `npm test`.**

### Task 4: Persist planning metadata and daily history

**Files:**
- Modify: `db/ff-stocks.ts`
- Modify: `db/schema.ts`
- Create: `db/ff-planning.ts`
- Create: `tests/ff-planning-db-shape.test.ts`

**Interfaces:**
- Consumes: daily metrics from `aggregateDailyFfMetrics()`.
- Produces: `replaceFfDailyMetrics()`, `listFfDailyMetrics()`, `openedAt`, and `planningTargetDays` on `ManualWarehouse`.

- [ ] **Step 1: Write a failing test for validation/normalization helpers used at the DB boundary, including invalid dates, target-day bounds, and duplicate daily rows.**
- [ ] **Step 2: Run the test and verify it fails for missing DB planning helpers.**
- [ ] **Step 3: Add idempotent D1 table/column migrations and the repository functions; keep cabinet scoping in every primary key/query.**
- [ ] **Step 4: Extend FF warehouse create/list/update paths with nullable opening date and default target days.**
- [ ] **Step 5: Run focused tests and the existing rendered/build tests.**

### Task 5: Add the shared planner API

**Files:**
- Create: `app/api/ff-planning/route.ts`
- Modify: `app/api/ff-warehouses/route.ts`
- Modify: `app/api/inventory/route.ts`

**Interfaces:**
- GET `/api/ff-planning?from=YYYY-MM-DD&to=YYYY-MM-DD` returns shared daily metrics and FF metadata.
- POST `/api/ff-planning` with `{ action: "refresh", from, to }` refreshes WB daily facts, enforces cooldown, and returns the same payload.
- PATCH `/api/ff-warehouses` accepts `openedAt` and `planningTargetDays` for owner sessions only.

- [ ] **Step 1: Add failing contract tests for date validation, viewer read access, owner-only FF metadata writes, and response fields.**
- [ ] **Step 2: Verify the contract tests fail because the route/fields do not exist.**
- [ ] **Step 3: Implement GET from D1 and POST refresh using existing WB fetch/status conventions and the pure source aggregator.**
- [ ] **Step 4: Integrate daily metric persistence into the explicit refresh path without changing current stock/reserve arithmetic.**
- [ ] **Step 5: Run contract tests and the full existing suite.**

### Task 6: Build the multi-FF planner UI

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `/api/ff-planning` payload and pure calculations from `lib/ff-planning.ts`.
- Produces: selected FF IDs, common and per-FF period overrides, summary cards, expandable SKU rows, manual refresh, and FF-detail deep link.

- [ ] **Step 1: Add a failing rendered/UI behavior test for the planner controls and honest demand/sold labels.**
- [ ] **Step 2: Run it and verify failure because the planner UI is absent.**
- [ ] **Step 3: Rename the nav/view copy to `План поставок`; add bulk period/target controls and multi-select FF cards with per-FF overrides.**
- [ ] **Step 4: Render summaries and an expandable SKU table using `calculateFfPlan`; never aggregate stocks before per-FF calculation.**
- [ ] **Step 5: Add owner-only opening-date/default-target controls to the existing warehouse settings and a `Рассчитать поставку` link from FF detail.**
- [ ] **Step 6: Add responsive CSS that stacks FF controls and expanded rows on narrow screens.**
- [ ] **Step 7: Run focused UI tests and the full test suite.**

### Task 7: End-to-end verification

**Files:**
- Verify only; modify implementation only in response to reproduced failures.

**Interfaces:**
- Consumes: completed local feature.
- Produces: evidence for login, calculations, API, desktop UI, narrow UI, lint, build, and regression safety.

- [ ] **Step 1: Run all focused Node tests and record total pass/fail counts.**
- [ ] **Step 2: Run `npm test` and confirm build plus every suite exits 0.**
- [ ] **Step 3: Run targeted ESLint on changed TypeScript files; report unrelated pre-existing full-repo lint failures separately.**
- [ ] **Step 4: Use the in-app browser to verify owner login, multi-FF selection, separate periods, per-SKU expansion, and FF-detail deep link on desktop.**
- [ ] **Step 5: Repeat the planner visual check at a narrow viewport and confirm no clipping/overlap.**
- [ ] **Step 6: Review `git diff` to confirm no secret, unrelated deletion, push, or deployment is present.**
