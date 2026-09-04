import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Page from "../app/page";

function visibleText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("planner renders multi-FF controls and keeps demand, confirmed sold, and per-FF supply honest", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.FfSupplyPlanner, "function", "app/page.tsx must export the rendered FF planner panel");
  const Planner = exported.FfSupplyPlanner as React.ComponentType<Record<string, unknown>>;
  const dates = ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"];
  const daily = [
    ...dates.map((date, index) => ({ warehouseId: "alpha", productKey: "nm:101", nmId: 101, sku: "SKU-101", date, demand: 1, sold: index < 3 ? 1 : 0 })),
    ...dates.map((date, index) => ({ warehouseId: "beta", productKey: "nm:101", nmId: 101, sku: "SKU-101", date, demand: 1, sold: index >= 5 ? 1 : 0 })),
  ];
  const warehouses = [
    { id: "alpha", city: "Казань", name: "Альфа ФФ", position: 10, wbWarehouseId: 1, wbWarehouseName: "Казань", serviceRateKopecks: 0, isHidden: false, openedAt: null, planningTargetDays: 14 },
    { id: "beta", city: "Москва", name: "Бета ФФ", position: 20, wbWarehouseId: 2, wbWarehouseName: "Москва", serviceRateKopecks: 0, isHidden: false, openedAt: "2026-08-24", planningTargetDays: 14 },
  ];
  const rows = [{
    key: "nm:101", sku: "SKU-101", nmId: 101, name: "Тестовый товар", category: "Тест", color: "#999",
    warehouses: {}, ffStock: { alpha: 30, beta: 0 }, ffExpiry: {}, ffBatches: {}, fbs: 0,
    fbsByLocation: { alpha: 0, beta: 0 }, sales7d: 0, sales7dByLocation: {}, receiving: 0,
    receivingByLocation: {}, toSale: 0, toSaleByLocation: {}, status: "В норме", updated: "12:00",
  }];

  const html = renderToStaticMarkup(React.createElement(Planner, {
    today: "2026-08-27",
    warehouses,
    daily,
    rows,
    dataAvailable: true,
    selectedWarehouseIds: ["alpha", "beta"],
    onSelectedWarehouseIdsChange: () => undefined,
    canEditWarehouseSettings: true,
    warehouseOpeningSavingId: null,
    onWarehouseOpenedAtChange: () => undefined,
    onRefresh: () => undefined,
    loading: false,
    refreshing: false,
    updatedAt: "2026-08-27T09:00:00.000Z",
    retrySeconds: null,
    error: null,
    warnings: [],
    source: {
      demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
      sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
    },
  }));
  const text = visibleText(html);

  assert.match(html, /aria-label="План поставок"/);
  assert.match(html, /type="checkbox"/);
  assert.match(text, /7 дней.*14 дней.*30 дней.*Свой период/);
  assert.match(text, /Целевой запас.*Снять все.*Применить выбранным/);
  assert.match(text, /Период этого ФФ.*Целевой запас этого ФФ/);
  assert.match(html, /aria-label="Дата открытия Казань — Альфа ФФ"[^>]*value=""/, "an owner must be able to set a missing opening date directly in the planner");
  assert.match(html, /aria-label="Дата открытия Москва — Бета ФФ"[^>]*value="2026-08-24"/, "the planner opening-date control must show the saved date");
  assert.match(html, /type="date"[^>]*value="2026-08-24"/, "the visible start input must use the FF opening date automatically");
  assert.match(text, /Обновить данные/);

  assert.match(text, /Спрос · созданные FBS/);
  assert.match(text, /Продано · подтверждённые выкупы/);
  assert.doesNotMatch(text, /Спрос.*Продажи ×/);

  assert.match(text, /Тестовый товар.*SKU-101/);
  assert.match(text, /Спрос · созданные FBS 11 шт\./, "facts before the Beta opening date must not dilute or inflate its demand");
  assert.match(text, /Продано · подтверждённые выкупы 5 шт\./);
  assert.match(text, /Хватит на 15 дн\./, "aggregate coverage must sum per-FF demand rates, not divide aggregate demand by one common period");
  assert.match(text, /Рекомендовано \+14 шт\./, "excess stock at Alpha must not cancel Beta's supply recommendation");
  assert.match(text, /По складам ФФ/);
  assert.match(text, /Москва — Бета ФФ.*24\.08–27\.08 · 4 дня.*Рекомендовано \+14 шт\./);

  const cooldownHtml = renderToStaticMarkup(React.createElement(Planner, {
    today: "2026-08-27",
    warehouses,
    daily,
    rows,
    dataAvailable: true,
    selectedWarehouseIds: ["alpha", "beta"],
    onSelectedWarehouseIdsChange: () => undefined,
    onRefresh: () => undefined,
    loading: false,
    refreshing: false,
    updatedAt: "2026-08-27T09:00:00.000Z",
    retrySeconds: 70,
    error: null,
    warnings: [],
    source: {
      demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
      sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
    },
  }));
  assert.match(cooldownHtml, /<button[^>]*planner-refresh-btn[^>]*disabled=""/);
  assert.match(visibleText(cooldownHtml), /Через 01:10/);
});

