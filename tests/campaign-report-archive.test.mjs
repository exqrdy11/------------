import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { archiveCampaignReport } from "../db/campaign-report-archive.mjs";

test("removing an upload hides only that exact period and preserves its rows for recovery", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE campaign_period_stats(date_from TEXT,date_to TEXT); CREATE TABLE campaign_deleted_reports(date_from TEXT,date_to TEXT,deleted_at TEXT,PRIMARY KEY(date_from,date_to)); INSERT INTO campaign_period_stats VALUES('2026-09-02','2026-09-08'),('2026-09-02','2026-09-07');");
  const db = {prepare: query => ({bind: (...args) => ({run: () => sql.prepare(query).run(...args)})})};
  await archiveCampaignReport(db,"2026-09-02","2026-09-08");
  assert.equal(sql.prepare("SELECT count(*) n FROM campaign_period_stats").get().n,2);
  assert.deepEqual(sql.prepare("SELECT date_to FROM campaign_deleted_reports").all().map(r=>r.date_to),["2026-09-08"]);
  await archiveCampaignReport(db,"2099-01-01","2099-01-02");
  assert.equal(sql.prepare("SELECT count(*) n FROM campaign_deleted_reports").get().n,1);
  sql.close();
});
