import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: await isAdminRequest(request) }, { headers: { "Cache-Control": "no-store" } });
}
