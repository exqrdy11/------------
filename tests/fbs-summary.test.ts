import assert from "node:assert/strict";
import test from "node:test";

import { summarizeActiveFbsLocations } from "../lib/fbs-summary.ts";

test("сводка активных FBS показывает лидирующие склады и количество остальных", () => {
  const locations = [
    { id: "moscow", city: "Москва", label: "БИК ФФ" },
    { id: "spb", city: "Питер", label: "Rus ФФ" },
    { id: "volgograd", city: "Волгоград", label: "Upakovka" },
    { id: "kazan", city: "Казань", label: "Наш склад" },
  ];

  const summary = summarizeActiveFbsLocations(locations, {
    moscow: 3,
    spb: 0,
    volgograd: 51,
    kazan: 16,
  }, 2);

  assert.deepEqual(summary.items, [
    { id: "volgograd", city: "Волгоград", label: "Upakovka", quantity: 51 },
    { id: "kazan", city: "Казань", label: "Наш склад", quantity: 16 },
  ]);
  assert.equal(summary.hiddenCount, 1);
  assert.equal(summary.hiddenLabel, "ещё 1 склад");
  assert.equal(summary.activeLocationCount, 3);
});

test("сводка правильно склоняет количество скрытых складов", () => {
  const locations = Array.from({ length: 13 }, (_, index) => ({
    id: `warehouse-${index}`,
    city: `Склад ${index}`,
    label: "ФФ",
  }));
  const quantities = Object.fromEntries(locations.map((location, index) => [location.id, index + 1]));

  assert.equal(summarizeActiveFbsLocations(locations.slice(0, 4), quantities, 2).hiddenLabel, "ещё 2 склада");
  assert.equal(summarizeActiveFbsLocations(locations, quantities, 2).hiddenLabel, "ещё 11 складов");
});

test("сводка активных FBS не выводит склады без заказов", () => {
  const summary = summarizeActiveFbsLocations([
    { id: "moscow", city: "Москва", label: "БИК ФФ" },
    { id: "spb", city: "Питер", label: "Rus ФФ" },
  ], { moscow: 0, spb: 0 }, 2);

  assert.deepEqual(summary.items, []);
  assert.equal(summary.hiddenCount, 0);
  assert.equal(summary.hiddenLabel, null);
  assert.equal(summary.activeLocationCount, 0);
});
