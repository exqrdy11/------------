import { readFile, writeFile } from "node:fs/promises";

const MARKER = "Выбранные даты показывают факт";
const code = (value) => value.replaceAll("\\${", "${");

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

export function patchFfForecastClient(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return source;

  source = replaceRequired(
    source,
    /const RISK_LABELS = \{[\s\S]*?\};/,
    (block) => `${block}\nconst CONFIDENCE_LABELS = { high: "высокая", medium: "средняя", low: "низкая" };`,
    "подписи риска",
  );

  source = replaceRequired(
    source,
    /<td data-label="Продажи">\$\{formatNumber\(row\.sales\)\}<\/td>\s*<td data-label="Среднее в день">\$\{formatNumber\(row\.averageDailySales\)\}<\/td>/,
    code(String.raw`<td data-label="Выкуплено">\${formatNumber(row.sales)}<small>Факт выбранного периода</small></td>
    <td data-label="Прогноз в день"><strong>\${formatNumber(row.forecastDailySales)}</strong><small>7д \${formatNumber(row.windowRates?.[7])} · 14д \${formatNumber(row.windowRates?.[14])} · 28д \${formatNumber(row.windowRates?.[28])}</small><small>Надёжность: \${CONFIDENCE_LABELS[row.confidence] ?? CONFIDENCE_LABELS.low}</small></td>`),
    "метрики строки SKU",
  );

  source = replaceRequired(
    source,
    /<article><span>Продано за период<\/span><strong>\$\{formatNumber\(totals\.sales\)\}<\/strong><\/article>\s*<article><span>Среднее в день<\/span><strong>\$\{formatNumber\(totals\.averageDailySales\)\}<\/strong><\/article>/,
    code(String.raw`<article><span>Выкуплено по заказам периода</span><strong>\${formatNumber(totals.sales)}</strong><small>Факт: \${formatNumber(totals.reportAverageDailySales)} шт./день</small></article>
    <article><span>Прогноз в день</span><strong>\${formatNumber(totals.forecastDailySales ?? totals.averageDailySales)}</strong><small>7д \${formatNumber(totals.windowRates?.[7])} · 14д \${formatNumber(totals.windowRates?.[14])} · 28д \${formatNumber(totals.windowRates?.[28])}</small></article>`),
    "итоги факта и прогноза",
  );

  source = replaceRequired(
    source,
    /(analysis = buildWarehouseAnalysis\(\{[\s\S]*?\n\s*to: input\.to,)/,
    `$1\n      asOf: new Date(planning.updatedAt).toISOString().slice(0, 10),\n      openedAt: selectedWarehouse.openedAt,`,
    "параметры анализа",
  );

  source = replaceRequired(
    source,
    /<th>Продажи<\/th><th>Среднее в день<\/th>/,
    "<th>Выкуплено</th><th>Прогноз в день</th>",
    "заголовки таблицы",
  );

  source = replaceRequired(
    source,
    /(\$\{renderMessages\(model\)\}\s*)(\$\{analysis\})/,
    `$1<section class="ff-analysis-method" role="note"><strong>${MARKER}.</strong><span>Рекомендация считается отдельно: медиана темпов 7/14/28 дней, свежие FBS-заказы скорректированы по доле выкупа зрелых заказов; текущий неполный день и дни до открытия ФФ исключены.</span></section>\n    $2`,
    "пояснение методики",
  );

  source = replaceRequired(
    source,
    /function ensureStylesheet\(\) \{[\s\S]*?document\.head\.append\(link\);\s*\}/,
    `function ensureStylesheet() {
  const href = "/assets/ff-analysis.css?v=20260831-robust1";
  const existing = document.querySelector("link[data-ff-analysis-style]");
  if (existing) {
    if (!existing.href.endsWith(href)) existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.ffAnalysisStyle = "";
  document.head.append(link);
}`,
    "версия стилей анализа",
  );

  return source;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажите путь к ff-analysis-app.mjs");
  const source = await readFile(file, "utf8");
  await writeFile(file, patchFfForecastClient(source));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
