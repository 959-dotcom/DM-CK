import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { isHubProjectDatabaseUrl } from "../src/lib/dmckSchema.mjs";

const url = process.env.DATABASE_URL?.trim() ?? "";
const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim() ?? "";
if (isHubProjectDatabaseUrl(url) || isHubProjectDatabaseUrl(unpooled)) {
  console.log("migrate: Hub project detected. This script does not apply SQL there.");
  console.log("migrate: Paste migrations/hub/dmck_schema.sql once in the Hub SQL editor.");
  console.log("migrate: That file does not create users and does not alter public hub tables.");
  process.exit(0);
}
const files = (await readdir("migrations").catch(() => []))
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (url === "" || files.length === 0) {
  console.log("migrate: nothing to do");
  process.exit(0);
}
// The session lock needs a direct connection: DATABASE_URL may go through a
// transaction pooler, which would keep the lock after this script exits.
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url,
});
await client.connect();
try {
  await client.query("set lock_timeout = '60s'");
  await client.query("select pg_advisory_lock(7272741)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await client.query("select name from schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );
  for (const file of files.filter((f) => !done.has(f))) {
    await client.query("begin");
    try {
      await client.query(await readFile(`migrations/${file}`, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [
        file,
      ]);
      await client.query("commit");
      console.log(`migrate: applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
