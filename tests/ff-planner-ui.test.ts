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
    selectedWarehouseIds: ["alpha", "beta"],
    onSelectedWarehouseIdsChange: () => undefined,
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
  assert.match(text, /Целевой запас.*Применить выбранным/);
  assert.match(text, /Период этого ФФ.*Целевой запас этого ФФ/);
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

test("planner state transitions apply bulk values, preserve overrides, and hydrate untouched owner defaults", () => {
  const exported = Page as Record<string, unknown>;
  assert.equal(typeof exported.applyPlannerRangeToSelected, "function");
  assert.equal(typeof exported.updatePlannerWarehouseRange, "function");
  assert.equal(typeof exported.togglePlannerWarehouse, "function");
  assert.equal(typeof exported.syncPlannerWarehouseRanges, "function");
  const applyBulk = exported.applyPlannerRangeToSelected as (current: Record<string, unknown>, ids: string[], range: { from: string; to: string }, targetDays: number) => Record<string, { from: string; to: string; targetDays: number }>;
  const updateOverride = exported.updatePlannerWarehouseRange as (current: Record<string, unknown>, id: string, fallback: { from: string; to: string; targetDays: number }, change: Partial<{ from: string; to: string; targetDays: number }>) => Record<string, { from: string; to: string; targetDays: number }>;
  const toggle = exported.togglePlannerWarehouse as (ids: string[], id: string, checked: boolean) => string[];
  const syncDefaults = exported.syncPlannerWarehouseRanges as (current: Record<string, { from: string; to: string; targetDays: number }>, warehouses: Array<{ id: string; planningTargetDays: number }>, initialRange: { from: string; to: string }, targetOverrideIds: ReadonlySet<string>) => Record<string, { from: string; to: string; targetDays: number }>;

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

  const hydrated = syncDefaults(base, [
    { id: "alpha", planningTargetDays: 45 },
    { id: "beta", planningTargetDays: 60 },
  ], { from: "2026-08-21", to: "2026-08-27" }, new Set(["beta"]));
  assert.equal(hydrated.alpha.targetDays, 45, "an untouched built-in default must adopt the owner-saved value");
  assert.equal(hydrated.beta.targetDays, 21, "a user override must survive warehouse metadata hydration");

  const explicitSameValue = syncDefaults(base, [
    { id: "alpha", planningTargetDays: 45 },
    { id: "beta", planningTargetDays: 60 },
  ], { from: "2026-08-21", to: "2026-08-27" }, new Set(["alpha", "beta"]));
  assert.equal(explicitSameValue.alpha.targetDays, 14, "an explicit override equal to the old default must still survive hydration");
});
