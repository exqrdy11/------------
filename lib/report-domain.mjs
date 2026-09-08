export function normalizeReportKey(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "");
}

export function articleReferenceMatches(reference, article) {
  const normalized = normalizeReportKey(reference);
  const skuKey = normalizeReportKey(article.sku);
  const offerKey = normalizeReportKey(article.offerId);
  const legacyMediaKey = normalized.startsWith("media") ? normalized.slice("media".length) : normalized;
  return normalized === skuKey || legacyMediaKey === offerKey || legacyMediaKey.startsWith(offerKey);
}

export function matchCampaignProduct(campaignName, products) {
  const campaignKey = normalizeReportKey(campaignName);
  return [...products]
    .filter((product) => {
      const offerKey = normalizeReportKey(product.offerId);
      return offerKey.length >= 3 && campaignKey.startsWith(offerKey);
    })
    .sort((left, right) => normalizeReportKey(right.offerId).length - normalizeReportKey(left.offerId).length)[0] ?? null;
}

export function aggregateCampaignRows(rows) {
  const totals = rows.reduce((sum, row) => ({
    views: sum.views + Number(row.impressions || 0),
    clicks: sum.clicks + Number(row.clicks || 0),
    expense: sum.expense + Number(row.expense || 0),
    directOrders: sum.directOrders + Number(row.directOrders || 0),
    modelOrders: sum.modelOrders + Number(row.postViewOrders || 0),
    directSales: sum.directSales + Number(row.directSales || 0),
    modelSales: sum.modelSales + Number(row.postViewSales || 0),
  }), { views: 0, clicks: 0, expense: 0, directOrders: 0, modelOrders: 0, directSales: 0, modelSales: 0 });
  const totalOrders = totals.directOrders + totals.modelOrders;
  const totalSales = totals.directSales + totals.modelSales;
  return {
    ...totals,
    totalOrders,
    totalSales,
    ctr: totals.views ? totals.clicks / totals.views * 100 : 0,
    drr: totalSales ? totals.expense / totalSales * 100 : 0,
  };
}

export function aggregateMediaQueryRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const campaignName = String(row.campaignName ?? "").trim();
    const campaignId = "campaign:" + normalizeReportKey(campaignName);
    const queryKey = normalizeReportKey(row.query);
    const key = campaignId + "\u001f" + queryKey;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...row, campaignId });
      continue;
    }
    current.impressions += Number(row.impressions || 0);
    current.clicks += Number(row.clicks || 0);
    current.expense += Number(row.expense || 0);
    current.cpm = current.impressions ? current.expense / current.impressions * 1_000 : Number(row.cpm || current.cpm || 0);
    const files = new Set(String(current.sourceFile || "").split(", ").filter(Boolean));
    if (row.sourceFile) files.add(row.sourceFile);
    current.sourceFile = [...files].join(", ");
  }
  return [...grouped.values()];
}

function normalizedHeader(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function columnIndexByAliases(headers, aliases) {
  const wanted = aliases.map(normalizedHeader);
  return headers.map(normalizedHeader).findIndex((header) => wanted.includes(header));
}

export function campaignRowsFromMatrix(matrix, sourceFile, products) {
  const headerIndex = matrix.findIndex((row) => columnIndexByAliases(row, ["ID кампании", "ID"]) >= 0
    && columnIndexByAliases(row, ["Название кампании"]) >= 0
    && columnIndexByAliases(row, ["Расход"]) >= 0);
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex];
  const columns = {
    id: columnIndexByAliases(headers, ["ID кампании", "ID"]),
    name: columnIndexByAliases(headers, ["Название кампании"]),
    status: columnIndexByAliases(headers, ["Статус"]),
    format: columnIndexByAliases(headers, ["Формат"]),
    paymentType: columnIndexByAliases(headers, ["Тип оплаты"]),
    impressions: columnIndexByAliases(headers, ["Показы"]),
    clicks: columnIndexByAliases(headers, ["Клики"]),
    expense: columnIndexByAliases(headers, ["Расход"]),
    directOrders: columnIndexByAliases(headers, ["Продано товаров"]),
    postViewOrders: columnIndexByAliases(headers, ["Продано товаров после просмотра"]),
    directSales: columnIndexByAliases(headers, ["Продажи"]),
    postViewSales: columnIndexByAliases(headers, ["Продажи после просмотра"]),
  };
  const number = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return matrix.slice(headerIndex + 1).flatMap((row) => {
    const campaignId = String(row[columns.id] ?? "").trim();
    const campaignName = String(row[columns.name] ?? "").trim();
    if (!campaignId || !campaignName) return [];
    const product = matchCampaignProduct(campaignName, products);
    const statusKey = normalizedHeader(row[columns.status]);
    const paymentKey = normalizedHeader(row[columns.paymentType] ?? campaignName);
    return [{
      campaignId,
      campaignName,
      status: ["активна", "active", "running", "запущена"].includes(statusKey) ? "running" : "paused",
      format: String(row[columns.format] ?? "Медийная реклама").trim() || "Медийная реклама",
      paymentType: paymentKey.includes("cpm") || paymentKey === "показы" || /(?:^|[_\s.-])CPM(?:$|[_\s.-])/iu.test(campaignName) ? "CPM" : "CPC",
      impressions: Math.round(number(row[columns.impressions])),
      clicks: Math.round(number(row[columns.clicks])),
      expense: number(row[columns.expense]),
      directOrders: Math.round(number(row[columns.directOrders])),
      postViewOrders: Math.round(number(row[columns.postViewOrders])),
      directSales: number(row[columns.directSales]),
      postViewSales: number(row[columns.postViewSales]),
      sourceFile,
      articleSku: product?.sku ?? "",
      articleOfferId: product?.offerId ?? "",
      articleName: product?.name ?? "",
    }];
  });
}

