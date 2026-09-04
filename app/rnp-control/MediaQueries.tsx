"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { aggregateMediaQueryRows, periodFromReportFilename } from "../../lib/report-domain.mjs";

type QueryRow = {
  campaignId: string;
  campaignName: string;
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  expense: number;
  sourceFile: string;
  importedAt: string;
};

type ParsedRow = Omit<QueryRow, "ctr" | "importedAt">;

type Props = {
  dateFrom: string;
  dateTo: string;
  reloadToken: number;
  onPeriodChange: (dateFrom: string, dateTo: string) => Promise<void>;
};

const API_HEADERS = { "ngrok-skip-browser-warning": "1" } as const;
const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 3_000;

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(response.ok ? "Сервер вернул неверный ответ" : text.slice(0, 180) || "Сервер временно недоступен");
  }
}

function xmlDocument(bytes: Uint8Array | undefined, filename: string) {
  if (!bytes) throw new Error("В Excel-файле нет " + filename);
  const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Не удалось прочитать " + filename);
  return document;
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function columnByAliases(headers: unknown[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  const wanted = aliases.map(normalizeHeader);
  return normalized.findIndex((header) => wanted.includes(header));
}

function reportColumns(headers: unknown[]) {
  return {
    campaignId: columnByAliases(headers, ["ID баннера", "ID рекламной кампании", "ID кампании"]),
    campaignName: columnByAliases(headers, ["Название", "Название кампании", "Название рекламной кампании"]),
    pageType: columnByAliases(headers, ["Тип страницы"]),
    conditionType: columnByAliases(headers, ["Тип условия"]),
    query: columnByAliases(headers, ["Запрос", "Поисковый запрос"]),
    impressions: columnByAliases(headers, ["Показы"]),
    clicks: columnByAliases(headers, ["Клики"]),
    cpm: columnByAliases(headers, ["Ср. стоимость 1000 показов, ₽", "Стоимость 1000 показов, ₽", "CPM"]),
    expense: columnByAliases(headers, ["Расход, ₽, с НДС", "Расход с НДС, ₽", "Расход, ₽", "Расход"]),
  };
}

function requiredColumnsFound(columns: ReturnType<typeof reportColumns>) {
  return [columns.campaignId, columns.campaignName, columns.query, columns.impressions, columns.clicks, columns.cpm, columns.expense]
    .every((value) => value >= 0);
}

function cellText(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.getElementsByTagName("is")[0]?.textContent ?? "";
  const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "str") return raw;
  const number = Number(raw);
  return raw !== "" && Number.isFinite(number) ? number : raw;
}

async function parseReport(file: File): Promise<{ rows: ParsedRow[]; period: ReturnType<typeof periodFromReportFilename> }> {
  if (!/\.xlsx$/iu.test(file.name)) throw new Error(file.name + ": нужен исходный файл Ozon в формате XLSX");
  if (file.size > MAX_FILE_BYTES) throw new Error(file.name + ": файл больше 20 МБ — выгрузите меньший период");
  const period = periodFromReportFilename(file.name);
  if (!period) throw new Error(file.name + ": в названии нет периода. Загружайте исходный файл Ozon без переименования");

  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const decoder = (path: string) => zip[path];
  const sharedStrings = decoder("xl/sharedStrings.xml")
    ? [...xmlDocument(decoder("xl/sharedStrings.xml"), "sharedStrings.xml").getElementsByTagName("si")]
      .map((item) => item.textContent ?? "")
    : [];
  const worksheetPaths = Object.keys(zip)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (!worksheetPaths.length) throw new Error("В файле " + file.name + " нет листов с данными");

  let rawRows: unknown[][] = [];
  let headerRowIndex = -1;
  let headers: unknown[] = [];
  let columns: ReturnType<typeof reportColumns> | null = null;
  for (const worksheetPath of worksheetPaths) {
    const sheet = xmlDocument(decoder(worksheetPath), worksheetPath);
    const candidateRows = [...sheet.getElementsByTagName("row")].map((row) => {
      const values: unknown[] = [];
      for (const cell of [...row.getElementsByTagName("c")]) {
        values[columnIndex(cell.getAttribute("r") ?? "")] = cellText(cell, sharedStrings);
      }
      return values;
    });
    const limit = Math.min(candidateRows.length, 30);
    for (let index = 0; index < limit; index += 1) {
      const candidateColumns = reportColumns(candidateRows[index] ?? []);
      if (!requiredColumnsFound(candidateColumns)) continue;
      rawRows = candidateRows;
      headerRowIndex = index;
      headers = candidateRows[index] ?? [];
      columns = candidateColumns;
      break;
    }
    if (columns) break;
  }
  if (!columns || headerRowIndex < 0) throw new Error(file.name + ": не найдены обязательные колонки отчёта «Показы и клики»");

  const nativeOzonMoney = normalizeHeader(headers[columns.cpm]).includes("ср стоимость 1000 показов")
    && normalizeHeader(headers[columns.expense]).includes("расход");
  const moneyDivider = nativeOzonMoney ? 100 : 1;

  const rows = rawRows.slice(headerRowIndex + 1).flatMap((values): ParsedRow[] => {
    const campaignName = String(values[columns.campaignName] ?? "").trim();
    const query = String(values[columns.query] ?? "").trim();
    const pageType = columns.pageType >= 0 ? String(values[columns.pageType] ?? "").trim() : "";
    const conditionType = columns.conditionType >= 0 ? String(values[columns.conditionType] ?? "").trim() : "";
    if (!campaignName || !query) return [];
    if (pageType && !/поиск/iu.test(pageType)) return [];
    if (conditionType && !/поисковый запрос/iu.test(conditionType)) return [];
    return [{
      campaignId: String(values[columns.campaignId] ?? campaignName).trim(),
      campaignName,
      query,
      impressions: Math.round(numberValue(values[columns.impressions])),
      clicks: Math.round(numberValue(values[columns.clicks])),
      cpm: numberValue(values[columns.cpm]) / moneyDivider,
      expense: numberValue(values[columns.expense]) / moneyDivider,
      sourceFile: file.name,
    }];
  });

  return { rows, period };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number) {
  return value.toFixed(2).replace(".", ",") + "%";
}

export default function MediaQueries({ dateFrom, dateTo, reloadToken, onPeriodChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState("all");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/rnp/media-queries?dateFrom=" + encodeURIComponent(dateFrom) + "&dateTo=" + encodeURIComponent(dateTo), { cache: "no-store", headers: API_HEADERS });
      const payload = await responseJson<{ rows?: QueryRow[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить ключи");
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить ключи");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRows(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRows, reloadToken]);

  const campaigns = useMemo(() => [...new Set(rows.map((row) => row.campaignName))].sort((left, right) => left.localeCompare(right, "ru")), [rows]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => (campaign === "all" || row.campaignName === campaign)
      && (!needle || (row.query + " " + row.campaignName).toLocaleLowerCase("ru-RU").includes(needle)));
  }, [rows, search, campaign]);
  const totals = useMemo(() => filteredRows.reduce((sum, row) => ({
    impressions: sum.impressions + row.impressions,
    clicks: sum.clicks + row.clicks,
    expense: sum.expense + row.expense,
  }), { impressions: 0, clicks: 0, expense: 0 }), [filteredRows]);
  const totalCtr = totals.impressions ? totals.clicks / totals.impressions * 100 : 0;
  const totalCpm = totals.impressions ? totals.expense / totals.impressions * 1_000 : 0;

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length > MAX_FILES) {
      setMessage("За один раз можно выбрать до " + MAX_FILES + " файлов.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setImporting(true);
    setMessage("");
    try {
      const parsed: Awaited<ReturnType<typeof parseReport>>[] = [];
      for (let index = 0; index < files.length; index += 1) {
        setMessage("Проверяю файл " + (index + 1) + " из " + files.length + "…");
        parsed.push(await parseReport(files[index]));
      }
      const detectedPeriods = parsed.flatMap((report) => report.period ? [report.period] : []);
      const detectedPeriod = detectedPeriods[0];
      if (detectedPeriod && detectedPeriods.some((period) => period.dateFrom !== detectedPeriod.dateFrom || period.dateTo !== detectedPeriod.dateTo)) {
        throw new Error("Выбранные Excel-файлы созданы за разные периоды");
      }
      if (!detectedPeriod) throw new Error("Не удалось определить период отчёта по названию файла");
      const importDateFrom = detectedPeriod.dateFrom;
      const importDateTo = detectedPeriod.dateTo;
      const importedRows = aggregateMediaQueryRows(parsed.flatMap((report) => report.rows));
      if (!importedRows.length) throw new Error("В файлах не нашли поисковые запросы");
      const campaignRows = new Map<string, ParsedRow[]>();
      for (const row of importedRows) {
        const list = campaignRows.get(row.campaignId) ?? [];
        list.push(row);
        campaignRows.set(row.campaignId, list);
      }
      const chunks = [...campaignRows.values()].flatMap((rows) => {
        const result: Array<{ rows: ParsedRow[]; replaceCampaigns: boolean }> = [];
        for (let index = 0; index < rows.length; index += UPLOAD_CHUNK_SIZE) {
          result.push({ rows: rows.slice(index, index + UPLOAD_CHUNK_SIZE), replaceCampaigns: index === 0 });
        }
        return result;
      });
      let savedRows = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        setMessage("Загружаю данные: часть " + (index + 1) + " из " + chunks.length + "…");
        const response = await fetch("/api/rnp/media-queries", {
          method: "POST",
          headers: { ...API_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateFrom: importDateFrom,
            dateTo: importDateTo,
            rows: chunks[index].rows,
            replaceCampaigns: chunks[index].replaceCampaigns,
          }),
        });
        const payload = await responseJson<{ rows?: number; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "Не удалось импортировать часть " + (index + 1));
        savedRows += payload.rows ?? 0;
      }
      if (importDateFrom !== dateFrom || importDateTo !== dateTo) {
        await onPeriodChange(importDateFrom, importDateTo);
      } else {
        await loadRows();
      }
      setMessage("Готово: " + savedRows + " запросов из " + campaignRows.size + " РК за " + importDateFrom + " — " + importDateTo + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось импортировать Excel");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="queries-layout">
      <div className="query-note">
        <span className="query-note-icon">Я</span>
        <div>
          <h2>Ключи из отчёта «Показы и клики»</h2>
          <p>Загружайте исходный XLSX из Ozon без переименования и ручного редактирования. Один файл — одна медийная РК; можно выбрать до 30 файлов за одинаковый период. Перед сохранением сайт проверит даты и обязательные колонки.</p>
        </div>
        <label className="query-upload-button">
          {importing ? "Проверяю и загружаю…" : "Загрузить XLSX Ozon"}
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple disabled={importing} onChange={(event) => void importFiles(event.target.files)} />
        </label>
      </div>

      {message && <div className="query-message">{message}</div>}

      <div className="query-kpis">
        <div><span>Поисковых запросов</span><strong>{formatNumber(filteredRows.length)}</strong></div>
        <div><span>Показы / клики</span><strong>{formatNumber(totals.impressions)} / {formatNumber(totals.clicks)}</strong></div>
        <div><span>CTR / CPM</span><strong>{formatPercent(totalCtr)} / {formatMoney(totalCpm)}</strong></div>
      </div>

      <section className="query-results-card">
        <div className="query-results-toolbar">
          <div><h2>Запросы по рекламным кампаниям</h2><span>{dateFrom} — {dateTo} · {campaigns.length} РК</span></div>
          <div className="query-filters">
            <select value={campaign} onChange={(event) => setCampaign(event.target.value)} aria-label="Рекламная кампания">
              <option value="all">Все кампании</option>
              {campaigns.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
            <label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Запрос или РК" /></label>
          </div>
        </div>
        <div className="query-table-wrap">
          <table className="query-table">
            <thead><tr><th>Запрос</th><th>Рекламная кампания</th><th>Показы</th><th>Клики</th><th>CTR</th><th>CPM</th><th>Расход</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="query-empty">Загружаем ключи…</td></tr>}
              {!loading && !filteredRows.length && <tr><td colSpan={7} className="query-empty">За этот период отчёты ещё не загружены.</td></tr>}
              {filteredRows.map((row) => (
                <tr key={row.campaignId + ":" + row.query}>
                  <td><strong>{row.query}</strong></td>
                  <td><strong>{row.campaignName}</strong><span className="query-campaign-id">№ {row.campaignId}</span></td>
                  <td>{formatNumber(row.impressions)}</td>
                  <td>{formatNumber(row.clicks)}</td>
                  <td>{formatPercent(row.ctr)}</td>
                  <td>{formatMoney(row.cpm)}</td>
                  <td>{formatMoney(row.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
