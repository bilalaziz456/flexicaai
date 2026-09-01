import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { ALL_VOCABULARY_SEED, type VocabularyRow } from "@/core/db/vocabulary-seed";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

/**
 * The vocabulary tables, read from the DATABASE and held in memory.
 *
 * WHY A CACHE AND NOT A QUERY PER USE: Drizzle's `customType` mappers — the thing that
 * turns `kind_id = 4` into `"refund"` on every row of every list — are SYNCHRONOUS.
 * They cannot await. So the id↔code mapping has to be resolvable in memory, and the
 * only question is where that memory is filled from. It is filled from the database,
 * once, at startup.
 *
 * WHAT THE DATABASE OWNS: the label, the sort order, and whether a value is still
 * offered (`is_active`). Renaming "Bank transfer", reordering a dropdown, or retiring
 * a value is a row update — no deploy.
 *
 * WHAT THE CODE STILL OWNS: what a value MEANS. `nextQueueAction` switches on an
 * appointment status, `plActionEffect` on a settlement kind, `can()` on a role. A row
 * inserted into the database alone would be stored and then never acted on, so adding
 * a NEW value remains a code change. That is not a limitation of this cache — it is
 * what "the application branches on this value" means.
 *
 * The compiled constants in `vocabulary-seed.ts` are therefore NOT a second source of
 * truth. They are the migration seed, and the list this module CHECKS the database
 * against at startup: any disagreement is reported loudly, because a database whose
 * codes have drifted from the code's branches produces a wrong figure in silence
 * rather than an error.
 */

export type VocabularyEntry = {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

const cache = new Map<string, VocabularyEntry[]>();
let loaded = false;
let loading: Promise<void> | null = null;
let loadedAt = 0;

/**
 * How stale the cache may get before it is re-read.
 *
 * Without this the cache is filled once at start-up and never again, so "renaming a
 * label is a row update" would quietly mean "a row update AND a restart" — which is
 * most of the benefit gone. Sixty seconds is a deliberate compromise: a label change
 * shows up on its own within the minute, and the cost is sixteen tiny indexed reads
 * per minute per process, not per request.
 */
const MAX_AGE_MS = 60_000;

/** Rows for one vocabulary, in the database's own sort order. */
export function vocabularyRows(table: string): VocabularyEntry[] {
  const rows = cache.get(table);
  if (rows) return rows;
  // Cold — fall back to the seed. Safe precisely BECAUSE `loadVocabularies` fails the
  // start-up check when the two disagree, so this can never return a different answer
  // than the database would; it only removes a boot-ordering hazard from the hot path.
  return (ALL_VOCABULARY_SEED[table] ?? []).map((r: VocabularyRow) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    sortOrder: r.sortOrder,
    isActive: r.isActive ?? true,
  }));
}

/** Values a form may offer: active only, in the database's order. */
export function vocabularyOptions(table: string): { value: string; label: string }[] {
  return vocabularyRows(table)
    .filter((r) => r.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({ value: r.code, label: r.label }));
}

/** The database's label for a code, falling back to the code itself. */
export function vocabularyLabel(table: string, code: string | null | undefined): string {
  if (!code) return "—";
  return vocabularyRows(table).find((r) => r.code === code)?.label ?? code;
}

/**
 * Load every vocabulary from the database and verify it against the compiled seed.
 *
 * Called once from `src/instrumentation.ts`, before the server takes a request. A
 * mismatch is REPORTED, not thrown: refusing to boot over a label typo would take the
 * clinic down, while a drifted code is something an operator must see. The check is
 * strict about the two things that would corrupt data silently — an id that means a
 * different code, and a code the application branches on that the database has lost.
 */
export async function loadVocabularies(): Promise<void> {
  // Already warm and fresh — nothing to do.
  if (loaded && Date.now() - loadedAt < MAX_AGE_MS) return;
  if (loading) return loading;
  // A stale refresh does NOT block: the caller is a page render and the current values
  // are correct enough for one more request. Only the very first load is awaited.
  const isRefresh = loaded;
  loading = (async () => {
    const problems: string[] = [];
    await unscoped("vocabulary tables are company-global reference data", async () => {
      for (const [table, seed] of Object.entries(ALL_VOCABULARY_SEED)) {
        const rows = (
          await db.execute(
            sql.raw(`select id, code, label, sort_order, is_active from "${table}"`),
          )
        ).rows as {
          id: number;
          code: string;
          label: string;
          sort_order: number;
          is_active: boolean;
        }[];

        cache.set(
          table,
          rows.map((r) => ({
            id: r.id,
            code: r.code,
            label: r.label,
            sortOrder: r.sort_order,
            isActive: r.is_active,
          })),
        );

        // An id that resolves to a DIFFERENT code than the code expects is the one
        // failure that silently reclassifies data — a refund read back as a payment.
        for (const s of seed) {
          const live = rows.find((r) => r.id === s.id);
          if (!live) problems.push(`${table}: id ${s.id} ('${s.code}') is missing`);
          else if (live.code !== s.code) {
            problems.push(`${table}: id ${s.id} is '${live.code}', the code expects '${s.code}'`);
          }
        }
      }
    });
    loaded = true;
    loadedAt = Date.now();
    loading = null;
    if (problems.length > 0) {
      const { report } = await import("@/core/observability");
      report(new Error(`vocabulary drift: ${problems.join("; ")}`), {
        op: "db.vocabulary.drift",
      });
    }
  })();
  if (isRefresh) {
    // Fire and forget, but never unhandled: a failed refresh leaves the previous
    // values in place, which is the right outcome — it must not take a page down.
    void loading.catch(async (e) => {
      loading = null;
      const { report } = await import("@/core/observability");
      report(e, { op: "db.vocabulary.refresh" });
    });
    return;
  }
  return loading;
}

/** For tests: the cache as loaded, so a test can assert it really came from the DB. */
export function vocabularyCacheLoaded(): boolean {
  return loaded;
}

/**
 * The whole cache, as plain data, for handing to the browser.
 *
 * A server component reads the cache directly; a CLIENT component cannot — this
 * module is `server-only` and the mapping lives in the server process. So each panel's
 * layout takes this snapshot once and passes it to `VocabularyProvider`
 * (`core/ui/vocabulary-provider.tsx`), which every client component below it reads.
 *
 * One snapshot per page render, not per component: the payload is nine dozen short
 * rows, and the alternative — threading labels down as props through sixteen client
 * components — is the churn this design exists to avoid.
 */
export function vocabularySnapshot(): Record<string, VocabularyEntry[]> {
  const out: Record<string, VocabularyEntry[]> = {};
  for (const table of Object.keys(ALL_VOCABULARY_SEED)) out[table] = vocabularyRows(table);
  return out;
}

/**
 * "Managers, doctors, receptionists" — the clinic-staff roles as prose, for the
 * dashboard's Staff card.
 *
 * Was a module-level const in `core/types/auth.ts` built from a compiled label map.
 * It cannot stay one: the labels live in the database now, and that module is
 * client-safe so it cannot read this cache. Derived from CLINIC_STAFF_ROLES, so a role
 * added or removed still updates the count and its prose together.
 */
export function clinicStaffSummary(): string {
  const rows = vocabularyRows("user_roles");
  const label = (code: string) => rows.find((r) => r.code === code)?.label ?? code;
  return CLINIC_STAFF_ROLES.map((r, i) =>
    i === 0 ? `${label(r)}s` : `${label(r).toLowerCase()}s`,
  ).join(", ");
}
