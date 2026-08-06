import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type WbCard = {
  nmID?: number;
  nmId?: number;
  vendorCode?: string;
  title?: string;
  subjectName?: string;
  sizes?: Array<{ chrtID?: number; chrtId?: number }>;
};

type WbOrder = {
  id: number;
  nmId?: number;
  chrtId?: number;
  article?: string;
  supplyId?: string;
  createdAt?: string;
};

type OrderStatus = { id: number; supplierStatus?: string; wbStatus?: string };

type DashboardRow = {
  key: string;
  sku: string;
  nmId: number | null;
  name: string;
  category: string;
  color: string;
  warehouses: Record<string, number>;
  fbs: number;
  receiving: number;
  toSale: number;
  status: "В норме" | "Мало" | "Заканчивается";
  updated: string;
};

const WB_MARKETPLACE = "https://marketplace-api.wildberries.ru";
const WB_CONTENT = "https://content-api.wildberries.ru";
const WB_STATISTICS = "https://statistics-api.wildberries.ru";
const palette = ["#ffb45c", "#8ea6ff", "#d7a6cc", "#94c5a6", "#eaa070", "#79b9bd", "#adb1b8", "#d0ad82"];

let memoryCache: { expiresAt: number; payload: unknown } | null = null;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function wbFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = new Error(`WB API ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

async function getCards(token: string): Promise<WbCard[]> {
  const cards: WbCard[] = [];
  let cursor: { limit: number; updatedAt?: string; nmID?: number } = { limit: 100 };

  for (let page = 0; page < 30; page += 1) {
    const data = await wbFetch<{ cards?: WbCard[]; cursor?: { total?: number; updatedAt?: string; nmID?: number } }>(
      token,
      `${WB_CONTENT}/content/v2/get/cards/list`,
      {
        method: "POST",
        body: JSON.stringify({ settings: { sort: { ascending: true }, cursor, filter: { withPhoto: -1 } } }),
      },
    );
    const batch = data.cards ?? [];
    cards.push(...batch);
    if (batch.length < cursor.limit || !data.cursor?.updatedAt || !data.cursor?.nmID) break;
    cursor = { limit: 100, updatedAt: data.cursor.updatedAt, nmID: data.cursor.nmID };
  }

  return cards;
}

async function getSellerStocks(token: string, cards: WbCard[]) {
  const warehouses = await wbFetch<Array<{ id: number; name: string; isDeleting?: boolean }>>(
    token,
    `${WB_MARKETPLACE}/api/v3/warehouses`,
  );
  const activeWarehouses = warehouses.filter((item) => !item.isDeleting);
  const chrtIds = [...new Set(cards.flatMap((card) => (card.sizes ?? []).map((size) => size.chrtID ?? size.chrtId).filter((id): id is number => Boolean(id))))];
  const stockByChrt = new Map<number, Record<string, number>>();

  for (const warehouse of activeWarehouses) {
    for (const batch of chunks(chrtIds, 1000)) {
      if (!batch.length) continue;
      const data = await wbFetch<{ stocks?: Array<{ chrtId: number; amount: number }> }>(
        token,
        `${WB_MARKETPLACE}/api/v3/stocks/${warehouse.id}`,
        { method: "POST", body: JSON.stringify({ chrtIds: batch }) },
      );
      for (const item of data.stocks ?? []) {
        const current = stockByChrt.get(item.chrtId) ?? {};
        current[`FBS · ${warehouse.name}`] = item.amount ?? 0;
        stockByChrt.set(item.chrtId, current);
      }
    }
  }

  return { stockByChrt, warehouses: activeWarehouses.map((item) => `FBS · ${item.name}`) };
}

async function getWbStocks(token: string) {
  const dateFrom = "2019-06-20T00:00:00";
  return wbFetch<Array<{
    supplierArticle?: string;
    nmId?: number;
    warehouseName?: string;
    quantity?: number;
    inWayFromClient?: number;
    subject?: string;
    category?: string;
  }>>(token, `${WB_STATISTICS}/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(dateFrom)}`);
}

async function getOrders(token: string): Promise<{ orders: WbOrder[]; statuses: Map<number, OrderStatus> }> {
  const orders: WbOrder[] = [];
  const now = Math.floor(Date.now() / 1000);
  const dateFrom = now - 30 * 24 * 60 * 60;
  let next = 0;

  for (let page = 0; page < 30; page += 1) {
    const params = new URLSearchParams({ limit: "1000", next: String(next), dateFrom: String(dateFrom), dateTo: String(now) });
    const data = await wbFetch<{ next?: number; orders?: WbOrder[] }>(token, `${WB_MARKETPLACE}/api/v3/orders?${params}`);
    const batch = data.orders ?? [];
    orders.push(...batch);
    if (batch.length < 1000 || !data.next || data.next === next) break;
    next = data.next;
  }

  const statuses = new Map<number, OrderStatus>();
  for (const batch of chunks(orders.map((order) => order.id), 1000)) {
    if (!batch.length) continue;
    const data = await wbFetch<{ orders?: OrderStatus[] }>(token, `${WB_MARKETPLACE}/api/v3/orders/status`, {
      method: "POST",
      body: JSON.stringify({ orders: batch }),
    });
    for (const status of data.orders ?? []) statuses.set(status.id, status);
  }

  return { orders, statuses };
}

function getOrCreateRow(map: Map<string, DashboardRow>, input: { nmId?: number; sku?: string; name?: string; category?: string }) {
  const key = input.nmId ? `nm:${input.nmId}` : `sku:${input.sku ?? "unknown"}`;
  const existing = map.get(key);
  if (existing) return existing;
  const seed = input.nmId ?? [...(input.sku ?? "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const row: DashboardRow = {
    key,
    sku: input.sku || (input.nmId ? String(input.nmId) : "Без артикула"),
    nmId: input.nmId ?? null,
    name: input.name || input.sku || `Товар ${input.nmId ?? ""}`.trim(),
    category: input.category || "Wildberries",
    color: palette[Math.abs(seed) % palette.length],
    warehouses: {},
    fbs: 0,
    receiving: 0,
    toSale: 0,
    status: "В норме",
    updated: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }),
  };
  map.set(key, row);
  return row;
}

function warningFor(section: string, error: unknown) {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401 || status === 403) return `${section}: у токена нет нужной категории доступа`;
  if (status === 429) return `${section}: Wildberries временно ограничил частоту запросов`;
  return `${section}: данные временно недоступны`;
}

export async function GET(request: Request) {
  const token = process.env.WB_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { configured: false, error: "Токен Wildberries ещё не подключён" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  if (!force && memoryCache && memoryCache.expiresAt > Date.now()) {
    return NextResponse.json(memoryCache.payload, { headers: { "Cache-Control": "private, max-age=0" } });
  }

  const [cardsResult, wbStocksResult, ordersResult] = await Promise.allSettled([
    getCards(token),
    getWbStocks(token),
    getOrders(token),
  ]);
  const warnings: string[] = [];
  const rowMap = new Map<string, DashboardRow>();

  const cards = cardsResult.status === "fulfilled" ? cardsResult.value : [];
  if (cardsResult.status === "rejected") warnings.push(warningFor("Карточки товаров", cardsResult.reason));
  for (const card of cards) {
    getOrCreateRow(rowMap, {
      nmId: card.nmID ?? card.nmId,
      sku: card.vendorCode,
      name: card.title,
      category: card.subjectName,
    });
  }

  if (wbStocksResult.status === "fulfilled") {
    for (const stock of wbStocksResult.value) {
      const row = getOrCreateRow(rowMap, {
        nmId: stock.nmId,
        sku: stock.supplierArticle,
        name: stock.supplierArticle,
        category: stock.subject ?? stock.category,
      });
      const warehouseName = `WB · ${stock.warehouseName || "Склад WB"}`;
      row.warehouses[warehouseName] = (row.warehouses[warehouseName] ?? 0) + (stock.quantity ?? 0);
      row.toSale += stock.inWayFromClient ?? 0;
    }
  } else {
    warnings.push(warningFor("Остатки на складах WB", wbStocksResult.reason));
  }

  if (cards.length) {
    try {
      const sellerStocks = await getSellerStocks(token, cards);
      for (const card of cards) {
        const row = getOrCreateRow(rowMap, { nmId: card.nmID ?? card.nmId, sku: card.vendorCode, name: card.title, category: card.subjectName });
        for (const size of card.sizes ?? []) {
          const chrtId = size.chrtID ?? size.chrtId;
          if (!chrtId) continue;
          for (const [warehouse, amount] of Object.entries(sellerStocks.stockByChrt.get(chrtId) ?? {})) {
            row.warehouses[warehouse] = (row.warehouses[warehouse] ?? 0) + amount;
          }
        }
      }
    } catch (error) {
      warnings.push(warningFor("Остатки на складах продавца", error));
    }
  }

  let activeSupplies = 0;
  if (ordersResult.status === "fulfilled") {
    const supplies = new Set<string>();
    const terminal = new Set(["sold", "canceled", "canceled_by_client", "declined_by_client", "defect"]);
    for (const order of ordersResult.value.orders) {
      const status = ordersResult.value.statuses.get(order.id);
      if (!status || terminal.has(status.wbStatus ?? "") || status.supplierStatus === "cancel") continue;
      const row = getOrCreateRow(rowMap, { nmId: order.nmId, sku: order.article, name: order.article });
      if (status.supplierStatus === "complete") {
        row.fbs += 1;
        if (order.supplyId) supplies.add(order.supplyId);
      }
      if (status.supplierStatus === "complete" && status.wbStatus === "waiting") row.receiving += 1;
      if (status.wbStatus === "sorted" || status.wbStatus === "ready_for_pickup") row.toSale += 1;
    }
    activeSupplies = supplies.size;
  } else {
    warnings.push(warningFor("FBS-отгрузки", ordersResult.reason));
  }

  const rows = [...rowMap.values()].map((row) => {
    const total = Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
    row.status = total <= 5 ? "Заканчивается" : total <= 20 ? "Мало" : "В норме";
    return row;
  }).sort((a, b) => {
    const priority = { "Заканчивается": 0, "Мало": 1, "В норме": 2 };
    return priority[a.status] - priority[b.status] || a.name.localeCompare(b.name, "ru");
  });

  if (!rows.length && warnings.length) {
    return NextResponse.json(
      { configured: true, error: "Wildberries не вернул данные. Проверьте категории токена: Контент, Маркетплейс и Статистика.", warnings },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const warehouseNames = [...new Set(rows.flatMap((row) => Object.keys(row.warehouses)))].sort((a, b) => a.localeCompare(b, "ru"));
  const totals = {
    available: rows.reduce((sum, row) => sum + Object.values(row.warehouses).reduce((inner, value) => inner + value, 0), 0),
    fbs: rows.reduce((sum, row) => sum + row.fbs, 0),
    receiving: rows.reduce((sum, row) => sum + row.receiving, 0),
    toSale: rows.reduce((sum, row) => sum + row.toSale, 0),
    risk: rows.filter((row) => row.status !== "В норме").length,
    activeSupplies,
  };
  const updatedAt = new Date().toISOString();
  const payload = { configured: true, rows, warehouseNames, totals, warnings, updatedAt };
  memoryCache = { expiresAt: Date.now() + 2 * 60 * 1000, payload };

  return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0" } });
}
