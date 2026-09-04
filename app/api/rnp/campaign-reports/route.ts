import { env } from "cloudflare:workers";
import { aggregateCampaignRows, buildCampaignReport } from "../../../../lib/report-domain.mjs";

type IncomingRow = {
  campaignId?: unknown;
  campaignName?: unknown;
  status?: unknown;
  format?: unknown;
  paymentType?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  expense?: unknown;
  directOrders?: unknown;
  postViewOrders?: unknown;
  directSales?: unknown;
  postViewSales?: unknown;
  sourceFile?: unknown;
  articleSku?: unknown;
  articleOfferId?: unknown;
  articleName?: unknown;
};

type StoredRow = {
  date_from: string;
  date_to: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  format: string;
  payment_type: string;
  impressions: number;
  clicks: number;
  expense: number;
  direct_orders: number;
  post_view_orders: number;
  direct_sales: number;
  post_view_sales: number;
  source_file: string;
  imported_at: string;
  article_sku: string | null;
  article_offer_id: string | null;
  article_name: string | null;
  mapping_source: string | null;
};

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("Общая база отчётов пока не подключена");
  return binding;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS campaign_period_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, date_from TEXT NOT NULL, date_to TEXT NOT NULL, campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paused', format TEXT NOT NULL DEFAULT 'Медийная реклама', payment_type TEXT NOT NULL DEFAULT 'CPC', impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, expense REAL NOT NULL DEFAULT 0, direct_orders INTEGER NOT NULL DEFAULT 0, post_view_orders INTEGER NOT NULL DEFAULT 0, direct_sales REAL NOT NULL DEFAULT 0, post_view_sales REAL NOT NULL DEFAULT 0, source_file TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(date_from, date_to, campaign_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_campaign_period_stats_period ON campaign_period_stats (date_from, date_to)"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaign_article_mappings (campaign_id TEXT PRIMARY KEY, article_sku TEXT NOT NULL, article_offer_id TEXT NOT NULL, article_name TEXT NOT NULL DEFAULT '', mapping_source TEXT NOT NULL DEFAULT 'auto', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_campaign_article_mappings_article ON campaign_article_mappings (article_sku)"),
  ]);
}

