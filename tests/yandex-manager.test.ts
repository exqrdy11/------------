import assert from "node:assert/strict";
import test from "node:test";
import { availableCabinets, createAdminSession, getAdminSession, getAuthenticatedSession, getMediaSession, getOwnerSession, sessionForCredentials } from "../lib/admin-auth.ts";

test("Yandex manager can work only in Yandex and cannot become owner or media user", async () => {
  process.env.YANDEX_MANAGER_LOGIN = "ym-test";
  process.env.YANDEX_MANAGER_PASSWORD = "test-manager-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-only";
  const session = sessionForCredentials("ym-test", "test-manager-password");
  assert.deepEqual(session, { ownerId: "metanutrix", cabinetId: "yandex", role: "yandex-manager" });
  assert.equal(sessionForCredentials("ym-test", "wrong"), null);
  assert.deepEqual(availableCabinets(session.ownerId, session.role).map(c => c.id), ["yandex"]);
  const token = await createAdminSession(session.ownerId, session.cabinetId, session.role);
  const request = new Request("https://example.com/api/target-prices", { headers: { cookie: `skladno_admin=${token}` } });
  assert.deepEqual(await getAdminSession(request), session);
  assert.equal(await getOwnerSession(request), null);
  assert.equal(await getMediaSession(request), null);
  for (const cabinet of ["metanutrix", "ozon"] as const) {
    await assert.rejects(createAdminSession(session.ownerId, cabinet, session.role));
  }
  const tampered = new Request("https://example.com", { headers: { cookie: `skladno_admin=${token.replace("yandex-manager", "owner")}` } });
  assert.equal(await getAuthenticatedSession(tampered), null);
});

test("additional owner does not replace existing owner", () => {
  process.env.OWNER_LOGIN = "owner-test";
  process.env.OWNER_PASSWORD = "owner-password";
  process.env.ADDITIONAL_OWNER_LOGIN = "second-test";
  process.env.ADDITIONAL_OWNER_PASSWORD = "second-password";
  assert.equal(sessionForCredentials("owner-test", "owner-password")?.role, "owner");
  assert.equal(sessionForCredentials("second-test", "second-password")?.role, "owner");
  assert.equal(sessionForCredentials("second-test", "wrong"), null);
  delete process.env.ADDITIONAL_OWNER_PASSWORD;
  assert.equal(sessionForCredentials("second-test", ""), null);
});
