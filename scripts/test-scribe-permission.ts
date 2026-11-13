/**
 * Voice scribe and clinical notes are two grants (owner, 2026-11-14): `scribe:create`
 * records and approves an AI draft, `clinical:create` writes a note by hand. Pins who
 * holds which by default, that the clinic admin's grid offers Voice scribe only where
 * the clinic has the scribe switched on, and that a clinic's capability list can allow
 * one without the other.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-scribe-permission.ts`
 */
import { can, clinicAllows, grantableResourcesForClinic } from "../src/core/auth/permissions";
import { DEFAULT_CLINIC_FEATURES, clinicHasFeature } from "../src/core/lib/features";

let failed = 0;
let passed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

const as = (role: "doctor" | "receptionist" | "manager" | "clinic_admin", extra: Partial<{ permissions: string[] | null; capabilities: string[] | null }> = {}) => ({
  role,
  permissions: null,
  capabilities: null,
  ...extra,
});

console.log("\nWho may record, who may write\n");
ok("a doctor records by default", can(as("doctor"), "scribe", "create"));
ok("a doctor writes notes by default", can(as("doctor"), "clinical", "create"));
ok("a clinic admin records", can(as("clinic_admin"), "scribe", "create"));
ok("a clinic admin writes notes", can(as("clinic_admin"), "clinical", "create"));
ok("a receptionist does neither", !can(as("receptionist"), "scribe", "create") && !can(as("receptionist"), "clinical", "create"));
ok("a manager reads notes only", can(as("manager"), "clinical", "view") && !can(as("manager"), "clinical", "create") && !can(as("manager"), "scribe", "create"));

console.log("\nThe clinic admin grants them separately\n");
ok("type only", can(as("doctor", { permissions: ["clinical:view", "clinical:create"] }), "clinical", "create") && !can(as("doctor", { permissions: ["clinical:view", "clinical:create"] }), "scribe", "create"));
ok("record only", can(as("doctor", { permissions: ["scribe:create"] }), "scribe", "create") && !can(as("doctor", { permissions: ["scribe:create"] }), "clinical", "create"));
ok("the super admin can allow notes but not the scribe", clinicAllows(["clinical:create"], "clinical", "create") && !clinicAllows(["clinical:create"], "scribe", "create"));
ok("…which a clinic admin's own grant cannot get round", !can(as("clinic_admin", { capabilities: ["clinical:view", "clinical:create"] }), "scribe", "create"));

console.log("\nThe grid offers Voice scribe only where the clinic has it\n");
const offered = (features: string[]) => grantableResourcesForClinic(features, null).some((r) => r.id === "scribe");
ok("scribe on → offered", offered(["voice_scribe"]));
ok("scribe off → not offered", !offered([]));
ok("Clinical notes is offered either way", grantableResourcesForClinic([], null).some((r) => r.id === "clinical"));
ok("a new clinic starts with the scribe on", clinicHasFeature(DEFAULT_CLINIC_FEATURES, "voice_scribe"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
