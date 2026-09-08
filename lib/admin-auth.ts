const SESSION_COOKIE = "skladno_admin";
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export const cabinetIds = ["metanutrix", "ozon", "yandex"] as const;
export type CabinetId = typeof cabinetIds[number];
export type MarketplaceKind = "wb" | "ozon" | "yandex";
export type CabinetSummary = { id: CabinetId; name: string; configured: boolean; marketplace: MarketplaceKind };
export type UserRole = "owner" | "viewer" | "media";
export type AdminSession = { ownerId: CabinetId; cabinetId: CabinetId; role: UserRole };

function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "skladno-local-development-session-secret";
  throw new Error("ADMIN_SESSION_SECRET is not configured");
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function ownerCredentials() {
  return {
    login: process.env.OWNER_LOGIN?.trim() || process.env.ADMIN_LOGIN?.trim() || "admin",
    password: process.env.OWNER_PASSWORD || process.env.ADMIN_PASSWORD || "admin",
  };
}

function viewerCredentials() {
  return {
    login: process.env.GUEST_LOGIN?.trim() || "Metanutrix",
    password: process.env.GUEST_PASSWORD || "5566rino",
  };
}

function mediaCredentials() {
  const login = process.env.MEDIA_LOGIN?.trim();
  const password = process.env.MEDIA_PASSWORD;
  return login && password ? { login, password } : null;
}

export function sessionForCredentials(login: string, password: string): AdminSession | null {
  const owner = ownerCredentials();
  if (constantTimeEqual(login, owner.login) && constantTimeEqual(password, owner.password)) {
    return { ownerId: "metanutrix", cabinetId: "metanutrix", role: "owner" };
  }
  const additionalLogin = process.env.ADDITIONAL_OWNER_LOGIN?.trim();
  const additionalPassword = process.env.ADDITIONAL_OWNER_PASSWORD;
  if (additionalLogin && additionalPassword && constantTimeEqual(login, additionalLogin) && constantTimeEqual(password, additionalPassword)) {
    return { ownerId: "metanutrix", cabinetId: "metanutrix", role: "owner" };
  }
  const viewer = viewerCredentials();
  if (constantTimeEqual(login, viewer.login) && constantTimeEqual(password, viewer.password)) {
    return { ownerId: "metanutrix", cabinetId: "metanutrix", role: "viewer" };
  }
  const media = mediaCredentials();
  if (media && constantTimeEqual(login, media.login) && constantTimeEqual(password, media.password)) {
    return { ownerId: "metanutrix", cabinetId: "metanutrix", role: "media" };
  }
  return null;
}

function cabinetsForOwner(ownerId: CabinetId): readonly CabinetId[] {
  // One login manages all of the seller's marketplace cabinets. Each cabinet
  // still has a separate D1 namespace and can never see another cabinet's data.
  return ownerId === "metanutrix" ? cabinetIds : [];
}

export function cabinetSummary(id: CabinetId): CabinetSummary {
  if (id === "ozon") {
    return {
      id,
      name: "Ozon Seller",
      configured: Boolean(process.env.OZON_CLIENT_ID?.trim() && process.env.OZON_API_KEY?.trim()),
      marketplace: "ozon",
    };
  }
  if (id === "yandex") {
    return {
      id,
      name: "Яндекс Маркет",
      configured: Boolean(process.env.YANDEX_MARKET_API_KEY?.trim() && process.env.YANDEX_MARKET_BUSINESS_ID?.trim()),
      marketplace: "yandex",
    };
  }
  return { id, name: "Метанутрикс", configured: Boolean(process.env.WB_API_TOKEN?.trim()), marketplace: "wb" };
}

export function availableCabinets(ownerId: CabinetId) {
  return cabinetsForOwner(ownerId).map(cabinetSummary);
}

export function cabinetToken(id: CabinetId) {
  return id === "metanutrix" ? process.env.WB_API_TOKEN?.trim() : undefined;
}

export function cabinetMarketplace(id: CabinetId): MarketplaceKind {
  if (id === "ozon") return "ozon";
  if (id === "yandex") return "yandex";
  return "wb";
}

export function ozonCredentials() {
  const clientId = process.env.OZON_CLIENT_ID?.trim();
  const apiKey = process.env.OZON_API_KEY?.trim();
  return clientId && apiKey ? { clientId, apiKey } : null;
}

export function yandexMarketCredentials() {
  const apiKey = process.env.YANDEX_MARKET_API_KEY?.trim();
  const businessId = Number(process.env.YANDEX_MARKET_BUSINESS_ID?.trim());
  return apiKey && Number.isInteger(businessId) && businessId > 0 ? { apiKey, businessId } : null;
}

export async function createAdminSession(ownerId: CabinetId, cabinetId: CabinetId = ownerId, role: UserRole = "owner") {
  if (!cabinetsForOwner(ownerId).includes(cabinetId)) throw new Error("Cabinet is not available for this access");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const payload = `v4.${ownerId}.${cabinetId}.${role}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function getAuthenticatedSession(request: Request): Promise<AdminSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const values = token.split(".");
  const version = values[0];
  const current = version === "v4" && values.length === 6;
  if (!current) return null;
  const ownerValue = values[1];
  const cabinetValue = values[2];
  const roleValue = values[3];
  const expiresAtValue = values[4];
  const signatureValue = values[5];
  if (!ownerValue || !cabinetValue || !roleValue || !expiresAtValue || !signatureValue || !cabinetIds.includes(ownerValue as CabinetId) || !cabinetIds.includes(cabinetValue as CabinetId) || !["owner", "viewer", "media"].includes(roleValue)) return null;
  const ownerId = ownerValue as CabinetId;
  const cabinetId = cabinetValue as CabinetId;
  const role = roleValue as UserRole;
  if (!cabinetsForOwner(ownerId).includes(cabinetId)) return null;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const payload = `v4.${ownerValue}.${cabinetValue}.${roleValue}.${expiresAtValue}`;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      fromBase64Url(signatureValue),
      encoder.encode(payload),
    );
    return verified ? { ownerId, cabinetId, role } : null;
  } catch {
    return null;
  }
}

export async function getAdminSession(request: Request): Promise<AdminSession | null> {
  const session = await getAuthenticatedSession(request);
  return session?.role === "media" ? null : session;
}

export async function getMediaSession(request: Request): Promise<AdminSession | null> {
  return getAuthenticatedSession(request);
}

export async function getAdminCabinet(request: Request): Promise<CabinetId | null> {
  return (await getAdminSession(request))?.cabinetId ?? null;
}

export async function getOwnerSession(request: Request): Promise<AdminSession | null> {
  const session = await getAdminSession(request);
  return session?.role === "owner" ? session : null;
}

export async function isAdminRequest(request: Request) {
  return Boolean(await getOwnerSession(request));
}

export function adminSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
}

export function clearAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
