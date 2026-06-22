/**
 * lib/db.ts
 * ---------------------------------------------------------------------------
 * Single entry point for all database access.
 *
 * Two backends are supported behind one interface (`db.query`, `db.transaction`):
 *
 *  1. Amazon Aurora DSQL  (production target for this hackathon)
 *     - Used automatically when PGHOST or DSQL_ENDPOINT is set.
 *     - Connects with the official `@aws/aurora-dsql-node-postgres-connector`,
 *       which signs IAM auth tokens for you and refreshes them per-connection.
 *     - On Vercel, installing the "Amazon Aurora DSQL" integration from the
 *       Vercel Marketplace sets PGHOST / PGUSER / PGDATABASE / PGPORT /
 *       AWS_REGION / AWS_ROLE_ARN automatically, and credentials are obtained
 *       via Vercel OIDC federation — no AWS access keys ever touch your
 *       environment variables. See @vercel/oidc-aws-credentials-provider below.
 *     - Locally, just `aws configure` (or export AWS_ACCESS_KEY_ID /
 *       AWS_SECRET_ACCESS_KEY) and set DSQL_ENDPOINT in .env.local — the
 *       connector falls back to the standard AWS credential provider chain.
 *
 *  2. Plain PostgreSQL (DATABASE_URL)
 *     - Optional fast-path for local development before a DSQL cluster
 *       exists, or for CI. Same schema (db/schema.sql) works on both,
 *       with the one exception that the OCC-conflict (40001) retry behavior
 *       described below is a DSQL-only phenomenon — see note in
 *       lib/allocation.ts.
 *
 * Why a hand-rolled `transaction()` wrapper instead of calling pg directly?
 * Aurora DSQL uses optimistic concurrency control: two transactions can
 * both proceed as if uncontended, and the conflict is only discovered when
 * one of them commits. The loser receives a `40001` serialization failure.
 * AWS's official connector ships a `.transaction()` helper that retries the
 * whole callback automatically on `40001` — we lean on that for DSQL, and
 * provide an equivalent (simpler — Postgres resolves this via row locks
 * instead of commit-time errors) implementation for the plain-pg fallback so
 * application code never has to branch on which backend it's talking to.
 */

import { Pool as PgPool, type PoolClient } from "pg";
import {
  AuroraDSQLPool,
  isOCCError,
  type AuroraDSQLPoolConfig,
} from "@aws/aurora-dsql-node-postgres-connector";

export type DbClient = PoolClient;

interface Db {
  backend: "dsql" | "postgres" | "demo";
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  transaction<T>(
    fn: (client: DbClient) => Promise<T>,
    options?: { maxRetries?: number }
  ): Promise<T>;
}

let cached: Db | null = null;

function buildDsqlPool(): AuroraDSQLPool {
  const host = process.env.PGHOST || process.env.DSQL_ENDPOINT;
  if (!host) {
    throw new Error(
      "Aurora DSQL host not configured. Set PGHOST (via the Vercel Aurora DSQL " +
        "integration) or DSQL_ENDPOINT (manual setup) in your environment."
    );
  }

  const config: AuroraDSQLPoolConfig = {
    host,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "postgres",
    user: process.env.PGUSER || "admin",
    region: process.env.AWS_REGION || undefined,
    max: Number(process.env.DSQL_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    // OCC retry tuned for "field worker tapping a button" latency expectations
    // (NFR1): a handful of fast retries, not a long backoff ladder.
    retry: { maxRetries: 4, baseDelayMs: 40, maxDelayMs: 400, jitterFactor: 0.3 },
  };

  // On Vercel with the Aurora DSQL integration + OIDC federation installed,
  // AWS_ROLE_ARN is present and we exchange the Vercel-issued OIDC token for
  // short-lived AWS credentials — no static keys anywhere.
  if (process.env.AWS_ROLE_ARN) {
    // Imported lazily so this optional dependency never has to resolve in
    // environments (e.g. local dev against plain Postgres) that don't use it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { awsCredentialsProvider } = require("@vercel/oidc-aws-credentials-provider");
    config.customCredentialsProvider = awsCredentialsProvider({
      roleArn: process.env.AWS_ROLE_ARN,
      clientConfig: { region: process.env.AWS_REGION },
    });
  }
  // Otherwise the connector falls back to the default AWS credential
  // provider chain (env vars, shared ~/.aws/credentials, instance role, ...).

  const pool = new AuroraDSQLPool(config);
  pool.on("error", (err) => {
    console.error("Aurora DSQL pool error (connection dropped, pool recovers automatically):", err);
  });

  // Keeps this Vercel Function instance warm long enough for idle pooled
  // connections to drain cleanly instead of being cut mid-flight.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { attachDatabasePool } = require("@vercel/functions");
    attachDatabasePool(pool);
  } catch {
    // Not running on Vercel (e.g. local dev) — nothing to attach to.
  }

  return pool;
}

