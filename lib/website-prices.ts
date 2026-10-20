import * as XLSX from "xlsx";

export const websitePricesCsvUrl = "https://docs.google.com/spreadsheets/d/1wDVp8UoSb5ss9riElssaVKNkVe8hK4A-Uu4HIJEeEVU/export?format=csv&gid=1773354676";

function normalizedHeader(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/g, "");
}

function exactSku(value: unknown) {
  return String(value ?? "").trim();
}

function positivePrice(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/[\s  ₽]/g, "")
    .replace(",", ".");
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function parseWebsitePricesCsv(csv: string) {
  const workbook = XLSX.read(csv, { type: "string" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error("Google Sheets export has no worksheet");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false });
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizedHeader(cell) === "артикулwb"));
  if (headerIndex < 0) throw new Error("Google Sheets export has no WB SKU header");

  const headers = rows[headerIndex].map(normalizedHeader);
  const skuIndex = headers.indexOf("артикулwb");
  const websitePriceIndex = headers.indexOf("ценасайт");
  if (skuIndex < 0 || websitePriceIndex < 0) throw new Error("Google Sheets export has no required columns");

  const prices = new Map<string, number>();
  for (const row of rows.slice(headerIndex + 1)) {
    const sku = exactSku(row[skuIndex]);
    const price = positivePrice(row[websitePriceIndex]);
    if (sku && price !== null) prices.set(sku, price);
  }
  return prices;
}

export async function attachWebsitePrices<T extends { sku: string }>(
  rows: T[],
  fetcher: typeof fetch = fetch,
) {
  try {
    const response = await fetcher(websitePricesCsvUrl, {
      headers: { Accept: "text/csv" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const prices = parseWebsitePricesCsv(await response.text());
    return {
      rows: rows.map((row) => ({ ...row, websitePrice: prices.get(exactSku(row.sku)) ?? null })),
      warning: null,
    };
  } catch {
    return {
      rows: rows.map((row) => ({ ...row, websitePrice: null })),
      warning: "Не удалось загрузить цены сайта из Google Sheets.",
    };
  }
}
