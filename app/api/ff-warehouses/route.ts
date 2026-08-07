import { NextResponse } from "next/server";
import { createFfWarehouse, listFfWarehouses, updateFfWarehouse } from "@/db/ff-stocks";
import { isAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function validText(value: unknown, limit: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= limit;
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  try {
    return NextResponse.json({ warehouses: await listFfWarehouses() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить список складов" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  try {
    const payload = await request.json() as { city?: unknown; name?: unknown };
    if (!validText(payload.city, 80) || !validText(payload.name, 120)) {
      return NextResponse.json({ error: "Укажите город и название склада" }, { status: 400 });
    }
    return NextResponse.json({ warehouse: await createFfWarehouse({ city: payload.city, name: payload.name }) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Не удалось добавить склад" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  try {
    const payload = await request.json() as { id?: unknown; city?: unknown; name?: unknown; position?: unknown };
    if (!validText(payload.id, 100) || !validText(payload.city, 80) || !validText(payload.name, 120)) {
      return NextResponse.json({ error: "Проверьте название склада" }, { status: 400 });
    }
    return NextResponse.json({ warehouse: await updateFfWarehouse({ id: payload.id, city: payload.city, name: payload.name, position: Number(payload.position) || 0 }) });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить склад" }, { status: 500 });
  }
}
