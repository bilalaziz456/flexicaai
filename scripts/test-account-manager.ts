/**
 * Account manager contact — who a clinic is told to call, and when it is told.
 *
 * WHAT THIS HAS TO PROVE, worst consequence first:
 *
 * 1. EVERY path that changes a clinic's manager writes the date with it. Five of them
 *    do it, and the one that matters most is the BULK reassignment — that runs when a
 *    manager leaves the company, which is exactly when clinics most need telling. A
 *    notice driven off a date that only the edit form maintains would be silent in
 *    that case and look perfectly healthy in testing (ADR-032: a correctness property
 *    carried by an optional argument is one most callers will not pass).
 * 2. Clearing the manager clears the date. If it did not, a clinic left unassigned
 *    would be told "your account manager is now …" about nobody, and the resolution
 *    below would have to defend against it in the view instead of by construction.
 * 3. The resolver never shows a name it cannot give a number for. Until every
 *    pre-existing member has a number, "manager with no phone" is a real state, and a
 *    name above a blank line reads as an answer while being none.
 * 4. A manager who cannot sign in falls back to the company. Suspension KEEPS the
 *    assignment on purpose, so the row is still there to mislead somebody.
 * 5. The notice window opens and shuts, and a future date is not "recent".
 *
 * Seeds its own clinic and team members and deletes them at the end, so it is safe to
 * run against a database with real data in it.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-account-manager.ts`
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, companySettings, users } from "@/core/db/schema";
import {
  ACCOUNT_MANAGER_NOTICE_DAYS,
  accountManagerFields,
  getAccountManagerContact,
  isRecentAssignment,
} from "@/core/clinics/account-manager";
import {
  deactivateTeamMember,
  reassignClinics,
  softDeleteTeamMember,
  suspendTeamMember,
} from "@/core/admin/team";
import { BRAND_EMAIL, BRAND_PHONE } from "@/core/lib/brand";

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
  if (ok) passed++;
  else failed++;
}

const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function main() {
  const made: { clinicIds: string[]; userIds: string[] } = { clinicIds: [], userIds: [] };
  // The support fallback is a singleton row the product shares, so the test must put
  // it back exactly as it found it rather than leave its own numbers behind.
  const [settingsBefore] = await db
    .select({ id: companySettings.id, phone: companySettings.supportPhone, email: companySettings.supportEmail })
    .from(companySettings)
    .limit(1);

  try {
    const [withPhone] = await db
      .insert(users)
      .values({
        username: `t-am-phone-${Date.now()}`,
        passwordHash: "x",
        role: "super_admin",
        fullName: "Ayesha Khan",
        prefix: "Ms",
        phone: "+923010000001",
        email: "ayesha@example.test",
        permissions: ["clinics:view"],
      })
      .returning({ id: users.id });
    const [noPhone] = await db
      .insert(users)
      .values({
        username: `t-am-nophone-${Date.now()}`,
        passwordHash: "x",
        role: "super_admin",
        fullName: "Imran Sethi",
        permissions: ["clinics:view"],
      })
      .returning({ id: users.id });
    const [successor] = await db
      .insert(users)
      .values({
        username: `t-am-next-${Date.now()}`,
        passwordHash: "x",
        role: "super_admin",
        fullName: "Sana Mirza",
        phone: "+923010000002",
        permissions: ["clinics:view"],
      })
      .returning({ id: users.id });
    made.userIds.push(withPhone.id, noPhone.id, successor.id);

    const [clinic] = await db
      .insert(clinics)
      .values({ name: `Test AM Clinic ${Date.now()}`, ...accountManagerFields(withPhone.id) })
      .returning({ id: clinics.id });
    made.clinicIds.push(clinic.id);

    console.log("\nThe paired write");
    const assignedNow = accountManagerFields(withPhone.id);
    check("assigning sets both columns", Boolean(assignedNow.assignedTo && assignedNow.assignedAt), true);
    const clearedNow = accountManagerFields(null);
    check("clearing nulls BOTH columns", [clearedNow.assignedTo, clearedNow.assignedAt], [null, null]);

    const [created] = await db
      .select({ to: clinics.assignedTo, at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("a clinic created with a manager carries the date", Boolean(created.at), true);

    console.log("\nEvery write path dates the assignment");
    // THE ONE THAT MATTERS: the bulk move a departing manager triggers.
    await db
      .update(clinics)
      .set({ assignedAt: null })
      .where(eq(clinics.id, clinic.id));
    await reassignClinics(withPhone.id, successor.id);
    const [afterBulk] = await db
      .select({ to: clinics.assignedTo, at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("reassignClinics moved the clinic", afterBulk.to, successor.id);
    check("reassignClinics dated it (the notice fires when a manager leaves)", Boolean(afterBulk.at), true);

    // Suspension KEEPS the assignment — so the date must survive it too.
    await suspendTeamMember(successor.id);
    const [afterSuspend] = await db
      .select({ to: clinics.assignedTo })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("suspension keeps the assignment", afterSuspend.to, successor.id);

    console.log("\nResolution: never a name without a number");
    await db.update(companySettings).set({ supportPhone: "+923009999999", supportEmail: "help@example.test" }).where(eq(companySettings.id, settingsBefore.id));

    const suspendedContact = await getAccountManagerContact(clinic.id);
    check("a suspended manager falls back to the company", suspendedContact.kind, "support");
    check("the fallback carries the company number", suspendedContact.phone, "+923009999999");

    await db.update(clinics).set(accountManagerFields(noPhone.id)).where(eq(clinics.id, clinic.id));
    const noPhoneContact = await getAccountManagerContact(clinic.id);
    check("a manager with no number falls back too", noPhoneContact.kind, "support");
    check("…and offers no name", noPhoneContact.name, null);

    await db.update(clinics).set(accountManagerFields(withPhone.id)).where(eq(clinics.id, clinic.id));
    const good = await getAccountManagerContact(clinic.id);
    check("a manager with a number is offered", good.kind, "manager");
    check("…with their prefixed name", good.name, "Ms. Ayesha Khan");
    check("…their number", good.phone, "+923010000001");
    check("…and their email", good.email, "ayesha@example.test");

    console.log("\nA silent handover");
    // A temporary cover: assign, but do not announce it. No column of its own — this
    // is the same "assigned, not announced" state a pre-existing assignment is in.
    await db
      .update(clinics)
      .set(accountManagerFields(successor.id, { notify: false }))
      .where(eq(clinics.id, clinic.id));
    const [silent] = await db
      .select({ to: clinics.assignedTo, at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("a silent assignment still assigns", silent.to, successor.id);
    check("…but writes no date, so no notice fires", silent.at, null);
    check("…and nothing reads as recent", isRecentAssignment(silent.at), false);
    // The contact must still RESOLVE — only the announcement was skipped. Getting this
    // wrong would leave the clinic with a manager it cannot see on its settings page.
    await db.update(users).set({ isActive: true }).where(eq(users.id, successor.id));
    const silentContact = await getAccountManagerContact(clinic.id);
    check("…while the settings card still shows them", silentContact.kind, "manager");
    check("…by name", silentContact.name, "Sana Mirza");

    // A silent change over a LIVE notice must stop it: that banner names somebody who
    // no longer holds the account.
    await db.update(clinics).set(accountManagerFields(withPhone.id)).where(eq(clinics.id, clinic.id));
    check("…(a loud assignment first sets a date)", isRecentAssignment((await db.select({ at: clinics.assignedAt }).from(clinics).where(eq(clinics.id, clinic.id)))[0].at), true);
    await db
      .update(clinics)
      .set(accountManagerFields(successor.id, { notify: false }))
      .where(eq(clinics.id, clinic.id));
    const [afterSilentOverLoud] = await db
      .select({ at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("a silent change clears a notice naming the old manager", afterSilentOverLoud.at, null);

    // The default is the SAFE one: omitting the option announces.
    check("omitting the option still announces", Boolean(accountManagerFields(successor.id).assignedAt), true);
    check("notify:true on an unassignment is still silent", accountManagerFields(null, { notify: true }).assignedAt, null);

    console.log("\nThe fallback always answers");
    // The state the owner is actually in on day one: nobody has filled the company
    // contact in yet. An empty card is not an acceptable answer to "who do I call",
    // so the brand details are the floor beneath the setting.
    await db
      .update(companySettings)
      .set({ supportPhone: null, supportEmail: null })
      .where(eq(companySettings.id, settingsBefore.id));
    await db.update(clinics).set(accountManagerFields(null)).where(eq(clinics.id, clinic.id));
    const unset = await getAccountManagerContact(clinic.id);
    check("an unset company contact still gives the brand number", unset.phone, BRAND_PHONE);
    check("…and the brand email", unset.email, BRAND_EMAIL);
    check("…so the card is never empty", Boolean(unset.phone && unset.email), true);

    // The owner's setting still WINS over the floor, per field.
    await db
      .update(companySettings)
      .set({ supportPhone: "+923009999999", supportEmail: null })
      .where(eq(companySettings.id, settingsBefore.id));
    const partial = await getAccountManagerContact(clinic.id);
    check("a configured number overrides the brand default", partial.phone, "+923009999999");
    check("…while the unset email still falls back", partial.email, BRAND_EMAIL);

    console.log("\nUnassignment says nothing");
    await db.update(clinics).set(accountManagerFields(withPhone.id)).where(eq(clinics.id, clinic.id));
    await deactivateTeamMember(withPhone.id);
    const [afterDeactivate] = await db
      .select({ to: clinics.assignedTo, at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("deactivating unassigns the clinic", afterDeactivate.to, null);
    check("…and clears the date, so no notice can fire", afterDeactivate.at, null);
    check("…so nothing is recent", isRecentAssignment(afterDeactivate.at), false);
    const orphan = await getAccountManagerContact(clinic.id);
    check("an unassigned clinic still gets an answer", orphan.kind, "support");

    await db.update(clinics).set(accountManagerFields(noPhone.id)).where(eq(clinics.id, clinic.id));
    await softDeleteTeamMember(noPhone.id, noPhone.id);
    const [afterDelete] = await db
      .select({ to: clinics.assignedTo, at: clinics.assignedAt })
      .from(clinics)
      .where(eq(clinics.id, clinic.id));
    check("deleting a member unassigns and un-dates", [afterDelete.to, afterDelete.at], [null, null]);

    console.log("\nThe notice window");
    check("just assigned is recent", isRecentAssignment(new Date()), true);
    check("inside the window is recent", isRecentAssignment(days(ACCOUNT_MANAGER_NOTICE_DAYS - 1)), true);
    check("past the window is not", isRecentAssignment(days(ACCOUNT_MANAGER_NOTICE_DAYS + 1)), false);
    check("never assigned is not", isRecentAssignment(null), false);
    // An assignment dated before this column existed reads as NULL, which must be
    // quiet rather than treated as brand new — migration 0116 backfills nothing.
    check("an undated legacy assignment is not recent", isRecentAssignment(undefined), false);
    // A clock skew must not pin the notice open forever.
    check("a future date is not recent", isRecentAssignment(new Date(Date.now() + 60_000)), false);
  } finally {
    if (made.clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, made.clinicIds));
    if (made.userIds.length) await db.delete(users).where(inArray(users.id, made.userIds));
    if (settingsBefore) {
      await db
        .update(companySettings)
        .set({ supportPhone: settingsBefore.phone, supportEmail: settingsBefore.email })
        .where(eq(companySettings.id, settingsBefore.id));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void main();
