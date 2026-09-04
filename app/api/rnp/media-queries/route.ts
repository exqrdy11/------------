import { env } from "cloudflare:workers";

type StoredRow = {
  campaign_id: string;
  campaign_name: string;
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  expense: number;
  source_file: string;
  imported_at: string;
};

type IncomingRow = {
  campaignId?: unknown;
  campaignName?: unknown;
  query?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  cpm?: unknown;
  expense?: unknown;
  sourceFile?: unknown;
};

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("Общая база отчётов пока не подключена");
  return binding;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS media_query_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, date_from TEXT NOT NULL, date_to TEXT NOT NULL, campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL, query TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, ctr REAL NOT NULL DEFAULT 0, cpm REAL NOT NULL DEFAULT 0, expense REAL NOT NULL DEFAULT 0, source_file TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(date_from, date_to, campaign_id, query))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_media_query_stats_period ON media_query_stats (date_from, date_to)"),
  ]);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
      return Response.json({ error: "Укажите корректный период" }, { status: 400 });
    }

    const db = database();
    await ensureSchema(db);
    const result = await db.prepare("SELECT campaign_id, campaign_name, query, impressions, clicks, ctr, cpm, expense, source_file, imported_at FROM media_query_stats WHERE date_from = ? AND date_to = ? ORDER BY clicks DESC, impressions DESC, query")
      .bind(dateFrom, dateTo)
      .all<StoredRow>();

    return Response.json({
      rows: (result.results ?? []).map((row) => ({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        query: row.query,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.ctr,
        cpm: row.cpm,
        expense: row.expense,
        sourceFile: row.source_file,
        importedAt: row.imported_at,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить запросы" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { dateFrom?: unknown; dateTo?: unknown; rows?: unknown; replaceCampaigns?: unknown };
    if (!validDate(payload.dateFrom) || !validDate(payload.dateTo) || payload.dateFrom > payload.dateTo) {
      return Response.json({ error: "Укажите корректный период" }, { status: 400 });
    }
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
      return Response.json({ error: "В отчёте нет строк с поисковыми запросами" }, { status: 400 });
    }
    if (payload.rows.length > 5_000) {
      return Response.json({ error: "Одна часть загрузки не должна превышать 5 000 строк" }, { status: 400 });
    }

    const grouped = new Map<string, {
      campaignId: string;
      campaignName: string;
      query: string;
      impressions: number;
      clicks: number;
      expense: number;
      sourceFiles: Set<string>;
      providedCpm: number;
    }>();

    for (const source of payload.rows as IncomingRow[]) {
      const campaignName = textValue(source.campaignName, 500);
      const campaignId = textValue(source.campaignId, 100) || campaignName;
      const query = textValue(source.query, 1_000);
      if (!campaignId || !campaignName || !query) continue;
      const key = campaignId + "\u001f" + query.toLocaleLowerCase("ru-RU");
      const current = grouped.get(key) ?? {
        campaignId,
        campaignName,
        query,
        impressions: 0,
        clicks: 0,
        expense: 0,
        sourceFiles: new Set<string>(),
        providedCpm: 0,
      };
      current.impressions += Math.round(finiteNumber(source.impressions));
      current.clicks += Math.round(finiteNumber(source.clicks));
      current.expense += finiteNumber(source.expense);
      current.providedCpm = finiteNumber(source.cpm) || current.providedCpm;
      const sourceFile = textValue(source.sourceFile, 240);
      if (sourceFile) current.sourceFiles.add(sourceFile);
      grouped.set(key, current);
    }

    const rows = [...grouped.values()];
    if (!rows.length) {
      return Response.json({ error: "Не нашли колонки «Запрос» или данные кампании" }, { status: 400 });
    }

    const db = database();
    await ensureSchema(db);
    const campaigns = [...new Map(rows.map((row) => [row.campaignId, { id: row.campaignId, name: row.campaignName }])).values()];
    if (payload.replaceCampaigns !== false) {
      for (let index = 0; index < campaigns.length; index += 80) {
        await db.batch(campaigns.slice(index, index + 80).map((campaign) =>
          db.prepare("DELETE FROM media_query_stats WHERE date_from = ? AND date_to = ? AND (campaign_id = ? OR campaign_name = ?)")
            .bind(payload.dateFrom, payload.dateTo, campaign.id, campaign.name),
        ));
      }
    }

    for (let index = 0; index < rows.length; index += 80) {
      await db.batch(rows.slice(index, index + 80).map((row) => {
        const ctr = row.impressions ? (row.clicks / row.impressions) * 100 : 0;
        const cpm = row.impressions && row.expense
          ? (row.expense / row.impressions) * 1_000
          : row.providedCpm;
        return db.prepare("INSERT INTO media_query_stats (date_from, date_to, campaign_id, campaign_name, query, impressions, clicks, ctr, cpm, expense, source_file, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date_from, date_to, campaign_id, query) DO UPDATE SET campaign_name = excluded.campaign_name, impressions = excluded.impressions, clicks = excluded.clicks, ctr = excluded.ctr, cpm = excluded.cpm, expense = excluded.expense, source_file = excluded.source_file, imported_at = CURRENT_TIMESTAMP")
          .bind(
            payload.dateFrom,
            payload.dateTo,
            row.campaignId,
            row.campaignName,
            row.query,
            row.impressions,
            row.clicks,
            Number(ctr.toFixed(6)),
            Number(cpm.toFixed(4)),
            Number(row.expense.toFixed(2)),
            [...row.sourceFiles].join(", "),
          );
      }));
    }

    return Response.json({ ok: true, rows: rows.length, campaigns: campaigns.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось импортировать отчёт" }, { status: 500 });
  }
}

