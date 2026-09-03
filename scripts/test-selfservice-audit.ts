/**
 * Patient self-service must leave an audit trail (Phase 0 of docs/whatsapp-ai-plan.md).
 *
 * THE BUG THIS PINS. `handleBookingReply` and `handleRescheduleReply` wrote NOTHING to
 * `activity_logs`. Neither called a logger, and the obvious one — `logActivity` —
 * would have no-opped anyway: it opens with `const user = await getCurrentUser(); if
 * (!user) return`, and an inbound webhook has no session. So a patient moving their own
 * appointment left no trace, while CLAUDE.md §10 requires an audit trail over patient
 * data. Nothing errored; the call simply did nothing, which is why it went unnoticed.
 *
 * WRITING THE ROW IS ONLY HALF OF IT. `listClinicActivityLogs` filters on
 * `actor_role IN (CLINIC_LOG_ROLES)`, so a row with an unlisted role is written and
 * then hidden from the one page the clinic can see — a compliance gap that LOOKS
 * closed. Every assertion below therefore checks visibility through the real query,
 * not just the presence of a row.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-selfservice-audit.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  activityLogs,
  appointments,
  clinics,
  patients,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { handleBookingReply } from "@/core/appointments/booking";
import { handleRescheduleReply } from "@/core/appointments/reschedule";
import { listClinicActivityLogs } from "@/core/audit/log-query";
import { CLINIC_LOG_ROLES, CLINIC_LOG_STAFF_ROLES } from "@/core/audit/access";
import { logPatientAction } from "@/core/audit/log";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

const uniq = Date.now();
const TAG = `ssa${uniq}`;
let clinicId = "";
let patientId = "";
const PHONE = `+92300${String(uniq).slice(-7)}`;

/** A date `days` from now at 15:00 local, and the text a patient would send. */
function future(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(15, 0, 0, 0);
  const month = d.toLocaleString("en-GB", { month: "short" });
  return { date: d, text: `${d.getDate()} ${month} 3:00pm` };
}

async function seed() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"], logAccess: ["create", "update"] })
    .returning({ id: clinics.id });
  await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_doc`,
      passwordHash: "x",
      role: "doctor",
      fullName: "SSA Doctor",
      consultationFee: 1500,
      // Flexible hours so any future slot validates — this test is about the audit
      // row, not about availability, which checkDoctorSlot already has its own tests for.
      flexibleHours: true,
    })
    .returning({ id: users.id });
  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Patient`, phone: PHONE })
    .returning({ id: patients.id });
}

async function cleanup() {
  await unscoped("test teardown", async () => {
    await db.delete(activityLogs).where(eq(activityLogs.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
}

/** Rows the CLINIC can actually see, through the real query the log page uses. */
async function visibleRows() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const { rows } = await listClinicActivityLogs(
    clinicId,
    { start, endExclusive, allowedActions: ["create", "update", "status", "delete"] },
    { offset: 0, limit: 50 },
  );
  return rows;
}

/** Every row in the table for this clinic, visible or not. */
async function allRows() {
  return db
    .select({
      action: activityLogs.action,
      entity: activityLogs.entity,
      actorRole: activityLogs.actorRole,
      actorName: activityLogs.actorName,
      actorUserId: activityLogs.actorUserId,
      summary: activityLogs.summary,
      metadata: activityLogs.metadata,
    })
    .from(activityLogs)
    .where(eq(activityLogs.clinicId, clinicId));
}

async function main() {
  await seed();

  console.log("A WhatsApp booking is audited:");
  const slot = future(3);
  const booking = await handleBookingReply({
    clinicId,
    patientId,
    phone: PHONE,
    text: `book ${slot.text}`,
  });
  check("the booking went through", booking.booked, true);

  let rows = await allRows();
  check("exactly one audit row was written", rows.length, 1);
  check("…as a 'create' on an appointment", [rows[0]?.action, rows[0]?.entity], ["create", "appointment"]);
  check("…with actor_role 'patient'", rows[0]?.actorRole, "patient");
  check("…and NO user id, because a patient is not a user", rows[0]?.actorUserId, null);
  check("…and no patient NAME in the actor column (§10: ids, not names)",
    rows[0]?.actorName?.includes(TAG) ?? false, false);
  check("…the patient is traceable by id in metadata",
    (rows[0]?.metadata as { patientId?: string })?.patientId, patientId);

  console.log("\n…and the clinic can actually SEE it — the half that was easy to miss:");
  let seen = await visibleRows();
  check("the row survives the clinic log's actor_role filter", seen.length, 1);
  check("…and is the booking", seen[0]?.action, "create");

  console.log("\nA WhatsApp reschedule is audited too:");
  const moved = future(5);
  const resched = await handleRescheduleReply({
    clinicId,
    patientId,
    phone: PHONE,
    text: `reschedule ${moved.text}`,
  });
  check("the reschedule went through", resched.rescheduled, true);
  rows = await allRows();
  check("a second row was written", rows.length, 2);
  check("…as an 'update'", rows.some((r) => r.action === "update" && r.actorRole === "patient"), true);
  seen = await visibleRows();
  check("…and the clinic sees both", seen.length, 2);

  console.log("\nThe role lists are kept apart on purpose:");
  check("'patient' is visible in the log", CLINIC_LOG_ROLES.includes("patient" as never), true);
  check("…but is NOT offered in the staff picker", CLINIC_LOG_STAFF_ROLES.includes("patient" as never), false);
  // A manager IS staff — added as a role in migration 0026 and never listed here, so
  // every action a manager took was logged and then hidden from their own clinic.
  check("'manager' is visible in the log", CLINIC_LOG_ROLES.includes("manager" as never), true);
  check("…and is offered in the staff picker", CLINIC_LOG_STAFF_ROLES.includes("manager" as never), true);
  check("a super admin is still never shown to a clinic", CLINIC_LOG_ROLES.includes("super_admin" as never), false);

  console.log("\nLogging is best-effort — it must never break the patient's booking:");
  {
    // A clinic id that satisfies the uuid type but matches no row: the insert fails
    // the foreign key, and the logger must swallow it.
    let threw = false;
    try {
      await logPatientAction({
        clinicId: "00000000-0000-0000-0000-000000000000",
        patientId,
        action: "create",
        entity: "appointment",
        entityId: null,
        summary: "should not throw",
      });
    } catch {
      threw = true;
    }
    check("a failed audit write does not throw", threw, false);
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try { await cleanup(); } catch { /* teardown is best-effort on a failed run */ }
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
