import { NextResponse } from "next/server";
import { availableCabinets, cabinetSummary, getAuthenticatedSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAuthenticatedSession(request);
  return NextResponse.json({ authenticated: Boolean(session), role: session?.role ?? null, cabinet: session ? cabinetSummary(session.cabinetId) : null, cabinets: session && session.role !== "media" ? availableCabinets(session.ownerId) : [] }, { headers: { "Cache-Control": "no-store" } });
}
