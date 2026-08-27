/** Pure date and replenishment calculations for fulfillment warehouses. */

import type { UserRole } from "./admin-auth";

export type FfPlanningOperation = "read" | "refresh" | "write-settings";

export function ffPlanningRoleCan(role: UserRole | null, operation: FfPlanningOperation) {
  if (!role) return false;
  return operation === "write-settings" ? role === "owner" : role === "owner" || role === "viewer";
}

export type PlanningPeriodInput = {
  from: string;
  to: string;
  openedAt?: string | null;
};

export type EffectivePeriod = {
  from: string;
  to: string;
  days: number;
};

export type FfPlanInput = PlanningPeriodInput & {
  demand: number;
  sold?: number;
  freeStock: number;
  targetCoverageDays: number;
  ffId?: string;
  sku?: string;
  productKey?: string;
  nmId?: string | number;
};

export type FfPlan = {
  ffId?: string;
  sku?: string;
  productKey?: string;
  nmId?: string | number;
  from: string;
  to: string;
  effectiveDays: number;
  demand: number;
  sold: number;
  freeStock: number;
  averageDemandPerDay: number;
  coverageDays: number | null;
  targetCoverageDays: number;
  targetStock: number;
  recommendedSupply: number;
};

export type SupplyPlanGroup = {
  key: string;
  sku?: string;
  productKey?: string;
  nmId?: string | number;
  demand: number;
  sold: number;
  freeStock: number;
  averageDemandPerDay: number;
  coverageDays: number | null;
  targetStock: number;
  recommendedSupply: number;
  plans: FfPlan[];
};

const DAY_MS = 86_400_000;

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Некорректная дата: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Некорректная дата: ${value}`);
  }
  return timestamp;
}

export function effectivePeriod(input: PlanningPeriodInput): EffectivePeriod {
  const selectedFrom = parseDate(input.from);
  const to = parseDate(input.to);
  const opened = input.openedAt ? parseDate(input.openedAt) : selectedFrom;
  if (selectedFrom > to) throw new Error("Дата начала позже даты окончания");
  const selectedDays = Math.floor((to - selectedFrom) / DAY_MS) + 1;
  if (selectedDays > 90) throw new Error("Период не может быть больше 90 дней");
  const fromMs = Math.max(selectedFrom, opened);
  const days = fromMs > to ? 0 : Math.floor((to - fromMs) / DAY_MS) + 1;
  return { from: new Date(fromMs).toISOString().slice(0, 10), to: input.to, days };
}

export function calculateFfPlan(input: FfPlanInput): FfPlan {
  const period = effectivePeriod(input);
  const demand = Number.isFinite(input.demand) ? Math.max(0, input.demand) : 0;
  const sold = Number.isFinite(input.sold ?? 0) ? Math.max(0, input.sold ?? 0) : 0;
  const freeStock = Number.isFinite(input.freeStock) ? Math.max(0, input.freeStock) : 0;
  const targetCoverageDays = Number.isFinite(input.targetCoverageDays) ? Math.max(0, input.targetCoverageDays) : 0;
  const averageDemandPerDay = period.days ? demand / period.days : 0;
  const coverageDays = averageDemandPerDay > 0 ? freeStock / averageDemandPerDay : null;
  const targetStock = Math.ceil(averageDemandPerDay * targetCoverageDays);
  return {
    ffId: input.ffId, sku: input.sku, productKey: input.productKey, nmId: input.nmId,
    from: period.from, to: period.to, effectiveDays: period.days, demand, sold, freeStock,
    averageDemandPerDay, coverageDays, targetCoverageDays, targetStock,
    recommendedSupply: Math.max(0, targetStock - freeStock),
  };
}

export function groupSupplyPlans(inputs: FfPlanInput[]): SupplyPlanGroup[] {
  const groups = new Map<string, FfPlan[]>();
  for (const input of inputs) {
    const key = String(input.productKey ?? input.sku ?? input.nmId ?? "");
    const plans = groups.get(key) ?? [];
    plans.push(calculateFfPlan(input));
    groups.set(key, plans);
  }
  return [...groups].map(([key, plans]) => {
    const demand = plans.reduce((sum, plan) => sum + plan.demand, 0);
    const sold = plans.reduce((sum, plan) => sum + plan.sold, 0);
    const freeStock = plans.reduce((sum, plan) => sum + plan.freeStock, 0);
    const targetStock = plans.reduce((sum, plan) => sum + plan.targetStock, 0);
    const recommendedSupply = plans.reduce((sum, plan) => sum + plan.recommendedSupply, 0);
    const averageDemandPerDay = plans.reduce((sum, plan) => sum + plan.averageDemandPerDay, 0);
    return {
      key, sku: plans[0].sku, productKey: plans[0].productKey, nmId: plans[0].nmId,
      demand, sold, freeStock, averageDemandPerDay,
      coverageDays: averageDemandPerDay > 0 ? freeStock / averageDemandPerDay : null,
      targetStock, recommendedSupply, plans,
    };
  });
}