function buildPgPool(): PgPool {
  const pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DSQL_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
  });
  // node-postgres Pools emit 'error' when an idle pooled connection hits a
  // network/backend issue. With no listener, Node treats that as an
  // uncaught EventEmitter error and can take the whole process down — so
  // this log-and-continue handler is load-bearing, not decorative.
  pool.on("error", (err) => {
    console.error("Postgres pool error (connection dropped, pool recovers automatically):", err);
  });
  return pool;
}

function isDemoMode(): boolean {
  const v = process.env.DEMO_MODE;
  return v === "1" || v === "true";
}

/**
 * Zero-dependency demo backend: an in-process PGlite (WASM Postgres) that is
 * migrated and seeded automatically on first use. Lets the whole app run with
 * no external database at all (`DEMO_MODE=1 npm run dev`) so every screen is
 * clickable out of the box. Data lives only in this process — it resets on
 * restart, which is exactly what a throwaway demo wants. PGlite is a single
 * connection, so it can't reproduce DSQL's commit-time OCC `40001` (the same
 * caveat as plain Postgres), but the conditional UPDATEs still make the race
 * demo resolve to one winner.
 */
function buildDemoDb(): Db {
  type PGliteType = import("@electric-sql/pglite").PGlite;
  let pglite: PGliteType | null = null;
  let schemaReady: Promise<void> | null = null;
  let fullReady: Promise<void> | null = null;
  let seeding = false;

  function shape(res: { rows: unknown[]; affectedRows?: number }) {
    return { rows: res.rows as never, rowCount: res.affectedRows ?? res.rows.length };
  }

  function ensureStarted() {
    if (schemaReady) return;
    schemaReady = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      pglite = new PGlite();
      await pglite.waitReady;
      const directQuery = async (sql: string, params?: unknown[]) =>
        shape(await pglite!.query(sql, params ?? []));
      const { applySchema } = await import("../scripts/migrate");
      await applySchema(false, directQuery as never);
    })();
    fullReady = (async () => {
      await schemaReady;
      seeding = true;
      try {
        const { seedDemoData } = await import("../scripts/seed");
        await seedDemoData();
      } finally {
        seeding = false;
      }
    })();
  }

  // External callers wait for schema AND seed; the seed's own queries (issued
  // while `seeding` is true) only wait for the schema, so they don't deadlock
  // on the seed step they are part of.
  async function gate() {
    ensureStarted();
    await (seeding ? schemaReady! : fullReady!);
  }

  return {
    backend: "demo",
    async query(sql, params) {
      await gate();
      return shape(await pglite!.query(sql, params as unknown[]));
    },
    async transaction(fn) {
      await gate();
      return pglite!.transaction(async (tx) => {
        const client = {
          query: async (sql: string, params?: unknown[]) => shape(await tx.query(sql, params ?? [])),
        };
        return fn(client as unknown as DbClient);
      }) as never;
    },
  };
}

function getDb(): Db {
  if (cached) return cached;

  if (isDemoMode()) {
    cached = buildDemoDb();
    return cached;
  }

  const useDsql = Boolean(process.env.PGHOST || process.env.DSQL_ENDPOINT);

  if (useDsql) {
    const pool = buildDsqlPool();
    cached = {
      backend: "dsql",
      async query(sql, params) {
        const res = await pool.query(sql, params as unknown[]);
        return { rows: res.rows as never, rowCount: res.rowCount };
      },
      async transaction(fn, options) {
        return pool.transaction(fn, {
          maxRetries: options?.maxRetries ?? 4,
        });
      },
    };
    return cached;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "No database configured. Set PGHOST/DSQL_ENDPOINT for Aurora DSQL, " +
        "or DATABASE_URL for a plain Postgres database during local dev."
    );
  }

  const pool = buildPgPool();
  cached = {
    backend: "postgres",
    async query(sql, params) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as never, rowCount: res.rowCount };
    },
    async transaction(fn, options) {
      const maxRetries = options?.maxRetries ?? 4;
      let attempt = 0;
      for (;;) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          const code = (err as { code?: string }).code;
          const retryable = code === "40001" || code === "40P01";
          if (retryable && attempt < maxRetries) {
            attempt += 1;
            await new Promise((r) => setTimeout(r, 40 * attempt));
            continue;
          }
          throw err;
        } finally {
          client.release();
        }
      }
    },
  };
  return cached;
}

export const db = {
  get backend() {
    return getDb().backend;
  },
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) {
    return getDb().query<T>(sql, params);
  },
  transaction<T>(fn: (client: DbClient) => Promise<T>, options?: { maxRetries?: number }) {
    return getDb().transaction(fn, options);
  },
};

export { isOCCError };
