"use client";

import { useEffect, useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { campaignRowsFromMatrix, campaignReportImportPeriod } from "../../lib/report-domain.mjs";
import type { CatalogProduct } from "../../lib/report-domain";

type Props = {
  exact: boolean;
  sourceFiles: string[];
  dateFrom: string;
  dateTo: string;
  reports: Array<{ dateFrom: string; dateTo: string; sourceFile: string; importedAt: string; campaigns: number }>;
  onDeleted: () => Promise<void>;
  onImported: (dateFrom: string, dateTo: string) => Promise<void>;
};

const API_HEADERS = { "ngrok-skip-browser-warning": "1" } as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

function cellValue(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.getElementsByTagName("is")[0]?.textContent ?? "";
  const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "str") return raw;
  const number = Number(raw);
  return raw !== "" && Number.isFinite(number) ? number : raw;
}

function workbookMatrices(fileBytes: Uint8Array) {
  const zip = unzipSync(fileBytes);
  const sharedStrings = zip["xl/sharedStrings.xml"]
    ? [...xmlDocument(zip["xl/sharedStrings.xml"], "sharedStrings.xml").getElementsByTagName("si")]
      .map((item) => item.textContent ?? "")
    : [];
  return Object.keys(zip)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((path) => [...xmlDocument(zip[path], path).getElementsByTagName("row")].map((row) => {
      const values: unknown[] = [];
      for (const cell of [...row.getElementsByTagName("c")]) {
        values[columnIndex(cell.getAttribute("r") ?? "")] = cellValue(cell, sharedStrings);
      }
      return values;
    }));
}

async function responseJson<T>(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 180) || "Сервер вернул неверный ответ");
  }
}

