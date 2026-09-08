import { NextResponse } from "next/server";
import { adminSessionCookie, availableCabinets, cabinetIds, cabinetSummary, createAdminSession, getAdminSession, type CabinetId } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getAdminSession(request);
    if (!session) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });

    const payload = await request.json() as { cabinetId?: string };
    const cabinetId = payload.cabinetId;
    if (!cabinetId || !cabinetIds.includes(cabinetId as CabinetId)) return NextResponse.json({ error: "Кампания не найдена" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const cabinets = availableCabinets(session.ownerId, session.role);
    if (!cabinets.some((cabinet) => cabinet.id === cabinetId)) return NextResponse.json({ error: "Нет доступа к этой кампании" }, { status: 403, headers: { "Cache-Control": "no-store" } });

    const token = await createAdminSession(session.ownerId, cabinetId as CabinetId, session.role);
    return NextResponse.json({ authenticated: true, role: session.role, cabinet: cabinetSummary(cabinetId as CabinetId), cabinets }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": adminSessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось переключить кампанию" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
