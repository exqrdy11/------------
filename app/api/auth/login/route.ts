import { NextResponse } from "next/server";
import { adminSessionCookie, availableCabinets, cabinetForCredentials, cabinetSummary, createAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { login?: string; password?: string };
    const owner = cabinetForCredentials(payload.login?.trim() ?? "", payload.password ?? "");
    if (!owner) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const token = await createAdminSession(owner);
    return NextResponse.json({ authenticated: true, cabinet: cabinetSummary(owner), cabinets: availableCabinets(owner) }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": adminSessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
