/**
 * scripts/migrate.ts
 * ---------------------------------------------------------------------------
 * Applies db/schema.sql. Run with: npm run db:migrate
 *
 * Why this can't just be `psql -f schema.sql`:
 *   - Aurora DSQL allows exactly one DDL statement per transaction, and
 *     forbids mixing DDL with DML in one transaction. We run every
 *     statement as its own standalone query (db.query never wraps a single
 *     statement in an explicit transaction unless we ask it to).
 *   - CREATE INDEX ASYNC returns a job_id immediately and builds in the
 *     background. We collect every job_id and block on
 *     `SELECT sys.wait_for_job(...)` for all of them before declaring the
 *     migration done — otherwise the seed script could start inserting
 *     data before, say, the entitlement-dedup unique index is actually
 *     enforcing anything.
 *   - On the plain-Postgres fallback (DATABASE_URL, no DSQL configured),
 *     there's no ASYNC keyword or sys.jobs view, so we strip ASYNC and
 *     create the index synchronously instead — same end state, no job to
 *     wait for.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../lib/db";

/**
 * Strips `--` line comments before splitting on semicolons. Two real bugs
 * motivated this: a descriptive comment can itself contain a semicolon
 * ("-- e.g. 24 for HOURS, 7 for DAYS; null otherwise"), which truncates a
 * statement mid-way if comments are left in; and the file's prose mentions
 * the literal phrase "CREATE INDEX ASYNC" in several explanatory comments,
 * which would otherwise false-trigger the ASYNC-handling branch below for
 * statements that aren't index creations at all. Stripping comments first
 * sidesteps both. (This assumes no string literal in the schema contains
 * "--" as data, which is true for this file.)
 */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

function splitStatements(sql: string): string[] {
  return stripLineComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function firstCodeLine(statement: string): string {
  return statement.replace(/\s+/g, " ").trim().slice(0, 72);
}

async function main() {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  const statements = splitStatements(sql);

  console.log(
    `Applying ${statements.length} statements to ${db.backend === "dsql" ? "Aurora DSQL" : "local Postgres"}...\n`
  );

  const pendingJobs: string[] = [];

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const isAsyncIndex = /INDEX\s+ASYNC/i.test(statement);
    const label = firstCodeLine(statement);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${label} ... `);

    try {
      if (isAsyncIndex && db.backend === "postgres") {
        const synced = statement.replace(/INDEX\s+ASYNC/i, "INDEX");
        await db.query(synced);
        console.log("ok (sync index, local pg)");
        continue;
      }

      const { rows } = await db.query<{ job_id?: string }>(statement);
      if (isAsyncIndex && rows[0]?.job_id) {
        pendingJobs.push(rows[0].job_id);
        console.log(`ok (async job ${rows[0].job_id})`);
      } else {
        console.log("ok");
      }
    } catch (err) {
      console.log("FAILED");
      throw err;
    }
  }

  if (pendingJobs.length > 0) {
    console.log(`\nWaiting on ${pendingJobs.length} async index build(s)...`);
    for (const jobId of pendingJobs) {
      await db.query(`SELECT sys.wait_for_job($1)`, [jobId]);
      console.log(`  job ${jobId} ready`);
    }
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
