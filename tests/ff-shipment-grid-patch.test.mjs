import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildShipmentGridPayload,
  createShipmentGridDraft,
  parseShipmentGridPaste,
  patchFfShipmentGrid,
} from "../ops/patch-ff-shipment-grid.mjs";

test("spreadsheet paste accepts a header and tab-separated article quantities", () => {
  assert.deepEqual(
    parseShipmentGridPaste("Артикул\tКоличество\nSKU-A\t12\nSKU-B\t3\n"),
    [
      { query: "SKU-A", quantity: 12 },
      { query: "SKU-B", quantity: 3 },
    ],
  );
});

test("draft editor clones only editable draft supplies and keeps product metadata", () => {
  const catalog = [
    { productKey: "sku:a", nmId: 101, sku: "SKU-A", name: "Товар A" },
  ];
  assert.equal(createShipmentGridDraft({ status: "in_transit", items: [] }, catalog), null);
  assert.deepEqual(
    [...createShipmentGridDraft({
      status: "draft",
      items: [{ productKey: "sku:a", nmId: 101, sku: "SKU-A", plannedQuantity: 7 }],
    }, catalog).values()],
    [{ productKey: "sku:a", nmId: 101, sku: "SKU-A", name: "Товар A", quantity: 7 }],
  );
});

test("draft editor payload contains the exact saved rows and quantities", () => {
  const items = new Map([
    ["sku:a", { productKey: "sku:a", nmId: 101, sku: "SKU-A", name: "Товар A", quantity: 12 }],
    ["sku:b", { productKey: "sku:b", nmId: 102, sku: "SKU-B", name: "Товар B", quantity: 3 }],
  ]);
  assert.deepEqual(buildShipmentGridPayload("draft-1", items), {
    shipmentId: "draft-1",
    items: [
      { productKey: "sku:a", nmId: 101, sku: "SKU-A", quantity: 12 },
      { productKey: "sku:b", nmId: 102, sku: "SKU-B", quantity: 3 },
    ],
  });
});

test("production client bundle receives the editable shipment grid once", async (t) => {
  const source = await readFile("/tmp/ff-analysis-app.shipments-sales.mjs", "utf8").catch(() => null);
  if (!source) return t.skip("production-shaped FF client bundle is not available");
  const patched = patchFfShipmentGrid(source);
  assert.match(patched, /data-ff-draft-grid/);
  assert.match(patched, /Артикул/);
  assert.match(patched, /Количество/);
  assert.match(patched, /Вставить из Excel \/ Google Sheets/);
  assert.match(patched, /data-action="save-shipment-grid"/);
  assert.equal(patchFfShipmentGrid(patched), patched);
});
