import assert from "node:assert/strict";
import test from "node:test";

import { aggregateDailyFfMetrics } from "../lib/ff-planning-source.ts";

test("excludes canceled FBS orders and canceled buyouts while keeping date, FF, and SKU distinct", () => {
  const result = aggregateDailyFfMetrics({
    orders: [
      { id: "o-1", createdAt: "2026-08-10T09:00:00Z", warehouseId: "wb-1", productKey: "nm:10", nmId: 10, sku: "A", quantity: 2 },
      { id: "o-2", createdAt: "2026-08-10T10:00:00Z", warehouseId: "wb-1", productKey: "nm:10", nmId: 10, sku: "A", quantity: 1 },
      { id: "o-3", createdAt: "2026-08-11T10:00:00Z", warehouseId: "wb-2", productKey: "nm:10", nmId: 10, sku: "A", quantity: 3 },
    ],
    statuses: [{ orderId: "o-2", status: "cancelled", quantity: 1 }],
    sales: [
      { id: "s-1", soldAt: "2026-08-10T12:00:00Z", warehouseId: "wb-1", productKey: "nm:10", nmId: 10, sku: "A", quantity: 2 },
      { id: "s-2", soldAt: "2026-08-10T13:00:00Z", warehouseId: "wb-1", productKey: "nm:10", nmId: 10, sku: "A", quantity: 1, canceled: true },
    ],
    warehouseMappings: { "wb-1": "ff-a", "wb-2": "ff-b" },
  });

  assert.deepEqual(result, [
    { warehouseId: "ff-a", productKey: "nm:10", nmId: 10, sku: "A", date: "2026-08-10", demand: 2, sold: 2 },
    { warehouseId: "ff-b", productKey: "nm:10", nmId: 10, sku: "A", date: "2026-08-11", demand: 3, sold: 0 },
  ]);
});

test("keeps unmapped marketplace warehouses as unassigned", () => {
  const result = aggregateDailyFfMetrics({
    orders: [{ id: "o-1", createdAt: "2026-08-12", warehouseName: "Новый склад", productKey: "sku:X", sku: "X", quantity: 1 }],
    sales: [{ id: "s-1", soldAt: "2026-08-12", warehouseName: "Новый склад", productKey: "sku:X", sku: "X", quantity: 1 }],
    warehouseMappings: [{ warehouseId: "wb-1", warehouseName: "Известный склад", ffWarehouseId: "ff-a" }],
  });

  assert.deepEqual(result, [
    { warehouseId: "unassigned", productKey: "sku:X", nmId: null, sku: "X", date: "2026-08-12", demand: 1, sold: 1 },
  ]);
});

test("counts demand only for created FBS orders", () => {
  const result = aggregateDailyFfMetrics({
    orders: [
      { id: "fbs", createdAt: "2026-08-13", warehouseId: "wb-1", productKey: "sku:F", sku: "F", quantity: 2, fulfillmentType: "FBS", isCreated: true },
      { id: "fbo", createdAt: "2026-08-13", warehouseId: "wb-1", productKey: "sku:F", sku: "F", quantity: 7, fulfillmentType: "FBO", isCreated: false },
    ],
    warehouseMappings: { "wb-1": "ff-a" },
  });
  assert.equal(result[0]?.demand, 2);
});

test("counts sold only for confirmed buyouts", () => {
  const result = aggregateDailyFfMetrics({
    sales: [
      { id: "confirmed", soldAt: "2026-08-13", warehouseId: "wb-1", productKey: "sku:S", sku: "S", quantity: 2, confirmedBuyout: true },
      { id: "pending", soldAt: "2026-08-13", warehouseId: "wb-1", productKey: "sku:S", sku: "S", quantity: 7, confirmedBuyout: false },
    ],
    warehouseMappings: { "wb-1": "ff-a" },
  });
  assert.equal(result[0]?.sold, 2);
});

test("supports record warehouse mappings by normalized marketplace warehouse name", () => {
  const result = aggregateDailyFfMetrics({
    orders: [{ id: "o-1", createdAt: "2026-08-14", warehouseName: "  Склад Имени  ", productKey: "sku:N", sku: "N", quantity: 1 }],
    warehouseMappings: { "склад имени": "ff-name" },
  });
  assert.equal(result[0]?.warehouseId, "ff-name");
});
