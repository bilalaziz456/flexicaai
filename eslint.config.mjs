import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Direct database access is banned from the app layer (ADR-014).
 *
 * Every query belongs in a `core/<domain>` module that takes `clinicId` first. A
 * query written inline in a page or action is one more place to forget `byClinic()`
 * or `notDeleted()`, it can't be unit-tested, and it can't be reused — which is how
 * dozens of files ended up each holding a slightly different version of the same read.
 *
 * This is a RATCHET, not a big-bang refactor. The rule applies to all of
 * `src/app/**`; the files that predate it are exempted below. **That list may only
 * ever shrink.** It is the debt counter: when it reaches zero, delete the exemption
 * block and the rule stands on its own. Never add to it — if a new page needs data,
 * the query goes in `core`.
 *
 * Type-only imports are allowed: `import type { Patient } from "@/core/db/schema"` is
 * erased at compile time and carries no query with it, so banning it would only push
 * callers into re-declaring row shapes by hand, which the conventions warn against.
 */
const DB_IMPORT_MESSAGE =
  "Don't query the database from the app layer (ADR-014). Put the query in a core/<domain> module that takes clinicId first, and call that. Type-only imports are fine.";

/**
 * Files that queried the DB directly before the rule existed. ONLY EVER SHRINKS.
 *
 * Kept as plain, readable paths so lines are easy to delete as they're migrated. The
 * bracket escaping happens in `escapeGlob` below rather than here.
 */
const LEGACY_DIRECT_DB_ACCESS = [
  "src/app/account/actions.ts",
  "src/app/account/page.tsx",
  "src/app/admin/account/page.tsx",
  "src/app/admin/actions.ts",
  "src/app/admin/announcements/page.tsx",
  "src/app/admin/clinics/[id]/page.tsx",
  "src/app/admin/finance/invoices/page.tsx",
  "src/app/admin/logs/page.tsx",
  "src/app/admin/page.tsx",
  "src/app/admin/security/actions.ts",
  "src/app/admin/security/page.tsx",
  "src/app/admin/team/[id]/page.tsx",
  "src/app/admin/team/actions.ts",
  "src/app/admin/team/page.tsx",
  "src/app/admin/trash/page.tsx",
  "src/app/api/admin/clinics/[id]/logo/route.ts",
  "src/app/api/ai/scribe/route.ts",
  "src/app/api/appointments/export/route.ts",
  "src/app/api/me/avatar/route.ts",
  "src/app/api/patients/export/route.ts",
  "src/app/api/prescriptions/build.ts",
  "src/app/api/procedures/export/route.ts",
  "src/app/api/staff/export/route.ts",
  "src/app/api/whatsapp/cloud/route.ts",
  "src/app/api/whatsapp/webhook/route.ts",
  "src/app/clinic/actions.ts",
  "src/app/clinic/appointments/[id]/invoice/page.tsx",
  "src/app/clinic/appointments/[id]/receipt/page.tsx",
  "src/app/clinic/approvals/actions.ts",
  "src/app/clinic/logs/page.tsx",
  "src/app/clinic/page.tsx",
  "src/app/clinic/patients/[id]/statement/page.tsx",
  "src/app/clinic/patients/clinical-chart-print.tsx",
  "src/app/clinic/patients/patient-detail.tsx",
  "src/app/clinic/patients/patients-list.tsx",
  "src/app/clinic/patients/treatment-estimate.tsx",
  "src/app/clinic/recalls/page.tsx",
  "src/app/clinic/settings/actions.ts",
  "src/app/clinic/settings/page.tsx",
  "src/app/clinic/shares/statement/page.tsx",
  "src/app/clinic/staff/[id]/page.tsx",
  "src/app/clinic/staff/page.tsx",
  "src/app/clinic/trash/page.tsx",
  "src/app/clinic/whatsapp/page.tsx",
  "src/app/doctor/actions.ts",
  "src/app/doctor/scribe-panel.tsx",
  "src/app/reception/actions.ts",
  "src/app/reception/appointment-detail.tsx",
  "src/app/reception/appointments-list.tsx",
  "src/app/reception/doctors-panel.tsx",
  "src/app/reception/new-appointment-panel.tsx",
  "src/app/reception/payment-actions.ts",
  "src/app/reception/procedure-actions.ts",
  "src/app/reception/procedures-panel.tsx",
  "src/app/reception/whatsapp-queue.tsx",
];

/**
 * A dynamic-route segment is a LITERAL path part, not a minimatch character class.
 * Unescaped, `[id]` matches the single characters "i" or "d", so the entry silently
 * fails to exempt its own file — and the rule then looks like it is passing on code
 * it never actually matched. (It did exactly that while this was being written.)
 */
const escapeGlob = (p) => p.replaceAll("[", "\\[").replaceAll("]", "\\]");

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
    files: LEGACY_DIRECT_DB_ACCESS.map(escapeGlob),
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
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
