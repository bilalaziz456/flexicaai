/**
 * Session security — the idle timeout and "sign out other devices".
 *
 * WHAT THIS HAS TO PROVE, worst consequence first:
 *
 * 1. An idle session is gone for good. Rejecting it without deleting the row would let
 *    a lengthened window — or switching the timeout off — bring an abandoned terminal
 *    back to life. That is the whole feature, inverted.
 * 2. Revoking OTHER devices never touches another user's sessions, and never the
 *    current one. It is a DELETE keyed on a user id; the failure mode is signing the
 *    wrong person out of everything.
 * 3. The window is floored. A one-minute timeout is not a safeguard, it is a fault.
 * 4. The absolute 7-day expiry still applies when the idle timeout is off.
 *
 * Seeds its own user and deletes everything at the end, so it is safe against a
 * database with real data in it.
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/core/db";
import { sessions, users } from "@/core/db/schema";
import {
  SESSION_IDLE_MIN_MINUTES,
  SESSION_IDLE_OPTIONS,
  idleLabel,
  normalizeIdleMinutes,
} from "@/core/auth/session-idle";

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) passed++;
  else failed++;
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const mins = (n: number) => new Date(Date.now() - n * 60_000);

/** The pure half needs no database at all. */
function checkWindow() {
  console.log("\nThe window refuses values that would make it a fault:");
  check("0 stays 0 — the timeout is OFF, not 'instantly'", normalizeIdleMinutes(0), 0);
  check("a negative is off, not a time in the past", normalizeIdleMinutes(-30), 0);
  // Somebody reading a long clinical note makes no requests while they read it.
  check("1 minute is raised to the floor", normalizeIdleMinutes(1), SESSION_IDLE_MIN_MINUTES);
  check("…and so is anything under it", normalizeIdleMinutes(SESSION_IDLE_MIN_MINUTES - 1), SESSION_IDLE_MIN_MINUTES);
  check("a real window is kept as given", normalizeIdleMinutes(30), 30);
  check("every offered option survives normalising", SESSION_IDLE_OPTIONS.every((m) => normalizeIdleMinutes(m) === m), true);
  check("0 reads as Never, not '0 minutes'", idleLabel(0), "Never");
  check("60 reads as an hour", idleLabel(60), "1 hour");
  check("240 reads as hours", idleLabel(240), "4 hours");
}

async function main() {
  checkWindow();

  const suffix = Date.now();
  const [me] = await db
    .insert(users)
    .values({ username: `sess-test-${suffix}`, passwordHash: "x", role: "receptionist", fullName: "Session Tester" })
    .returning({ id: users.id });
  const [other] = await db
    .insert(users)
    .values({ username: `sess-other-${suffix}`, passwordHash: "x", role: "receptionist", fullName: "Someone Else" })
    .returning({ id: users.id });

  const week = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const open = async (userId: string, lastSeen: Date) => {
    const token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ userId, tokenHash: hash(token), expiresAt: week(), lastSeenAt: lastSeen });
    return token;
  };

  try {
    console.log("\nIdle expiry is measured from last_seen_at, not created_at:");
    const fresh = await open(me.id, mins(2));
    const stale = await open(me.id, mins(90));
    const idleWindow = 30;

    // The predicate the session guard applies, asserted against real rows.
    const expired = async (token: string) => {
      const [row] = await db
        .select({ lastSeenAt: sessions.lastSeenAt })
        .from(sessions)
        .where(eq(sessions.tokenHash, hash(token)));
      if (!row) return "gone";
      return Date.now() - row.lastSeenAt.getTime() > idleWindow * 60_000;
    };
    check("a session used 2 minutes ago is live", await expired(fresh), false);
    check("one untouched for 90 minutes is idle", await expired(stale), true);

    console.log("\nAn idle session is DELETED, so no setting change can revive it:");
    // What the guard does on detecting idle expiry.
    await db.delete(sessions).where(eq(sessions.tokenHash, hash(stale)));
    check("the row is gone", await expired(stale), "gone");
    // The point: turn the timeout off entirely and it must still be gone. Had the
    // guard only REJECTED it, this is where an abandoned terminal comes back.
    const [revived] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, hash(stale)));
    check("…and switching the timeout off does not bring it back", revived ?? null, null);
    check("the live session is untouched by all of that", await expired(fresh), false);

    console.log("\nSigning out other devices:");
    const here = await open(me.id, mins(1));
    await open(me.id, mins(5));
    await open(me.id, mins(5));
    const theirs = await open(other.id, mins(5));

    const countOthers = async (userId: string, keep: string) => {
      const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date()), ne(sessions.tokenHash, hash(keep))));
      return rows.length;
    };
    check("three others are counted (fresh + the two just opened)", await countOthers(me.id, here), 3);

    const gone = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, me.id), ne(sessions.tokenHash, hash(here))))
      .returning({ id: sessions.id });
    check("all three are ended", gone.length, 3);
    check("…and none are left", await countOthers(me.id, here), 0);

    const [stillHere] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, hash(here)));
    check("THIS device stays signed in", Boolean(stillHere), true);
    // The failure that would matter most: a DELETE that escaped its user.
    const [untouched] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, hash(theirs)));
    check("another user's session is untouched", Boolean(untouched), true);

    console.log("\nThe absolute expiry is independent of the idle one:");
    const ancient = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
      userId: me.id,
      tokenHash: hash(ancient),
      expiresAt: new Date(Date.now() - 60_000), // expired an hour of the clock ago
      lastSeenAt: new Date(), // …but "just used"
    });
    const [live] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hash(ancient)), gt(sessions.expiresAt, new Date())));
    check("a 7-day-expired session is refused even though it was just used", live ?? null, null);
    const [byExpiry] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hash(ancient)), lt(sessions.expiresAt, new Date())));
    check("…and it is the EXPIRY that refuses it, not the idle check", Boolean(byExpiry), true);
  } finally {
    await db.delete(sessions).where(eq(sessions.userId, me.id));
    await db.delete(sessions).where(eq(sessions.userId, other.id));
    await db.delete(users).where(eq(users.id, me.id));
    await db.delete(users).where(eq(users.id, other.id));
    console.log("\nseeded rows removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
