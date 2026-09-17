/**
 * Regression test for the DOCTOR SCHEDULE ACL (ADR-033, 2026-09-18).
 *
 * `schedule` was split out of `leave`, because they are different authorities:
 * leave says a doctor is away (and cancels their appointments), schedule says when
 * they work and how many patients a day they will see. Before the split, seeing the
 * rota required `leave:view` and setting a doctor's daily cap required `leave:edit`
 * — which the FRONT DESK holds by default, while the same field on the staff record
 * needed clinic admin. One field, two very different bars.
 *
 * WHAT THIS COVERS: the role defaults and the two-tier gate, which is pure
 * (`core/auth/permissions.ts` has no DB by design, so both the server guard and the
 * client grid share it). It does NOT cover the self-scoping of a doctor to their own
 * row — that lives in the page and is checked in the browser.
 *
 * The point of pinning the defaults in a test: the tempting future "tidy-up" is to
 * fold schedule back into leave, and nothing else would notice.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-schedule-acl.ts`
 */
import {
  ALL_PERMISSIONS,
  can,
  defaultPermissionsForRole,
  isPermission,
  PERM_RESOURCES,
} from "@/core/auth/permissions";
import type { UserRole } from "@/core/types/auth";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const asUser = (role: UserRole, permissions?: string[] | null, capabilities?: string[] | null) => ({
  role,
  permissions: permissions === undefined ? null : permissions,
  capabilities,
});

console.log("\nThe resource exists, with only the two actions that mean anything");
const res = PERM_RESOURCES.find((r) => r.id === "schedule");
check("schedule is in the catalog", Boolean(res), true);
check("actions are view + edit only", res?.actions, ["view", "edit"]);
check("schedule:view is a real slug", isPermission("schedule:view"), true);
check("schedule:edit is a real slug", isPermission("schedule:edit"), true);
// create/delete are meaningless: a schedule is a property of a doctor, always there.
check("schedule:create is NOT a slug", ALL_PERMISSIONS.includes("schedule:create"), false);
check("schedule:delete is NOT a slug", ALL_PERMISSIONS.includes("schedule:delete"), false);

console.log("\nRole defaults — who may SEE the rota, and who may change capacity");
for (const [role, view, edit] of [
  // Everyone in the clinic reads the rota; the front desk books against it.
  ["clinic_admin", true, true],
  ["manager", true, true],
  ["receptionist", true, false],
  ["doctor", true, false],
] as [UserRole, boolean, boolean][]) {
  check(`${role} may${view ? "" : " NOT"} see the rota`, can(asUser(role), "schedule", "view"), view);
  check(`${role} may${edit ? "" : " NOT"} change capacity`, can(asUser(role), "schedule", "edit"), edit);
}

console.log("\nLeave is untouched by the split");
for (const [role, create] of [
  ["manager", true],
  ["receptionist", true],
  ["doctor", true], // their OWN leave; the actions re-check the doctor id
] as [UserRole, boolean][]) {
  check(`${role} may${create ? "" : " NOT"} add leave`, can(asUser(role), "leave", "create"), create);
}

console.log("\nThe two are independent — neither implies the other");
const rotaOnly = asUser("receptionist", ["schedule:view"]);
check("schedule:view alone grants no leave", can(rotaOnly, "leave", "create"), false);
const leaveOnly = asUser("receptionist", ["leave:view", "leave:create"]);
check("leave alone grants no cap editing", can(leaveOnly, "schedule", "edit"), false);
// The backfill (migration 0107) is what stops that second case from being a
// REGRESSION for people who already had leave:edit — it wrote schedule:edit beside
// it. Here we only assert the code does not infer one from the other.
check("leave alone does not grant the rota", can(leaveOnly, "schedule", "view"), false);

console.log("\nTier 1 still wins: a clinic capability whitelist can withhold it");
const scoped = asUser("manager", null, ["schedule:view", "leave:view"]);
check("clinic allows view → manager sees the rota", can(scoped, "schedule", "view"), true);
check("clinic withholds edit → manager cannot", can(scoped, "schedule", "edit"), false);
const starred = asUser("manager", null, ["*"]);
check("'*' means everything allowed", can(starred, "schedule", "edit"), true);

console.log("\nA doctor's default set names the rota explicitly");
const docDefaults = defaultPermissionsForRole("doctor");
check("doctor defaults include schedule:view", docDefaults.includes("schedule:view"), true);
check("doctor defaults exclude schedule:edit", docDefaults.includes("schedule:edit"), false);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
