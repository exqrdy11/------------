import assert from "node:assert/strict";
import test from "node:test";

import { calculateRobustSkuForecast } from "../ops/ff-forecast.mjs";

function isoDay(day) {
  return `2026-08-${String(day).padStart(2, "0")}`;
}

test("supply recommendation is independent from the factual report period", () => {
  const metrics = [];
  for (let day = 3; day <= 23; day += 1) metrics.push({ date: isoDay(day), demand: 10, sold: 8 });
  for (let day = 24; day <= 30; day += 1) metrics.push({ date: isoDay(day), demand: 10, sold: 0 });

  const common = {
    metrics,
    asOf: "2026-08-31",
    openedAt: "2026-08-01",
    availableStock: 50,
    inTransit: 10,
    leadTimeDays: 7,
    targetDays: 14,
  };
  const shortReport = calculateRobustSkuForecast({ ...common, reportFrom: "2026-08-18", reportTo: "2026-08-23" });
  const longReport = calculateRobustSkuForecast({ ...common, reportFrom: "2026-08-18", reportTo: "2026-08-30" });

  assert.equal(shortReport.reportSales, 48);
  assert.equal(longReport.reportSales, 48, "unmatured orders must not be presented as confirmed buyouts");
  assert.equal(shortReport.reportAverageDailySales, 8);
  assert.equal(longReport.reportAverageDailySales, 3.69);
  assert.deepEqual(shortReport.windowRates, { 7: 8, 14: 8, 28: 8 });
  assert.equal(shortReport.forecastDailySales, 8);
  assert.equal(shortReport.recommendedSupply, 108);
  assert.equal(longReport.recommendedSupply, 108, "changing report dates must not change the supply plan");
});

test("recent created FBS orders are projected with the mature cohort buyout rate", () => {
  const metrics = [];
  for (let day = 3; day <= 23; day += 1) metrics.push({ date: isoDay(day), demand: 10, sold: 8 });
  for (let day = 24; day <= 30; day += 1) metrics.push({ date: isoDay(day), demand: 5, sold: 0 });

  const result = calculateRobustSkuForecast({
    metrics,
    asOf: "2026-08-31",
    openedAt: "2026-08-01",
    reportFrom: "2026-08-24",
    reportTo: "2026-08-30",
    availableStock: 0,
    inTransit: 0,
    leadTimeDays: 0,
    targetDays: 7,
  });

  assert.equal(result.buyoutRate, 0.8);
  assert.equal(result.windowRates[7], 4, "five fresh orders per day at 80% buyout must forecast four units per day");
  assert.deepEqual(result.windowRates, { 7: 4, 14: 6, 28: 7 });
  assert.equal(result.recommendedSupply, 42, "the median 6 units/day, not the volatile 7-day edge, drives the plan");
});

test("days before FF opening, the current partial day, and stockout dates do not dilute demand", () => {
  const result = calculateRobustSkuForecast({
    metrics: [
      { date: "2026-08-24", demand: 100, sold: 100 },
      { date: "2026-08-25", demand: 6, sold: 6 },
      { date: "2026-08-26", demand: 0, sold: 0 },
      { date: "2026-08-27", demand: 6, sold: 6 },
      { date: "2026-08-28", demand: 6, sold: 6 },
      { date: "2026-08-29", demand: 6, sold: 6 },
      { date: "2026-08-30", demand: 6, sold: 6 },
      { date: "2026-08-31", demand: 100, sold: 100 },
    ],
    asOf: "2026-08-31",
    openedAt: "2026-08-25",
    reportFrom: "2026-08-24",
    reportTo: "2026-08-31",
    outOfStockDates: ["2026-08-26"],
    fallbackBuyoutRate: 1,
    maturityDays: 0,
    availableStock: 0,
    inTransit: 0,
    leadTimeDays: 0,
    targetDays: 7,
  });

  assert.deepEqual(result.windowRates, { 7: 6, 14: 6, 28: 6 });
  assert.equal(result.forecastDailySales, 6);
  assert.equal(result.recommendedSupply, 42);
});
