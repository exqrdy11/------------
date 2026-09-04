import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("RNP Ozon module is wired into Skladno", async () => {
  const [page, layout, pkg] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  ]);

  assert.match(page, /import RnpDashboard from "\.\/rnp-control\/RnpDashboard"/);
  assert.match(page, /\| "rnp"/);
  assert.match(page, />РНП Ozon<\/button>/);
  assert.match(page, /activeView === "rnp"/);
  assert.match(layout, /import "\.\/rnp-control\/rnp-control\.css"/);
  assert.equal(pkg.dependencies.fflate, "0.7.4");

  await Promise.all([
    access(new URL("app/rnp-control/RnpDashboard.tsx", root)),
    access(new URL("app/api/rnp/tasks/route.ts", root)),
    access(new URL("app/api/rnp/ozon/route.ts", root)),
    access(new URL("db/ozon-cache.ts", root)),
    access(new URL("lib/report-domain.mjs", root)),
  ]);
});
