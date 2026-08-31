import { calculateRobustSkuForecast } from "./ff-forecast.mjs";

const DAY_MS = 86_400_000;

export function inclusiveDays(from, to) {
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) {
    throw new Error("Некорректный период анализа");
  }
  return Math.floor((last - first) / DAY_MS) + 1;
}

const finiteNonNegative = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export function calculateSkuPlan(input = {}) {
  return calculateRobustSkuForecast({
    metrics: input.metrics ?? [],
    asOf: input.asOf ?? input.reportTo,
    openedAt: input.openedAt,
    reportFrom: input.reportFrom,
    reportTo: input.reportTo,
    availableStock: input.availableStock,
    inTransit: input.inTransit,
    targetDays: input.targetDays,
    leadTimeDays: input.leadTimeDays,
    fallbackBuyoutRate: input.fallbackBuyoutRate,
    outOfStockDates: input.outOfStockDates,
  });
}

const RISK_ORDER = { critical: 0, send_now: 1, sufficient: 2, no_sales: 3 };

export function riskRank(risk) {
  return Object.hasOwn(RISK_ORDER, risk) ? RISK_ORDER[risk] : Number.MAX_SAFE_INTEGER;
}

function defaultBuyoutRate(daily, warehouseId, asOf) {
  const cutoff = Date.parse(`${asOf}T00:00:00Z`) - 8 * DAY_MS;
  let demand = 0;
  let sold = 0;
  for (const metric of daily) {
    if (metric?.warehouseId !== warehouseId || Date.parse(`${metric.date}T00:00:00Z`) > cutoff) continue;
    demand += finiteNonNegative(metric.demand);
    sold += finiteNonNegative(metric.sold);
  }
  return demand > 0 ? Math.min(1, Math.max(0, sold / demand)) : 0.85;
}

export function buildWarehouseAnalysis(input = {}) {
  const warehouseId = input.warehouseId;
  const from = input.from;
  const to = input.to;
  const periodDays = inclusiveDays(from, to);
  const daily = Array.isArray(input.daily) ? input.daily : [];
  const inventoryRows = Array.isArray(input.inventoryRows) ? input.inventoryRows : [];
  const asOf = input.asOf ?? to;
  const inTransitByWarehouseProduct = input.inTransitByWarehouseProduct && typeof input.inTransitByWarehouseProduct === "object"
    ? input.inTransitByWarehouseProduct
    : {};
  const inTransitForWarehouse = inTransitByWarehouseProduct[warehouseId] && typeof inTransitByWarehouseProduct[warehouseId] === "object"
    ? inTransitByWarehouseProduct[warehouseId]
    : {};
  const inTransitByProduct = input.inTransitByProduct && typeof input.inTransitByProduct === "object"
    ? input.inTransitByProduct
    : {};
  const metricsByProduct = new Map();
  const metadataByProduct = new Map();
  const demandByProduct = new Map();

  for (const metric of daily) {
    if (metric?.warehouseId !== warehouseId || !metric.productKey) continue;
    const productMetrics = metricsByProduct.get(metric.productKey) ?? [];
    productMetrics.push(metric);
    metricsByProduct.set(metric.productKey, productMetrics);
    const metadata = metadataByProduct.get(metric.productKey) ?? { sku: metric.sku, name: metric.name };
    if (!metadata.sku && metric.sku) metadata.sku = metric.sku;
    if (!metadata.name && metric.name) metadata.name = metric.name;
    metadataByProduct.set(metric.productKey, metadata);
    if (metric.date >= from && metric.date <= to) {
      demandByProduct.set(metric.productKey, finiteNonNegative(demandByProduct.get(metric.productKey)) + finiteNonNegative(metric.demand));
    }
  }

  const productKeys = new Set([...metricsByProduct.keys(), ...inventoryRows.map((row) => row?.key).filter(Boolean)]);
  const fallbackBuyoutRate = defaultBuyoutRate(daily, warehouseId, asOf);
  const rows = [...productKeys].map((productKey) => {
    const inventory = inventoryRows.find((row) => row?.key === productKey) ?? {};
    const metadata = metadataByProduct.get(productKey) ?? {};
    const physicalStock = finiteNonNegative(inventory.ffStock?.[warehouseId]);
    const reservedStock = finiteNonNegative(inventory.fbsByLocation?.[warehouseId]);
    const availableStock = Math.max(0, physicalStock - reservedStock);
    const inTransit = finiteNonNegative(Object.hasOwn(inTransitForWarehouse, productKey)
      ? inTransitForWarehouse[productKey]
      : inTransitByProduct[productKey]);
    const plan = calculateSkuPlan({
      metrics: metricsByProduct.get(productKey) ?? [],
      asOf,
      openedAt: input.openedAt,
      reportFrom: from,
      reportTo: to,
      availableStock,
      inTransit,
      targetDays: input.targetDays,
      leadTimeDays: input.leadTimeDays,
      fallbackBuyoutRate,
      outOfStockDates: input.outOfStockByProduct?.[productKey],
    });
    return {
      productKey,
      sku: inventory.sku ?? metadata.sku ?? "",
      name: inventory.name ?? metadata.name ?? "",
      sales: plan.reportSales,
      demand: finiteNonNegative(demandByProduct.get(productKey)),
      availableStock,
      inTransit,
      ...plan,
    };
  });

  return {
    warehouseId,
    from,
    to,
    periodDays,
    rows,
    totals: {
      sales: rows.reduce((sum, row) => sum + row.sales, 0),
      reportAverageDailySales: rows.reduce((sum, row) => sum + row.reportAverageDailySales, 0),
      forecastDailySales: rows.reduce((sum, row) => sum + row.forecastDailySales, 0),
      windowRates: {
        7: rows.reduce((sum, row) => sum + finiteNonNegative(row.windowRates?.[7]), 0),
        14: rows.reduce((sum, row) => sum + finiteNonNegative(row.windowRates?.[14]), 0),
        28: rows.reduce((sum, row) => sum + finiteNonNegative(row.windowRates?.[28]), 0),
      },
      recommendedSupply: rows.reduce((sum, row) => sum + row.recommendedSupply, 0),
      critical: rows.filter((row) => row.risk === "critical").length,
      sendNow: rows.filter((row) => row.risk === "send_now").length,
    },
  };
}