function storedRow(row: StoredRow) {
  return {
    dateFrom: row.date_from,
    dateTo: row.date_to,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    status: row.status,
    format: row.format,
    paymentType: row.payment_type,
    impressions: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    directOrders: row.direct_orders,
    postViewOrders: row.post_view_orders,
    directSales: row.direct_sales,
    postViewSales: row.post_view_sales,
    sourceFile: row.source_file,
    importedAt: row.imported_at,
    articleSku: row.article_sku ?? "",
    articleOfferId: row.article_offer_id ?? "",
    articleName: row.article_name ?? "",
    mappingSource: row.mapping_source ?? "unmapped",
  };
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
    const result = await db.prepare("SELECT s.date_from, s.date_to, s.campaign_id, s.campaign_name, s.status, s.format, s.payment_type, s.impressions, s.clicks, s.expense, s.direct_orders, s.post_view_orders, s.direct_sales, s.post_view_sales, s.source_file, s.imported_at, m.article_sku, m.article_offer_id, m.article_name, m.mapping_source FROM campaign_period_stats s LEFT JOIN campaign_article_mappings m ON m.campaign_id = s.campaign_id WHERE (s.date_from = ? AND s.date_to = ?) OR (s.date_from = s.date_to AND s.date_from >= ? AND s.date_to <= ?) ORDER BY s.campaign_name, s.campaign_id")
      .bind(dateFrom, dateTo, dateFrom, dateTo)
      .all<StoredRow>();
    const report = buildCampaignReport((result.results ?? []).map(storedRow), dateFrom, dateTo);
    return Response.json({ ...report, mode: report.articles.length ? "xlsx" : "empty" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить отчёт Ozon" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { dateFrom?: unknown; dateTo?: unknown; rows?: unknown };
    if (!validDate(payload.dateFrom) || !validDate(payload.dateTo) || payload.dateFrom > payload.dateTo) {
      return Response.json({ error: "Не удалось определить корректный период отчёта" }, { status: 400 });
    }
    if (!Array.isArray(payload.rows) || payload.rows.length === 0 || payload.rows.length > 1_000) {
      return Response.json({ error: "В отчёте нет кампаний или их слишком много" }, { status: 400 });
    }
    const rows = (payload.rows as IncomingRow[]).flatMap((source) => {
      const campaignId = textValue(source.campaignId, 100);
      const campaignName = textValue(source.campaignName, 500);
      if (!campaignId || !campaignName) return [];
      return [{
        campaignId,
        campaignName,
        status: source.status === "running" ? "running" : "paused",
        format: textValue(source.format, 160) || "Медийная реклама",
        paymentType: source.paymentType === "CPM" ? "CPM" : "CPC",
        impressions: Math.round(finiteNumber(source.impressions)),
        clicks: Math.round(finiteNumber(source.clicks)),
        expense: finiteNumber(source.expense),
        directOrders: Math.round(finiteNumber(source.directOrders)),
        postViewOrders: Math.round(finiteNumber(source.postViewOrders)),
        directSales: finiteNumber(source.directSales),
        postViewSales: finiteNumber(source.postViewSales),
        sourceFile: textValue(source.sourceFile, 240),
        articleSku: textValue(source.articleSku, 100),
        articleOfferId: textValue(source.articleOfferId, 240),
        articleName: textValue(source.articleName, 500),
      }];
    });
    if (!rows.length) return Response.json({ error: "В отчёте не найдены ID и названия кампаний" }, { status: 400 });

    const db = database();
    await ensureSchema(db);
    await db.prepare("DELETE FROM campaign_period_stats WHERE date_from = ? AND date_to = ?")
      .bind(payload.dateFrom, payload.dateTo)
      .run();
    for (let index = 0; index < rows.length; index += 50) {
      const batch = rows.slice(index, index + 50).flatMap((row) => {
        const statements = [db.prepare("INSERT INTO campaign_period_stats (date_from, date_to, campaign_id, campaign_name, status, format, payment_type, impressions, clicks, expense, direct_orders, post_view_orders, direct_sales, post_view_sales, source_file, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date_from, date_to, campaign_id) DO UPDATE SET campaign_name = excluded.campaign_name, status = excluded.status, format = excluded.format, payment_type = excluded.payment_type, impressions = excluded.impressions, clicks = excluded.clicks, expense = excluded.expense, direct_orders = excluded.direct_orders, post_view_orders = excluded.post_view_orders, direct_sales = excluded.direct_sales, post_view_sales = excluded.post_view_sales, source_file = excluded.source_file, imported_at = CURRENT_TIMESTAMP")
          .bind(payload.dateFrom, payload.dateTo, row.campaignId, row.campaignName, row.status, row.format, row.paymentType, row.impressions, row.clicks, Number(row.expense.toFixed(2)), row.directOrders, row.postViewOrders, Number(row.directSales.toFixed(2)), Number(row.postViewSales.toFixed(2)), row.sourceFile)];
        if (row.articleSku && row.articleOfferId) {
          statements.push(db.prepare("INSERT INTO campaign_article_mappings (campaign_id, article_sku, article_offer_id, article_name, mapping_source, updated_at) VALUES (?, ?, ?, ?, 'auto', CURRENT_TIMESTAMP) ON CONFLICT(campaign_id) DO UPDATE SET article_sku = CASE WHEN campaign_article_mappings.mapping_source = 'manual' THEN campaign_article_mappings.article_sku ELSE excluded.article_sku END, article_offer_id = CASE WHEN campaign_article_mappings.mapping_source = 'manual' THEN campaign_article_mappings.article_offer_id ELSE excluded.article_offer_id END, article_name = CASE WHEN campaign_article_mappings.mapping_source = 'manual' THEN campaign_article_mappings.article_name ELSE excluded.article_name END, updated_at = CURRENT_TIMESTAMP")
            .bind(row.campaignId, row.articleSku, row.articleOfferId, row.articleName));
        }
        return statements;
      });
      await db.batch(batch);
    }
    const totals = aggregateCampaignRows(rows);
    return Response.json({ ok: true, campaigns: rows.length, totals });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось импортировать отчёт" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { campaignId?: unknown; product?: { sku?: unknown; offerId?: unknown; name?: unknown } };
    const campaignId = textValue(payload.campaignId, 100);
    const articleSku = textValue(payload.product?.sku, 100);
    const articleOfferId = textValue(payload.product?.offerId, 240);
    const articleName = textValue(payload.product?.name, 500);
    if (!campaignId || !articleSku || !articleOfferId) return Response.json({ error: "Выберите кампанию и артикул" }, { status: 400 });
    const db = database();
    await ensureSchema(db);
    await db.prepare("INSERT INTO campaign_article_mappings (campaign_id, article_sku, article_offer_id, article_name, mapping_source, updated_at) VALUES (?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP) ON CONFLICT(campaign_id) DO UPDATE SET article_sku = excluded.article_sku, article_offer_id = excluded.article_offer_id, article_name = excluded.article_name, mapping_source = 'manual', updated_at = CURRENT_TIMESTAMP")
      .bind(campaignId, articleSku, articleOfferId, articleName)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сопоставить кампанию" }, { status: 500 });
  }
}

