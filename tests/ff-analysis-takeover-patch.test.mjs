import assert from "node:assert/strict";
import test from "node:test";

import { patchFfAnalysisTakeover } from "../ops/patch-ff-analysis-takeover.mjs";

const productionShape = `import { helper } from "./helper.mjs";

function adaptNavigation(navigation) {
  sync();
  if (navigation.dataset.ffAnalysisNavigationBound === "true") return () => {};
  navigation.dataset.ffAnalysisNavigationBound = "true";
  return () => {
    delete navigation.dataset.ffAnalysisNavigationBound;
  };
}

export async function mountFfAnalysis() {
  ensureStylesheet();
  const shell = await waitForAuthenticatedShell();
  if (activeShell?.mountHost !== shell.mountHost) {
    activeShell?.cleanup();
    activeShell = null;
  }
  let root = shell.mountHost.querySelector("[data-ff-analysis-root]");
  const isNewRoot = !root;
  if (!root) {
    root = document.createElement("div");
    root.dataset.ffAnalysisRoot = "";
    root.className = "ff-analysis-host";
    root.hidden = true;
    shell.mountHost.append(root);
  }
  if (isNewRoot) loadSavedAnalysis(root);
  return root;
}
`;

test("new FF analysis build takes over stale DOM and navigation bindings", () => {
  const patched = patchFfAnalysisTakeover(productionShape);

  assert.match(patched, /const FF_ANALYSIS_BUILD = "20260901-grid3";/);
  assert.match(patched, /root\.dataset\.ffAnalysisBuild !== FF_ANALYSIS_BUILD/);
  assert.match(patched, /root\.replaceWith\(freshRoot\)/);
  assert.match(patched, /root\.dataset\.ffAnalysisBuild = FF_ANALYSIS_BUILD/);
  assert.match(patched, /ffAnalysisNavigationBuild === FF_ANALYSIS_BUILD/);
  assert.match(patched, /navigation\.dataset\.ffAnalysisNavigationBuild = FF_ANALYSIS_BUILD/);
});

test("FF analysis takeover patch is idempotent", () => {
  const patched = patchFfAnalysisTakeover(productionShape);
  assert.equal(patchFfAnalysisTakeover(patched), patched);
});
