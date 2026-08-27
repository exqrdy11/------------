import assert from "node:assert/strict";
import test from "node:test";

import * as planningDb from "../db/ff-planning.ts";
import * as planning from "../lib/ff-planning.ts";
import * as planningSource from "../lib/ff-planning-source.ts";

type MetricRow = {
  cabinetId: string;
  date: string;
  warehouseId: string;
  productKey: string;
  nmId: number | null;
  sku: string;
  demand: number;
  sold: number;
  updatedAt: string;
};

class FakeStatement {
  readonly database: FakePlanningD1;
  readonly sql: string;
  readonly values: unknown[];
  constructor(database: FakePlanningD1, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]) { return new FakeStatement(this.database, this.sql, values); }
  run() { return this.database.run(this); }
  first<T>() { return this.database.first(this) as Promise<T | null>; }
}

class FakePlanningD1 {
  metrics: MetricRow[];
  refreshes = new Map<string, { cooldownUntil: string | null; updatedAt: string | null }>();
  failSku: string | null = null;
  failRefreshUpdate = false;
  batches: string[][] = [];

  constructor(metrics: MetricRow[] = []) {
    this.metrics = structuredClone(metrics);
  }

  prepare(sql: string) { return new FakeStatement(this, sql); }

  async batch(statements: FakeStatement[]) {
    this.batches.push(statements.map((statement) => statement.sql.replace(/\s+/g, " ").trim()));
    const metrics = structuredClone(this.metrics);
    const refreshes = structuredClone(this.refreshes);
    try {
      const results = [];
      for (const statement of statements) results.push(await this.run(statement));
      return results;
    } catch (error) {
      this.metrics = metrics;
      this.refreshes = refreshes;
      throw error;
    }
  }

