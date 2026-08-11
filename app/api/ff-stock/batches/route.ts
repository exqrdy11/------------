import { NextResponse } from "next/server";
import { deleteFfStockBatch, saveFfStockBatch } from "@/db/ff-stocks";
import { getOwnerSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function validExpiry(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function batchInput(payload: Record<string, unknown>) {
  const productKey = typeof payload.productKey === "string" ? payload.productKey.trim().slice(0, 200) : "";
  const sku = typeof payload.sku === "string" ? payload.sku.trim().slice(0, 200) : "";
  const warehouseId = typeof payload.warehouseId === "string" ? payload.warehouseId.trim().slice(0, 200) : "";
  const batchCode = typeof payload.batchCode === "string" ? payload.batchCode.trim().slice(0, 120) : "";
  const expiresAt = typeof payload.expiresAt === "string" && payload.expiresAt ? payload.expiresAt : null;
  const nmId = typeof payload.nmId === "number" && Number.isInteger(payload.nmId) ? payload.nmId : null;
  return { productKey, sku, warehouseId, batchCode, expiresAt, nmId };
}

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const input = batchInput(payload);
    const quantity = Math.floor(Number(payload.quantity));
    if (!input.productKey || !input.sku || !input.warehouseId || !validExpiry(input.expiresAt) || !Number.isFinite(quantity) || quantity < 0 || quantity > 10_000_000) {
      return NextResponse.json({ error: "Укажите склад, артикул, количество от 0 до 10 000 000 и корректный срок годности" }, { status: 400 });
    }
    return NextResponse.json(await saveFfStockBatch({ cabinetId: session.cabinetId, ...input, quantity }));
  } catch (error) {
    const message = error instanceof Error && error.message === "Склад не найден" ? error.message : "Не удалось сохранить партию";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const input = batchInput(payload);
    if (!input.productKey || !input.sku || !input.warehouseId || !validExpiry(input.expiresAt)) {
      return NextResponse.json({ error: "Не удалось определить партию" }, { status: 400 });
    }
    return NextResponse.json(await deleteFfStockBatch({ cabinetId: session.cabinetId, ...input }));
  } catch (error) {
    const message = error instanceof Error && error.message === "Склад не найден" ? error.message : "Не удалось удалить партию";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
