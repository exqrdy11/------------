import { NextResponse } from "next/server";
import { createFfWarehouse, listFfWarehouses, updateFfWarehouse } from "@/db/ff-stocks";
import { mergeWarehousePlanningSettings } from "@/db/ff-planning";
import { getAdminCabinet, getAdminSession, getOwnerSession } from "@/lib/admin-auth";
import { ffPlanningRoleCan } from "@/lib/ff-planning";

export const dynamic = "force-dynamic";

function validText(value: unknown, limit: number): value is string {
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

function optionalServiceRateKopecks(value: unknown) {
  const rate = Number(value);
  return Number.isInteger(rate) && rate >= 0 && rate <= 10_000_000 ? rate : undefined;
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
  const session = await getAdminSession(request);
  if (!session || !ffPlanningRoleCan(session.role, "write-settings")) return NextResponse.json({ error: "Изменять данные может только владелец кабинета" }, { status: 403 });
  try {
    const payload = await request.json() as { id?: unknown; city?: unknown; name?: unknown; position?: unknown; wbWarehouseId?: unknown; wbWarehouseName?: unknown; serviceRateKopecks?: unknown; isHidden?: unknown; openedAt?: unknown; planningTargetDays?: unknown };
    const wbWarehouseId = optionalWarehouseId(payload.wbWarehouseId);
    const wbWarehouseName = optionalWarehouseName(payload.wbWarehouseName);
    const serviceRateKopecks = optionalServiceRateKopecks(payload.serviceRateKopecks);
    const isHidden = optionalHidden(payload.isHidden);
    if (!validText(payload.id, 100) || !validText(payload.city, 80) || !validText(payload.name, 120) || wbWarehouseId === undefined || wbWarehouseName === undefined || serviceRateKopecks === undefined || isHidden === undefined) {
      return NextResponse.json({ error: "Проверьте настройки ФФ, ставку и ID склада WB" }, { status: 400 });
    }
    const current = (await listFfWarehouses(session.cabinetId)).find((warehouse) => warehouse.id === payload.id);
    if (!current) return NextResponse.json({ error: "Склад не найден" }, { status: 404 });
    let planningSettings;
    try {
      planningSettings = mergeWarehousePlanningSettings(current, payload);
    } catch {
      return NextResponse.json({ error: "Проверьте дату открытия и плановый срок склада" }, { status: 400 });
    }
    const { openedAt, planningTargetDays } = planningSettings;
    return NextResponse.json({ warehouse: await updateFfWarehouse({ cabinetId: session.cabinetId, id: payload.id, city: payload.city, name: payload.name, position: Number(payload.position) || 0, wbWarehouseId, wbWarehouseName, serviceRateKopecks, isHidden, openedAt, planningTargetDays }) });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить склад" }, { status: 500 });
  }
}
