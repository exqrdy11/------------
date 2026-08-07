import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ authenticated: false }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": clearAdminSessionCookie() },
  });
}
