import { getD1 } from "./index";
import type { CabinetId } from "@/lib/admin-auth";

export type Marketplace = "ozon" | "yandex";
export type MarketplaceCredential = { clientId: string | null; apiKey: string };

const createMarketplaceCredentialsTableSql = `
  CREATE TABLE IF NOT EXISTS marketplace_credentials (
    cabinet_id TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    client_id TEXT,
    api_key_ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cabinet_id, marketplace)
  )
`;

let initializePromise: Promise<D1Database> | null = null;

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

function encryptionSeed() {
  const seed = process.env.MARKETPLACE_SECRETS_KEY?.trim() || process.env.ADMIN_SESSION_SECRET?.trim();
  if (seed) return seed;
  if (process.env.NODE_ENV !== "production") return "skladno-local-marketplace-credentials";
  throw new Error("Не задан ключ защиты API-данных");
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSeed()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return toBase64Url(combined);
}

async function decrypt(value: string) {
  const combined = fromBase64Url(value);
  if (combined.length <= 12) throw new Error("Не удалось прочитать сохранённый API-ключ");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, await encryptionKey(), combined.slice(12));
  return new TextDecoder().decode(decrypted);
}

async function getCredentialsDb() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const d1 = getD1();
      await d1.prepare(createMarketplaceCredentialsTableSql).run();
      return d1;
    })();
  }
  return initializePromise;
}

export async function marketplaceCredential(cabinetId: CabinetId, marketplace: Marketplace): Promise<MarketplaceCredential | null> {
  const d1 = await getCredentialsDb();
  const row = await d1.prepare("SELECT client_id, api_key_ciphertext FROM marketplace_credentials WHERE cabinet_id = ? AND marketplace = ?").bind(cabinetId, marketplace).first<{ client_id: string | null; api_key_ciphertext: string }>();
  if (!row) return null;
  return { clientId: row.client_id?.trim() || null, apiKey: await decrypt(row.api_key_ciphertext) };
}

export async function saveMarketplaceCredential(input: { cabinetId: CabinetId; marketplace: Marketplace; clientId?: string | null; apiKey: string }) {
  const d1 = await getCredentialsDb();
  const clientId = input.clientId?.trim() || null;
  const apiKeyCiphertext = await encrypt(input.apiKey.trim());
  await d1.prepare(`
    INSERT INTO marketplace_credentials (cabinet_id, marketplace, client_id, api_key_ciphertext, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(cabinet_id, marketplace) DO UPDATE SET
      client_id = excluded.client_id,
      api_key_ciphertext = excluded.api_key_ciphertext,
      updated_at = CURRENT_TIMESTAMP
  `).bind(input.cabinetId, input.marketplace, clientId, apiKeyCiphertext).run();
}