test("planner does not turn an unavailable demand snapshot into zero demand", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.FfSupplyPlanner, "function");
  const Planner = exported.FfSupplyPlanner as React.ComponentType<Record<string, unknown>>;
  const warehouses = [{
    id: "alpha", city: "Казань", name: "Альфа ФФ", position: 10, wbWarehouseId: 1,
    wbWarehouseName: "Казань", serviceRateKopecks: 0, isHidden: false, openedAt: null, planningTargetDays: 14,
  }];
  const rows = [{
    key: "nm:101", sku: "SKU-101", nmId: 101, name: "Тестовый товар", category: "Тест", color: "#999",
    warehouses: {}, ffStock: { alpha: 30 }, ffExpiry: {}, ffBatches: {}, fbs: 0,
    fbsByLocation: { alpha: 0 }, sales7d: 0, sales7dByLocation: {}, receiving: 0,
    receivingByLocation: {}, toSale: 0, toSaleByLocation: {}, status: "В норме", updated: "12:00",
  }];
  const source = {
    demand: { kind: "marketplace_orders", label: "Оперативные заказы", dateBasis: "created_at" },
    sold: { kind: "marketplace_sales", label: "Финансовые выкупы", dateBasis: "sold_at" },
  };
  const commonProps = {
    today: "2026-08-27",
    warehouses,
    daily: [],
    rows,
    dataAvailable: false,
    selectedWarehouseIds: ["alpha"],
    onSelectedWarehouseIdsChange: () => undefined,
    onRefresh: () => undefined,
    refreshing: false,
    updatedAt: null,
    retrySeconds: null,
    warnings: [],
    source,
  };

  const unavailableText = visibleText(renderToStaticMarkup(React.createElement(Planner, {
    ...commonProps,
    loading: false,
    error: "Остатки временно недоступны",
  })));
  assert.match(unavailableText, /План поставок пока недоступен/);
  assert.match(unavailableText, /Остатки временно недоступны/);
  assert.match(unavailableText, /Оперативные заказы/);
  assert.match(unavailableText, /Финансовые выкупы/);
  assert.doesNotMatch(unavailableText, /Нет спроса/);
  assert.doesNotMatch(unavailableText, /Рекомендовано 0/);

  const loadingText = visibleText(renderToStaticMarkup(React.createElement(Planner, {
    ...commonProps,
    loading: true,
    error: null,
  })));
  assert.match(loadingText, /Загружаем общий снимок/);
  assert.match(loadingText, /Оперативные заказы.*Финансовые выкупы/);
  assert.doesNotMatch(loadingText, /Нет спроса/);
});

