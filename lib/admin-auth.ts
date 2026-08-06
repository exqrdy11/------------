const SESSION_COOKIE = "skladno_admin";
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

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

export function verifyAdminCredentials(login: string, password: string) {
  const expectedLogin = process.env.ADMIN_LOGIN?.trim() || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  return constantTimeEqual(login, expectedLogin) && constantTimeEqual(password, expectedPassword);
}

export async function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const payload = `v1.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function isAdminRequest(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [version, expiresAtValue, signatureValue, ...extra] = token.split(".");
  if (version !== "v1" || !expiresAtValue || !signatureValue || extra.length) return false;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  try {
    return crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      fromBase64Url(signatureValue),
      encoder.encode(`${version}.${expiresAtValue}`),
    );
  } catch {
    return false;
  }
}

export function adminSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
}

export function clearAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
