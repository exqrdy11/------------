import { env } from "cloudflare:workers";
import { getMediaSession } from "@/lib/admin-auth";

type PeriodRow = {
  date_from: string;
  date_to: string;
  preset: "7" | "14" | "30" | "custom";
};

const presets = new Set(["7", "14", "30", "custom"]);

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("Хранилище общего периода пока не подключено");
  return binding;
}

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inclusiveDays(from: string, to: string) {
  return Math.floor((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000) + 1;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS shared_report_period (id INTEGER PRIMARY KEY CHECK (id = 1), date_from TEXT NOT NULL, date_to TEXT NOT NULL, preset TEXT NOT NULL DEFAULT 'custom', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ).run();
}

function present(row: PeriodRow) {
  return { dateFrom: row.date_from, dateTo: row.date_to, preset: row.preset };
}

export async function GET(request: Request) {
  if (!await getMediaSession(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const db = database();
    await ensureSchema(db);
    const row = await db
      .prepare("SELECT date_from, date_to, preset FROM shared_report_period WHERE id = 1")
      .first<PeriodRow>();
    return Response.json({ period: row ? present(row) : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить общий период" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!await getMediaSession(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const payload = await request.json() as { dateFrom?: string; dateTo?: string; preset?: string };
    const dateFrom = payload.dateFrom;
    const dateTo = payload.dateTo;
    const preset = payload.preset;
    if (!validDate(dateFrom) || !validDate(dateTo) || !preset || !presets.has(preset)) {
      return Response.json({ error: "Укажите корректный период" }, { status: 400 });
    }
    if (dateFrom > dateTo) return Response.json({ error: "Дата «От» должна быть раньше даты «До»" }, { status: 400 });
    if (inclusiveDays(dateFrom, dateTo) > 31) {
      return Response.json({ error: "Период не должен превышать 31 день" }, { status: 400 });
    }

    const db = database();
    await ensureSchema(db);
    await db.prepare(
      "INSERT INTO shared_report_period (id, date_from, date_to, preset, updated_at) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET date_from = excluded.date_from, date_to = excluded.date_to, preset = excluded.preset, updated_at = CURRENT_TIMESTAMP",
    ).bind(dateFrom, dateTo, preset).run();
    return Response.json({ period: { dateFrom, dateTo, preset } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить общий период" }, { status: 500 });
  }
}
