import { ozonCredentials } from "@/lib/admin-auth";

export const OZON_SELLER_API = "https://api-seller.ozon.ru";

export type OzonApiError = Error & { status?: number; retryAfterSeconds?: number };

function retryAfterSeconds(response: Response) {
  const seconds = Number(response.headers.get("Retry-After") ?? response.headers.get("X-Ratelimit-Retry"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

export async function ozonFetch<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const credentials = ozonCredentials();
  if (!credentials) {
    const error = new Error("Ключи Ozon не настроены на сервере") as OzonApiError;
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${OZON_SELLER_API}${path}`, {
    ...init,
    cache: "no-store",
    signal,
    headers: {
      "Client-Id": credentials.clientId,
      "Api-Key": credentials.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`Ozon API ${response.status}`) as OzonApiError;
    error.status = response.status;
    if (response.status === 429) error.retryAfterSeconds = retryAfterSeconds(response);
    throw error;
  }
  return response.json() as Promise<T>;
}

export function ozonErrorMessage(section: string, error: unknown) {
  const status = (error as OzonApiError)?.status;
  if (status === 401 || status === 403) return `${section}: ключ Ozon не подошёл или у него нет нужного доступа`;
  if (status === 429) return `${section}: Ozon временно ограничил частоту запросов`;
  if (status === 503) return "Ключи Ozon не настроены на сервере";
  if ((error as Error)?.name === "AbortError") return `${section}: Ozon отвечает дольше 25 секунд`;
  return `${section}: данные Ozon временно недоступны`;
}

export function isOzonConfigured() {
  return Boolean(ozonCredentials());
}
