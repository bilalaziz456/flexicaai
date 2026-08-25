/**
 * Notifications open the EXACT record (2026-08-26).
 *
 * Every notification carries a precomputed `link` and the bell renders it as a real
 * `<Link>`. Two of them used to land on a queue rather than the thing that caused
 * them: a new WhatsApp message opened the clinic-wide message log, and a discount
 * needing approval opened the whole approvals list. Both now narrow to the record.
 *
 * The discount one deliberately does NOT deep-link the appointment: Approve/Reject
 * live on `/clinic/approvals`, and the appointment page only shows a "pending
 * approval" badge — linking there would show the approver the problem and give them
 * no way to act on it. So it links to the queue FILTERED to that appointment.
 *
 * The sharp edge, and the reason this file exists: an E.164 number starts with `+`,
 * which decodes to a SPACE in a query string. An unencoded link would silently filter
 * on " 923…" and show an empty conversation — a bug that looks like missing data, not
 * a broken link. The round-trip through `URL` is asserted below.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-notification-links.ts`
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics, notifications, patients, users, whatsappMessages } from "../src/core/db/schema";
import { listWhatsappQueue } from "../src/core/integrations/whatsapp/queue";
import { notifyInboundWhatsApp } from "../src/core/notifications/triggers";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const TAG = `nlink${Date.now()}`;
const PHONE = "+923001234567";
const OTHER = "+923009999999";
let clinicId = "";
let receptionistId = "";

async function cleanup() {
  if (!clinicId) return;
  await db.delete(notifications).where(eq(notifications.clinicId, clinicId));
  await db.delete(whatsappMessages).where(eq(whatsappMessages.clinicId, clinicId));
  await db.delete(patients).where(eq(patients.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

async function main() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });

  // A receptionist holds `whatsapp:view` by default — the permission the inbound
  // trigger notifies on.
  [{ id: receptionistId }] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_rec`,
      passwordHash: "x",
      role: "receptionist",
      fullName: `${TAG} Reception`,
    })
    .returning({ id: users.id });

  // Two conversations, so a filter that does nothing would be visible.
  await db.insert(whatsappMessages).values([
    { clinicId, direction: "inbound", phone: PHONE, status: "received", body: "one" },
    { clinicId, direction: "outbound", phone: PHONE, status: "sent", body: "two" },
    { clinicId, direction: "inbound", phone: OTHER, status: "received", body: "elsewhere" },
  ]);

  console.log("The queue can be narrowed to one conversation:");
  {
    const all = await listWhatsappQueue(clinicId, { offset: 0, limit: 50 });
    check("unfiltered shows every message", all.total, 3);

    const one = await listWhatsappQueue(clinicId, { offset: 0, limit: 50 }, { phone: PHONE });
    check("filtered shows only that number", one.total, 2);
    check("…and every row really is that number", one.rows.every((r) => r.phone === PHONE), true);
    check("…including the OUTBOUND side of it", one.rows.some((r) => r.direction === "outbound"), true);

    const none = await listWhatsappQueue(clinicId, { offset: 0, limit: 50 }, { phone: "+920000000000" });
    check("an unknown number is empty, not everything", none.total, 0);
  }

  console.log("\nThe inbound notification links to that conversation:");
  {
    await notifyInboundWhatsApp({
      clinicId,
      patientId: null,
      phone: PHONE,
      text: "Hello, is the clinic open?",
      outcome: "message",
    });
    const [row] = await db
      .select({ link: notifications.link, type: notifications.type })
      .from(notifications)
      .where(and(eq(notifications.clinicId, clinicId), eq(notifications.userId, receptionistId)));
    check("the receptionist was notified", row?.type, "whatsapp.inbound");
    check("no longer the bare queue", row?.link === "/clinic/whatsapp", false);

    // THE trap: '+' is a space once it is in a query string. Parse the link the way a
    // browser and Next will, and require the original number back out of it.
    const parsed = new URL(row!.link!, "http://localhost");
    check("the link points at the WhatsApp queue", parsed.pathname, "/clinic/whatsapp");
    check("and the phone survives the round trip (the '+' trap)", parsed.searchParams.get("phone"), PHONE);

    // Prove it end to end: feed the parsed value straight back into the query.
    const viaLink = await listWhatsappQueue(
      clinicId,
      { offset: 0, limit: 50 },
      { phone: parsed.searchParams.get("phone") ?? "" },
    );
    check("following the link finds that conversation", viaLink.total >= 2, true);
    check("…and nothing from the other number", viaLink.rows.every((r) => r.phone === PHONE), true);
  }

  console.log("\nA booking/reschedule still deep-links its appointment:");
  {
    await db.delete(notifications).where(and(eq(notifications.clinicId, clinicId), eq(notifications.userId, receptionistId)));
    // A doctor/admin holds `appointments:edit`; the receptionist does too by default.
    await notifyInboundWhatsApp({
      clinicId,
      patientId: null,
      phone: PHONE,
      text: null,
      outcome: "booked",
      appointmentId: "11111111-1111-1111-1111-111111111111",
    });
    const [row] = await db
      .select({ link: notifications.link })
      .from(notifications)
      .where(and(eq(notifications.clinicId, clinicId), eq(notifications.userId, receptionistId)));
    check(
      "opens that appointment",
      row?.link,
      "/clinic/appointments/11111111-1111-1111-1111-111111111111",
    );
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      await cleanup();
    } catch {
      /* the seed clinic may not exist yet */
    }
  })
  .finally(async () => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
