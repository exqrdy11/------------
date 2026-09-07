import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("media user is isolated to the media advertising module", async () => {
  const [auth, loginRoute, sessionRoute, page, envExample] = await Promise.all([
    readFile(new URL("lib/admin-auth.ts", root), "utf8"),
    readFile(new URL("app/api/auth/login/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/session/route.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(auth, /UserRole = "owner" \| "viewer" \| "media"/);
  assert.match(auth, /MEDIA_LOGIN/);
  assert.match(auth, /MEDIA_PASSWORD/);
  assert.match(auth, /export async function getAuthenticatedSession/);
  assert.match(auth, /export async function getMediaSession/);
  assert.match(loginRoute, /session\.role === "media" \? \[\]/);
  assert.match(sessionRoute, /getAuthenticatedSession/);
  assert.match(page, /const mediaOnly = role === "media"/);
  assert.match(page, /mediaOnly \? "rnp"/);
  assert.match(envExample, /^MEDIA_LOGIN=/m);
  assert.match(envExample, /^MEDIA_PASSWORD=/m);
});

test("every media API route accepts only an authenticated media-capable session", async () => {
  const routes = [
    "app/api/rnp/campaign-reports/route.ts",
    "app/api/rnp/media-queries/route.ts",
    "app/api/rnp/notes/route.ts",
    "app/api/rnp/ozon/products/route.ts",
    "app/api/rnp/ozon/queries/route.ts",
    "app/api/rnp/ozon/route.ts",
    "app/api/rnp/settings/period/route.ts",
    "app/api/rnp/tasks/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(route, root), "utf8");
    assert.match(source, /getMediaSession/);
    assert.match(source, /status:\s*401/);
  }
});
