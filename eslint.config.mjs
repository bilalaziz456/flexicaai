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
