import { NextResponse } from "next/server";
import { getAdminSession, getOwnerSession } from "@/lib/admin-auth";
import { marketplaceCredential, saveMarketplaceCredential, type Marketplace, type MarketplaceCredential } from "@/db/marketplace-credentials";

export const dynamic = "force-dynamic";

type MarketplaceConnection = {
  platform: "yandex" | "ozon";
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  details: string[];
  error: string | null;
};

const OZON_API = "https://api-seller.ozon.ru";
const YANDEX_MARKET_API = "https://api.partner.market.yandex.ru";

function timeoutSignal() {
  return AbortSignal.timeout(12_000);
}

function safeApiError(platform: string, status?: number) {
  if (status === 401 || status === 403) return `${platform}: ключ не подошёл или у него нет нужного доступа`;
  if (status === 429) return `${platform}: сервис временно ограничил частоту запросов`;
  if (status && status >= 500) return `${platform}: сервис временно недоступен`;
  return `${platform}: не удалось проверить подключение`;
}

async function checkOzon(credentials: MarketplaceCredential | null): Promise<MarketplaceConnection> {
  const clientId = credentials?.clientId?.trim() || process.env.OZON_CLIENT_ID?.trim();
  const apiKey = credentials?.apiKey?.trim() || process.env.OZON_API_KEY?.trim();
  if (!clientId || !apiKey) return { platform: "ozon", configured: false, connected: false, accountName: null, details: [], error: null };

  try {
    const response = await fetch(`${OZON_API}/v1/warehouse/list`, {
      method: "POST",
      headers: { "Client-Id": clientId, "Api-Key": apiKey, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!response.ok) return { platform: "ozon", configured: true, connected: false, accountName: null, details: [], error: safeApiError("Ozon", response.status) };
    const data = await response.json() as { result?: Array<{ name?: string; warehouse_id?: number }> };
    const warehouses = (data.result ?? []).map((warehouse) => warehouse.name?.trim()).filter((name): name is string => Boolean(name));
    return {
      platform: "ozon",
      configured: true,
      connected: true,
      accountName: "Ozon Seller",
      details: warehouses.slice(0, 3),
      error: null,
    };
  } catch {
    return { platform: "ozon", configured: true, connected: false, accountName: null, details: [], error: "Ozon: сервис не ответил за 12 секунд" };
  }
}

async function checkYandex(credentials: MarketplaceCredential | null): Promise<MarketplaceConnection> {
  const apiKey = credentials?.apiKey?.trim() || process.env.YANDEX_MARKET_API_KEY?.trim();
  if (!apiKey) return { platform: "yandex", configured: false, connected: false, accountName: null, details: [], error: null };

  try {
    const response = await fetch(`${YANDEX_MARKET_API}/v2/campaigns`, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!response.ok) return { platform: "yandex", configured: true, connected: false, accountName: null, details: [], error: safeApiError("Яндекс Маркет", response.status) };
    const data = await response.json() as { campaigns?: Array<{ id?: number; domain?: string; placementType?: string; business?: { name?: string } }> };
    const campaigns = data.campaigns ?? [];
    const details = campaigns.slice(0, 3).map((campaign) => {
      const name = campaign.business?.name?.trim() || campaign.domain?.trim() || `Кампания ${campaign.id ?? ""}`.trim();
      return campaign.placementType ? `${name} · ${campaign.placementType}` : name;
    });
    return {
      platform: "yandex",
      configured: true,
      connected: true,
      accountName: campaigns.length === 1 ? details[0]?.split(" · ")[0] ?? "Яндекс Маркет" : "Яндекс Маркет",
      details,
      error: null,
    };
  } catch {
    return { platform: "yandex", configured: true, connected: false, accountName: null, details: [], error: "Яндекс Маркет: сервис не ответил за 12 секунд" };
  }
}

export async function GET(request: Request) {
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const [yandexCredentials, ozonCredentials] = await Promise.all([
    marketplaceCredential(session.cabinetId, "yandex").catch(() => null),
    marketplaceCredential(session.cabinetId, "ozon").catch(() => null),
  ]);
  const [yandex, ozon] = await Promise.all([checkYandex(yandexCredentials), checkOzon(ozonCredentials)]);
  return NextResponse.json({ connections: [yandex, ozon] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Управлять API-ключами может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const payload = await request.json() as { platform?: unknown; clientId?: unknown; apiKey?: unknown };
    const marketplace = payload.platform === "ozon" || payload.platform === "yandex" ? payload.platform as Marketplace : null;
    const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
    const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
    if (!marketplace || !apiKey || apiKey.length > 1000 || (marketplace === "ozon" && (!clientId || clientId.length > 200))) {
      return NextResponse.json({ error: marketplace === "ozon" ? "Укажите Client ID и API-ключ Ozon" : "Укажите API-ключ Яндекс Маркета" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    await saveMarketplaceCredential({ cabinetId: session.cabinetId, marketplace, clientId: marketplace === "ozon" ? clientId : null, apiKey });
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось безопасно сохранить API-ключ" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
