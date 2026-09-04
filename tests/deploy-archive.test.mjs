import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDeployArchive } from "../ops/create-deploy-archive.mjs";

test("deployment archive excludes macOS metadata that Wrangler would parse as JavaScript", () => {
  const root = mkdtempSync(join(tmpdir(), "skladno-deploy-"));
  const sourceDir = join(root, "source");
  const archivePath = join(root, "release.tgz");

  mkdirSync(join(sourceDir, "dist", "server"), { recursive: true });
  writeFileSync(join(sourceDir, "dist", "server", "index.js"), "export default {};\n");
  writeFileSync(join(sourceDir, "dist", "server", "._index.js"), "APPLEDOUBLE");
  writeFileSync(join(sourceDir, ".DS_Store"), "metadata");

  createDeployArchive({ sourceDir, archivePath });

  const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
    .trim()
    .split("\n");

  assert(entries.some((entry) => entry.endsWith("dist/server/index.js")));
  assert.equal(entries.some((entry) => /(^|\/)\._/.test(entry)), false);
  assert.equal(entries.some((entry) => entry.endsWith(".DS_Store")), false);
});
