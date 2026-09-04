"use client";

import { useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { campaignRowsFromMatrix, periodFromReportFilename, type CatalogProduct } from "../../lib/report-domain.mjs";

type Props = {
  exact: boolean;
  sourceFiles: string[];
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

export default function CampaignReportUpload({ exact, sourceFiles, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function importFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage("Проверяю структуру файла Ozon…");
    try {
      if (!/\.xlsx$/iu.test(file.name)) throw new Error("Нужен исходный XLSX Ozon");
      if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 20 МБ — выгрузите меньший период");
      const period = periodFromReportFilename(file.name);
      if (!period) throw new Error("Период не найден в названии. Не переименовывайте исходный файл Ozon");

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
      setMessage("Сохраняю " + rows.length + " кампаний…");
      const response = await fetch("/api/rnp/campaign-reports", {
        method: "POST",
        headers: { ...API_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, rows }),
      });
      const payload = await responseJson<{ campaigns?: number; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить отчёт");
      await onImported(period.dateFrom, period.dateTo);
      setMessage("Загружено: " + (payload.campaigns ?? rows.length) + " кампаний за " + period.dateFrom + " — " + period.dateTo + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось импортировать Excel");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className={"campaign-import-card " + (exact ? "reconciled" : "pending")}>
      <div className="campaign-import-copy">
        <span className="campaign-import-icon">X</span>
        <div>
          <strong>{exact ? "Итоги сверены с XLSX Ozon" : "Загрузите контрольный отчёт Ozon"}</strong>
          <p>{exact ? "Показатели за период берутся из «Статистики по кампаниям», а не восстанавливаются по текущему списку РК." : "Файл campaign_statistics за выбранный период исправит итоги и вернёт остановленные или переименованные кампании в историю."}</p>
          {sourceFiles.length > 0 && <small>{sourceFiles.join(", ")}</small>}
          {message && <small className="campaign-import-message">{message}</small>}
        </div>
      </div>
      <label className="campaign-upload-button">
        {uploading ? "Загружаю…" : exact ? "Заменить XLSX" : "Загрузить XLSX"}
        <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={uploading} onChange={(event) => void importFile(event.target.files?.[0])} />
      </label>
    </section>
  );
}
