import assert from "node:assert/strict";
import test from "node:test";
import { availableCabinets, createAdminSession, getAdminSession, getAuthenticatedSession, getMediaSession, getOwnerSession, sessionForCredentials } from "../lib/admin-auth.ts";

test("WB manager can access WB only, not owner privileges, media or other cabinets", async () => {
  process.env.WB_MANAGER_LOGIN = "wb-test";
  process.env.WB_MANAGER_PASSWORD = "test-wb-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-only";
  const session = sessionForCredentials("wb-test", "test-wb-password");
  assert.deepEqual(session, { ownerId: "metanutrix", cabinetId: "metanutrix", role: "wb-manager" });
  assert.equal(sessionForCredentials("wb-test", "wrong"), null);
  assert.deepEqual(availableCabinets(session.ownerId, session.role).map(c => c.id), ["metanutrix"]);
  const token = await createAdminSession(session.ownerId, session.cabinetId, session.role);
  const request = new Request("https://example.com/api/target-prices", { headers: { cookie: `skladno_admin=${token}` } });
  assert.deepEqual(await getAdminSession(request), session);
  assert.equal(await getOwnerSession(request), null);
  assert.equal(await getMediaSession(request), null);
  for (const cabinet of ["ozon", "yandex"] as const) {
    await assert.rejects(createAdminSession(session.ownerId, cabinet, session.role));
  }
  const tampered = new Request("https://example.com", { headers: { cookie: `skladno_admin=${token.replace("wb-manager", "owner")}` } });
  assert.equal(await getAuthenticatedSession(tampered), null);
  delete process.env.WB_MANAGER_PASSWORD;
  assert.equal(sessionForCredentials("wb-test", ""), null);
});
