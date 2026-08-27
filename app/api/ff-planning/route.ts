import { NextResponse } from "next/server";
import { getFfPlanningRefreshState, listFfDailyMetrics, reserveFfPlanningRefresh } from "@/db/ff-planning";
import { listFfWarehouses } from "@/db/ff-stocks";
import { cabinetToken, getAdminSession, type CabinetId } from "@/lib/admin-auth";
import { effectivePeriod, ffPlanningRoleCan, type EffectivePeriod } from "@/lib/ff-planning";
import { refreshWbFfPlanningMetrics } from "@/app/api/inventory/route";

export const dynamic = "force-dynamic";

const SOURCE = {
  demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
  sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
} as const;

function requestPeriod(from: unknown, to: unknown): EffectivePeriod {
  if (typeof from !== "string" || typeof to !== "string") throw new Error("Укажите период в формате YYYY-MM-DD");
  return effectivePeriod({ from, to });
}

async function planningPayload(cabinetId: CabinetId, period: EffectivePeriod, warnings: string[] = []) {
  const [warehouses, daily, state] = await Promise.all([
    listFfWarehouses(cabinetId),
    listFfDailyMetrics(cabinetId, { from: period.from, to: period.to }),
    getFfPlanningRefreshState(cabinetId),
  ]);
  const retryAt = state.cooldown_until && Date.parse(state.cooldown_until) > Date.now() ? state.cooldown_until : null;
  return { period, warehouses, daily, source: SOURCE, warnings, updatedAt: state.updated_at, retryAt };
}

function errorPayload(error: string, period: EffectivePeriod | null = null) {
  return { error, period, warehouses: [], daily: [], source: SOURCE, warnings: [], updatedAt: null, retryAt: null };
}

export async function GET(request: Request) {
  const session = await getAdminSession(request);
  if (!session || !ffPlanningRoleCan(session.role, "read")) return NextResponse.json(errorPayload("Требуется вход"), { status: 401, headers: { "Cache-Control": "no-store" } });
  let period: EffectivePeriod;
  try {
    const params = new URL(request.url).searchParams;
    period = requestPeriod(params.get("from"), params.get("to"));
  } catch (error) {
    return NextResponse.json(errorPayload(error instanceof Error ? error.message : "Некорректный период"), { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await planningPayload(session.cabinetId, period), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(errorPayload("Не удалось загрузить план поставок", period), { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const session = await getAdminSession(request);
  if (!session || !ffPlanningRoleCan(session.role, "refresh")) return NextResponse.json(errorPayload("Требуется вход"), { status: 401, headers: { "Cache-Control": "no-store" } });
  let body: { action?: unknown; from?: unknown; to?: unknown };
  let period: EffectivePeriod;
  try {
    body = await request.json() as typeof body;
    if (body.action !== "refresh") return NextResponse.json(errorPayload("Поддерживается только ручное обновление"), { status: 400, headers: { "Cache-Control": "no-store" } });
    period = requestPeriod(body.from, body.to);
  } catch (error) {
    return NextResponse.json(errorPayload(error instanceof Error ? error.message : "Некорректный запрос"), { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const token = cabinetToken(session.cabinetId);
  if (!token) return NextResponse.json(errorPayload("Токен Wildberries не подключён", period), { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const reservation = await reserveFfPlanningRefresh(session.cabinetId);
    if (!reservation.reserved) {
      const payload = await planningPayload(session.cabinetId, period, ["Общий снимок уже обновлялся в последние 2 минуты"]);
      return NextResponse.json({ ...payload, retryAt: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    const refreshed = await refreshWbFfPlanningMetrics({ cabinetId: session.cabinetId, token, from: period.from, to: period.to });
    return NextResponse.json(await planningPayload(session.cabinetId, period, refreshed.warnings), { headers: { "Cache-Control": "no-store" } });
  } catch {
    const payload = await planningPayload(session.cabinetId, period, ["Не удалось завершить запрос обновления — показан текущий общий снимок"])
      .catch(() => errorPayload("Не удалось обновить план поставок", period));
    return NextResponse.json(payload, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
