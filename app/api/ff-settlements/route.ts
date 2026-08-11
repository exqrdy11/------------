import { NextResponse } from "next/server";
import { getFfSettlement } from "@/db/ff-settlements";
import { getAdminCabinet } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function currentMonthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const cabinetId = await getAdminCabinet(request);
  if (!cabinetId) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const url = new URL(request.url);
  const warehouseId = url.searchParams.get("warehouseId")?.trim();
  const from = url.searchParams.get("from")?.trim() || currentMonthStart();
  const to = url.searchParams.get("to")?.trim() || new Date().toISOString().slice(0, 10);
  if (!warehouseId) return NextResponse.json({ error: "Выберите ФФ" }, { status: 400 });
  try {
    return NextResponse.json({ settlement: await getFfSettlement({ cabinetId, warehouseId, from, to }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось посчитать сверку" }, { status: 400 });
  }
}
