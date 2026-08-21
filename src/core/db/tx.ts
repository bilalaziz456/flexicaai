import "server-only";

import type { db } from "@/core/db";

/**
 * Transaction handles — CORE.
 *
 * `Tx` is Drizzle's transaction object, extracted from `db.transaction`'s callback so
 * it can never drift from the driver's actual type.
 *
 * `Executor` is "either the pool or an open transaction". Functions that write
 * DERIVED state take one, which lets the same function either open its own unit of
 * work or JOIN a caller's — the difference between "the sale was recorded" and "the
 * sale was recorded as part of completing the appointment" (ADR-016).
 *
 * WHY THIS MATTERS BEYOND ATOMICITY: a function handed a `Tx` must also READ through
 * it. Reads on the pool run on a different connection and cannot see the caller's
 * uncommitted changes — so a ledger that re-derives from `appointments` while the
 * status update is still open would compute from the OLD row and quietly snapshot the
 * wrong amount. Thread the executor through the reads too, not just the writes.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Executor = Tx | typeof db;
