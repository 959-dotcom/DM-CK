import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearHandoffReplayForTests,
  consumeHandoffJti,
  decideHandoffAccount,
  HANDOFF_USER_LOOKUP_SQL,
  signDmckHandoff,
  verifyDmckHandoff,
} from "./hubHandoff.ts";

const SECRET = "handoff-test-secret-32-characters!";
const NOW = 1_700_000_000_000;
const JTI = "fixed-jti-value-0001";
const TOKEN =
  "v1.eyJpc3MiOiJkYjM1Ny1odWIiLCJhdWQiOiJkbWNrIiwiZW1haWwiOiJwZXJzb25AZXhhbXBsZS5jb20iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDA2MCwianRpIjoiZml4ZWQtanRpLXZhbHVlLTAwMDEifQ.CiLOgS2seJ9QTIOeYKBQt8U5yY15lOMm0yj14IXg7Ts";
const LAND_TOKEN =
  "v1.eyJpc3MiOiJkYjM1Ny1odWIiLCJhdWQiOiJsYW5kIiwiZW1haWwiOiJwZXJzb25AZXhhbXBsZS5jb20iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDA2MCwianRpIjoiZml4ZWQtanRpLXZhbHVlLTAwMDEifQ.0Ugo07AYBz_2b6C20KOC2btwAM5XaDeZalRUyAc0zo0";

describe("dmck handoff token", () => {
  it("matches the token the hub signs for audience dmck", () => {
    const token = signDmckHandoff("Person@Example.com", SECRET, { nowMs: NOW, jti: JTI });
    assert.equal(token, TOKEN);
    assert.equal(verifyDmckHandoff(TOKEN, SECRET, NOW)?.email, "person@example.com");
    assert.equal(verifyDmckHandoff(TOKEN, SECRET, NOW + 120_000), null);
    assert.equal(verifyDmckHandoff(LAND_TOKEN, SECRET, NOW), null);
    assert.equal(signDmckHandoff("not-an-email", SECRET, { nowMs: NOW, jti: JTI }), null);
  });

  it("accepts a token once", () => {
    clearHandoffReplayForTests();
    const claims = verifyDmckHandoff(TOKEN, SECRET, NOW);
    assert.ok(claims);
    assert.equal(consumeHandoffJti(claims.jti, claims.exp, NOW), true);
    assert.equal(consumeHandoffJti(claims.jti, claims.exp, NOW), false);
  });

  it("opens only an existing enabled account and never writes", () => {
    assert.match(HANDOFF_USER_LOOKUP_SQL, /^SELECT\b/i);
    assert.doesNotMatch(HANDOFF_USER_LOOKUP_SQL, /\b(insert|update|delete|into)\b/i);
    assert.equal(
      decideHandoffAccount([{ id: "user_1", email: "person@example.com", role: "USER", disabled: false }]).status,
      "ok",
    );
    const admin = decideHandoffAccount([
      { id: "user_admin", email: "admin@db357.com", role: "ADMIN", disabled: false },
    ]);
    assert.equal(admin.status, "ok");
    if (admin.status === "ok") assert.equal(admin.nextPath, "/admin");
    assert.equal(decideHandoffAccount([]).status, "missing");
    assert.equal(
      decideHandoffAccount([{ id: "user_1", email: "person@example.com", role: "USER", disabled: true }]).status,
      "disabled",
    );
    assert.equal(
      decideHandoffAccount([
        { id: "a", email: "person@example.com", role: "USER", disabled: false },
        { id: "b", email: "Person@example.com", role: "USER", disabled: false },
      ]).status,
      "ambiguous",
    );
  });
});