test("planner refresh is sequential and commits only a matching fresh generation", async () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.runCoherentFfPlannerRefresh, "function");
  const refresh = exported.runCoherentFfPlannerRefresh as (
    fetchPlanning: () => Promise<Record<string, unknown>>,
    fetchInventory: (generation: string) => Promise<Record<string, unknown>>,
    commit: (snapshot: Record<string, unknown>) => void,
  ) => Promise<Record<string, unknown>>;
  const source = {
    demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
    sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
  };
  const previous = { marker: "previous coherent planner" };
  let committed: Record<string, unknown> = previous;
  let inventoryCalls = 0;
  await assert.rejects(() => refresh(
    async () => { throw new Error("planning failed"); },
    async () => { inventoryCalls += 1; return { configured: true, rows: [] }; },
    (snapshot) => { committed = snapshot; },
  ), /planning failed/);
  assert.equal(inventoryCalls, 0, "inventory refresh must not start after a planning failure");
  assert.equal(committed, previous, "a partial refresh must not replace any part of the coherent snapshot");

  await assert.rejects(() => refresh(
    async () => ({ warehouses: [], daily: [], source, warnings: [], updatedAt: null }),
    async () => { inventoryCalls += 1; return { configured: true, rows: [] }; },
    (snapshot) => { committed = snapshot; },
  ), /снимок спроса ещё не создан/i);
  assert.equal(inventoryCalls, 0, "an absent demand snapshot must stop before inventory is requested");
  assert.equal(committed, previous);

  await assert.rejects(() => refresh(
    async () => ({ warehouses: [], daily: [], source, warnings: [], updatedAt: "2026-08-27T09:00:02.000Z", retryAt: "2026-08-27T09:02:00.000Z" }),
    async (generation) => {
      inventoryCalls += 1;
      assert.equal(generation, "2026-08-27T09:00:02.000Z");
      return { configured: true, rows: [], warnings: [], updatedAt: "2026-08-27T08:59:00.000Z", plannerGeneration: "2026-08-27T08:58:00.000Z" };
    },
    (snapshot) => { committed = snapshot; },
  ), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /поколен/i);
    assert.equal((error as Error & { retryAt?: string }).retryAt, "2026-08-27T09:02:00.000Z", "a successful planning POST keeps its cooldown even when inventory is rejected");
    return true;
  });
  assert.equal(committed, previous, "HTTP 200 with an old cached inventory generation must not replace the coherent snapshot");

  const next = await refresh(
    async () => ({ warehouses: [], daily: [], source, warnings: [], updatedAt: "2026-08-27T09:00:02.000Z", retryAt: "2026-08-27T09:02:00.000Z" }),
    async (generation) => ({ configured: true, rows: [], warnings: [], updatedAt: "2026-08-27T09:00:03.000Z", plannerGeneration: generation }),
    (snapshot) => { committed = snapshot; },
  );
  assert.equal(committed, next);
  assert.deepEqual(next.daily, []);
  assert.deepEqual(next.rows, []);
  assert.equal(next.retryAt, "2026-08-27T09:02:00.000Z", "the successful planning cooldown must remain on the coherent snapshot");
  assert.equal(next.generation, "2026-08-27T09:00:02.000Z");

  const clockSkewSafe = await refresh(
    async () => ({ warehouses: [], daily: [], source, warnings: [], updatedAt: "2026-08-27T08:59:58.000Z" }),
    async (generation) => ({ configured: true, rows: [], warnings: [], updatedAt: "2026-08-27T08:59:59.000Z", plannerGeneration: generation }),
    () => undefined,
  );
  assert.equal(clockSkewSafe.generation, "2026-08-27T08:59:58.000Z", "the server-issued generation, not browser clock skew, establishes coherence");
});

test("FF planner is explicitly unavailable outside Wildberries", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.ffPlanningSupported, "function");
  const supported = exported.ffPlanningSupported as (marketplace: string | null | undefined) => boolean;
  assert.equal(supported("wb"), true);
  assert.equal(supported("ozon"), false);
  assert.equal(supported("yandex"), false);
  assert.equal(typeof exported.FfPlannerMarketplaceUnavailable, "function");
  const Unavailable = exported.FfPlannerMarketplaceUnavailable as React.ComponentType<{ marketplaceName: string }>;
  const text = visibleText(renderToStaticMarkup(React.createElement(Unavailable, { marketplaceName: "Ozon" })));
  assert.match(text, /План поставок доступен только для Wildberries/);
  assert.match(text, /Ozon/);
});

