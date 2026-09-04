export type CatalogProduct = { sku: string; offerId: string; name: string };

export type CampaignImportRow = {
  campaignId: string;
  campaignName: string;
  status: "running" | "paused";
  format: string;
  paymentType: "CPM" | "CPC";
  impressions: number;
  clicks: number;
  expense: number;
  directOrders: number;
  postViewOrders: number;
  directSales: number;
  postViewSales: number;
  sourceFile: string;
  articleSku: string;
  articleOfferId: string;
  articleName: string;
};

export function normalizeReportKey(value: unknown): string;
export function articleReferenceMatches(reference: string, article: { sku: string; offerId: string }): boolean;
export function matchCampaignProduct(campaignName: string, products: CatalogProduct[]): CatalogProduct | null;
export function aggregateCampaignRows(rows: Array<Record<string, unknown>>): Record<string, number>;
export function aggregateMediaQueryRows<T>(rows: T[]): T[];
export function periodFromReportFilename(filename: string): { dateFrom: string; dateTo: string } | null;
export function campaignRowsFromMatrix(matrix: unknown[][], sourceFile: string, products: CatalogProduct[]): CampaignImportRow[];
export function buildCampaignReport(rows: Array<Record<string, unknown>>, dateFrom: string, dateTo: string): {
  exact: boolean;
  totals: Record<string, number>;
  articles: unknown[];
  sourceFiles: string[];
};
export function mergeCampaignReportArticles<T>(importedArticles: T[], apiArticles: T[]): T[];

