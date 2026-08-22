/**
 * Delta D-07 — Trash pages in SQL instead of loading every soft-deleted row.
 *
 * `collect` used to select all trashed rows of nine tables with NO limit, merge them
 * in memory, then filter and sort in JavaScript. Under ADR-006 nothing is ever
 * removed, so that set only grows, and the super admin's view has no retention window
 * at all — it was every trashed row the platform had ever produced, on one page.
 *
 * It now bounds each source to `offset + limit` and cuts the page from the merge.
 * That technique is only correct if three things hold, and each is asserted here
 * against rows deliberately INTERLEAVED across entity types (patients, procedures,
 * expenses, recalls) so no single source can supply a whole page:
 *
 *   1. Ordering is GLOBAL — newest first across all sources, not within one.
 *   2. Consecutive pages tile the set exactly: no overlap, no gap, no duplicates.
 *   3. `total` counts what the filters actually match, since the pager sizes itself
 *      from it — a total that disagrees with the pages is a pager that lies.
 *
 * The search is the subtle one. It used to run in JS over the assembled label AFTER
 * everything was loaded; pushing it into SQL was required, because filtering after
 * the page is cut returns short pages and a wrong total. So it is asserted through
 * the paging, not on its own.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-trash-paging.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics, expenses, patients, procedures, recalls, users } from "../src/core/db/schema";
import { listAllTrash, listClinicTrash } from "../src/core/trash";

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

const uniq = Date.now();
const TAG = `d07x${uniq}`;
let clinicId = "";
let actorId = "";
let patientId = "";

/** Deletion times, newest first, so expected order is known exactly. */
const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000);

async function seed() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });

  [{ id: actorId }] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_actor`,
      passwordHash: "x",
      role: "clinic_admin",
      fullName: "D07 Actor",
    })
    .returning({ id: users.id });

  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Live Patient` })
    .returning({ id: patients.id });

  const trashed = (minsAgo: number) => ({
    deletedAt: at(minsAgo),
    deletedBy: actorId,
    deleteGroup: crypto.randomUUID(),
    deletedByCascade: false,
  });

  // 12 entries, INTERLEAVED across four entity types by deletion time, so a page
  // boundary always falls between sources rather than inside one.
  //   0,4,8  patient   1,5,9  procedure   2,6,10 expense   3,7,11 recall
  for (let i = 0; i < 12; i++) {
    const mins = 100 - i; // i=0 is OLDEST, i=11 newest
    const t = trashed(mins);
    if (i % 4 === 0) {
      await db.insert(patients).values({ clinicId, fullName: `${TAG} p${i}`, ...t });
    } else if (i % 4 === 1) {
      await db.insert(procedures).values({ clinicId, name: `${TAG} proc${i}`, price: 100 + i, ...t });
    } else if (i % 4 === 2) {
      await db
        .insert(expenses)
        .values({ clinicId, amount: 50 + i, incurredOn: "2026-01-01", vendor: `${TAG} exp${i}`, ...t });
    } else {
      await db.insert(recalls).values({ clinicId, patientId, reason: `${TAG} rec${i}`, dueAt: new Date(), ...t });
    }
  }
}