  async run(statement: FakeStatement) {
    const sql = statement.sql.replace(/\s+/g, " ").trim();
    if (sql.startsWith("CREATE TABLE")) return { meta: { changes: 0 } };
    if (sql.startsWith("DELETE FROM ff_daily_metrics") && sql.includes("metric_date >= ?")) {
      const [cabinetId, from, to] = statement.values as string[];
      const before = this.metrics.length;
      this.metrics = this.metrics.filter((row) => row.cabinetId !== cabinetId || row.date < from || row.date > to);
      return { meta: { changes: before - this.metrics.length } };
    }
    if (sql.startsWith("INSERT INTO ff_daily_metrics")) {
      const [cabinetId, date, warehouseId, productKey, nmId, sku, demand, sold, updatedAt] = statement.values;
      if (sku === this.failSku) throw new Error("simulated insert failure");
      this.metrics.push({ cabinetId, date, warehouseId, productKey, nmId, sku, demand, sold, updatedAt } as MetricRow);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO ff_planning_refreshes")) {
      const cabinetId = String(statement.values[0]);
      if (!this.refreshes.has(cabinetId)) this.refreshes.set(cabinetId, { cooldownUntil: null, updatedAt: null });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO ff_planning_refreshes")) {
      if (this.failRefreshUpdate) throw new Error("simulated refresh timestamp failure");
      const [cabinetId, updatedAt] = statement.values.map(String);
      const current = this.refreshes.get(cabinetId) ?? { cooldownUntil: null, updatedAt: null };
      current.updatedAt = updatedAt;
      this.refreshes.set(cabinetId, current);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE ff_planning_refreshes") && sql.includes("SET cooldown_until")) {
      const [cooldownUntil, cabinetId, now] = statement.values.map(String);
      const current = this.refreshes.get(cabinetId)!;
      if (current.cooldownUntil && current.cooldownUntil > now) return { meta: { changes: 0 } };
      current.cooldownUntil = cooldownUntil;
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unsupported SQL: ${sql}`);
  }

  async first(statement: FakeStatement) {
    const sql = statement.sql.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT cooldown_until, updated_at FROM ff_planning_refreshes")) {
      const current = this.refreshes.get(String(statement.values[0]));
      return current ? { cooldown_until: current.cooldownUntil, updated_at: current.updatedAt } : null;
    }
    throw new Error(`Unsupported SELECT: ${sql}`);
  }
}

function metric(date: string, sku: string, demand: number): MetricRow {
  return { cabinetId: "metanutrix", date, warehouseId: "ff-a", productKey: `sku:${sku}`, nmId: null, sku, demand, sold: 0, updatedAt: "old" };
}

test("range replacement commits metrics and refresh timestamp in one batch and rolls both back on failure", async () => {
  assert.equal(typeof planningDb.replaceFfDailyMetricsRangeInDb, "function");
  if (typeof planningDb.replaceFfDailyMetricsRangeInDb !== "function") return;
  const database = new FakePlanningD1([
    metric("2026-07-31", "BEFORE", 1),
    metric("2026-08-01", "OLD", 2),
    metric("2026-08-03", "AFTER", 3),
  ]);
  database.refreshes.set("metanutrix", { cooldownUntil: "2026-08-27T10:02:00.000Z", updatedAt: "2026-08-27T09:00:00.000Z" });

  await planningDb.replaceFfDailyMetricsRangeInDb(database as never, {
    cabinetId: "metanutrix", from: "2026-08-01", to: "2026-08-02",
    metrics: [{ warehouseId: "ff-a", productKey: "sku:NEW", nmId: null, sku: "NEW", date: "2026-08-02", demand: 4, sold: 1 }],
  }, "2026-08-27T10:00:00.000Z");
  assert.deepEqual(database.metrics.map((row) => [row.date, row.sku, row.demand]), [
    ["2026-07-31", "BEFORE", 1], ["2026-08-03", "AFTER", 3], ["2026-08-02", "NEW", 4],
  ]);
  assert.equal(database.refreshes.get("metanutrix")?.updatedAt, "2026-08-27T10:00:00.000Z");
  assert.equal(database.batches.length, 1);
  assert.deepEqual(database.batches[0].map((sql) => sql.split(" ").slice(0, 4).join(" ")), [
    "DELETE FROM ff_daily_metrics WHERE",
    "INSERT INTO ff_daily_metrics (cabinet_id,",
    "INSERT INTO ff_planning_refreshes (cabinet_id,",
  ]);

  database.failRefreshUpdate = true;
  await assert.rejects(() => planningDb.replaceFfDailyMetricsRangeInDb(database as never, {
    cabinetId: "metanutrix", from: "2026-08-01", to: "2026-08-02",
    metrics: [{ warehouseId: "ff-a", productKey: "sku:NEXT", nmId: null, sku: "NEXT", date: "2026-08-01", demand: 9, sold: 0 }],
  }, "2026-08-27T10:01:00.000Z"), /simulated refresh timestamp failure/);
  assert.deepEqual(database.metrics.map((row) => [row.date, row.sku, row.demand]), [
    ["2026-07-31", "BEFORE", 1], ["2026-08-03", "AFTER", 3], ["2026-08-02", "NEW", 4],
  ]);
  assert.equal(database.refreshes.get("metanutrix")?.updatedAt, "2026-08-27T10:00:00.000Z");
});

test("warehouse planning patch preserves omitted metadata and applies explicit values", () => {
  assert.equal(typeof planningDb.mergeWarehousePlanningSettings, "function");
  if (typeof planningDb.mergeWarehousePlanningSettings !== "function") return;
  const current = { openedAt: "2026-05-10", planningTargetDays: 21 };
  assert.deepEqual(planningDb.mergeWarehousePlanningSettings(current, {}), current);
  assert.deepEqual(planningDb.mergeWarehousePlanningSettings(current, { openedAt: null, planningTargetDays: 30 }), {
    openedAt: null, planningTargetDays: 30,
  });
});

test("planning pagination reads past the former 30-page cap and fails explicitly at its safety cap", async () => {
  assert.equal(typeof planningSource.paginateWbPlanningOrders, "function");
  if (typeof planningSource.paginateWbPlanningOrders !== "function") return;
  let requests = 0;
  const complete = await planningSource.paginateWbPlanningOrders({ pageSize: 2, maxPages: 40, fetchPage: async (cursor) => {
    requests += 1;
    if (requests <= 30) return { orders: [{ id: requests * 2 - 1 }, { id: requests * 2 }], next: cursor + 1 };
    return { orders: [{ id: 61 }] };
  } });
  assert.equal(requests, 31);
  assert.equal(complete.length, 61);

  await assert.rejects(() => planningSource.paginateWbPlanningOrders({ pageSize: 1, maxPages: 3, fetchPage: async (cursor) => ({
    orders: [{ id: cursor + 1 }], next: cursor + 1,
  }) }), /safety limit|безопасн.*лимит/i);
});

test("supplier cancellation vetoes a sold WB status", () => {
  assert.equal(typeof planningSource.aggregateWbPlanningMetrics, "function");
  if (typeof planningSource.aggregateWbPlanningMetrics !== "function") return;
  const result = planningSource.aggregateWbPlanningMetrics({
    orders: [{ id: 1, createdAt: "2026-08-10", warehouseId: 10, nmId: 100, article: "SKU" }],
    statuses: [{ id: 1, supplierStatus: "cancel", wbStatus: "sold" }],
    warehouseMappings: { "10": "ff-a" },
  });
  assert.deepEqual(result.daily, []);
});

test("planning role policy allows shared reads and refreshes but only owners can write settings", () => {
  assert.equal(typeof planning.ffPlanningRoleCan, "function");
  if (typeof planning.ffPlanningRoleCan !== "function") return;
  assert.equal(planning.ffPlanningRoleCan("owner", "read"), true);
  assert.equal(planning.ffPlanningRoleCan("viewer", "read"), true);
  assert.equal(planning.ffPlanningRoleCan("viewer", "refresh"), true);
  assert.equal(planning.ffPlanningRoleCan("viewer", "write-settings"), false);
  assert.equal(planning.ffPlanningRoleCan("owner", "write-settings"), true);
  assert.equal(planning.ffPlanningRoleCan(null, "read"), false);
});

test("planning period is inclusive and rejects more than 90 days", () => {
  assert.equal(planning.effectivePeriod({ from: "2026-01-01", to: "2026-03-31" }).days, 90);
  assert.throws(() => planning.effectivePeriod({ from: "2026-01-01", to: "2026-04-01" }), /90 дней/);
});

test("shared cooldown permits one refresh per cabinet every two minutes", async () => {
  assert.equal(typeof planningDb.reserveFfPlanningRefreshInDb, "function");
  if (typeof planningDb.reserveFfPlanningRefreshInDb !== "function") return;
  const database = new FakePlanningD1();
  const first = await planningDb.reserveFfPlanningRefreshInDb(database as never, "metanutrix", new Date("2026-08-27T10:00:00.000Z"));
  const blocked = await planningDb.reserveFfPlanningRefreshInDb(database as never, "metanutrix", new Date("2026-08-27T10:01:59.999Z"));
  const next = await planningDb.reserveFfPlanningRefreshInDb(database as never, "metanutrix", new Date("2026-08-27T10:02:00.000Z"));
  assert.deepEqual(first, { reserved: true, cooldownUntil: "2026-08-27T10:02:00.000Z" });
  assert.deepEqual(blocked, { reserved: false, cooldownUntil: "2026-08-27T10:02:00.000Z" });
  assert.deepEqual(next, { reserved: true, cooldownUntil: "2026-08-27T10:04:00.000Z" });
});
