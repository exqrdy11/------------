import { NextResponse } from "next/server";
import { getAdminSession, getOwnerSession } from "@/lib/admin-auth";
import { disableMarketplace, isMarketplaceDisabled } from "@/db/marketplace-connections";
import type { Marketplace } from "@/db/marketplace-credentials";

export const dynamic = "force-dynamic";

type MarketplaceConnection = {
  platform: "yandex" | "ozon";
  configured: boolean;
  disabled: boolean;
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

async function checkOzon(disabled: boolean): Promise<MarketplaceConnection> {
  const clientId = process.env.OZON_CLIENT_ID?.trim();
  const apiKey = process.env.OZON_API_KEY?.trim();
  const configured = Boolean(clientId && apiKey);
  if (disabled) return { platform: "ozon", configured, disabled: true, connected: false, accountName: null, details: [], error: null };
  if (!configured) return { platform: "ozon", configured: false, disabled: false, connected: false, accountName: null, details: [], error: null };

  try {
    // Ozon discontinued the v1 warehouse endpoint in March 2026. Keeping this
    // request on v2 makes an otherwise valid Client ID and API key verifiable.
    const response = await fetch(`${OZON_API}/v2/warehouse/list`, {
      method: "POST",
      headers: { "Client-Id": clientId, "Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!response.ok) return { platform: "ozon", configured: true, disabled: false, connected: false, accountName: null, details: [], error: safeApiError("Ozon", response.status) };
    const data = await response.json() as { result?: Array<{ name?: string; warehouse_id?: number }> };
    const warehouses = (data.result ?? []).map((warehouse) => warehouse.name?.trim()).filter((name): name is string => Boolean(name));
    return {
      platform: "ozon",
      configured: true,
      disabled: false,
      connected: true,
      accountName: "Ozon Seller",
      details: warehouses.slice(0, 3),
      error: null,
    };
  } catch {
    return { platform: "ozon", configured: true, disabled: false, connected: false, accountName: null, details: [], error: "Ozon: сервис не ответил за 12 секунд" };
  }
}

async function checkYandex(disabled: boolean): Promise<MarketplaceConnection> {
  const businessId = process.env.YANDEX_MARKET_BUSINESS_ID?.trim() || null;
  const apiKey = process.env.YANDEX_MARKET_API_KEY?.trim();
  const configured = Boolean(apiKey);
  if (disabled) return { platform: "yandex", configured, disabled: true, connected: false, accountName: null, details: [], error: null };
  if (!configured) return { platform: "yandex", configured: false, disabled: false, connected: false, accountName: null, details: [], error: null };

  try {
    const response = await fetch(`${YANDEX_MARKET_API}/v2/campaigns?limit=50`, {
      // Yandex Market uses its own Api-Key header. Authorization is only for
      // legacy OAuth tokens, so placing an API key there produces a 401.
      headers: { "Api-Key": apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!response.ok) return { platform: "yandex", configured: true, disabled: false, connected: false, accountName: null, details: [], error: safeApiError("Яндекс Маркет", response.status) };
    const data = await response.json() as { campaigns?: Array<{ id?: number; domain?: string; placementType?: string; business?: { name?: string } }> };
    const campaigns = data.campaigns ?? [];
    const details = campaigns.slice(0, 3).map((campaign) => {
      const name = campaign.business?.name?.trim() || campaign.domain?.trim() || `Кампания ${campaign.id ?? ""}`.trim();
      return campaign.placementType ? `${name} · ${campaign.placementType}` : name;
    });
    if (businessId) details.unshift(`Business ID ${businessId}`);
    return {
      platform: "yandex",
      configured: true,
      disabled: false,
      connected: true,
      accountName: campaigns.length === 1 ? details[0]?.split(" · ")[0] ?? "Яндекс Маркет" : "Яндекс Маркет",
      details,
      error: null,
    };
  } catch {
    return { platform: "yandex", configured: true, disabled: false, connected: false, accountName: null, details: [], error: "Яндекс Маркет: сервис не ответил за 12 секунд" };
  }
}

export async function GET(request: Request) {
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (session.role === "yandex-manager") {
    const disabled = await isMarketplaceDisabled(session.cabinetId, "yandex");
    return NextResponse.json({ connections: [await checkYandex(disabled)] }, { headers: { "Cache-Control": "no-store" } });
  }
  const [yandexDisabled, ozonDisabled] = await Promise.all([
    isMarketplaceDisabled(session.cabinetId, "yandex"),
    isMarketplaceDisabled(session.cabinetId, "ozon"),
  ]);
  const [yandex, ozon] = await Promise.all([checkYandex(yandexDisabled), checkOzon(ozonDisabled)]);
  return NextResponse.json({ connections: [yandex, ozon] }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return NextResponse.json({ error: "Отключать маркетплейсы может только владелец кабинета" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const payload = await request.json() as { platform?: unknown };
    const marketplace = payload.platform === "ozon" || payload.platform === "yandex" ? payload.platform as Marketplace : null;
    if (!marketplace) return NextResponse.json({ error: "Неизвестный маркетплейс" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    await disableMarketplace(session.cabinetId, marketplace);
    return NextResponse.json({ disabled: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось отключить маркетплейс" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