test("planner state transitions apply bulk values, preserve overrides, and hydrate untouched owner defaults", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.applyPlannerRangeToSelected, "function");
  assert.equal(typeof exported.updatePlannerWarehouseRange, "function");
  assert.equal(typeof exported.togglePlannerWarehouse, "function");
  assert.equal(typeof exported.toggleAllPlannerWarehouses, "function");
  assert.equal(typeof exported.syncPlannerWarehouseRanges, "function");
  assert.equal(typeof exported.mergePlannerWarehouseMetadata, "function");
  const applyBulk = exported.applyPlannerRangeToSelected as (current: Record<string, unknown>, ids: string[], range: { from: string; to: string }, targetDays: number) => Record<string, { from: string; to: string; targetDays: number }>;
  const updateOverride = exported.updatePlannerWarehouseRange as (current: Record<string, unknown>, id: string, fallback: { from: string; to: string; targetDays: number }, change: Partial<{ from: string; to: string; targetDays: number }>) => Record<string, { from: string; to: string; targetDays: number }>;
  const toggle = exported.togglePlannerWarehouse as (ids: string[], id: string, checked: boolean) => string[];
  const toggleAll = exported.toggleAllPlannerWarehouses as (ids: string[], warehouses: Array<{ id: string; isHidden: boolean }>) => string[];
  const syncDefaults = exported.syncPlannerWarehouseRanges as (current: Record<string, { from: string; to: string; targetDays: number }>, warehouses: Array<{ id: string; planningTargetDays: number; openedAt: string | null }>, initialRange: { from: string; to: string }, targetOverrideIds: ReadonlySet<string>, periodOverrideIds: ReadonlySet<string>, minimumFrom?: string) => Record<string, { from: string; to: string; targetDays: number }>;
  const mergeMetadata = exported.mergePlannerWarehouseMetadata as <T extends { id: string }>(snapshot: T[], live: T[]) => T[];

  const merged = mergeMetadata([
    { id: "alpha", openedAt: null, planningTargetDays: 14 },
    { id: "snapshot-only", openedAt: null, planningTargetDays: 14 },
  ], [
    { id: "alpha", openedAt: "2026-08-10", planningTargetDays: 21 },
    { id: "live-only", openedAt: "2026-08-20", planningTargetDays: 30 },
  ]);
  assert.deepEqual(merged, [
    { id: "alpha", openedAt: "2026-08-10", planningTargetDays: 21 },
    { id: "snapshot-only", openedAt: null, planningTargetDays: 14 },
    { id: "live-only", openedAt: "2026-08-20", planningTargetDays: 30 },
  ], "fresh FF settings must immediately replace stale planner metadata without dropping warehouses");

  const base = {
    alpha: { from: "2026-08-21", to: "2026-08-27", targetDays: 14 },
    beta: { from: "2026-08-14", to: "2026-08-27", targetDays: 21 },
  };
  const bulk = applyBulk(base, ["alpha"], { from: "2026-07-29", to: "2026-08-27" }, 30);
  assert.deepEqual(bulk.alpha, { from: "2026-07-29", to: "2026-08-27", targetDays: 30 });
  assert.deepEqual(bulk.beta, base.beta, "bulk apply must leave unselected FF overrides intact");
  const overridden = updateOverride(bulk, "beta", base.beta, { from: "2026-08-24", targetDays: 10 });
  assert.deepEqual(overridden.beta, { from: "2026-08-24", to: "2026-08-27", targetDays: 10 });
  assert.deepEqual(toggle(["alpha"], "beta", true), ["alpha", "beta"]);
  assert.deepEqual(toggle(["alpha", "beta"], "alpha", false), ["beta"]);
  assert.deepEqual(toggleAll(["alpha"], [
    { id: "alpha", isHidden: false },
    { id: "beta", isHidden: false },
    { id: "hidden", isHidden: true },
  ]), ["alpha", "beta"], "select all must include every visible FF and exclude hidden FFs");
  assert.deepEqual(toggleAll(["alpha", "beta"], [
    { id: "alpha", isHidden: false },
    { id: "beta", isHidden: false },
  ]), [], "the same control must clear the selection when every visible FF is already selected");

  const hydrated = syncDefaults(base, [
    { id: "alpha", planningTargetDays: 45, openedAt: "2026-08-10" },
    { id: "beta", planningTargetDays: 60, openedAt: "2026-08-24" },
  ], { from: "2026-08-21", to: "2026-08-27" }, new Set(["beta"]), new Set(["beta"]), "2026-06-01");
  assert.equal(hydrated.alpha.targetDays, 45, "an untouched built-in default must adopt the owner-saved value");
  assert.equal(hydrated.beta.targetDays, 21, "a user override must survive warehouse metadata hydration");
  assert.equal(hydrated.alpha.from, "2026-08-10", "an untouched FF period must start on its saved opening date");
  assert.equal(hydrated.beta.from, "2026-08-14", "a manually overridden FF period must survive warehouse metadata hydration");

  const explicitSameValue = syncDefaults(base, [
    { id: "alpha", planningTargetDays: 45, openedAt: null },
    { id: "beta", planningTargetDays: 60, openedAt: null },
  ], { from: "2026-08-21", to: "2026-08-27" }, new Set(["alpha", "beta"]), new Set());
  assert.equal(explicitSameValue.alpha.targetDays, 14, "an explicit override equal to the old default must still survive hydration");

  const clampedOpening = syncDefaults({}, [
    { id: "alpha", planningTargetDays: 14, openedAt: "2026-01-01" },
  ], { from: "2026-08-21", to: "2026-08-27" }, new Set(), new Set(), "2026-05-30");
  assert.equal(clampedOpening.alpha.from, "2026-05-30", "the automatic start must not predate the available 90-day snapshot");
});

