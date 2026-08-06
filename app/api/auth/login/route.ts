import { NextResponse } from "next/server";
import { adminSessionCookie, createAdminSession, verifyAdminCredentials } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { login?: string; password?: string };
    if (!verifyAdminCredentials(payload.login?.trim() ?? "", payload.password ?? "")) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const token = await createAdminSession();
    return NextResponse.json({ authenticated: true }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": adminSessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
