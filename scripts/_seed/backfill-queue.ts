/**
 * Backfill queue tokens (appointment #) for the demo clinic's doctor appointments,
 * using the app's real `queueSessionKey` so sessions match production behaviour.
 * Run: npx tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/_seed/backfill-queue.ts
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, clinics, users } from "@/core/db/schema";
import { queueSessionKey } from "@/core/appointments/queue";
import type { DayAvailability } from "@/core/lib/availability";

async function main() {
  const [clinic] = await db.select({ id: clinics.id }).from(clinics).where(eq(clinics.name, "Clinic002"));
  if (!clinic) { console.log("Clinic002 not found — seed it first."); process.exit(1); }
  const clinicId = clinic.id;

  const rows = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      doctorId: appointments.doctorId,
      availability: users.availability,
      flexible: users.flexibleHours,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .where(and(eq(appointments.clinicId, clinicId), isNotNull(appointments.doctorId)));

  // Clear first so row-by-row reassignment can't transiently hit the
  // (clinic_id, queue_session, queue_number) unique index.
  await db
    .update(appointments)
    .set({ queueSession: null, queueNumber: null })
    .where(and(eq(appointments.clinicId, clinicId), isNotNull(appointments.doctorId)));

  const bySession = new Map<string, { id: string; scheduledAt: Date }[]>();
  for (const r of rows) {
    const session = queueSessionKey(
      r.doctorId!,
      r.scheduledAt,
      (r.availability ?? []) as DayAvailability[],
      !!r.flexible,
    );
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session)!.push({ id: r.id, scheduledAt: r.scheduledAt });
  }

  let updated = 0;
  for (const [session, items] of bySession) {
    items.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id));
    let n = 1;
    for (const it of items) {
      await db.update(appointments).set({ queueSession: session, queueNumber: n }).where(eq(appointments.id, it.id));
      n++;
      updated++;
    }
  }
  console.log(`✅ Assigned tokens to ${updated} doctor appointments across ${bySession.size} sessions.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
