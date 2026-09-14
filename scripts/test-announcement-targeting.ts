/**
 * Announcement targeting — who sees a notice, where, and when.
 *
 * An announcement that reaches the wrong people is a quiet failure in BOTH directions,
 * which is why this is tested rather than eyeballed. Too narrow and nobody sees the
 * notice and nobody knows; too wide and a subscription price rise meant for the clinic
 * owner is read by the receptionist and every patient-facing member of staff. Neither
 * shows up as an error anywhere.
 *
 * The three properties, each the thing a caller could plausibly get wrong:
 *
 *   1. AUDIENCE. `audience` NULL means everyone — that is what every notice posted
 *      before the column existed carries, so a filter that treated NULL as "nobody"
 *      would silently blank the existing ones. A narrowed audience must reach exactly
 *      the listed roles and no others.
 *   2. REACH. A post to several clinics reaches all of them and no one else; a
 *      broadcast reaches clinics that were never named; a single-clinic post stays put.
 *   3. WINDOW. `starts_at` in the future hides it, `ends_at` in the past hides it, and
 *      an open-ended notice shows. The window is the half most likely to be written and
 *      never verified, because "it will appear next month" cannot be checked by looking.
 *
 * Plus the batch behaviour the admin screen depends on: one post to N clinics lists as
 * ONE entry, and deactivating it silences every clinic rather than one.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-announcement-targeting.ts`
 */
import { inArray } from "drizzle-orm";
import { db } from "../src/core/db";
import { unscoped } from "../src/core/db/tenant-guard";
import { announcements, clinics } from "../src/core/db/schema";
import { CLINIC_STAFF_ROLES } from "../src/core/types/auth";
import {
  createAnnouncement,
  getAnnouncementPost,
  listActiveForClinic,
  listAnnouncementsPage,
  setAnnouncementActive,
  updateAnnouncement,
} from "../src/core/admin/announcements";

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

const TAG = `ann${Date.now()}`;
const clinicIds: string[] = [];
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const pad2 = (n: number) => String(n).padStart(2, "0");

async function makeClinic(name: string): Promise<string> {
  const [row] = await db
    .insert(clinics)
    .values({ name: `${TAG} ${name}`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });
  clinicIds.push(row.id);
  return row.id;
}

async function cleanup() {
  if (!clinicIds.length) return;
  // Announcements cascade with the clinic, but a broadcast row belongs to no clinic —
  // delete by title so a run cannot leave a notice sitting on every real clinic. That
  // is cross-tenant by definition, so it says so: an unlabelled one trips the tenant
  // guard, and a guard that cries wolf during tests is a guard people learn to ignore.
  await unscoped("test cleanup: seeded announcements", async () => {
    await db.delete(announcements).where(inArray(announcements.title, [...titles]));
  });
  await db.delete(clinics).where(inArray(clinics.id, clinicIds));
  console.log("\nseeded rows removed");
}

const titles = new Set<string>();
async function post(input: Parameters<typeof createAnnouncement>[0]) {
  titles.add(input.title);
  return createAnnouncement(input);
}

/** Titles this person can currently see, so an assertion reads like the screen does. */
async function seenBy(clinicId: string, role: string): Promise<string[]> {
  const rows = await listActiveForClinic(clinicId, role);
  return rows.filter((r) => titles.has(r.title)).map((r) => r.title).sort();
}

