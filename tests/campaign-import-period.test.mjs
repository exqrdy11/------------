import assert from "node:assert/strict";
import test from "node:test";
import * as reports from "../lib/report-domain.mjs";

test("Ozon filename with one date uses the selected period, not the export date", () => {
  assert.equal(typeof reports.campaignReportImportPeriod, "function");
  assert.deepEqual(reports.campaignReportImportPeriod("Статистика по кампаниям_08.09.26-2.xlsx", {
    dateFrom: "2026-09-01", dateTo: "2026-09-07",
  }), { dateFrom: "2026-09-01", dateTo: "2026-09-07" });
});

test("a complete filename period still takes precedence", () => {
  assert.deepEqual(reports.campaignReportImportPeriod("campaign_statistics_10.08.26-16.08.26.xlsx", {
    dateFrom: "2026-09-01", dateTo: "2026-09-07",
  }), { dateFrom: "2026-08-10", dateTo: "2026-08-16" });
});

test("confirmation rejects missing, reversed and impossible dates; accepts a single day", () => {
  for (const period of [undefined, { dateFrom: "", dateTo: "2026-09-07" },
    { dateFrom: "2026-09-08", dateTo: "2026-09-07" },
    { dateFrom: "2026-02-30", dateTo: "2026-03-01" }]) {
    assert.equal(reports.campaignReportImportPeriod("", period), null);
  }
  assert.deepEqual(reports.campaignReportImportPeriod("", {
    dateFrom: "2026-09-08", dateTo: "2026-09-08",
  }), { dateFrom: "2026-09-08", dateTo: "2026-09-08" });
});
