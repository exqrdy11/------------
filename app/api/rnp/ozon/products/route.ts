import { env } from "cloudflare:workers";
import { getMediaSession } from "@/lib/admin-auth";

type SellerSecrets = {
  OZON_SELLER_CLIENT_ID?: string;
  OZON_SELLER_API_KEY?: string;
  OZON_CLIENT_ID?: string;
  OZON_API_KEY?: string;
};
type ProductListItem = { product_id?: string | number; offer_id?: string };
type ProductInfoItem = { id?: string | number; sku?: string | number; offer_id?: string; name?: string; is_archived?: boolean };

async function sellerJson(path: string, body: unknown, secrets: Required<SellerSecrets>) {
  const response = await fetch("https://api-seller.ozon.ru" + path, {
    method: "POST",
    headers: { "Client-Id": secrets.OZON_SELLER_CLIENT_ID, "Api-Key": secrets.OZON_SELLER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("Seller API: " + response.status);
  return payload;
}

export async function GET(request: Request) {
  if (!await getMediaSession(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const runtime = env as unknown as SellerSecrets;
    const clientId = runtime.OZON_SELLER_CLIENT_ID ?? runtime.OZON_CLIENT_ID;
    const apiKey = runtime.OZON_SELLER_API_KEY ?? runtime.OZON_API_KEY;
    if (!clientId || !apiKey) {
      return Response.json({ error: "Seller API не подключён" }, { status: 503 });
    }
    const secrets = { OZON_SELLER_CLIENT_ID: clientId, OZON_SELLER_API_KEY: apiKey };
    const list = await sellerJson("/v3/product/list", { filter: { visibility: "ALL" }, last_id: "", limit: 1000 }, secrets) as {
      result?: { items?: ProductListItem[] };
    };
    const listed = list.result?.items ?? [];
    const ids = listed.map((item) => String(item.product_id ?? "")).filter(Boolean);
    const details = ids.length
      ? await sellerJson("/v3/product/info/list", { product_id: ids }, secrets) as { items?: ProductInfoItem[] }
      : { items: [] };
    const fallbackOffers = new Map(listed.map((item) => [String(item.product_id ?? ""), item.offer_id ?? ""]));
    const products = (details.items ?? [])
      .filter((item) => !item.is_archived && item.sku != null)
      .map((item) => ({
        sku: String(item.sku),
        offerId: item.offer_id || fallbackOffers.get(String(item.id ?? "")) || String(item.sku),
        name: item.name || "Товар Ozon",
      }))
      .sort((left, right) => left.offerId.localeCompare(right.offerId, "ru"));
    return Response.json({ products });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить список товаров" }, { status: 502 });
  }
}
