import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";

type ObservedFbsOrder = {
  id: number;
  warehouseId: number | null;
  createdAt: string | null;
  state: "before" | "handover";
};

type TimingRow = {
  warehouseId: string;
  sampleSize: number;
  averageHours: number;
};

export type HandoverTiming = {
  sampleSize: number;
  averageHours: number | null;
};

export type HandoverMetrics = {
  overall: HandoverTiming;
  byWbWarehouse: Record<string, HandoverTiming>;
  trackingStartedAt: string | null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS fbs_order_handover_metrics (
    cabinet_id TEXT NOT NULL,
    order_id INTEGER NOT NULL,
    warehouse_id TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    first_state TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    handed_over_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (cabinet_id, order_id)
  )
`;
const createIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_fbs_handover_cabinet_warehouse_completed
  ON fbs_order_handover_metrics (cabinet_id, warehouse_id, handed_over_at)
`;

let initializePromise: Promise<D1Database> | null = null;

async function getMetricsDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.batch([d1.prepare(createTableSql), d1.prepare(createIndexSql)]);
      return d1;
    })();
  }
  return initializePromise;
}

function isParsableDate(value: string | null) {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

/**
 * WB does not expose the timestamp of the FBS handover. We therefore record a
 * payable handover only when the dashboard first sees the order before handover
 * and later sees it in `complete`. An order that was already in delivery on
 * the first observation is deliberately not backdated: this prevents charging
 * the same unit twice during the initial reconciliation.
 */
export async function recordFbsHandoverObservations(input: { cabinetId: CabinetId; orders: ObservedFbsOrder[]; observedAt?: string }) {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const d1 = await getMetricsDb();
  const statements: D1PreparedStatement[] = [];

  for (const order of input.orders) {
    if (!isParsableDate(order.createdAt)) continue;
    const state = order.state;
    const warehouseId = order.warehouseId ? String(order.warehouseId) : "unknown";
    const createdAt = new Date(order.createdAt!).toISOString();
    statements.push(
      d1.prepare(`
        INSERT OR IGNORE INTO fbs_order_handover_metrics
          (cabinet_id, order_id, warehouse_id, created_at, first_state, first_seen_at, handed_over_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      `).bind(input.cabinetId, order.id, warehouseId, createdAt, state, observedAt, observedAt),
      d1.prepare(`
        UPDATE fbs_order_handover_metrics
        SET
          warehouse_id = CASE WHEN handed_over_at IS NULL THEN ? ELSE warehouse_id END,
          created_at = CASE WHEN handed_over_at IS NULL THEN ? ELSE created_at END,
          handed_over_at = CASE
            WHEN handed_over_at IS NULL AND first_state = 'before' AND ? = 'handover' THEN ?
            ELSE handed_over_at
          END,
          updated_at = ?
        WHERE cabinet_id = ? AND order_id = ?
      `).bind(warehouseId, createdAt, state, observedAt, observedAt, input.cabinetId, order.id),
    );
  }

  for (let index = 0; index < statements.length; index += 100) {
    await d1.batch(statements.slice(index, index + 100));
  }
}

export async function fbsHandoverMetrics(cabinetId: CabinetId): Promise<HandoverMetrics> {
  const d1 = await getMetricsDb();
  const [byWarehouseResult, overallResult, startedResult] = await Promise.all([
    d1.prepare(`
      SELECT warehouse_id AS warehouseId,
        COUNT(*) AS sampleSize,
        AVG((strftime('%s', handed_over_at) - strftime('%s', created_at)) / 3600.0) AS averageHours
      FROM fbs_order_handover_metrics
      WHERE cabinet_id = ?
        AND handed_over_at IS NOT NULL
        AND handed_over_at >= datetime('now', '-30 days')
        AND strftime('%s', handed_over_at) >= strftime('%s', created_at)
      GROUP BY warehouse_id
    `).bind(cabinetId).all<TimingRow>(),
    d1.prepare(`
      SELECT COUNT(*) AS sampleSize,
        AVG((strftime('%s', handed_over_at) - strftime('%s', created_at)) / 3600.0) AS averageHours
      FROM fbs_order_handover_metrics
      WHERE cabinet_id = ?
        AND handed_over_at IS NOT NULL
        AND handed_over_at >= datetime('now', '-30 days')
        AND strftime('%s', handed_over_at) >= strftime('%s', created_at)
    `).bind(cabinetId).first<TimingRow>(),
    d1.prepare("SELECT MIN(first_seen_at) AS trackingStartedAt FROM fbs_order_handover_metrics WHERE cabinet_id = ?").bind(cabinetId).first<{ trackingStartedAt: string | null }>(),
  ]);
  const byWbWarehouse = Object.fromEntries((byWarehouseResult.results ?? []).map((row) => [row.warehouseId, {
    sampleSize: Math.max(0, Number(row.sampleSize) || 0),
    averageHours: Number.isFinite(Number(row.averageHours)) ? Number(row.averageHours) : null,
  }]));
  const sampleSize = Math.max(0, Number(overallResult?.sampleSize) || 0);
  const averageHours = Number(overallResult?.averageHours);
  return {
    overall: { sampleSize, averageHours: sampleSize && Number.isFinite(averageHours) ? averageHours : null },
    byWbWarehouse,
    trackingStartedAt: startedResult?.trackingStartedAt ?? null,
  };
}
