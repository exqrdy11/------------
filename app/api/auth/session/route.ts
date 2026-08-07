import { NextResponse } from "next/server";
import { cabinetSummary, getAdminCabinet } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cabinet = await getAdminCabinet(request);
  return NextResponse.json({ authenticated: Boolean(cabinet), cabinet: cabinet ? cabinetSummary(cabinet) : null }, { headers: { "Cache-Control": "no-store" } });
}
