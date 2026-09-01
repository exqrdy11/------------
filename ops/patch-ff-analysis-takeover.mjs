import { readFile, writeFile } from "node:fs/promises";

const BUILD = "20260901-grid3";
const MARKER = `const FF_ANALYSIS_BUILD = "${BUILD}";`;

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

export function patchFfAnalysisTakeover(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return source;

  source = replaceRequired(
    source,
    /^((?:import[^\n]*\n)+)/,
    `$1\n${MARKER}\n`,
    "версия клиентского модуля",
  );

  source = replaceRequired(
    source,
    `if (navigation.dataset.ffAnalysisNavigationBound === "true") return () => {};
  navigation.dataset.ffAnalysisNavigationBound = "true";`,
    `if (navigation.dataset.ffAnalysisNavigationBuild === FF_ANALYSIS_BUILD) return () => {};
  navigation.dataset.ffAnalysisNavigationBound = "true";
  navigation.dataset.ffAnalysisNavigationBuild = FF_ANALYSIS_BUILD;`,
    "версионная привязка навигации",
  );

  source = replaceRequired(
    source,
    `delete navigation.dataset.ffAnalysisNavigationBound;`,
    `delete navigation.dataset.ffAnalysisNavigationBound;
    if (navigation.dataset.ffAnalysisNavigationBuild === FF_ANALYSIS_BUILD) {
      delete navigation.dataset.ffAnalysisNavigationBuild;
    }`,
    "очистка привязки навигации",
  );

  source = replaceRequired(
    source,
    `let root = shell.mountHost.querySelector("[data-ff-analysis-root]");
  const isNewRoot = !root;
  if (!root) {`,
    `let root = shell.mountHost.querySelector("[data-ff-analysis-root]");
  let isNewRoot = !root;
  if (root && root.dataset.ffAnalysisBuild !== FF_ANALYSIS_BUILD) {
    const freshRoot = document.createElement("div");
    freshRoot.dataset.ffAnalysisRoot = "";
    freshRoot.className = "ff-analysis-host";
    freshRoot.hidden = true;
    root.replaceWith(freshRoot);
    root = freshRoot;
    isNewRoot = true;
  }
  if (!root) {`,
    "перехват старого корня анализа",
  );

  source = replaceRequired(
    source,
    /(\s+shell\.mountHost\.append\(root\);\n\s+}\n)(\s+if )/,
    `$1  root.dataset.ffAnalysisBuild = FF_ANALYSIS_BUILD;\n$2`,
    "метка новой версии корня",
  );

  return source;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажите путь к ff-analysis-app.mjs");
  const source = await readFile(file, "utf8");
  await writeFile(file, patchFfAnalysisTakeover(source));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
