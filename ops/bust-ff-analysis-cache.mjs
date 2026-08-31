import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [distRoot, version = "snapshot1"] = process.argv.slice(2);

if (!distRoot) {
  console.error("Usage: node ops/bust-ff-analysis-cache.mjs <dist-root> [version]");
  process.exit(1);
}

const assetsDir = path.join(distRoot, "client", "assets");
const renames = new Map([
  ["page-B4VqAw2G-layout2.js", `page-B4VqAw2G-${version}.js`],
  ["index-xxMS78ko-layout2.js", `index-xxMS78ko-${version}.js`],
  [
    "layout-segment-context-BWcNNTxA-layout2.js",
    `layout-segment-context-BWcNNTxA-${version}.js`,
  ],
]);

for (const [sourceName, targetName] of renames) {
  await cp(path.join(assetsDir, sourceName), path.join(assetsDir, targetName));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(fullPath)));
    else if (entry.isFile() && fullPath.endsWith(".js")) files.push(fullPath);
  }

  return files;
}

const copiedTargets = new Set(
  [...renames.values()].map((name) => path.join(assetsDir, name)),
);
const serverFiles = (await listFiles(path.join(distRoot, "server"))).filter((file) => {
  const name = path.basename(file);
  return name === "index.js" || name === "__vite_rsc_assets_manifest.js";
});

for (const file of [...copiedTargets, ...serverFiles]) {
  let source = await readFile(file, "utf8");
  for (const [oldName, newName] of renames) {
    source = source.replaceAll(oldName, newName);
  }
  source = source.replaceAll(
    "ff-analysis-app.mjs?v=20260830-layout2",
    `ff-analysis-app.mjs?v=${version}`,
  );
  await writeFile(file, source);
}

console.log(`FF analysis assets cache-busted with version ${version}`);
