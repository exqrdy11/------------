import { NextResponse } from "next/server";
import { adminSessionCookie, cabinetForCredentials, cabinetSummary, createAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { login?: string; password?: string };
    const cabinet = cabinetForCredentials(payload.login?.trim() ?? "", payload.password ?? "");
    if (!cabinet) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const token = await createAdminSession(cabinet);
    return NextResponse.json({ authenticated: true, cabinet: cabinetSummary(cabinet) }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": adminSessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