async function main() {
  const a = await makeClinic("A");
  const b = await makeClinic("B");
  const c = await makeClinic("C");
  const base = { level: "info" as const, body: "…" };

  console.log("Audience — NULL is everyone, a list is exactly that list:");
  await post({ ...base, title: `${TAG} everyone`, clinicIds: [a], audience: [] });
  await post({ ...base, title: `${TAG} admins`, clinicIds: [a], audience: ["clinic_admin"] });
  await post({
    ...base,
    title: `${TAG} admin+manager`,
    clinicIds: [a],
    audience: ["clinic_admin", "manager"],
  });
  check("a clinic admin sees all three", await seenBy(a, "clinic_admin"), [
    `${TAG} admin+manager`,
    `${TAG} admins`,
    `${TAG} everyone`,
  ]);
  check("a manager sees the two that name them", await seenBy(a, "manager"), [
    `${TAG} admin+manager`,
    `${TAG} everyone`,
  ]);
  check("a receptionist sees only the open one", await seenBy(a, "receptionist"), [
    `${TAG} everyone`,
  ]);
  check("and so does a doctor", await seenBy(a, "doctor"), [`${TAG} everyone`]);

  console.log("\nReach — several clinics, one clinic, or all of them:");
  const batchId = await post({
    ...base,
    title: `${TAG} price rise`,
    clinicIds: [a, b],
    audience: ["clinic_admin"],
  });
  await post({ ...base, title: `${TAG} broadcast`, clinicIds: [] });
  check("a multi-clinic post reaches the first", (await seenBy(a, "clinic_admin")).includes(`${TAG} price rise`), true);
  check("…and the second", (await seenBy(b, "clinic_admin")).includes(`${TAG} price rise`), true);
  check("…and NOT a clinic left out of it", (await seenBy(c, "clinic_admin")).includes(`${TAG} price rise`), false);
  check("a broadcast reaches a clinic never named", (await seenBy(c, "receptionist")), [`${TAG} broadcast`]);
  check("it wrote a batch id", typeof batchId, "string");

  console.log("\nWindow — a notice outside its dates is not shown:");
  await post({ ...base, title: `${TAG} future`, clinicIds: [c], startsAt: day(3) });
  await post({ ...base, title: `${TAG} expired`, clinicIds: [c], endsAt: day(-1) });
  await post({ ...base, title: `${TAG} running`, clinicIds: [c], startsAt: day(-3), endsAt: day(3) });
  check("only the open window shows", await seenBy(c, "doctor"), [
    `${TAG} broadcast`,
    `${TAG} running`,
  ]);

  console.log("\nTicking every role is stored as 'everyone', not as a list of roles:");
  await post({ ...base, title: `${TAG} all roles`, clinicIds: [b], audience: [...CLINIC_STAFF_ROLES] });
  const [allRoles] = ((await listAnnouncementsPage({}, { offset: 0, limit: 200 })).rows).filter((r) => r.title === `${TAG} all roles`);
  // A stored list of every CURRENT role quietly excludes any role added later, so the
  // two ways of saying "everyone" have to converge on the one that stays true.
  check("collapses to NULL", allRoles.audience, null);

  console.log("\nA START DATE IS A LOCAL DAY — the bug that made a notice invisible:");
  // `new Date("2026-09-15")` is UTC midnight, which in Pakistan (UTC+5) is 5am. A notice
  // posted at 00:57 to start "today" sat hidden for five hours while the admin screen
  // called it active. Everything else in the app reads server-local days.
  // Today as the date input hands it over: LOCAL parts, never toISOString(), which is
  // the UTC date and is a different day for part of every day east of Greenwich.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayInput = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const [yy, mm, dd] = todayInput.split("-").map(Number);
  const viaParts = new Date(yy, mm - 1, dd); // what the action does now
  const viaString = new Date(todayInput); // what it did before

  check("the parts build local midnight", [viaParts.getHours(), viaParts.getDate()], [0, now.getDate()]);
  // Exact rather than flaky: the two agree only on a UTC server, and differ by the
  // offset everywhere else — which is the whole bug, in one line.
  check(
    "…and the naive string parse differs wherever the server is not UTC",
    viaString.getTime() === viaParts.getTime(),
    now.getTimezoneOffset() === 0,
  );

  await post({ ...base, title: `${TAG} from today`, clinicIds: [b], startsAt: viaParts });
  check(
    "…so a notice starting today is visible today",
    (await seenBy(b, "doctor")).includes(`${TAG} from today`),
    true,
  );

  console.log("\nA multi-clinic post is ONE entry, and one switch:");
  const all = (await listAnnouncementsPage({}, { offset: 0, limit: 200 })).rows;
  const priceRows = all.filter((r) => r.title === `${TAG} price rise`);
  check("listed once, not once per clinic", priceRows.length, 1);
  check("…naming both clinics", priceRows[0].clinicNames, [`${TAG} A`, `${TAG} B`]);

  await setAnnouncementActive(priceRows[0].id, false);
  check("deactivating silences the first clinic", (await seenBy(a, "clinic_admin")).includes(`${TAG} price rise`), false);
  check("…and the second, not just the row clicked", (await seenBy(b, "clinic_admin")).includes(`${TAG} price rise`), false);
  await setAnnouncementActive(priceRows[0].id, true);
  check("and reactivating brings both back", (await seenBy(b, "clinic_admin")).includes(`${TAG} price rise`), true);

  console.log("\nThe list filters, and PAGES OVER POSTS rather than rows:");
  const mine = (f: Parameters<typeof listAnnouncementsPage>[0] = {}) =>
    listAnnouncementsPage({ ...f, q: f.q ?? TAG }, { offset: 0, limit: 200 });

  const scheduled = await mine({ state: "scheduled" });
  check("scheduled finds the future one", scheduled.rows.map((r) => r.title), [`${TAG} future`]);
  const ended = await mine({ state: "ended" });
  check("ended finds the expired one", ended.rows.map((r) => r.title), [`${TAG} expired`]);
  const admins = await mine({ audience: "clinic_admin" });
  // Narrowed to clinic_admin only — NOT the "everyone" ones, which are NULL and are not
  // an answer to "which posts are aimed at admins".
  check("audience finds only NARROWED posts", admins.rows.map((r) => r.title).sort(), [
    `${TAG} admins`,
    `${TAG} admin+manager`,
    `${TAG} price rise`,
  ].sort());
  const broadcast = await mine({ clinic: "broadcast" });
  check("broadcast finds the all-clinic post", broadcast.rows.map((r) => r.title), [`${TAG} broadcast`]);
  const byText = await mine({ q: `${TAG} price` });
  check("search matches the title", byText.rows.map((r) => r.title), [`${TAG} price rise`]);

  // The date range asks "what was SHOWING then", so it matches on overlap. The seeded
  // windows are: future (starts +3d), expired (ended -1d), running (-3d → +3d), and
  // several with no window at all.
  const ymd = (offset: number) => {
    const d = day(offset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const windowed = (f: { from?: string; to?: string }) =>
    mine(f).then((r) => r.rows.map((x) => x.title));

  const yesterdayOnly = await windowed({ from: ymd(-1), to: ymd(-1) });
  check("yesterday finds the one that ended then, and the open-ended ones", [
    yesterdayOnly.includes(`${TAG} expired`),
    yesterdayOnly.includes(`${TAG} running`),
    yesterdayOnly.includes(`${TAG} future`),
  ], [true, true, false]);

  const nextWeek = await windowed({ from: ymd(5), to: ymd(9) });
  // A notice that has already ended cannot be showing next week; one with no window at
  // all is open-ended in both directions and always overlaps.
  check("a window entirely in the future excludes what has ended", nextWeek.includes(`${TAG} expired`), false);
  check("…and still includes an open-ended notice", nextWeek.includes(`${TAG} broadcast`), true);
  check("…and the one scheduled to start in 3 days", nextWeek.includes(`${TAG} future`), true);

  // The two-clinic post is TWO rows. A pager over rows would count it twice and split it
  // across a page boundary; over posts it is one entry and one unit of the total.
  const everything = await mine();
  check("the total counts posts, not rows", everything.total, everything.rows.length);
  const page1 = await listAnnouncementsPage({ q: TAG }, { offset: 0, limit: 3 });
  const page2 = await listAnnouncementsPage({ q: TAG }, { offset: 3, limit: 3 });
  check("a page is bounded by its limit", page1.rows.length, 3);
  check("…the total is the same on every page", [page1.total, page2.total], [everything.total, everything.total]);
  check(
    "…and no post appears on two pages",
    page1.rows.some((r) => page2.rows.some((x) => x.id === r.id)),
    false,
  );
  const paged = await listAnnouncementsPage({ q: TAG, clinic: a }, { offset: 0, limit: 200 });
  const pricePaged = paged.rows.find((r) => r.title === `${TAG} price rise`);
  // Filtering by ONE clinic must not make the entry under-report its own reach: the
  // post still went to two, and the badge is what an admin reads to confirm that.
  check("a clinic filter still shows the post's full reach", pricePaged?.clinicNames.length, 2);

  console.log("\nEditing re-targets in place, keeping the clinics that stay:");
  const head = await getAnnouncementPost(priceRows[0].id);
  check("it reads back both clinics", head?.clinicIds.length, 2);

  // a + b → b + c. B is the one that must keep its existing row.
  const bRowBefore = (await listActiveForClinic(b, "clinic_admin")).find(
    (r) => r.title === `${TAG} price rise`,
  );
  const edited = await updateAnnouncement(priceRows[0].id, {
    clinicIds: [b, c],
    audience: ["clinic_admin", "manager"],
    level: "warning",
    title: `${TAG} price rise`,
    body: "edited",
    startsAt: null,
    endsAt: null,
  });
  check("the edit succeeds", "ok" in edited, true);
  check("the clinic dropped no longer sees it", (await seenBy(a, "clinic_admin")).includes(`${TAG} price rise`), false);
  check("the clinic added now does", (await seenBy(c, "clinic_admin")).includes(`${TAG} price rise`), true);
  const bRowAfter = (await listActiveForClinic(b, "clinic_admin")).find(
    (r) => r.title === `${TAG} price rise`,
  );
  // The row id surviving is the point of diffing rather than delete-and-recreate: an
  // edit must not look like a brand-new post to the clinics it already reached.
  check("the clinic that stayed keeps its own row", bRowAfter?.id, bRowBefore?.id);
  check("…carrying the new wording", bRowAfter?.body, "edited");
  check("…and the widened audience", (await seenBy(b, "manager")).includes(`${TAG} price rise`), true);
  check("…while a role still excluded stays out", (await seenBy(b, "doctor")).includes(`${TAG} price rise`), false);
  check("the original author survives the edit", bRowAfter?.createdByName, bRowBefore?.createdByName);

  // Narrowed back to ONE clinic, the post is no longer a batch.
  await updateAnnouncement(bRowAfter!.id, {
    clinicIds: [b],
    audience: [],
    level: "info",
    title: `${TAG} price rise`,
    body: "narrowed",
    startsAt: null,
    endsAt: null,
  });
  const narrowed = await getAnnouncementPost(bRowAfter!.id);
  check("narrowing to one clinic drops the batch", narrowed?.batchId, null);
  check("…and it reaches only that clinic", narrowed?.clinicIds, [b]);
  check("…with an emptied audience meaning everyone again", narrowed?.audience, null);
}

main()
  .then(cleanup)
  .then(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await cleanup().catch(() => {});
    console.error(e);
    process.exit(1);
  });
