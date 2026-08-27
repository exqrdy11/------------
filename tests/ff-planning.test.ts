import assert from "node:assert/strict";
import test from "node:test";

import { calculateFfPlan, effectivePeriod, groupSupplyPlans } from "../lib/ff-planning.ts";

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
