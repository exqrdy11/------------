import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ffWarehouses = sqliteTable("ff_warehouses", {
  cabinetId: text("cabinet_id").notNull().default("metanutrix"),
  id: text("id").notNull(),
  city: text("city").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  wbWarehouseId: integer("wb_warehouse_id"),
  wbWarehouseName: text("wb_warehouse_name"),
  isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.cabinetId, table.id] })]);

export const ffStocks = sqliteTable("ff_stocks", {
  cabinetId: text("cabinet_id").notNull().default("metanutrix"),
  productKey: text("product_key").notNull(),
  nmId: integer("nm_id"),
  sku: text("sku").notNull().default(""),
  location: text("location").notNull(),
  quantity: integer("quantity").notNull().default(0),
  expiresAt: text("expires_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.cabinetId, table.productKey, table.location] })]);

export const ffStockBatches = sqliteTable("ff_stock_batches", {
  cabinetId: text("cabinet_id").notNull().default("metanutrix"),
  productKey: text("product_key").notNull(),
  nmId: integer("nm_id"),
  sku: text("sku").notNull().default(""),
  location: text("location").notNull(),
  batchCode: text("batch_code").notNull().default(""),
  expiresAt: text("expires_at").notNull().default(""),
  quantity: integer("quantity").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.cabinetId, table.productKey, table.location, table.batchCode, table.expiresAt] })]);

export const marketplaceCredentials = sqliteTable("marketplace_credentials", {
  cabinetId: text("cabinet_id").notNull().default("metanutrix"),
  marketplace: text("marketplace").notNull(),
  clientId: text("client_id"),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.cabinetId, table.marketplace] })]);

export const fbsOrderHandoverMetrics = sqliteTable("fbs_order_handover_metrics", {
  cabinetId: text("cabinet_id").notNull(),
  orderId: integer("order_id").notNull(),
  warehouseId: text("warehouse_id").notNull().default("unknown"),
  createdAt: text("created_at").notNull(),
  firstState: text("first_state").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  handedOverAt: text("handed_over_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.cabinetId, table.orderId] }),
  index("idx_fbs_handover_cabinet_warehouse_completed").on(table.cabinetId, table.warehouseId, table.handedOverAt),
]);
