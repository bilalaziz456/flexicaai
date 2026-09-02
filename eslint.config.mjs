import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Direct database access is banned from the app layer (ADR-014).
 *
 * Every query belongs in a `core/<domain>` module that takes `clinicId` first. A
 * query written inline in a page or action is one more place to forget `byClinic()`
 * or `notDeleted()`, it can't be unit-tested, and it can't be reused — which is how
 * 77 files ended up each holding a slightly different version of the same read.
 *
 * This began as a RATCHET with an exemption list of those 77 files, shrinking as each
 * was migrated. **The list reached zero on 2026-08-22 and the exemption block is
 * gone**, so the rule now applies to all of `src/app/**` with no escape hatch. Don't
 * reintroduce one: if a new page needs data, the query goes in `core`.
 *
 * Type-only imports are allowed: `import type { Patient } from "@/core/db/schema"` is
 * erased at compile time and carries no query with it, so banning it would only push
 * callers into re-declaring row shapes by hand, which the conventions warn against.
 *
 * One trap worth knowing if you ever edit this file: a config that fails to PARSE
 * reports zero problems, which reads exactly like passing. After changing the rule,
 * prove it still fires by adding a deliberate `import { db } from "@/core/db"` to any
 * app file and watching it fail.
 */
const DB_IMPORT_MESSAGE =
  "Don't query the database from the app layer (ADR-014). Put the query in a core/<domain> module that takes clinicId first, and call that. Type-only imports are fine.";

/**
 * The dependency direction is a lint rule now, not a convention (architecture §3).
 *
 * Allowed: app → config/modules → modules → core, and app → core. Everything else is
 * banned outright, in both directions that matter:
 *
 *   core → modules            the whole point of the core/module split (ADR-001)
 *   core → config             the registry names specialties, so this is the same leak
 *   core → app                a shared module reaching into one panel is not shared
 *   app/<group> → app/<other> a route group used as a library (ADR-019)
 *
 * WHY IT IS ENFORCED RATHER THAN DOCUMENTED. Two breaches survived a long time
 * precisely because nothing checked: `core/ai/scribe-job.ts` imported the registry to
 * resolve a scribe prompt, and `core/ui/account-forms.tsx` imported its Server Actions
 * from `@/app/account/actions`. Both were found by hand while auditing something else,
 * which is not a process. ADR-014 already proved the shape that works — the machine
 * holds the count at zero, and a violation fails the build instead of waiting to be
 * noticed.
 *
 * Type-only imports are allowed for the same reason as the DB rule above: they are
 * erased at compile time, so they carry no dependency into the bundle, and banning
 * them would only push callers into re-declaring shapes by hand.
 *
 * The same trap applies here as to the rule above: a config that fails to PARSE
 * reports zero problems, which reads exactly like passing. Prove it still fires with a
 * deliberate violation before believing it.
 */
const CORE_BOUNDARY_MESSAGE =
  "core/ must not import from app/, config/ or modules/ (architecture §3). Core cannot know a specialty exists: take the contribution as a parameter and let the registry or the app hand it down — see config/module-scribe.ts and config/module-trash.ts.";

const ROUTE_GROUP_MESSAGE =
  "A route group is a routing boundary, not a library (ADR-019). Anything two panels share belongs in core/ui (presentation) or core/<domain> (logic).";

/** The route groups under src/app, each banned from importing any of the others. */
const ROUTE_GROUPS = ["account", "admin", "clinic", "doctor", "reception", "api"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/core/db", message: DB_IMPORT_MESSAGE, allowTypeImports: true },
            { name: "@/core/db/schema", message: DB_IMPORT_MESSAGE, allowTypeImports: true },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/config/*", "@/modules/*"],
              message: CORE_BOUNDARY_MESSAGE,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // One block per route group: the DB ban above, plus a ban on every other group.
  ...ROUTE_GROUPS.map((group) => ({
    files: [`src/app/${group}/**/*.ts`, `src/app/${group}/**/*.tsx`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/core/db", message: DB_IMPORT_MESSAGE, allowTypeImports: true },
            { name: "@/core/db/schema", message: DB_IMPORT_MESSAGE, allowTypeImports: true },
          ],
          patterns: [
            {
              group: ROUTE_GROUPS.filter((g) => g !== group).map((g) => `@/app/${g}/*`),
              message: ROUTE_GROUP_MESSAGE,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  })),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