async function cleanup() {
  await db.delete(recalls).where(eq(recalls.clinicId, clinicId));
  await db.delete(expenses).where(eq(expenses.clinicId, clinicId));
  await db.delete(procedures).where(eq(procedures.clinicId, clinicId));
  await db.delete(patients).where(eq(patients.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

/** Only OUR seeded rows — the dev DB has other trash. */
const mine = <T extends { label: string }>(items: T[]): T[] =>
  items.filter((i) => i.label.includes(TAG));

async function main() {
  await seed();
  const f = { q: TAG }; // scope every assertion to this run's rows

  console.log("\nThe total counts what the filters match:");
  {
    const r = await listClinicTrash(clinicId, 3650, f, [], { offset: 0, limit: 100 });
    check("all 12 seeded entries are found", mine(r.items).length, 12);
    check("and the total agrees", r.total, 12);
  }

  console.log("\nOrdering is GLOBAL — newest first across entity types, not within one:");
  {
    const r = await listClinicTrash(clinicId, 3650, f, [], { offset: 0, limit: 100 });
    // i=11 is newest, so the head must be recall, expense, procedure, patient — four
    // DIFFERENT tables in a row, which a per-source sort could not produce. (Asserted
    // on the entity, not the label: a recall's label is its PATIENT's name, and the
    // reason it was seeded with lands in `detail`.)
    const head = mine(r.items).slice(0, 4).map((i) => i.entity);
    check("newest four interleave across tables", head, [
      "recall",
      "expense",
      "procedure",
      "patient",
    ]);
    check("and the newest expense is exp10", mine(r.items)[1]?.label.includes("exp10"), true);
    check("and the newest procedure is proc9", mine(r.items)[2]?.label.includes("proc9"), true);

    const times = mine(r.items).map((i) => i.deletedAt.getTime());
    check("and every step is non-increasing", times.every((t, i) => i === 0 || times[i - 1] >= t), true);
  }

  console.log("\nConsecutive pages tile the set — no overlap, no gap:");
  {
    const pages: string[][] = [];
    for (let p = 0; p < 3; p++) {
      const r = await listClinicTrash(clinicId, 3650, f, [], { offset: p * 5, limit: 5 });
      pages.push(mine(r.items).map((i) => i.id));
    }
    check("page 1 holds 5", pages[0].length, 5);
    check("page 2 holds 5", pages[1].length, 5);
    check("page 3 holds the last 2", pages[2].length, 2);

    const all = [...pages[0], ...pages[1], ...pages[2]];
    check("12 rows across the three pages", all.length, 12);
    check("with no duplicate", new Set(all).size, 12);

    const oneShot = mine(
      (await listClinicTrash(clinicId, 3650, f, [], { offset: 0, limit: 100 })).items,
    ).map((i) => i.id);
    check("and the same order as one unpaged read", all, oneShot);
  }

  console.log("\nSearch is applied BEFORE the page is cut, so pages stay full:");
  {
    // Six of the twelve are procedures or expenses; search for one narrow term.
    const r = await listClinicTrash(clinicId, 3650, { q: `${TAG} proc` }, [], { offset: 0, limit: 2 });
    check("the page is full at 2", r.items.length, 2);
    check("the total is the 3 matching procedures", r.total, 3);
    check("and only procedures matched", r.items.every((i) => i.entity === "procedure"), true);

    const p2 = await listClinicTrash(clinicId, 3650, { q: `${TAG} proc` }, [], { offset: 2, limit: 2 });
    check("the second page holds the remaining 1", p2.items.length, 1);
  }

  console.log("\nThe type filter narrows the total too, not just the page:");
  {
    const r = await listClinicTrash(clinicId, 3650, { ...f, type: "expense" }, [], { offset: 0, limit: 100 });
    check("3 expenses", mine(r.items).length, 3);
    check("total says 3", r.total, 3);
  }

  console.log("\nSearching by the DELETER's name still works (it is an id lookup now):");
  {
    const r = await listClinicTrash(clinicId, 3650, { q: "D07 Actor" }, [], { offset: 0, limit: 100 });
    check("all 12 are attributed to that actor", mine(r.items).length, 12);
    check("and the total agrees", r.total >= 12, true);
  }

  console.log("\nThe super-admin scope pages the same way:");
  {
    const r = await listAllTrash(f, [], { offset: 0, limit: 5 });
    check("page of 5", mine(r.items).length, 5);
    check("total still 12", r.total, 12);
    check("clinic name is resolved on the page", Boolean(r.items[0]?.clinicName), true);
  }

  console.log("\nA page beyond the end is empty, not an error:");
  {
    const r = await listClinicTrash(clinicId, 3650, f, [], { offset: 500, limit: 5 });
    check("no items", r.items.length, 0);
    check("but the total is still right", r.total, 12);
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      if (clinicId) await cleanup();
    } catch {
      /* the seed clinic may not exist yet */
    }
  })
  .finally(async () => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