export default function CampaignReportUpload({ exact, sourceFiles, dateFrom, dateTo, reports, onDeleted, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ name: string; rows: ReturnType<typeof campaignRowsFromMatrix> } | null>(null);
  const [period, setPeriod] = useState({ dateFrom, dateTo });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setConfirmDelete(false); setMessage(""); }, [dateFrom, dateTo]);

  async function deleteReport() {
    if (uploading) return;
    setUploading(true);
    try {
      const response = await fetch("/api/rnp/campaign-reports", {
        method: "DELETE", headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const payload = await responseJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить отчёт");
      setConfirmDelete(false);
      await onDeleted();
      setMessage("Отчёт убран из расчётов. Данные API и другие периоды не изменены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить отчёт");
    } finally { setUploading(false); }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setPending(null);
    setUploading(true);
    setMessage("Проверяю структуру файла Ozon…");
    try {
      if (!/\.xlsx$/iu.test(file.name)) throw new Error("Нужен исходный XLSX Ozon");
      if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 20 МБ — выгрузите меньший период");
      setPeriod(campaignReportImportPeriod(file.name, { dateFrom, dateTo }) ?? { dateFrom: "", dateTo: "" });

      let products: CatalogProduct[] = [];
      try {
        const productsResponse = await fetch("/api/rnp/ozon/products", { cache: "no-store", headers: API_HEADERS });
        const productsPayload = await responseJson<{ products?: CatalogProduct[] }>(productsResponse);
        if (productsResponse.ok && Array.isArray(productsPayload.products)) products = productsPayload.products;
      } catch {
        // Импорт статистики не блокируется: несопоставленные РК попадут в отдельную группу.
      }

      const matrices = workbookMatrices(new Uint8Array(await file.arrayBuffer()));
      const rows = matrices.flatMap((matrix) => campaignRowsFromMatrix(matrix, file.name, products));
      if (!rows.length) throw new Error("Не найдены колонки отчёта «Статистика по кампаниям»");
      setPending({ name: file.name, rows });
      setMessage("Найдено кампаний: " + rows.length + ". Подтвердите период перед сохранением.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать Excel");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function saveReport() {
    if (!pending || uploading) return;
    const confirmedPeriod = campaignReportImportPeriod("", period);
    if (!confirmedPeriod) {
      setMessage("Укажите корректные даты: начало периода не должно быть позже окончания.");
      return;
    }
    const { rows } = pending;
    setUploading(true);
    try {
      setMessage("Сохраняю " + rows.length + " кампаний…");
      const response = await fetch("/api/rnp/campaign-reports", {
        method: "POST",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ ...confirmedPeriod, rows }),
      });
      const payload = await responseJson<{ campaigns?: number; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить отчёт");
      setPending(null);
      setMessage("Загружено: " + (payload.campaigns ?? rows.length) + " кампаний за " + confirmedPeriod.dateFrom + " — " + confirmedPeriod.dateTo + ".");
      try {
        await onImported(confirmedPeriod.dateFrom, confirmedPeriod.dateTo);
      } catch {
        setMessage("Отчёт сохранён, но обновить экран не удалось. Обновите страницу.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось импортировать Excel");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={"campaign-import-card " + (exact ? "reconciled" : "pending")}>
      <div className="campaign-import-copy">
        <span className="campaign-import-icon">X</span>
        <div>
          <strong>{exact ? "Источник: загруженный Excel Ozon" : "Отчёты Excel Ozon"}</strong>
          <p>{exact ? "Итоги взяты из файла. Это не подтверждение совпадения с API. В сводном файле нет разбивки по дням — показываем итог за весь период." : "Загрузите исходный XLSX «Статистика по кампаниям» из Ozon. Переименовывать файл не нужно — период можно указать перед сохранением."}</p>
          {sourceFiles.length > 0 && <small>{sourceFiles.join(", ")}</small>}
          {message && <small className="campaign-import-message" role="status">{message}</small>}
        </div>
      </div>
      <label className="campaign-upload-button">
        {uploading ? "Загружаю…" : exact ? "Заменить XLSX" : "Загрузить XLSX"}
        <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={uploading} onChange={(event) => void importFile(event.target.files?.[0])} />
      </label>
      {exact && <button type="button" className="campaign-upload-button report-delete-button" disabled={uploading} onClick={() => setConfirmDelete(true)}>Удалить отчёт</button>}
      {reports.length > 0 && <label className="saved-report-picker">Сохранённые отчёты
        <select value={exact ? dateFrom + ":" + dateTo : ""} disabled={uploading} onChange={event => {
          const selected = reports.find(report => report.dateFrom + ":" + report.dateTo === event.target.value);
          if (selected) void onImported(selected.dateFrom, selected.dateTo);
        }}>
          <option value="" disabled>Выберите отчёт</option>
          {reports.map(report => <option key={report.dateFrom + ":" + report.dateTo} value={report.dateFrom + ":" + report.dateTo}>{report.dateFrom} — {report.dateTo} · {report.campaigns} РК · {report.sourceFile}</option>)}
        </select>
      </label>}
      {confirmDelete && <div className="campaign-import-confirm" role="alert">
        <p>Убрать отчёт за {dateFrom} — {dateTo} из расчётов? Другие периоды и API останутся без изменений.</p>
        <button type="button" className="campaign-upload-button report-delete-button" disabled={uploading} onClick={() => void deleteReport()}>Да, удалить отчёт</button>
        <button type="button" className="campaign-upload-button" disabled={uploading} onClick={() => setConfirmDelete(false)}>Не удалять</button>
      </div>}
      {pending && (
        <form className="campaign-import-confirm" onSubmit={(event) => { event.preventDefault(); void saveReport(); }}>
          <div className="campaign-import-confirm-copy">
            <strong>{pending.name}</strong>
            <p>Укажите тот же период, который выбрали в Ozon при выгрузке. Если в названии нет двух дат, подставлен период экрана — проверьте его. Отчёт за эти даты будет заменён.</p>
          </div>
          <label>С<input aria-label="Начало периода отчёта" type="date" required value={period.dateFrom} max={period.dateTo || undefined} disabled={uploading} onChange={(event) => setPeriod({ ...period, dateFrom: event.target.value })} /></label>
          <label>По<input aria-label="Конец периода отчёта" type="date" required value={period.dateTo} min={period.dateFrom || undefined} disabled={uploading} onChange={(event) => setPeriod({ ...period, dateTo: event.target.value })} /></label>
          <button className="campaign-upload-button" type="submit" disabled={uploading}>{uploading ? "Сохраняю…" : "Сохранить отчёт"}</button>
          <button className="campaign-upload-button" type="button" disabled={uploading} onClick={() => { setPending(null); setMessage(""); }}>Отмена</button>
        </form>
      )}
    </section>
  );
}
