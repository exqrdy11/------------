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
      items?: Array<{ sku?: unknown; quantity?: unknown; expiresAt?: unknown }>;
    };
    if (typeof payload.warehouseId !== "string" || !["replace", "add"].includes(String(payload.mode)) || !Array.isArray(payload.items)) {
      return NextResponse.json({ error: "Проверьте склад и формат импорта" }, { status: 400 });
    }
    if (payload.items.length === 0 || payload.items.length > 5000) {
      return NextResponse.json({ error: "В файле должно быть от 1 до 5 000 строк" }, { status: 400 });
    }

    const grouped = new Map<string, { sku: string; quantity: number; expiresAt?: string | null }>();
    for (const item of payload.items) {
      const sku = typeof item.sku === "string" ? item.sku.trim().slice(0, 200) : "";
      const quantity = Math.floor(Number(item.quantity));
      if (!sku || !normalizeSku(sku) || !Number.isFinite(quantity) || quantity < 0 || quantity > 10_000_000) {
        return NextResponse.json({ error: "Каждая строка должна содержать артикул и количество от 0 до 10 000 000" }, { status: 400 });
      }
      const expiresAt = item.expiresAt;
      if (expiresAt !== undefined && expiresAt !== null && (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))) {
        return NextResponse.json({ error: "Срок годности укажите в формате ГГГГ-ММ-ДД" }, { status: 400 });
      }
      const key = normalizeSku(sku);
      const current = grouped.get(key);
      const nextExpiry = expiresAt === undefined ? current?.expiresAt : (expiresAt || null);
      grouped.set(key, { sku, quantity: (current?.quantity ?? 0) + quantity, ...(nextExpiry !== undefined ? { expiresAt: nextExpiry } : {}) });
    }

    const items = [...grouped.values()];
    if (items.some((item) => item.quantity > 10_000_000)) return NextResponse.json({ error: "Количество по артикулу не должно превышать 10 000 000" }, { status: 400 });
    const result = await importFfStocks({ cabinetId: cabinet, warehouseId: payload.warehouseId, mode: payload.mode as "replace" | "add", items });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.message === "Склад не найден" ? error.message : "Не удалось загрузить остатки";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
