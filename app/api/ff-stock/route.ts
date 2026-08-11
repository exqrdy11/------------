import { NextResponse } from "next/server";
import { listFfWarehouses, saveFfStock, type FfExpiry, type FfStock } from "@/db/ff-stocks";
import { getOwnerSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const payload = await request.json() as {
      productKey?: string;
      nmId?: number | null;
      sku?: string;
      stock?: Partial<FfStock>;
      expiresAt?: Partial<FfExpiry>;
    };
    const productKey = payload.productKey?.trim() ?? "";
    const sku = payload.sku?.trim().slice(0, 200) ?? "";

    if (!productKey || productKey.length > 200) {
      return NextResponse.json({ error: "Не удалось определить артикул" }, { status: 400 });
    }

    const warehouses = await listFfWarehouses(session.cabinetId);
    const stock: FfStock = {};
    const expiresAt: FfExpiry = {};
    for (const warehouse of warehouses) {
      const value = Number(payload.stock?.[warehouse.id] ?? 0);
      if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
        return NextResponse.json({ error: "Количество должно быть от 0 до 10 000 000" }, { status: 400 });
      }
      stock[warehouse.id] = Math.floor(value);
      const expiry = payload.expiresAt?.[warehouse.id];
      if (expiry !== null && expiry !== undefined && (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) {
        return NextResponse.json({ error: "Срок годности укажите в формате ГГГГ-ММ-ДД" }, { status: 400 });
      }
      expiresAt[warehouse.id] = expiry || null;
    }

    const saved = await saveFfStock({
      cabinetId: session.cabinetId,
      productKey,
      nmId: typeof payload.nmId === "number" ? payload.nmId : null,
      sku,
      stock,
      expiresAt,
    });
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error && error.message.includes("D1 binding")
      ? "Хранилище ручных остатков пока не подключено"
      : "Не удалось сохранить остатки ФФ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