export function buildCampaignReport(_rows, _dateFrom, _dateTo) {
  const rows = _rows;
  const dateFrom = _dateFrom;
  const dateTo = _dateTo;
  const exactRows = rows.filter((row) => row.dateFrom === dateFrom && row.dateTo === dateTo);
  const dailyRows = rows.filter((row) => row.dateFrom === row.dateTo && row.dateFrom >= dateFrom && row.dateFrom <= dateTo);
  const exact = exactRows.length > 0;
  const periodRows = exact ? exactRows : dailyRows;
  const byCampaign = new Map();

  for (const row of periodRows) {
    const current = byCampaign.get(row.campaignId) ?? { period: [], daily: [] };
    current.period.push(row);
    byCampaign.set(row.campaignId, current);
  }
  for (const row of dailyRows) {
    const current = byCampaign.get(row.campaignId) ?? { period: [], daily: [] };
    current.daily.push(row);
    byCampaign.set(row.campaignId, current);
  }

  const cellFromRows = (sourceRows) => {
    const totals = aggregateCampaignRows(sourceRows);
    return {
      views: totals.views,
      clicks: totals.clicks,
      expense: totals.expense,
      directOrders: totals.directOrders,
      modelOrders: totals.modelOrders,
      directSales: totals.directSales,
      modelSales: totals.modelSales,
    };
  };

  const articleGroups = new Map();
  for (const [campaignId, group] of byCampaign) {
    const source = group.period[0] ?? group.daily[0];
    if (!source) continue;
    const mapped = Boolean(source.articleSku && source.articleOfferId);
    const articleKey = mapped ? source.articleSku : "unmapped";
    const article = articleGroups.get(articleKey) ?? {
      sku: articleKey,
      offerId: mapped ? source.articleOfferId : "Без артикула",
      name: mapped ? source.articleName : "РК, которые пока не сопоставлены с товаром Ozon",
      source: mapped ? "imported" : "unmapped",
      campaigns: [],
    };
    const dates = Object.fromEntries(group.daily.map((row) => [row.dateFrom, cellFromRows([row])]));
    article.campaigns.push({
      id: String(campaignId),
      name: source.campaignName,
      type: source.format || "Медийная реклама",
      paymentType: source.paymentType === "CPM" ? "CPM" : "CPC",
      status: source.status === "running" ? "running" : "paused",
      dates,
      periodTotals: cellFromRows(group.period.length ? group.period : group.daily),
      sourceFile: source.sourceFile || "",
      mappingSource: source.mappingSource || (mapped ? "auto" : "unmapped"),
    });
    articleGroups.set(articleKey, article);
  }

  const articles = [...articleGroups.values()]
    .map((article) => ({ ...article, campaigns: article.campaigns.sort((a, b) => a.name.localeCompare(b.name, "ru")) }))
    .sort((a, b) => a.sku === "unmapped" ? 1 : b.sku === "unmapped" ? -1 : a.offerId.localeCompare(b.offerId, "ru"));

  return {
    exact,
    totals: aggregateCampaignRows(periodRows),
    articles,
    sourceFiles: [...new Set(periodRows.map((row) => row.sourceFile).filter(Boolean))],
  };
}

export function mergeCampaignReportArticles(importedArticles, apiArticles) {
  if (!importedArticles.length) return apiArticles;
  const apiCampaigns = new Map(apiArticles.flatMap((article) => article.campaigns.map((campaign) => [String(campaign.id), campaign])));
  return importedArticles.map((article) => ({
    ...article,
    campaigns: article.campaigns.map((campaign) => {
      const apiCampaign = apiCampaigns.get(String(campaign.id));
      return {
        ...campaign,
        dates: { ...(apiCampaign?.dates ?? {}), ...(campaign.dates ?? {}) },
      };
    }),
  }));
}

export function periodFromReportFilename(filename) {
  const match = String(filename).match(/(\d{1,2})[._-](\d{1,2})[._-](\d{4}|\d{2})\s*[-–—]\s*(\d{1,2})[._-](\d{1,2})[._-](\d{4}|\d{2})/u);
  if (!match) return null;
  const year = (value) => value.length === 2 ? "20" + value : value;
  return {
    dateFrom: year(match[3]) + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0"),
    dateTo: year(match[6]) + "-" + match[5].padStart(2, "0") + "-" + match[4].padStart(2, "0"),
  };
}

export function campaignReportImportPeriod(filename, selectedPeriod) {
  const period = periodFromReportFilename(filename) ?? selectedPeriod;
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!period || !validDate(period.dateFrom) || !validDate(period.dateTo) || period.dateFrom > period.dateTo) return null;
  return { dateFrom: period.dateFrom, dateTo: period.dateTo };
}
