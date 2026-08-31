const DAY_MS = 86_400_000;
const DEFAULT_WINDOWS = Object.freeze([7, 14, 28]);

const finiteNonNegative = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value) => Math.round(value * 100) / 100;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function dateMs(value, label) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) || !Number.isFinite(parsed)) {
    throw new Error(`Некорректная дата ${label}`);
  }
  return parsed;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function aggregateMetrics(metrics) {
  const byDate = new Map();
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    if (!metric?.date) continue;
    dateMs(metric.date, "метрики");
    const current = byDate.get(metric.date) ?? { demand: 0, sold: 0 };
    current.demand += finiteNonNegative(metric.demand);
    current.sold += finiteNonNegative(metric.sold);
    byDate.set(metric.date, current);
  }
  return byDate;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reportSummary(byDate, fromMs, toMs, openedAtMs, cutoffMs) {
  const effectiveFrom = Math.max(fromMs, openedAtMs);
  const effectiveTo = Math.min(toMs, cutoffMs);
  if (effectiveFrom > effectiveTo) return { sales: 0, days: 0, average: 0 };
  let sales = 0;
  let days = 0;
  for (let cursor = effectiveFrom; cursor <= effectiveTo; cursor += DAY_MS) {
    sales += finiteNonNegative(byDate.get(isoDate(cursor))?.sold);
    days += 1;
  }
  return { sales: round(sales), days, average: days ? round(sales / days) : 0 };
}

export function calculateRobustSkuForecast(input = {}) {
  const asOfMs = dateMs(input.asOf, "снимка");
  const cutoffMs = asOfMs - DAY_MS;
  const openedAtMs = input.openedAt ? dateMs(input.openedAt, "открытия ФФ") : Number.NEGATIVE_INFINITY;
  const reportFromMs = dateMs(input.reportFrom, "начала отчёта");
  const reportToMs = dateMs(input.reportTo, "конца отчёта");
  if (reportFromMs > reportToMs) throw new Error("Начало отчёта позже конца");

  const maturityDays = Math.max(0, Math.floor(finiteNonNegative(input.maturityDays ?? 7)));
  const maturityBoundaryMs = cutoffMs - maturityDays * DAY_MS;
  const fallbackBuyoutRate = clamp(Number.isFinite(Number(input.fallbackBuyoutRate)) ? Number(input.fallbackBuyoutRate) : 0.85, 0, 1);
  const byDate = aggregateMetrics(input.metrics);
  const outOfStockDates = new Set(Array.isArray(input.outOfStockDates) ? input.outOfStockDates : []);

  let matureDemand = 0;
  let matureSales = 0;
  for (const [date, metric] of byDate) {
    const currentMs = dateMs(date, "метрики");
    if (currentMs < openedAtMs || currentMs > maturityBoundaryMs) continue;
    matureDemand += finiteNonNegative(metric.demand);
    matureSales += finiteNonNegative(metric.sold);
  }
  const buyoutRate = round(matureDemand > 0 ? clamp(matureSales / matureDemand, 0, 1) : fallbackBuyoutRate);

  const windows = (Array.isArray(input.windows) && input.windows.length ? input.windows : DEFAULT_WINDOWS)
    .map((value) => Math.max(1, Math.floor(finiteNonNegative(value))))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);
  const windowRates = {};
  const windowActiveDays = {};
  for (const days of windows) {
    const startMs = Math.max(openedAtMs, cutoffMs - (days - 1) * DAY_MS);
    let projectedSales = 0;
    let activeDays = 0;
    for (let cursor = startMs; cursor <= cutoffMs; cursor += DAY_MS) {
      const date = isoDate(cursor);
      if (outOfStockDates.has(date)) continue;
      const metric = byDate.get(date) ?? { demand: 0, sold: 0 };
      projectedSales += cursor <= maturityBoundaryMs
        ? finiteNonNegative(metric.sold)
        : finiteNonNegative(metric.demand) * buyoutRate;
      activeDays += 1;
    }
    windowActiveDays[days] = activeDays;
    windowRates[days] = activeDays ? round(projectedSales / activeDays) : 0;
  }

  const forecastDailySales = round(median(Object.values(windowRates).filter((value) => Number.isFinite(value))));
  const report = reportSummary(byDate, reportFromMs, reportToMs, openedAtMs, cutoffMs);
  const availableStock = finiteNonNegative(input.availableStock);
  const inTransit = finiteNonNegative(input.inTransit);
  const targetDays = Math.max(1, Math.floor(finiteNonNegative(input.targetDays)));
  const leadTimeDays = Math.max(0, Math.floor(finiteNonNegative(input.leadTimeDays)));
  const projectedStockAtArrival = Math.max(0, availableStock - forecastDailySales * leadTimeDays);
  const recommendedSupply = Math.ceil(Math.max(0, forecastDailySales * (leadTimeDays + targetDays) - availableStock - inTransit));
  const observedDays = Math.max(0, ...Object.values(windowActiveDays));
  const confidence = observedDays >= 28 && matureDemand >= 20 ? "high" : observedDays >= 14 && matureDemand >= 5 ? "medium" : "low";

  return {
    reportSales: report.sales,
    reportDays: report.days,
    reportAverageDailySales: report.average,
    matureDemand: round(matureDemand),
    matureSales: round(matureSales),
    buyoutRate,
    windowRates,
    windowActiveDays,
    forecastDailySales,
    averageDailySales: forecastDailySales,
    confidence,
    coverageNow: forecastDailySales > 0 ? round(availableStock / forecastDailySales) : null,
    projectedStockAtArrival: round(projectedStockAtArrival),
    coverageAtArrival: forecastDailySales > 0 ? round(projectedStockAtArrival / forecastDailySales) : null,
    recommendedSupply,
    risk: forecastDailySales === 0 ? "no_sales" : projectedStockAtArrival <= 0 ? "critical" : recommendedSupply > 0 ? "send_now" : "sufficient",
  };
}
