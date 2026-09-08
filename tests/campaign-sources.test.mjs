import test from "node:test";
import assert from "node:assert/strict";
import * as view from "../lib/report-domain.mjs";

const api = [{ campaigns: [{ id: "1", dates: { "2026-09-02": { expense: 10, directSales: 50 } } }] }];
const excel = [{ campaigns: [{ id: "1", dates: {}, periodTotals: { expense: 15, directSales: 60 } }, { id: "2", dates: {}, periodTotals: { expense: 20 } }] }];

test("source selection never blends API daily cells into Excel or falls back silently", () => {
  assert.equal(typeof view.selectCampaignSource, "function");
  assert.deepEqual(view.selectCampaignSource("api", api, excel), api);
  assert.deepEqual(view.selectCampaignSource("xlsx", api, excel), excel);
  assert.deepEqual(view.selectCampaignSource("xlsx", api, []), []);
});

test("comparison matches campaign IDs and exposes campaigns absent from either source", () => {
  const result = view.compareCampaignSources(api, excel);
  assert.equal(result.apiTotals.expense, 10);
  assert.equal(result.xlsxTotals.expense, 35);
  assert.equal(result.rows.find(r => r.id === "1").expenseDelta, 5);
  assert.equal(result.rows.find(r => r.id === "2").api, null);
});

test("campaign pagination includes older campaigns beyond the first page", async () => {
  const calls = [];
  const campaigns = await view.collectCampaignPages(async page => {
    calls.push(page);
    return page === 1 ? { list: [{ id: "new" }], total: 2 } : { list: [{ id: "old" }], total: 2 };
  });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(campaigns.map(c => c.id), ["new", "old"]);
});

test("an exact Excel report does not gain campaigns from separate daily reports", () => {
  const report = view.buildCampaignReport([
    {dateFrom:"2026-09-02",dateTo:"2026-09-08",campaignId:"1",campaignName:"one",expense:15},
    {dateFrom:"2026-09-02",dateTo:"2026-09-02",campaignId:"2",campaignName:"two",expense:20},
  ],"2026-09-02","2026-09-08");
  assert.deepEqual(report.articles.flatMap(a=>a.campaigns.map(c=>c.id)),["1"]);
});
