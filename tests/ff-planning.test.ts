import assert from "node:assert/strict";
import test from "node:test";

import { calculateFfPlan, effectivePeriod, groupSupplyPlans } from "../lib/ff-planning.ts";
import * as planningModule from "../lib/ff-planning.ts";

test("effectivePeriod counts selected dates inclusively", () => {
  assert.deepEqual(effectivePeriod({ from: "2026-08-01", to: "2026-08-07" }), {
    from: "2026-08-01", to: "2026-08-07", days: 7,
  });
});

test("effectivePeriod clamps the start to an FF opening date", () => {
  assert.deepEqual(effectivePeriod({ from: "2026-08-01", to: "2026-08-10", openedAt: "2026-08-04" }), {
    from: "2026-08-04", to: "2026-08-10", days: 7,
  });
});

test("effectivePeriod rejects an original period over 90 days even when opening date clamps it", () => {
  assert.throws(
    () => effectivePeriod({ from: "2026-01-01", to: "2026-04-01", openedAt: "2026-03-01" }),
    /90 дней/,
  );
});

test("effectivePeriod accepts exactly 90 inclusive selected days", () => {
  assert.deepEqual(effectivePeriod({ from: "2026-01-01", to: "2026-03-31" }), {
    from: "2026-01-01", to: "2026-03-31", days: 90,
  });
});

test("zero demand has no coverage and recommends no supply", () => {
  const plan = calculateFfPlan({ from: "2026-08-01", to: "2026-08-07", demand: 0, freeStock: 20, targetCoverageDays: 14 });
  assert.equal(plan.effectiveDays, 7);
  assert.equal(plan.averageDemandPerDay, 0);
  assert.equal(plan.coverageDays, null);
  assert.equal(plan.recommendedSupply, 0);
});

test("groupSupplyPlans calculates each FF before summing", () => {
  const result = groupSupplyPlans([
    { ffId: "a", sku: "SKU", from: "2026-08-01", to: "2026-08-02", demand: 10, freeStock: 0, targetCoverageDays: 2 },
    { ffId: "b", sku: "SKU", from: "2026-08-01", to: "2026-08-02", demand: 2, freeStock: 10, targetCoverageDays: 2 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].demand, 12);
  assert.equal(result[0].recommendedSupply, 10);
  assert.deepEqual(result[0].plans.map((plan) => plan.ffId), ["a", "b"]);
});

test("inventory planner generation distinguishes fresh, cached, partial, and independent refreshes", () => {
  const exported = planningModule as Record<string, unknown>;
  assert.equal(typeof exported.resolveInventoryPlannerGeneration, "function");
  const marker = exported.resolveInventoryPlannerGeneration as (input: {
    requestedGeneration: string | null;
    snapshotIsComplete: boolean;
    fallbackGeneration?: string | null;
    usedFallback?: boolean;
  }) => string | null;
  const generation = "2026-08-27T09:00:02.000Z";
  const oldGeneration = "2026-08-27T08:58:00.000Z";
  assert.equal(marker({ requestedGeneration: generation, snapshotIsComplete: true }), generation);
  assert.equal(marker({ requestedGeneration: generation, snapshotIsComplete: false }), null, "a partial fresh response must not claim the requested generation");
  assert.equal(marker({ requestedGeneration: generation, snapshotIsComplete: false, fallbackGeneration: oldGeneration, usedFallback: true }), oldGeneration, "a cached HTTP 200 keeps its old marker so the client rejects it as a mismatch");
  assert.equal(marker({ requestedGeneration: null, snapshotIsComplete: true, fallbackGeneration: oldGeneration }), null, "ordinary independent inventory refresh must clear an older planner generation");
  assert.equal(marker({ requestedGeneration: null, snapshotIsComplete: false }), null);
});
