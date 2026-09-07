import { NextResponse } from "next/server";
import { adminSessionCookie, availableCabinets, cabinetSummary, createAdminSession, sessionForCredentials } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { login?: string; password?: string };
    const session = sessionForCredentials(payload.login?.trim() ?? "", payload.password ?? "");
    if (!session) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const token = await createAdminSession(session.ownerId, session.cabinetId, session.role);
    return NextResponse.json({ authenticated: true, role: session.role, cabinet: cabinetSummary(session.cabinetId), cabinets: session.role === "media" ? [] : availableCabinets(session.ownerId) }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": adminSessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