test("unassigned demand follows the union of applied selected FF periods, not the common draft", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.summarizePlannerUnassigned, "function");
  const summarize = exported.summarizePlannerUnassigned as (
    daily: Array<{ warehouseId: string; date: string; demand: number; sold: number }>,
    warehouses: Array<{ id: string; openedAt: string | null }>,
    ranges: Record<string, { from: string; to: string; targetDays: number }>,
    fallback: { from: string; to: string },
  ) => { facts: unknown[]; demand: number; sold: number };
  const applyBulk = exported.applyPlannerRangeToSelected as (
    current: Record<string, { from: string; to: string; targetDays: number }>,
    ids: string[],
    range: { from: string; to: string },
    targetDays: number,
  ) => Record<string, { from: string; to: string; targetDays: number }>;
  const daily = [
    { warehouseId: "unassigned", productKey: "nm:1", nmId: 1, sku: "one", date: "2026-08-01", demand: 1, sold: 0 },
    { warehouseId: "unassigned", productKey: "nm:2", nmId: 2, sku: "two", date: "2026-08-02", demand: 1, sold: 1 },
    { warehouseId: "unassigned", productKey: "nm:3", nmId: 3, sku: "three", date: "2026-08-03", demand: 1, sold: 0 },
  ];
  const warehouses = [
    { id: "alpha", openedAt: null },
    { id: "beta", openedAt: "2026-08-03" },
  ];
  const applied = {
    alpha: { from: "2026-08-01", to: "2026-08-01", targetDays: 14 },
    beta: { from: "2026-08-03", to: "2026-08-03", targetDays: 14 },
  };
  const fallback = { from: "2026-08-01", to: "2026-08-03" };
  const beforeApply = summarize(daily, warehouses, applied, fallback);
  assert.equal(beforeApply.demand, 2, "disjoint selected FF periods must use their union, not one enclosing range");
  assert.equal(beforeApply.sold, 0);

  const commonDraft = { from: "2026-08-01", to: "2026-08-03" };
  const whileDraftOnly = summarize(daily, warehouses, applied, fallback);
  assert.deepEqual(whileDraftOnly, beforeApply, "editing the common draft must not change visible unassigned facts");

  const afterApplyRanges = applyBulk(applied, ["alpha", "beta"], commonDraft, 14);
  const afterApply = summarize(daily, warehouses, afterApplyRanges, fallback);
  assert.equal(afterApply.demand, 3, "unassigned facts may change only after applying the draft to selected FFs");
  assert.equal(afterApply.sold, 1);
});
