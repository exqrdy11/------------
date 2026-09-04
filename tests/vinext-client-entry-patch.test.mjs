import assert from "node:assert/strict";
import test from "node:test";

import { patchVinextClientEntry } from "../ops/patch-vinext-client-entry.mjs";

const oldPage = "assets/page-B4VqAw2G-20260831-snapshot1.js";
const newPage = "assets/page-B4VqAw2G-20260901-grid4.js";

test("client entry loads the current page bundle instead of the stale snapshot", () => {
  const source = `const deps=["${oldPage}","assets/vendor.js"];`;

  const patched = patchVinextClientEntry(source, oldPage, newPage);

  assert.equal(patched, `const deps=["${newPage}","assets/vendor.js"];`);
  assert.doesNotMatch(patched, /20260831-snapshot1/);
});

test("client entry patch is idempotent after the current page is installed", () => {
  const source = `const deps=["${newPage}"];`;

  assert.equal(patchVinextClientEntry(source, oldPage, newPage), source);
});

test("client entry patch rejects an unrelated bundle", () => {
  assert.throws(
    () => patchVinextClientEntry('const deps=["assets/vendor.js"];', oldPage, newPage),
    /Ссылка на старую страницу не найдена/,
  );
});
