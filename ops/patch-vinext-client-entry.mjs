import { readFile, writeFile } from "node:fs/promises";

export function patchVinextClientEntry(input, oldPageAsset, newPageAsset) {
  const source = String(input ?? "");
  if (source.includes(newPageAsset) && !source.includes(oldPageAsset)) return source;
  if (!source.includes(oldPageAsset)) {
    throw new Error("Ссылка на старую страницу не найдена в клиентском index-бандле");
  }
  return source.replaceAll(oldPageAsset, newPageAsset);
}

async function main() {
  const [file, oldPageAsset, newPageAsset] = process.argv.slice(2);
  if (!file || !oldPageAsset || !newPageAsset) {
    throw new Error("Usage: node ops/patch-vinext-client-entry.mjs <file> <old-page> <new-page>");
  }
  const source = await readFile(file, "utf8");
  await writeFile(file, patchVinextClientEntry(source, oldPageAsset, newPageAsset));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
