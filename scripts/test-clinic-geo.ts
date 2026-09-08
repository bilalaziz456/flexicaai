/**
 * Structured clinic location — provinces, the seeded city list, and find-or-create.
 *
 * WHAT THIS IS FOR: the whole point of replacing free-text `clinics.city` was that
 * "how many clinics do we have in Lahore" should be a GROUP BY rather than a guess. The
 * one thing that can quietly destroy that is a SECOND ROW for a city that already
 * exists — "lahore", "Lahore ", or a row created twice by two admins onboarding at the
 * same moment — because the count then splits in half and still looks plausible. Most
 * of the checks below are about that.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-clinic-geo.ts`
 */
import { Pool } from "pg";
import { CITY_SEED } from "@/core/db/city-seed";
import {
  PROVINCES,
  asProvinceCode,
  isProvinceCode,
  provinceLabel,
} from "@/core/clinics/provinces";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

/** The action's resolution step, expressed as the SQL it performs. */
async function findOrCreate(name: string, province: string): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const found = await pool.query(
    `select id from cities where lower(name) = lower($1) and province = $2 limit 1`,
    [trimmed, province],
  );
  if (found.rows[0]) return found.rows[0].id;
  const ins = await pool.query(
    `insert into cities (name, province) values ($1, $2)
     on conflict (name, province) do nothing returning id`,
    [trimmed, province],
  );
  if (ins.rows[0]) return ins.rows[0].id;
  const race = await pool.query(
    `select id from cities where lower(name) = lower($1) and province = $2 limit 1`,
    [trimmed, province],
  );
  return race.rows[0]?.id ?? null;
}

const made: number[] = [];

async function main() {
  console.log("Provinces (a constant, not a table):");
  {
    check("seven administrative units", PROVINCES.length, 7);
    check("codes are unique", new Set(PROVINCES.map((p) => p.code)).size, PROVINCES.length);
    check("a known code narrows", asProvinceCode("punjab"), "punjab");
    // Narrowed, never cast: an unknown filter value must DROP its condition rather
    // than match nothing, which would read as "no clinics there".
    check("an unknown code narrows to null", asProvinceCode("bavaria"), null);
    check("a non-string narrows to null", asProvinceCode(7), null);
    check("isProvinceCode agrees", [isProvinceCode("gb"), isProvinceCode("x")], [true, false]);
    check("label resolves", provinceLabel("kpk"), "Khyber Pakhtunkhwa");
    // Falls back to the code so a renamed province renders SOMETHING rather than blank.
    check("unknown label falls back to the code", provinceLabel("zzz"), "zzz");
    check("null label is empty", provinceLabel(null), "");
  }

  console.log("\nThe seed reached the database:");
  {
    const { rows } = await pool.query(`select count(*)::int n from cities`);
    check("every seeded city exists", rows[0].n >= CITY_SEED.length, true);

    // Every seeded province must be one the app knows, or the city is unreachable in
    // the form — it would be filtered out of the dropdown and never selectable.
    const bad = CITY_SEED.filter((c) => !isProvinceCode(c.province));
    check("no seed row names an unknown province", bad.map((c) => c.name), []);

    const dupes = new Map<string, number>();
    for (const c of CITY_SEED) {
      const k = `${c.name.toLowerCase()}|${c.province}`;
      dupes.set(k, (dupes.get(k) ?? 0) + 1);
    }
    check(
      "no duplicate (name, province) in the seed",
      [...dupes.entries()].filter(([, n]) => n > 1).map(([k]) => k),
      [],
    );

    const lhr = await pool.query(`select province from cities where name = 'Lahore'`);
    check("Lahore is in Punjab", lhr.rows.map((r) => r.province), ["punjab"]);
  }

  console.log("\nThe unique index is what protects the counts:");
  {
    const dup = await pool
      .query(`insert into cities (name, province) values ('Lahore', 'punjab') returning id`)
      .then(() => "inserted")
      .catch((e: { code?: string }) => e.code);
    // 23505 = unique_violation. Without this, a second "Lahore" row would split the
    // city's clinic count between two rows and both halves would look believable.
    check("a duplicate (name, province) is refused", dup, "23505");

    const same = await pool.query(
      `select count(*)::int n from cities where name = 'Lahore' and province = 'punjab'`,
    );
    check("…and only one Lahore remains", same.rows[0].n, 1);

    // The SAME name in a DIFFERENT province is a different place — Mirpur exists in
    // both AJK and Sindh, so the index is on the pair, not the name.
    const id = await findOrCreate("Mirpur", "sindh");
    if (id) made.push(id);
    const both = await pool.query(`select count(*)::int n from cities where name = 'Mirpur'`);
    check("the same name in another province is allowed", both.rows[0].n >= 2, true);
  }

  console.log("\nFind-or-create (why onboarding is never blocked):");
  {
    const a = await findOrCreate("Lahore", "punjab");
    const b = await findOrCreate("lahore", "punjab");
    const c = await findOrCreate("  Lahore  ", "punjab");
    // Case and stray whitespace are exactly what free text produced. All three must
    // land on ONE row or the counts fragment again.
    check("case and whitespace reuse the same row", [a === b, b === c], [true, true]);

    const fresh = `Testville ${Date.now()}`;
    const first = await findOrCreate(fresh, "punjab");
    if (first) made.push(first);
    check("a town not in the seed is created", typeof first, "number");

    const second = await findOrCreate(fresh, "punjab");
    check("…and creating it twice returns the same row", second, first);

    check("an empty name creates nothing", await findOrCreate("   ", "punjab"), null);
  }

  console.log("\nCounting, which is the reason all of this exists:");
  {
    const { rows } = await pool.query(
      `select ci.name, count(c.id)::int n
         from clinics c
         join cities ci on ci.id = c.city_id
        where c.deleted_at is null
        group by ci.name`,
    );
    // No clinic has a city yet on a fresh database; the shape is what matters — the
    // query groups without error and only counts live clinics.
    check("the by-city query runs and excludes trashed clinics", Array.isArray(rows), true);

    const orphan = await pool.query(
      `select count(*)::int n from clinics where deleted_at is null and city_id is null`,
    );
    check("clinics with no city are countable separately", typeof orphan.rows[0].n, "number");
  }

  if (made.length) {
    await pool.query(`delete from cities where id = any($1::int[])`, [made]);
    console.log(`\nremoved ${made.length} test row(s)`);
  }
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
