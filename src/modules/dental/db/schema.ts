/**
 * Dental MODULE-owned Drizzle tables (CLAUDE.md §5 / docs/dental-clinical-plan.md §2).
 *
 * Specialty tables live here, NOT in core `schema.ts`, so core stays specialty-
 * agnostic. drizzle-kit picks this file up via the glob in `drizzle.config.ts`;
 * module code imports these tables and passes them to the core `db.select()` client
 * (the app uses no relational `db.query`, so the core client needs no merge). Adding
 * derma later is a new `src/modules/derma/db/schema.ts` the same glob already covers.
 *
 * Phase 0 (foundations) only proves the plumbing — no tables yet. Phase 1 adds
 * `dental_records` + `dental_charts`; Phase 2 adds `perio_exams`; Phase 6 adds
 * `lab_cases`. Core-owned clinical tables (attachments, treatment plans, medical
 * history) stay in `src/core/db/schema.ts`.
 */

// (No dental tables yet — Phase 1 adds them here.)
export {};
