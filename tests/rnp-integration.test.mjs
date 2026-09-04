import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Media advertising Ozon module is wired into Skladno", async () => {
  const [page, layout, dashboard, envExample, pkg] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/rnp-control/RnpDashboard.tsx", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  ]);

  assert.match(page, /import RnpDashboard from "\.\/rnp-control\/RnpDashboard"/);
  assert.match(page, /\| "rnp"/);
  assert.match(page, />Медийная реклама<\/button>/);
  assert.match(page, /activeView === "rnp"/);
  assert.match(dashboard, /<strong>Медийная реклама<\/strong>/);
  assert.match(layout, /import "\.\/rnp-control\/rnp-control\.css"/);
  assert.equal(pkg.dependencies.fflate, "0.7.4");

  for (const key of [
    "OZON_PERFORMANCE_CLIENT_ID",
    "OZON_PERFORMANCE_CLIENT_SECRET",
    "OZON_SELLER_CLIENT_ID",
    "OZON_SELLER_API_KEY",
  ]) {
    assert.match(envExample, new RegExp(`^${key}=`, "m"));
  }

  await Promise.all([
    access(new URL("app/rnp-control/RnpDashboard.tsx", root)),
    access(new URL("app/api/rnp/tasks/route.ts", root)),
    access(new URL("app/api/rnp/ozon/route.ts", root)),
    access(new URL("db/ozon-cache.ts", root)),
    access(new URL("lib/report-domain.mjs", root)),
  ]);
});
