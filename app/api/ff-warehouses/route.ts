import { NextResponse } from "next/server";
import { createFfWarehouse, listFfWarehouses, updateFfWarehouse } from "@/db/ff-stocks";
import { getAdminCabinet, getOwnerSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function validText(value: unknown, limit: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= limit;
}

function optionalWarehouseId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : undefined;
}

function optionalWarehouseName(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && value.trim().length <= 120 ? value.trim() : undefined;
}

function optionalHidden(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export async function GET(request: Request) {
  const cabinet = await getAdminCabinet(request);
  if (!cabinet) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    return NextResponse.json({ warehouses: await listFfWarehouses(cabinet) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить список складов" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403 });
  try {
    const payload = await request.json() as { city?: unknown; name?: unknown };
    if (!validText(payload.city, 80) || !validText(payload.name, 120)) {
      return NextResponse.json({ error: "Укажите город и название склада" }, { status: 400 });
    }
    return NextResponse.json({ warehouse: await createFfWarehouse({ cabinetId: session.cabinetId, city: payload.city, name: payload.name }) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Не удалось добавить склад" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403 });
  try {
    const payload = await request.json() as { id?: unknown; city?: unknown; name?: unknown; position?: unknown; wbWarehouseId?: unknown; wbWarehouseName?: unknown; isHidden?: unknown };
    const wbWarehouseId = optionalWarehouseId(payload.wbWarehouseId);
    const wbWarehouseName = optionalWarehouseName(payload.wbWarehouseName);
    const isHidden = optionalHidden(payload.isHidden);
    if (!validText(payload.id, 100) || !validText(payload.city, 80) || !validText(payload.name, 120) || wbWarehouseId === undefined || wbWarehouseName === undefined || isHidden === undefined) {
      return NextResponse.json({ error: "Проверьте название склада и ID склада WB" }, { status: 400 });
    }
    return NextResponse.json({ warehouse: await updateFfWarehouse({ cabinetId: session.cabinetId, id: payload.id, city: payload.city, name: payload.name, position: Number(payload.position) || 0, wbWarehouseId, wbWarehouseName, isHidden }) });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить склад" }, { status: 500 });
  }
}
