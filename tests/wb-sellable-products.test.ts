import assert from "node:assert/strict";
import test from "node:test";

import { isCurrentWbSellableSnapshot, sellableWbProductIds, sellableWbProductIdsFromSnapshot, selectSellableWbCards } from "../lib/wb-sellable-products.ts";

test("WB catalogue keeps only cards with the exact normalized tag «продаем»", () => {
  const cards = [
    { nmID: 101, vendorCode: "SELL-1", tags: [{ id: 1, name: "продаем", color: "D1CFD7" }] },
    { nmID: 102, vendorCode: "SELL-2", tags: [{ id: 2, name: "  ПРОДАЕМ  ", color: "FEE7B0" }] },
    { nmID: 103, vendorCode: "OLD", tags: [{ id: 3, name: "не продаем", color: "E7E7E7" }] },
    { nmID: 104, vendorCode: "EMPTY", tags: [] },
    { nmID: 105, vendorCode: "OTHER", tags: [{ id: 4, name: "продаем позже", color: "E7E7E7" }] },
  ];

  assert.deepEqual(selectSellableWbCards(cards).map((card) => card.nmID), [101, 102]);
  assert.deepEqual([...sellableWbProductIds(cards)], [101, 102]);
});

test("WB catalogue fails closed when no card has the «продаем» tag", () => {
  const cards = [
    { nmID: 201, tags: [{ id: 1, name: "архив", color: "D1CFD7" }] },
    { nmID: 202 },
  ];

  assert.deepEqual(selectSellableWbCards(cards), []);
  assert.deepEqual([...sellableWbProductIds(cards)], []);
});

test("old unfiltered inventory snapshots cannot restore products without the «продаем» tag", () => {
  const oldSnapshot = { rows: [{ nmId: 301 }, { nmId: 302 }] };
  const filteredSnapshot = {
    productFilter: { marketplace: "wb", tag: "продаем", version: 1 },
    rows: [{ nmId: 301 }, { nmId: null }, { nmId: 302 }],
  };

  assert.equal(isCurrentWbSellableSnapshot(oldSnapshot), false);
  assert.deepEqual([...sellableWbProductIdsFromSnapshot(oldSnapshot)], []);
  assert.equal(isCurrentWbSellableSnapshot(filteredSnapshot), true);
  assert.deepEqual([...sellableWbProductIdsFromSnapshot(filteredSnapshot)], [301, 302]);
});
