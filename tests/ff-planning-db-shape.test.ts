import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFfDailyMetrics, normalizeOpenedAt, normalizePlanningTargetDays } from "../db/ff-planning.ts";

test("planning target days defaults to 14 and rejects values outside 1 through 365", () => {
  assert.equal(normalizePlanningTargetDays(undefined), 14);
  assert.equal(normalizePlanningTargetDays(1), 1);
  assert.equal(normalizePlanningTargetDays(365), 365);
  assert.throws(() => normalizePlanningTargetDays(0), /1.*365/);
  assert.throws(() => normalizePlanningTargetDays(366), /1.*365/);
});

test("daily metrics reject non-calendar YYYY-MM-DD dates", () => {
  assert.throws(() => normalizeFfDailyMetrics([
    { warehouseId: "ff-kazan", productKey: "nm:1", nmId: 1, sku: "A-1", date: "2026-02-30", demand: 1, sold: 0 },
  ]), /YYYY-MM-DD/);
});

test("warehouse opening date is nullable but must be YYYY-MM-DD", () => {
  assert.equal(normalizeOpenedAt(undefined), null);
  assert.equal(normalizeOpenedAt("2026-08-01"), "2026-08-01");
  assert.throws(() => normalizeOpenedAt("2026-08-01T12:00:00Z"), /YYYY-MM-DD/);
});

test("daily metrics combine duplicate keys deterministically", () => {
  const duplicateRows = [
    { warehouseId: "ff-kazan", productKey: "nm:1", nmId: 1, sku: "A-1", date: "2026-08-15", demand: 2, sold: 1 },
    { warehouseId: "ff-kazan", productKey: "nm:1", nmId: 1, sku: "A-1", date: "2026-08-15", demand: 3, sold: 4 },
  ];

  const expected = [
    { warehouseId: "ff-kazan", productKey: "nm:1", nmId: 1, sku: "A-1", date: "2026-08-15", demand: 5, sold: 5 },
  ];
  assert.deepEqual(normalizeFfDailyMetrics(duplicateRows), expected);
  assert.deepEqual(normalizeFfDailyMetrics([...duplicateRows].reverse()), expected);
});
