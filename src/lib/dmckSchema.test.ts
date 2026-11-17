import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DMCK_SCHEMA, HUB_PROJECT_REF, isHubProjectDatabaseUrl } from "./dmckSchema.mjs";

const DIRECT = `postgresql://postgres:secret@db.${HUB_PROJECT_REF}.supabase.co:5432/postgres`;
const POOLER = `postgresql://postgres.${HUB_PROJECT_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;

describe("hub project detection", () => {
  it("matches the hub direct host and the pooler user", () => {
    assert.equal(DMCK_SCHEMA, "dmck");
    assert.equal(isHubProjectDatabaseUrl(DIRECT), true);
    assert.equal(isHubProjectDatabaseUrl(POOLER), true);
    assert.equal(isHubProjectDatabaseUrl(`  ${DIRECT}  `), true);
  });

  it("leaves every other database on public", () => {
    assert.equal(isHubProjectDatabaseUrl(""), false);
    assert.equal(isHubProjectDatabaseUrl("   "), false);
    assert.equal(isHubProjectDatabaseUrl(undefined), false);
    assert.equal(
      isHubProjectDatabaseUrl("postgresql://postgres:secret@db.fahkknzinragbeizymny.supabase.co:5432/postgres"),
      false,
    );
    assert.equal(
      isHubProjectDatabaseUrl("postgresql://spin:secret@ep-old-dmck.example.com:5432/spinlytics"),
      false,
    );
  });
});

describe("hub schema sql", () => {
  it("builds schema dmck with plans and no users", async () => {
    const sql = await readFile(new URL("../../migrations/hub/dmck_schema.sql", import.meta.url), "utf8");
    assert.match(sql, /CREATE SCHEMA IF NOT EXISTS dmck/i);
    assert.doesNotMatch(sql, /\binsert\s+into\s+(dmck\.)?users\b/i);
    assert.doesNotMatch(sql, /\b(hub_profiles|user_app_permissions|security_audit_logs)\b/i);
    assert.doesNotMatch(sql, /\bdrop\s+schema\b/i);
    assert.doesNotMatch(sql, /\bpublic\.(plans|users|transactions|domains)\b/i);

    const db = new PGlite();
    await db.exec(sql);
    await db.exec("SET search_path TO dmck");

    const schemas = await db.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname = 'dmck'",
    );
    assert.equal(schemas.rows.length, 1);

    const publicUsers = await db.query<{ rel: string | null }>(
      "SELECT to_regclass('public.users') AS rel",
    );
    assert.equal(publicUsers.rows[0]?.rel ?? null, null);

    const users = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM users");
    assert.equal(users.rows[0]?.count, 0);

    const plans = await db.query<{ id: string }>("SELECT id FROM plans ORDER BY sort_order");
    assert.deepEqual(
      plans.rows.map((row) => row.id),
      ["plan_free", "plan_starter", "plan_standard", "plan_pro", "plan_business"],
    );

    const lookup = await db.query(
      `SELECT id, email, role, COALESCE(disabled, FALSE) AS disabled
       FROM users
       WHERE lower(email) = $1`,
      ["person@example.com"],
    );
    assert.equal(lookup.rows.length, 0);
    await db.close();
  });
});
