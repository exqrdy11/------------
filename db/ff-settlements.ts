import { listFfWarehouses, type ManualWarehouse } from "./ff-stocks";
import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";

export type FfSettlementOrder = {
  orderId: number;
  handedOverAt: string;
};

export type FfSettlement = {
  warehouse: ManualWarehouse;
  from: string;
  to: string;
  orders: FfSettlementOrder[];
  quantity: number;
  rateKopecks: number;
  totalKopecks: number;
  trackingStartedAt: string | null;
};

function asDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

export async function getFfSettlement(input: { cabinetId: CabinetId; warehouseId: string; from: string; to: string }): Promise<FfSettlement> {
  if (!asDate(input.from) || !asDate(input.to) || input.from > input.to) throw new Error("Проверьте период сверки");
  const warehouses = await listFfWarehouses(input.cabinetId);
  const warehouse = warehouses.find((item) => item.id === input.warehouseId);
  if (!warehouse) throw new Error("ФФ не найден");
  if (!warehouse.wbWarehouseId) throw new Error("У этого ФФ не указан склад WB FBS. Сначала настройте привязку.");

  const d1 = getD1();
  const start = `${input.from}T00:00:00.000Z`;
  const end = `${input.to}T23:59:59.999Z`;
  const [ordersResult, trackingResult] = await Promise.all([
    d1.prepare(`
      SELECT order_id AS orderId, handed_over_at AS handedOverAt
      FROM fbs_order_handover_metrics
      WHERE cabinet_id = ?
        AND warehouse_id = ?
        AND handed_over_at IS NOT NULL
        AND handed_over_at >= ?
        AND handed_over_at <= ?
      ORDER BY handed_over_at ASC, order_id ASC
    `).bind(input.cabinetId, String(warehouse.wbWarehouseId), start, end).all<FfSettlementOrder>(),
    d1.prepare("SELECT MIN(first_seen_at) AS trackingStartedAt FROM fbs_order_handover_metrics WHERE cabinet_id = ?").bind(input.cabinetId).first<{ trackingStartedAt: string | null }>(),
  ]);
  const orders = (ordersResult.results ?? []).map((order) => ({
    orderId: Number(order.orderId),
    handedOverAt: order.handedOverAt,
  }));
  const rateKopecks = Math.max(0, Number(warehouse.serviceRateKopecks) || 0);
  return {
    warehouse,
    from: input.from,
    to: input.to,
    orders,
    quantity: orders.length,
    rateKopecks,
    totalKopecks: orders.length * rateKopecks,
    trackingStartedAt: trackingResult?.trackingStartedAt ?? null,
  };
}
