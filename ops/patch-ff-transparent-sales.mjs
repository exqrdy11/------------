import { readFile, writeFile } from "node:fs/promises";

const MARKER = "Факт продаж в день";

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Фрагмент «${label}» не найден в клиентском бандле`);
  return next;
}

export function patchFfTransparentSales(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return source;

  source = replaceRequired(
    source,
    /<td data-label="Выкуплено">\$\{formatNumber\(row\.sales\)\}<small>Факт выбранного периода<\/small><\/td>\s*<td data-label="Прогноз в день"><strong>\$\{formatNumber\(row\.forecastDailySales\)\}<\/strong>/,
    `<td data-label="Продажи за период">\${formatNumber(row.sales)}<small>Учтено: \${formatNumber(row.reportDays)} календарных дн.</small></td>
    <td data-label="Факт продаж в день"><strong>\${formatNumber(row.reportAverageDailySales)} шт./день</strong><small>\${formatNumber(row.sales)} ÷ \${formatNumber(row.reportDays)} дн.</small></td>
    <td data-label="Расчётный темп"><strong>\${formatNumber(row.forecastDailySales)}</strong>`,
    "фактические продажи SKU в день",
  );

  source = replaceRequired(
    source,
    /<article><span>Выкуплено по заказам периода<\/span><strong>\$\{formatNumber\(totals\.sales\)\}<\/strong><small>Факт: \$\{formatNumber\(totals\.reportAverageDailySales\)\} шт\.\/день<\/small><\/article>\s*<article><span>Прогноз в день<\/span><strong>/,
    `<article><span>Продажи за период</span><strong>\${formatNumber(totals.sales)} шт.</strong><small>Учтено: \${formatNumber(totals.reportDays)} календарных дн.</small></article>
    <article><span>${MARKER}</span><strong>\${formatNumber(totals.reportAverageDailySales)} шт./день</strong><small>\${formatNumber(totals.sales)} ÷ \${formatNumber(totals.reportDays)} дн.</small></article>
    <article><span>Расчётный темп</span><strong>`,
    "итоговая формула продаж в день",
  );

  source = replaceRequired(
    source,
    /<th>Выкуплено<\/th><th>Прогноз в день<\/th>/,
    "<th>Продажи за период</th><th>Факт в день</th><th>Расчётный темп</th>",
    "заголовки прозрачных метрик",
  );

  source = replaceRequired(
    source,
    /(totals:\s*\{\s*\.\.\.analysis\.totals,\s*)(averageDailySales: allRows\.reduce)/,
    `$1reportDays: Math.max(0, ...allRows.map((row) => finiteInteger(row.reportDays, 0, 0))),
      $2`,
    "число учтённых дней",
  );

  return source;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажите путь к ff-analysis-app.mjs");
  const source = await readFile(file, "utf8");
  await writeFile(file, patchFfTransparentSales(source));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
