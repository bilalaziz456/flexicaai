import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import type { Logger } from "drizzle-orm";
import { Pool } from "pg";
import { serverEnv } from "@/core/lib/env";
import * as schema from "@/core/db/schema";
import { checkSql } from "@/core/db/tenant-guard";

/**
 * The one database entry point for the whole app. SERVER ONLY — importing this
 * anywhere near a Client Component is a bug ("server-only" makes that a build
 * error). The browser never talks to Postgres; it goes through Server Actions
 * and Route Handlers, which use this.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE WE USE DRIZZLE vs RAW SQL  (read this before writing a query)
 * ─────────────────────────────────────────────────────────────────────────
 * Default to DRIZZLE. It is a thin query builder that compiles straight to SQL,
 * so it is ~as fast as raw for ordinary work, and it gives us type-safety,
 * autocompletion, and refactor-safety. Use it for:
 *   • CRUD (insert/select/update/delete) on one or a few tables
 *   • simple joins and filters (always filter by clinic_id for tenant data)
 *   • anything touched often enough that type-safety pays off
 *
 * Drop to RAW SQL (via `db.execute(sql\`...\`)`, SAME pool, no extra client) for:
 *   • heavy analytics / reporting aggregations (e.g. the owner "Revenue
 *     Recovered" dashboard: window functions, date_trunc rollups, GROUP BY
 *     CUBE) where hand-written SQL is clearer and easier to tune
 *   • Postgres features the builder expresses awkwardly (CTEs with recursion,
 *     rich full-text search, JSON aggregation, LATERAL joins)
 *   • a specific hot query proven slow by EXPLAIN ANALYZE that needs a shape
 *     the builder won't produce
 *
 * Both run on THIS pool — never create a second Pool. The real speed levers are
 * indexes (see schema.ts), pooling (here), and avoiding N+1 — not the choice of
 * Drizzle vs raw. Remember DB queries are milliseconds; the AI scribe is seconds.
 *
 * Example raw usage:
 *   import { sql } from "drizzle-orm";
 *   await db.execute(sql`SELECT ... FROM visits WHERE clinic_id = ${clinicId}`);
 * (Template values are parameterised — safe from SQL injection.)
 */

// Reuse the pool across HMR reloads in dev; otherwise every edit leaks a pool.
const globalForDb = globalThis as unknown as {
  __klenicPool?: Pool;
};

const pool =
  globalForDb.__klenicPool ??
  new Pool({
    connectionString: serverEnv.DATABASE_URL,
    // Keep the local pool modest; tune when we move to a real deployment.
    max: 10,
  });

if (serverEnv.NODE_ENV !== "production") {
  globalForDb.__klenicPool = pool;
}

// Tenant-scope guard: a Drizzle logger runs `checkSql` before every statement
// (covers builder queries, `db.execute` raw SQL, and transactions) — defense-in-depth
// for a forgotten `byClinic()`. It's a read-only hook, so it can't corrupt the query
// pipeline; in strict mode `checkSql` throws, which rejects the offending query. See
// tenant-guard.ts.
const tenantGuardLogger: Logger = {
  logQuery(query: string): void {
    checkSql(query);
  },
};

export const db = drizzle(pool, { schema, logger: tenantGuardLogger });

export { schema };
