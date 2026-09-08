export async function archiveCampaignReport(db, dateFrom, dateTo) {
  return db.prepare(`INSERT INTO campaign_deleted_reports (date_from, date_to, deleted_at)
    SELECT date_from, date_to, CURRENT_TIMESTAMP FROM campaign_period_stats
    WHERE date_from = ? AND date_to = ? GROUP BY date_from, date_to
    ON CONFLICT(date_from, date_to) DO UPDATE SET deleted_at = excluded.deleted_at`)
    .bind(dateFrom, dateTo).run();
}
