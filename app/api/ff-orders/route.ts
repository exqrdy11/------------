import { NextResponse } from "next/server";
import { listFfWarehouses } from "@/db/ff-stocks";
import { cabinetToken, getAdminCabinet } from "@/lib/admin-auth";
import { ozonFetch, type OzonApiError } from "@/lib/ozon-api";

export const dynamic = "force-dynamic";

const WB_MARKETPLACE = "https://marketplace-api.wildberries.ru";

type WbOrder = {
  id: number;
  article?: string;
  nmId?: number;
  warehouseId?: number;
};

type WbOrderStatus = {
  id: number;
  supplierStatus?: string;
  wbStatus?: string;
};

type WbSticker = {
  orderId: number;
  file?: string;
};

type OzonPosting = {
  posting_number?: string;
  status?: string;
  warehouse_id?: number | string;
  products?: Array<{ offer_id?: string; product_id?: number; quantity?: number }>;
};

function chunks<T>(items: T[], size: number) {
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

async function getRecentOrders(token: string) {
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

  const statuses = new Map<number, WbOrderStatus>();
  for (const orderIds of chunks(orders.map((order) => order.id), 1000)) {
    if (!orderIds.length) continue;
    const data = await wbFetch<{ orders?: WbOrderStatus[] }>(token, `${WB_MARKETPLACE}/api/v3/orders/status`, {
      method: "POST",
      body: JSON.stringify({ orders: orderIds }),
    });
    for (const status of data.orders ?? []) statuses.set(status.id, status);
  }

  return { orders, statuses };
}

function userMessage(error: unknown) {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401 || status === 403) return "У токена WB нет доступа к FBS-заказам или стикерам. Нужна категория «Маркетплейс» (Marketplace).";
  if (status === 429) return "Wildberries временно ограничил запросы. Подождите минуту и повторите выгрузку.";
  return "Не удалось получить актуальные FBS-заказы из Wildberries. Повторите попытку чуть позже.";
}

function ozonUserMessage(error: unknown) {
  const status = (error as OzonApiError)?.status;
  if (status === 401 || status === 403) return "У ключа Ozon нет доступа к FBS-заказам. Проверьте Client ID и API Key на сервере.";
  if (status === 429) return "Ozon временно ограничил запросы. Подождите минуту и повторите выгрузку.";
  return "Не удалось получить актуальные FBS-заказы из Ozon. Повторите попытку чуть позже.";
}

async function ozonOrdersForWarehouse(marketplaceWarehouseId: number) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const data = await ozonFetch<{ result?: { postings?: OzonPosting[] }; postings?: OzonPosting[] }>("/v3/posting/fbs/list", {
    method: "POST",
    body: JSON.stringify({
      dir: "ASC",
      filter: { since, to: new Date().toISOString(), warehouse_id: marketplaceWarehouseId },
      limit: 1000,
      offset: 0,
      with: { analytics_data: false, financial_data: false, barcodes: true, translit: false },
    }),
  });
  const activeStatuses = new Set(["awaiting_packaging", "awaiting_registration", "awaiting_deliver", "delivering", "driver_pickup", "sent_by_seller"]);
  return (data.result?.postings ?? data.postings ?? []).filter((posting) => activeStatuses.has((posting.status ?? "").toLowerCase()));
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const warehouseId = new URL(request.url).searchParams.get("warehouseId")?.trim();
  if (!warehouseId) return NextResponse.json({ error: "Не выбран склад ФФ" }, { status: 400 });

  const warehouse = (await listFfWarehouses(cabinetId)).find((item) => item.id === warehouseId);
  if (!warehouse) return NextResponse.json({ error: "Склад ФФ не найден" }, { status: 404 });
  if (!warehouse.wbWarehouseId) return NextResponse.json({ error: cabinetId === "ozon" ? "У этого ФФ не указан ID склада Ozon. Добавьте привязку в настройках складов." : "У этого ФФ не указан ID склада WB. Добавьте привязку в настройках складов." }, { status: 409 });

  if (cabinetId === "ozon") {
    try {
      const postings = await ozonOrdersForWarehouse(warehouse.wbWarehouseId);
      const orders = postings.flatMap((posting) => (posting.products ?? []).map((product, index) => ({
        orderId: `${posting.posting_number ?? "Ozon-заказ"}:${index + 1}`,
        article: product.offer_id?.trim() || `Ozon ${product.product_id ?? ""}`.trim(),
        quantity: Math.max(1, Math.floor(Number(product.quantity) || 1)),
        sticker: null,
        stickerText: posting.posting_number?.trim() || "Номер отправления не получен",
      }))).sort((left, right) => left.article.localeCompare(right.article, "ru") || String(left.orderId).localeCompare(String(right.orderId), "ru"));
      return NextResponse.json({ warehouse: { id: warehouse.id, city: warehouse.city, name: warehouse.name }, orders, missingStickers: orders.filter((order) => !order.stickerText).length, stickerKind: "Номер отправления Ozon" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: ozonUserMessage(error) }, { status: 502 });
    }
  }

  const token = cabinetToken(cabinetId);
  if (!token) return NextResponse.json({ error: "Сначала добавьте токен Wildberries для кабинета" }, { status: 409 });

  try {
    const { orders, statuses } = await getRecentOrders(token);
    const activeOrders = orders.filter((order) => {
      const status = statuses.get(order.id);
      const supplierStatus = status?.supplierStatus;
      const terminal = ["sold", "canceled", "canceled_by_client", "declined_by_client", "defect"];
      return order.warehouseId === warehouse.wbWarehouseId
        && (supplierStatus === "confirm" || supplierStatus === "complete")
        && !terminal.includes(status?.wbStatus ?? "");
    });
    const stickers = new Map<number, WbSticker>();

    for (const [index, orderBatch] of chunks(activeOrders, 100).entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 220));
      const params = new URLSearchParams({ type: "png", width: "58", height: "40" });
      const data = await wbFetch<{ stickers?: WbSticker[] }>(token, `${WB_MARKETPLACE}/api/v3/orders/stickers?${params}`, {
        method: "POST",
        body: JSON.stringify({ orders: orderBatch.map((order) => order.id) }),
      });
      for (const sticker of data.stickers ?? []) stickers.set(sticker.orderId, sticker);
    }

    const exportedOrders = activeOrders
      .map((order) => ({
        orderId: order.id,
        article: order.article?.trim() || `WB ${order.nmId ?? order.id}`,
        quantity: 1,
        sticker: stickers.get(order.id)?.file ?? null,
      }))
      .sort((left, right) => left.article.localeCompare(right.article, "ru") || left.orderId - right.orderId);

    return NextResponse.json({
      warehouse: { id: warehouse.id, city: warehouse.city, name: warehouse.name },
      orders: exportedOrders,
      missingStickers: exportedOrders.filter((order) => !order.sticker).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: userMessage(error) }, { status: 502 });
  }
}
