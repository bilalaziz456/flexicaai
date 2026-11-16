/**
 * Free trials (owner, 2026-11-17):
 *  - the pure rules: who may use the app, days left, when a clinic lost access;
 *  - a clinic on trial is NOT billed — no balance, no "payment due", not on the dues
 *    list — and billing starts at activation;
 *  - `clinicUsableSql` (the crons' filter) agrees with `isClinicUsable`, clinic by clinic;
 *  - a locked clinic sends its patients nothing: an outgoing message is held back, and
 *    an incoming one is stored but not acted on (no booking, no reply);
 *  - a clinic that comes back drops the recalls that fell due while it was locked,
 *    and keeps the rest.
 * Seeds its own clinics and patients and removes them. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-clinic-trial.ts`
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinics, patients, recalls, whatsappMessages } from "@/core/db/schema";
import { clinicLockedSince, isClinicUsable, trialDaysLeft } from "@/core/clinics/status";
import { clinicUsableSql } from "@/core/clinics/usable-sql";
import { computeClinicBalance, getClinicBalanceSummary, listDueClinics } from "@/core/admin/billing";
import { cancelRecallsMissedWhileLocked } from "@/core/recall";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { recordInboundMessage } from "@/core/integrations/whatsapp/inbound";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = 86_400_000;

function pureRules() {
  console.log("Pure rules:");
  const now = new Date();
  const future = new Date(now.getTime() + 5 * DAY);
  const past = new Date(now.getTime() - DAY);
  ok("a trial before its end may be used", isClinicUsable({ status: "trial", trialEndsAt: future }));
  ok("a trial past its end may not", !isClinicUsable({ status: "trial", trialEndsAt: past }));
  ok("an open-ended trial may be used", isClinicUsable({ status: "trial", trialEndsAt: null }));
  ok("5 days left", trialDaysLeft(future, now) === 5);
  ok("an ended trial has 0 days left", trialDaysLeft(past, now) === 0);
  ok("a trial was locked from its end date", clinicLockedSince({ status: "trial", trialEndsAt: past, suspendedAt: null }) === past);
  ok("a suspended clinic from its suspension", clinicLockedSince({ status: "suspended", trialEndsAt: null, suspendedAt: past }) === past);

  const created = new Date(now.getTime() - 60 * DAY);
  const base = { monthlyPrice: 10_000, graceDays: 7, activatedAt: null, createdAt: created };
  const trial = computeClinicBalance({ ...base, status: "trial" }, []);
  ok("a trial clinic owes nothing", trial.billingStatus === "trial" && trial.owed === 0 && trial.accrued === 0);
  const active = computeClinicBalance({ ...base, status: "active" }, []);
  ok("the same clinic active is billed from creation", active.owed > 0 && active.billingStatus === "overdue");
  const legacy = computeClinicBalance(base, []);
  ok("a caller that passes no status is billed as before", legacy.owed === active.owed);
}

async function againstTheDatabase() {
  const tag = `trial${Date.now()}`;
  const now = new Date();
  const ids: string[] = [];
  await unscoped("trial test — seeds its own clinics", async () => {
    const mk = async (name: string, values: Partial<typeof clinics.$inferInsert>) => {
      const [c] = await db
        .insert(clinics)
        .values({ name: `${tag} ${name}`, modulesEnabled: [], monthlyPrice: 10_000, ...values })
        .returning({ id: clinics.id });
      ids.push(c.id);
      return c.id;
    };
    try {
      const old = new Date(now.getTime() - 90 * DAY);
      const cases = {
        active: await mk("active", { status: "active" }),
        trialOn: await mk("trial on", { status: "trial", trialStartAt: old, trialEndsAt: new Date(now.getTime() + 10 * DAY) }),
        trialOver: await mk("trial over", { status: "trial", trialStartAt: old, trialEndsAt: new Date(now.getTime() - 20 * DAY) }),
        trialOpen: await mk("trial open", { status: "trial", trialEndsAt: null }),
        suspended: await mk("suspended", { status: "suspended", suspendedAt: old }),
        cancelled: await mk("cancelled", { status: "cancelled" }),
      };
      // Make every seeded clinic old enough to owe if it were billed.
      await db.update(clinics).set({ createdAt: old }).where(inArray(clinics.id, ids));

      console.log("The crons' filter agrees with isClinicUsable:");
      const usableIds = new Set(
        (await db.select({ id: clinics.id }).from(clinics).where(and(inArray(clinics.id, ids), clinicUsableSql(now)))).map((r) => r.id),
      );
      const rows = await db.select().from(clinics).where(inArray(clinics.id, ids));
      for (const r of rows) {
        ok(`${r.name.replace(tag, "").trim()}: SQL ${usableIds.has(r.id)} = TS ${isClinicUsable(r)}`, usableIds.has(r.id) === isClinicUsable(r));
      }

      console.log("A trial clinic is not billed:");
      const trialRow = rows.find((r) => r.id === cases.trialOn)!;
      const summary = await getClinicBalanceSummary(trialRow);
      ok("its balance says trial, nothing owed", summary.billingStatus === "trial" && summary.owed === 0);
      const due = await listDueClinics();
      ok("it is not on the dues list", !due.some((d) => d.id === cases.trialOn));
      ok("an active clinic as old IS on it", due.some((d) => d.id === cases.active));

      console.log("A locked clinic sends nothing:");
      const [p] = await db
        .insert(patients)
        .values({ clinicId: cases.trialOver, fullName: `${tag} Patient`, phone: "+923001234567" })
        .returning({ id: patients.id });
      const out = await sendWhatsAppToPatient({
        clinicId: cases.trialOver,
        patientId: p.id,
        phone: "+923001234567",
        campaignName: "test",
        body: "test",
      });
      ok("an outgoing message is held back", !out.ok && /paused/i.test(out.error ?? ""), out.error);
      const [held] = await db.select({ status: whatsappMessages.status, error: whatsappMessages.error }).from(whatsappMessages).where(eq(whatsappMessages.id, out.messageId));
      ok("and recorded as not sent, with why", held?.status === "failed" && /paused/i.test(held.error ?? ""));

      const inbound = await recordInboundMessage({
        clinicId: cases.trialOver,
        patientId: p.id,
        phone: "+923001234567",
        text: "book tomorrow 5pm",
        externalId: `${tag}-in`,
        payload: {},
      });
      ok("an incoming message is stored", inbound.kind !== "duplicate");
      ok("but nothing is booked from it", inbound.kind === "handled" ? !inbound.booked && !inbound.rescheduled && !inbound.cancelled : true);
      const stored = await db.select({ id: whatsappMessages.id }).from(whatsappMessages).where(eq(whatsappMessages.externalId, `${tag}-in`));
      ok("it is there for the front desk", stored.length === 1);
      const replies = await db
        .select({ id: whatsappMessages.id })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.clinicId, cases.trialOver), eq(whatsappMessages.direction, "outbound")));
      ok("and no reply went out (only the held-back test message exists)", replies.length === 1);

      console.log("Coming back starts from scratch:");
      const trialEnd = new Date(now.getTime() - 20 * DAY);
      const mkRecall = async (daysFromNow: number) => {
        const [r] = await db
          .insert(recalls)
          .values({ clinicId: cases.trialOver, patientId: p.id, dueAt: new Date(now.getTime() + daysFromNow * DAY), reason: "check-up" })
          .returning({ id: recalls.id });
        return r.id;
      };
      const beforeLock = await mkRecall(-30); // due before the trial ended
      const duringLock = await mkRecall(-5); // due while locked
      const later = await mkRecall(10); // not due yet
      const n = await cancelRecallsMissedWhileLocked(cases.trialOver, trialEnd, now);
      const statusOf = async (id: string) =>
        (await db.select({ s: recalls.status }).from(recalls).where(eq(recalls.id, id)))[0]?.s;
      ok("the recall due while locked is cancelled", (await statusOf(duringLock)) === "cancelled" && n === 1);
      ok("one due before the lock is kept", (await statusOf(beforeLock)) === "pending");
      ok("one not yet due is kept", (await statusOf(later)) === "pending");
    } finally {
      await db.delete(whatsappMessages).where(inArray(whatsappMessages.clinicId, ids));
      await db.delete(recalls).where(inArray(recalls.clinicId, ids));
      await db.delete(patients).where(inArray(patients.clinicId, ids));
      await db.delete(clinics).where(inArray(clinics.id, ids));
      console.log("seeded rows removed");
    }
  });
}

async function main() {
  pureRules();
  await againstTheDatabase();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
