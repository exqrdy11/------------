import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ffWarehouses = sqliteTable("ff_warehouses", {
  id: text("id").primaryKey(),
  city: text("city").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ffStocks = sqliteTable("ff_stocks", {
  productKey: text("product_key").notNull(),
  nmId: integer("nm_id"),
  sku: text("sku").notNull().default(""),
  location: text("location").notNull(),
  quantity: integer("quantity").notNull().default(0),
  expiresAt: text("expires_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.productKey, table.location] })]);
