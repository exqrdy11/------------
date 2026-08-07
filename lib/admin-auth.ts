const SESSION_COOKIE = "skladno_admin";
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export const cabinetIds = ["metanutrix"] as const;
export type CabinetId = typeof cabinetIds[number];
export type CabinetSummary = { id: CabinetId; name: string; configured: boolean };
export type AdminSession = { ownerId: CabinetId; cabinetId: CabinetId };

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

function cabinetCredentials() {
  return {
    login: process.env.ADMIN_LOGIN?.trim() || "admin",
    password: process.env.ADMIN_PASSWORD || "admin",
  };
}

export function cabinetForCredentials(login: string, password: string): CabinetId | null {
  for (const cabinetId of cabinetIds) {
    const credentials = cabinetCredentials();
    if (constantTimeEqual(login, credentials.login) && constantTimeEqual(password, credentials.password)) return cabinetId;
  }
  return null;
}

function cabinetsForOwner(ownerId: CabinetId) {
  return cabinetIds.filter((cabinetId) => cabinetId === ownerId);
}

export function cabinetSummary(id: CabinetId): CabinetSummary {
  return { id, name: "Метанутрикс", configured: Boolean(process.env.WB_API_TOKEN?.trim()) };
}

export function availableCabinets(ownerId: CabinetId) {
  return cabinetsForOwner(ownerId).map(cabinetSummary);
}

export function cabinetToken(id: CabinetId) {
  return id === "metanutrix" ? process.env.WB_API_TOKEN?.trim() : undefined;
}

export async function createAdminSession(ownerId: CabinetId, cabinetId: CabinetId = ownerId) {
  if (!cabinetsForOwner(ownerId).includes(cabinetId)) throw new Error("Cabinet is not available for this access");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const payload = `v3.${ownerId}.${cabinetId}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function getAdminSession(request: Request): Promise<AdminSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const values = token.split(".");
  const version = values[0];
  const legacy = version === "v2" && values.length === 4;
  const current = version === "v3" && values.length === 5;
  if (!legacy && !current) return null;
  const ownerValue = values[1];
  const cabinetValue = legacy ? values[1] : values[2];
  const expiresAtValue = legacy ? values[2] : values[3];
  const signatureValue = legacy ? values[3] : values[4];
  if (!ownerValue || !cabinetValue || !expiresAtValue || !signatureValue || !cabinetIds.includes(ownerValue as CabinetId) || !cabinetIds.includes(cabinetValue as CabinetId)) return null;
  const ownerId = ownerValue as CabinetId;
  const cabinetId = cabinetValue as CabinetId;
  if (!cabinetsForOwner(ownerId).includes(cabinetId)) return null;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const payload = legacy ? `v2.${cabinetValue}.${expiresAtValue}` : `v3.${ownerValue}.${cabinetValue}.${expiresAtValue}`;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      fromBase64Url(signatureValue),
      encoder.encode(payload),
    );
    return verified ? { ownerId, cabinetId } : null;
  } catch {
    return null;
  }
}

export async function getAdminCabinet(request: Request): Promise<CabinetId | null> {
  return (await getAdminSession(request))?.cabinetId ?? null;
}

export async function isAdminRequest(request: Request) {
  return Boolean(await getAdminCabinet(request));
}

export function adminSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
}

export function clearAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
