/**
 * Regression test for INBOUND WhatsApp idempotency (migration 0079).
 *
 * WhatsApp providers redeliver a webhook whenever they don't get a timely 200, and
 * our handlers do real work before responding — patient matching, self-service
 * reschedule and BOOKING. Before the partial unique index, a replay logged the
 * message twice and could book a second appointment from one patient text.
 *
 * This exercises the real Postgres semantics the handlers depend on, because they
 * can't be verified by reading the code: `ON CONFLICT … WHERE …` only infers a
 * PARTIAL index if the predicate matches exactly, and getting it subtly wrong fails
 * at runtime, not at compile time.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-webhook-idempotency.ts`
 */
import { Pool } from "pg";

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

// The exact conflict clause the two webhook handlers emit via Drizzle. Kept
// character-for-character in step with `onConflictDoNothing({ target, where })` in
// app/api/whatsapp/{cloud,webhook}/route.ts.
const INSERT_INBOUND = `
  insert into whatsapp_messages (clinic_id, patient_id, direction, phone, status, body, external_id)
  values (null, null, 'inbound', $1, 'received', $2, $3)
  on conflict (external_id) where external_id is not null and direction = 'inbound'
  do nothing
  returning id`;

const WAMID = `wamid.TEST-${Date.now()}`;
const PHONE = "923001234567";

async function main() {
  console.log("The partial unique index:");
  {
    const idx = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'wa_messages_inbound_external_id_unique'`,
    );
    check("exists (migration 0079 applied)", idx.rowCount, 1);
    check(
      "is scoped to inbound only",
      /direction = 'inbound'/.test(idx.rows[0]?.indexdef ?? ""),
      true,
    );
  }

  console.log("\nA redelivered inbound message:");
  {
    const first = await pool.query(INSERT_INBOUND, [PHONE, "first delivery", WAMID]);
    check("the first delivery inserts a row", first.rowCount, 1);

    // An empty result is what tells the handler "already handled" — it returns
    // before running reschedule/booking, which is the whole point.
    const replay = await pool.query(INSERT_INBOUND, [PHONE, "provider retry", WAMID]);
    check("the retry inserts NOTHING (side effects skipped)", replay.rowCount, 0);

    const total = await pool.query<{ c: number }>(
      `select count(*)::int c from whatsapp_messages where external_id = $1 and direction = 'inbound'`,
      [WAMID],
    );
    check("exactly one inbound row survives", total.rows[0].c, 1);
  }

  console.log("\nWhat the index must NOT block:");
  {
    // Outbound ids come from a loosely-typed provider response
    // (`messageId ?? id ?? submitted_message_id`). If the index spanned outbound, a
    // repeated value would start rejecting real sends at log time.
    const outbound = await pool.query(
      `insert into whatsapp_messages (clinic_id, direction, phone, status, external_id)
       values (null, 'outbound', $1, 'sent', $2) returning id`,
      [PHONE, WAMID],
    );
    check("an outbound row may reuse the same id", outbound.rowCount, 1);

    // A message with no provider id can't be deduped — it must still be processed.
    const a = await pool.query(INSERT_INBOUND, [PHONE, "no provider id A", null]);
    const b = await pool.query(INSERT_INBOUND, [PHONE, "no provider id B", null]);
    check("NULL external_id is never deduped", [a.rowCount, b.rowCount], [1, 1]);
  }

  await pool.query(
    `delete from whatsapp_messages where external_id = $1 or (phone = $2 and body like 'no provider id%')`,
    [WAMID, PHONE],
  );
  console.log("\nprobe rows removed");
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
