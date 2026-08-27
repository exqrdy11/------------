/** Pure normalization of marketplace events into daily fulfillment-warehouse metrics. */

export type NormalizedOrderEvent = {
  id: string;
  createdAt: string;
  warehouseId?: string | number | null;
  warehouseName?: string | null;
  productKey?: string | null;
  nmId?: string | number | null;
  sku?: string | null;
  quantity?: number | null;
  canceled?: boolean;
  isCanceled?: boolean;
  fulfillmentType?: string | null;
  orderType?: string | null;
  isFbs?: boolean;
  isCreated?: boolean;
  created?: boolean;
};

export type NormalizedStatusEvent = {
  orderId: string;
  status?: string | null;
  canceled?: boolean;
  isCanceled?: boolean;
  quantity?: number | null;
};

export type NormalizedSaleEvent = {
  id: string;
  soldAt: string;
  warehouseId?: string | number | null;
  warehouseName?: string | null;
  productKey?: string | null;
  nmId?: string | number | null;
  sku?: string | null;
  quantity?: number | null;
  canceled?: boolean;
  isCanceled?: boolean;
  status?: string | null;
  confirmedBuyout?: boolean;
  buyoutConfirmed?: boolean;
  isBuyoutConfirmed?: boolean;
  confirmed?: boolean;
};

export type WarehouseMapping = {
  warehouseId?: string | number | null;
  warehouseName?: string | null;
  ffWarehouseId?: string | null;
  id?: string | null;
  name?: string | null;
};

export type DailyFfMetric = {
  warehouseId: string;
  productKey: string;
  nmId: string | number | null;
  sku: string;
  date: string;
  demand: number;
  sold: number;
};

export type AggregateDailyFfMetricsInput = {
  orders?: NormalizedOrderEvent[];
  statuses?: NormalizedStatusEvent[];
  sales?: NormalizedSaleEvent[];
  warehouseMappings?: Record<string, string | WarehouseMapping> | WarehouseMapping[];
};

function datePart(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Некорректная дата события: ${value}`);
  return date;
}

function quantity(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 1;
}

function isCancellation(status: NormalizedStatusEvent): boolean {
  return status.canceled === true || status.isCanceled === true || /cancel|отмен/i.test(status.status ?? "");
}

function mappingLookup(input: AggregateDailyFfMetricsInput) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  if (Array.isArray(input.warehouseMappings)) {
    for (const mapping of input.warehouseMappings) {
      const ffId = mapping.ffWarehouseId ?? mapping.id;
      if (!ffId) continue;
      if (mapping.warehouseId != null) byId.set(String(mapping.warehouseId), ffId);
      if (mapping.warehouseName?.trim()) byName.set(mapping.warehouseName.trim().toLocaleLowerCase("ru-RU"), ffId);
      if (mapping.name?.trim()) byName.set(mapping.name.trim().toLocaleLowerCase("ru-RU"), ffId);
    }
  } else {
    for (const [marketplaceId, value] of Object.entries(input.warehouseMappings ?? {})) {
      if (typeof value === "string") {
        byId.set(marketplaceId, value);
        byName.set(marketplaceId.trim().toLocaleLowerCase("ru-RU"), value);
      } else if (value?.ffWarehouseId ?? value?.id) {
        const ffId = String(value.ffWarehouseId ?? value.id);
        byId.set(marketplaceId, ffId);
        if (value.warehouseName?.trim()) byName.set(value.warehouseName.trim().toLocaleLowerCase("ru-RU"), ffId);
        if (value.name?.trim()) byName.set(value.name.trim().toLocaleLowerCase("ru-RU"), ffId);
      }
    }
  }
  return (event: { warehouseId?: string | number | null; warehouseName?: string | null }) => {
    const mapped = event.warehouseId != null ? byId.get(String(event.warehouseId)) : undefined;
    if (mapped) return mapped;
    const name = event.warehouseName?.trim().toLocaleLowerCase("ru-RU");
    return name ? byName.get(name) ?? "unassigned" : "unassigned";
  };
}

function isCreatedFbsOrder(order: NormalizedOrderEvent): boolean {
  if (order.isFbs === false || order.isCreated === false || order.created === false) return false;
  if (order.fulfillmentType && !/fbs/i.test(order.fulfillmentType)) return false;
  if (order.orderType && !/fbs/i.test(order.orderType)) return false;
  const affirmativeFbs = order.isFbs === true || /fbs/i.test(order.fulfillmentType ?? "") || /fbs/i.test(order.orderType ?? "");
  const affirmativeCreated = order.isCreated === true || order.created === true;
  return affirmativeFbs && affirmativeCreated;
}

function isConfirmedBuyout(sale: NormalizedSaleEvent): boolean {
  if (sale.confirmedBuyout === false || sale.buyoutConfirmed === false || sale.isBuyoutConfirmed === false || sale.confirmed === false) return false;
  const affirmativeSignal = sale.confirmedBuyout === true || sale.buyoutConfirmed === true || sale.isBuyoutConfirmed === true || sale.confirmed === true;
  const affirmativeStatus = new Set(["buyout", "confirmed_buyout", "confirmed buyout", "выкуп", "sold", "complete", "completed"]).has((sale.status ?? "").trim().toLocaleLowerCase("ru-RU"));
  return affirmativeSignal || affirmativeStatus;
}

function product(event: { productKey?: string | null; nmId?: string | number | null; sku?: string | null }) {
  const sku = event.sku?.trim() ?? "";
  const nmId = event.nmId ?? null;
  const productKey = event.productKey?.trim() || (nmId != null && String(nmId) ? `nm:${nmId}` : `sku:${sku}`);
  return { productKey, nmId, sku };
}

export function aggregateDailyFfMetrics(input: AggregateDailyFfMetricsInput): DailyFfMetric[] {
  const resolveWarehouse = mappingLookup(input);
  const cancellations = new Map<string, number>();
  for (const status of input.statuses ?? []) {
    if (isCancellation(status)) {
      const canceled = status.quantity == null ? Number.POSITIVE_INFINITY : quantity(status.quantity);
      cancellations.set(status.orderId, Math.max(cancellations.get(status.orderId) ?? 0, canceled));
    }
  }
  const metrics = new Map<string, DailyFfMetric>();
  const add = (event: NormalizedOrderEvent | NormalizedSaleEvent, field: "demand" | "sold", amount: number, timestamp: string) => {
    if (amount <= 0) return;
    const warehouseId = resolveWarehouse(event);
    const { productKey, nmId, sku } = product(event);
    const date = datePart(timestamp);
    const key = `${date}\u0000${warehouseId}\u0000${productKey}\u0000${sku}`;
    const current = metrics.get(key) ?? { warehouseId, productKey, nmId, sku, date, demand: 0, sold: 0 };
    current[field] += amount;
    metrics.set(key, current);
  };
  for (const order of input.orders ?? []) {
    if (!isCreatedFbsOrder(order)) continue;
    const total = quantity(order.quantity);
    const canceled = order.canceled || order.isCanceled ? total : Math.min(total, cancellations.get(order.id) ?? 0);
    add(order, "demand", total - canceled, order.createdAt);
  }
  for (const sale of input.sales ?? []) add(sale, "sold", !isConfirmedBuyout(sale) || sale.canceled || sale.isCanceled || /cancel|отмен/i.test(sale.status ?? "") ? 0 : quantity(sale.quantity), sale.soldAt);
  return [...metrics.values()].sort((a, b) => a.date.localeCompare(b.date) || a.warehouseId.localeCompare(b.warehouseId) || a.productKey.localeCompare(b.productKey) || a.sku.localeCompare(b.sku));
}
