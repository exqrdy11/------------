import { yandexMarketCredentials } from "@/lib/admin-auth";

export const YANDEX_MARKET_API = "https://api.partner.market.yandex.ru";

export type YandexMarketApiError = Error & { status?: number; retryAfterSeconds?: number };

function retryAfterSeconds(response: Response) {
  const seconds = Number(response.headers.get("Retry-After") ?? response.headers.get("X-Ratelimit-Retry"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

export async function yandexMarketFetch<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const credentials = yandexMarketCredentials();
  if (!credentials) {
    const error = new Error("Ключ Яндекс Маркета не настроен на сервере") as YandexMarketApiError;
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${YANDEX_MARKET_API}${path}`, {
    ...init,
    cache: "no-store",
    signal,
    headers: {
      "Api-Key": credentials.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`Yandex Market API ${response.status}`) as YandexMarketApiError;
    error.status = response.status;
    if (response.status === 429) error.retryAfterSeconds = retryAfterSeconds(response);
    throw error;
  }
  return response.json() as Promise<T>;
}

export function yandexMarketErrorMessage(section: string, error: unknown) {
  const status = (error as YandexMarketApiError)?.status;
  if (status === 401 || status === 403) return `${section}: ключ Яндекс Маркета не подошёл или у него нет нужного доступа`;
  if (status === 429) return `${section}: Яндекс Маркет временно ограничил частоту запросов`;
  if (status === 503) return "Ключ Яндекс Маркета не настроен на сервере";
  if ((error as Error)?.name === "AbortError") return `${section}: Яндекс Маркет отвечает дольше 25 секунд`;
  return `${section}: данные Яндекс Маркета временно недоступны`;
}

export function isYandexMarketConfigured() {
  return Boolean(yandexMarketCredentials());
}
