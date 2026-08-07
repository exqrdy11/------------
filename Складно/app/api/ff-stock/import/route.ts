import { NextResponse } from "next/server";
import { importFfStocks, normalizeSku } from "@/db/ff-stocks";
import { getAdminCabinet } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cabinet = await getAdminCabinet(request);
  if (!cabinet) return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  try {
    const payload = await request.json() as {
      warehouseId?: unknown;
      mode?: unknown;
      items?: Array<{ sku?: unknown; nmId?: unknown; quantity?: unknown; batchCode?: unknown; expiresAt?: unknown }>;
    };
    if (typeof payload.warehouseId !== "string" || !["replace", "add"].includes(String(payload.mode)) || !Array.isArray(payload.items)) {
      return NextResponse.json({ error: "Проверьте склад и формат импорта" }, { status: 400 });
    }
    if (payload.items.length === 0 || payload.items.length > 5000) {
      return NextResponse.json({ error: "В файле должно быть от 1 до 5 000 строк" }, { status: 400 });
    }

    const grouped = new Map<string, { sku: string; nmId: number | null; quantity: number; batchCode: string; expiresAt?: string | null }>();
    for (const item of payload.items) {
      const sku = typeof item.sku === "string" ? item.sku.trim().slice(0, 200) : "";
      const rawNmId = item.nmId === undefined || item.nmId === null || item.nmId === "" ? null : Number(item.nmId);
      const nmId = rawNmId !== null && Number.isInteger(rawNmId) && rawNmId > 0 && rawNmId <= 2_147_483_647 ? rawNmId : null;
      const batchCode = typeof item.batchCode === "string" ? item.batchCode.trim().slice(0, 120) : "";
      const quantity = Math.floor(Number(item.quantity));
      if ((!sku && !nmId) || (rawNmId !== null && !nmId) || !Number.isFinite(quantity) || quantity < 0 || quantity > 10_000_000) {
        return NextResponse.json({ error: "Каждая строка должна содержать артикул WB или артикул продавца и количество от 0 до 10 000 000" }, { status: 400 });
      }
      const expiresAt = item.expiresAt;
      if (expiresAt !== undefined && expiresAt !== null && (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))) {
        return NextResponse.json({ error: "Срок годности укажите в формате ГГГГ-ММ-ДД" }, { status: 400 });
      }
      const key = `${nmId ? `nm:${nmId}` : `sku:${normalizeSku(sku)}`}\u0000${batchCode}\u0000${expiresAt ?? ""}`;
      const current = grouped.get(key);
      grouped.set(key, { sku, nmId, batchCode, quantity: (current?.quantity ?? 0) + quantity, ...(expiresAt !== undefined ? { expiresAt: expiresAt || null } : {}) });
    }

    const items = [...grouped.values()];
    if (items.some((item) => item.quantity > 10_000_000)) return NextResponse.json({ error: "Количество по партии не должно превышать 10 000 000" }, { status: 400 });
    const result = await importFfStocks({ cabinetId: cabinet, warehouseId: payload.warehouseId, mode: payload.mode as "replace" | "add", items });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.message === "Склад не найден" ? error.message : "Не удалось загрузить остатки";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
