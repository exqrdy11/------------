const origin = (process.env.SKLADNO_INTERNAL_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "");
const login = process.env.OWNER_LOGIN?.trim() || process.env.ADMIN_LOGIN?.trim();
const password = process.env.OWNER_PASSWORD || process.env.ADMIN_PASSWORD;

if (!login || !password) throw new Error("Для планового обновления не настроены OWNER_LOGIN/OWNER_PASSWORD");

function moscowDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function daysBefore(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

const loginResponse = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ login, password }),
});
const loginPayload = await json(loginResponse);
if (!loginResponse.ok) throw new Error(loginPayload.error || `Вход для планового обновления завершился HTTP ${loginResponse.status}`);

const setCookie = loginResponse.headers.getSetCookie?.()[0] || loginResponse.headers.get("set-cookie") || "";
const cookie = setCookie.split(";", 1)[0];
if (!cookie.includes("=")) throw new Error("Сервер не вернул cookie для планового обновления");

const to = moscowDate();
const from = daysBefore(to, 89);
const refreshResponse = await fetch(`${origin}/api/ff-planning`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    Cookie: cookie,
  },
  body: JSON.stringify({ action: "refresh", from, to }),
});
const refreshPayload = await json(refreshResponse);
if (!refreshResponse.ok) {
  const warning = Array.isArray(refreshPayload.warnings) ? refreshPayload.warnings.join(" · ") : "";
  throw new Error(refreshPayload.error || warning || `Обновление анализа завершилось HTTP ${refreshResponse.status}`);
}

process.stdout.write(`Снимок анализа ФФ обновлён: ${from} — ${to}; сохранён ${refreshPayload.updatedAt || "без отметки времени"}\n`);
