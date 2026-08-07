import { NextResponse } from "next/server";
import { listFfWarehouses, saveFfStock, type FfStock } from "@/db/ff-stocks";
import { isAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const payload = await request.json() as {
      productKey?: string;
      nmId?: number | null;
      sku?: string;
      stock?: Partial<FfStock>;
    };
    const productKey = payload.productKey?.trim() ?? "";
    const sku = payload.sku?.trim().slice(0, 200) ?? "";

    if (!productKey || productKey.length > 200) {
      return NextResponse.json({ error: "Не удалось определить артикул" }, { status: 400 });
    }

    const warehouses = await listFfWarehouses();
    const stock: FfStock = {};
    for (const warehouse of warehouses) {
      const value = Number(payload.stock?.[warehouse.id] ?? 0);
      if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
        return NextResponse.json({ error: "Количество должно быть от 0 до 10 000 000" }, { status: 400 });
      }
      stock[warehouse.id] = Math.floor(value);
    }

    await saveFfStock({
      productKey,
      nmId: typeof payload.nmId === "number" ? payload.nmId : null,
      sku,
      stock,
    });
    return NextResponse.json({ stock });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("D1 binding")
      ? "Хранилище ручных остатков пока не подключено"
      : "Не удалось сохранить остатки ФФ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
