import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { listFfDailyMetrics } from "@/db/ff-planning";
import { listFfWarehouses } from "@/db/ff-stocks";
import { cabinetToken, getAdminSession, type CabinetId } from "@/lib/admin-auth";
import { effectivePeriod, type PlanningPeriod } from "@/lib/ff-planning";
import { refreshWbFfPlanningMetrics } from "@/app/api/inventory/route";

export const dynamic = "force-dynamic";

const FF_PLANNING_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const SOURCE = {
  demand: { kind: "created_fbs_orders", label: "Созданные заказы FBS", dateBasis: "order_created_at" },
  sold: { kind: "confirmed_buyouts", label: "Подтверждённые выкупы", dateBasis: "order_created_at" },
} as const;
const createRefreshTableSql = `
  CREATE TABLE IF NOT EXISTS ff_planning_refreshes (
    cabinet_id TEXT PRIMARY KEY,
    cooldown_until TEXT,
    updated_at TEXT
  )
`;

type RefreshState = { cooldown_until: string | null; updated_at: string | null };

function requestPeriod(from: unknown, to: unknown): PlanningPeriod {
  if (typeof from !== "string" || typeof to !== "string") throw new Error("Укажите период в формате YYYY-MM-DD");
  return effectivePeriod({ from, to });
}

async function getRefreshDb() {
  const d1 = getD1();
  await d1.prepare(createRefreshTableSql).run();
  return d1;
}

async function refreshState(cabinetId: CabinetId): Promise<RefreshState> {
  const d1 = await getRefreshDb();
  return await d1.prepare("SELECT cooldown_until, updated_at FROM ff_planning_refreshes WHERE cabinet_id = ?")
    .bind(cabinetId).first<RefreshState>() ?? { cooldown_until: null, updated_at: null };
}

async function reserveRefresh(cabinetId: CabinetId) {
  const d1 = await getRefreshDb();
  await d1.prepare("INSERT OR IGNORE INTO ff_planning_refreshes (cabinet_id, cooldown_until, updated_at) VALUES (?, NULL, NULL)").bind(cabinetId).run();
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + FF_PLANNING_REFRESH_COOLDOWN_MS).toISOString();
  const result = await d1.prepare(`
    UPDATE ff_planning_refreshes
    SET cooldown_until = ?
    WHERE cabinet_id = ? AND (cooldown_until IS NULL OR cooldown_until <= ?)
  `).bind(cooldownUntil, cabinetId, now.toISOString()).run();
  const state = await refreshState(cabinetId);
  return { reserved: Number(result.meta?.changes ?? 0) > 0, cooldownUntil: state.cooldown_until };
}

async function markUpdated(cabinetId: CabinetId, updatedAt: string) {
  const d1 = await getRefreshDb();
  await d1.prepare("UPDATE ff_planning_refreshes SET updated_at = ? WHERE cabinet_id = ?").bind(updatedAt, cabinetId).run();
}

async function planningPayload(cabinetId: CabinetId, period: PlanningPeriod, warnings: string[] = []) {
  const [warehouses, daily, state] = await Promise.all([
    listFfWarehouses(cabinetId),
    listFfDailyMetrics(cabinetId, { from: period.from, to: period.to }),
    refreshState(cabinetId),
  ]);
  const retryAt = state.cooldown_until && Date.parse(state.cooldown_until) > Date.now() ? state.cooldown_until : null;
  return { period, warehouses, daily, source: SOURCE, warnings, updatedAt: state.updated_at, retryAt };
}

function errorPayload(error: string, period: PlanningPeriod | null = null) {
  return { error, period, warehouses: [], daily: [], source: SOURCE, warnings: [], updatedAt: null, retryAt: null };
}

export async function GET(request: Request) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json(errorPayload("Требуется вход"), { status: 401, headers: { "Cache-Control": "no-store" } });
  let period: PlanningPeriod;
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
  if (!session) return NextResponse.json(errorPayload("Требуется вход"), { status: 401, headers: { "Cache-Control": "no-store" } });
  let body: { action?: unknown; from?: unknown; to?: unknown };
  let period: PlanningPeriod;
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
    const reservation = await reserveRefresh(session.cabinetId);
    if (!reservation.reserved) {
      const payload = await planningPayload(session.cabinetId, period, ["Общий снимок уже обновлялся в последние 2 минуты"]);
      return NextResponse.json({ ...payload, retryAt: reservation.cooldownUntil }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    const refreshed = await refreshWbFfPlanningMetrics({ cabinetId: session.cabinetId, token, from: period.from, to: period.to });
    const updatedAt = new Date().toISOString();
    await markUpdated(session.cabinetId, updatedAt);
    return NextResponse.json(await planningPayload(session.cabinetId, period, refreshed.warnings), { headers: { "Cache-Control": "no-store" } });
  } catch {
    const payload = await planningPayload(session.cabinetId, period, ["WB не обновил дневную историю — показан последний общий снимок"])
      .catch(() => errorPayload("Не удалось обновить план поставок", period));
    return NextResponse.json(payload, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
