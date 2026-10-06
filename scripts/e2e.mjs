/**
 * End-to-end smoke test for FlexicaAI.
 *
 * Seeds a throwaway two-clinic world directly in Postgres, mints REAL sessions
 * (SHA-256 token — exactly how the app validates), then exercises every panel and
 * API route over HTTP against a running dev/prod server. Asserts auth, role
 * isolation, multi-tenant scoping, the "Revenue Recovered" metric, the WhatsApp
 * webhook, the recall cron, and the scribe's graceful-when-unconfigured path.
 * All seeded data (and any audio the scribe test writes) is cleaned up at the end.
 *
 * It does NOT need the live third-party keys (Anthropic / OpenAI / AiSensy): those
 * features are checked on their "unconfigured" path only. Everything else is real.
 *
 * Usage:
 *   1. Start the app:  npm run dev   (or: npm run build && npm start)
 *   2. Run:            npm run test:e2e
 *
 * Env (from .env.local): DATABASE_URL is required; LINK_SIGNING_SECRET,
 * WHATSAPP_WEBHOOK_TOKEN, CRON_SECRET enable the signed-link / webhook / cron
 * checks. Override the target with BASE_URL (default http://localhost:3000).
 *
 * Exit code is non-zero if any check fails, so this doubles as a CI smoke test.
 *
 * ── Reporting ────────────────────────────────────────────────────────────────
 * Every run writes two files (scripts/qa/run/e2e-report.mjs):
 *
 *   scripts/qa/run/e2e-report.html   — the whole run, grouped by section
 *   scripts/qa/run/e2e-results.json  — just the assertions that carry a manual
 *                                      TEST CASE ID, for the QA workbook
 *
 * An assertion earns a workbook row by naming the case id first:
 *
 *   record("TC-WA-006 webhook inbound → 200 + logged & patient-matched", …)
 *
 * A case may have several assertions (`TC-WA-006`, `TC-WA-006b`, …) and passes only
 * if ALL of them did. `node scripts/qa/run/apply-results.mjs` writes them in.
 *
 * ── The rule the tagging has to obey ─────────────────────────────────────────
 * A case id goes on an assertion only when the assertion proves what the CASE
 * claims — not what is convenient to check. Four tags were removed for failing
 * that: a prescription PDF is not the attachment route; a 200 with the right
 * content-type does not prove the document's contents; "every cron endpoint" means
 * all eight; and a scoped LIST says nothing about a detail route that trusts its own
 * id. Where only part of a case is observable here, `record.skip` says so and the
 * workbook cell stays blank for a human.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";
import { writeReports } from "./qa/run/e2e-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(ROOT, ".env.local"), quiet: true });

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SECRET_LINK = process.env.LINK_SIGNING_SECRET;
const WH_TOKEN = process.env.WHATSAPP_WEBHOOK_TOKEN;
// Meta app secret. Set → the Cloud-webhook delivery path is exercised with a real
// signature; unset → we assert the endpoint fails closed instead.
const WA_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const CRON = process.env.CRON_SECRET;
const STORAGE_DIR = path.resolve(ROOT, process.env.STORAGE_DIR || "./storage");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (check .env.local). Aborting.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const b64url = (b) => Buffer.from(b).toString("base64url");
function signToken(id, expMs) {
  if (!SECRET_LINK) return null;
  const payload = `${id}.${expMs}`;
  const sig = crypto.createHmac("sha256", SECRET_LINK).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}
async function mintSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "insert into sessions (user_id, token_hash, expires_at) values ($1,$2, now()+interval '1 hour')",
    [userId, sha256(token)],
  );
  return token;
}

// ---- tiny assert framework ----
const results = [];

/**
 * An assertion. When the NAME begins with a manual test-case id ("TC-WA-005 …") the
 * id is lifted out and the result is written onto that row of the QA workbook by
 * `scripts/qa/run/apply-results.mjs`.
 *
 * Tagging by name rather than by a new argument is deliberate: there are eighty-odd
 * existing call sites, and a signature change would have meant touching every one of
 * them to credit a handful. An untagged assertion stays exactly as it was.
 */
const TC_ID = /^(TC-[A-Z0-9]+-\d+[a-z]?)\s+/;

/**
 * The section an assertion belongs to. Set by `section()`, which also prints the
 * banner the console output has always had — so the grouping in the HTML report and
 * the grouping a human reads in the terminal can never disagree.
 */
let currentSection = "general";
function section(title) {
  currentSection = title;
  console.log(`\n== ${title} ==`);
}

function record(name, pass, detail) {
  const m = TC_ID.exec(name);
  results.push({ name, pass, detail, tc: m ? m[1] : null, section: currentSection });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? "  — " + detail : ""}`);
}

/**
 * A check this environment cannot make — a missing secret, or a property that only
 * holds on a production build.
 *
 * It exists because the alternative in use was `record(name, true, "skipped (…)")`,
 * which counts a check nobody made as a pass. That is tolerable in a console summary
 * and intolerable once the result reaches a spreadsheet: the row would read Pass
 * while the behaviour went unexercised. A skip is reported, never counted, and
 * carries NO case id into the workbook, so the cell stays blank for a human.
 */
record.skip = (name, why) => {
  results.push({ name, pass: true, skipped: true, detail: why, tc: null, section: currentSection });
  console.log(`  [SKIP] ${name}  — ${why}`);
};
async function req(pathname, { cookie, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = `klenic_session=${cookie}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(BASE + pathname, { method, body, headers: h, redirect: "manual", signal: ctl.signal });
    const ct = r.headers.get("content-type") || "";
    const text = ct.includes("pdf") ? "" : await r.text().catch(() => "");
    return { status: r.status, ct, text, headers: r.headers };
  } finally {
    clearTimeout(t);
  }
}
const is3xx = (s) => s >= 300 && s < 400;
const snip = (t) => (t || "").slice(0, 160).replace(/\s+/g, " ");

/**
 * Did this response actually render the clinic workspace for a signed-in user?
 *
 * The positive half that every "…and nothing leaked" assertion needs beside it. A
 * blank page leaks nothing; so does a redirect to /login, which means the session was
 * dropped — a different and worse outcome that a content-absence check reads as a
 * clean pass. `/clinic/patients` is in every clinic role's nav, so its presence says
 * the shell rendered AND the session survived.
 */
const isClinicShell = (r) => r.status === 200 && r.text.includes('href="/clinic/patients"');

const ids = {};

async function seed() {
  section("SEED");
  const hash = await bcrypt.hash("not-used-over-http", 10);
  const q = (t, v) => pool.query(t, v).then((r) => r.rows[0]);
  const uniq = Date.now();

  // Clinic A has the Revenue dashboard feature ON; Clinic B leaves it OFF (default).
  const cA = await q("insert into clinics (name, modules_enabled, features_enabled, avg_visit_value) values ('E2E Clinic A', ARRAY['dental'], ARRAY['revenue_dashboard'], 4000) returning id");
  const cB = await q("insert into clinics (name, modules_enabled) values ('E2E Clinic B', ARRAY['dental']) returning id");
  ids.clinics = [cA.id, cB.id];

  const mkUser = (clinicId, uname, role) =>
    q("insert into users (clinic_id, username, password_hash, role, full_name, is_active) values ($1,$2,$3,$4,$5,true) returning id",
      [clinicId, uname, hash, role, uname]);

  const sadmin = await mkUser(null, `e2e_super_${uniq}`, 1 /* super_admin */);
  const adminA = await mkUser(cA.id, `e2e_adminA_${uniq}`, 2 /* clinic_admin */);
  const docA = await mkUser(cA.id, `e2e_docA_${uniq}`, 4 /* doctor */);
  const recepA = await mkUser(cA.id, `e2e_recepA_${uniq}`, 5 /* receptionist */);
  const adminB = await mkUser(cB.id, `e2e_adminB_${uniq}`, 2 /* clinic_admin */);
  const suspU = await mkUser(cA.id, `e2e_susp_${uniq}`, 5 /* receptionist */);
  // A manager, for the cases whose expected result names all four clinic roles.
  // Without one, "reachable by the right roles" could only ever be half-checked.
  const mgrA = await mkUser(cA.id, `e2e_mgrA_${uniq}`, 3 /* manager */);
  ids.users = [sadmin, adminA, docA, recepA, adminB, suspU, mgrA].map((u) => u.id);
  ids.suspUserId = suspU.id;
  ids.docAId = docA.id;
  // docA has no working hours; make it flexible so any future slot books
  // (booking/reschedule checks rely on this).
  await pool.query("update users set flexible_hours = true where id = $1", [docA.id]);
  // Clinic A gets a WhatsApp Cloud sender number (for the Cloud webhook routing test).
  ids.waPnid = `E2E_PNID_${uniq}`;
  await pool.query("update clinics set whatsapp_phone_number_id = $1 where id = $2", [ids.waPnid, cA.id]);

  const patA1 = await q("insert into patients (clinic_id, full_name, phone) values ($1,'Ayesha Recovered','+923009990001') returning id", [cA.id]);
  const patA2 = await q("insert into patients (clinic_id, full_name, phone) values ($1,'Bilal NoPhone', null) returning id", [cA.id]);
  const patB1 = await q("insert into patients (clinic_id, full_name, phone) values ($1,'ClinicB Patient','+923009990009') returning id", [cB.id]);
  // A patient reserved for the REMINDER cron, and the reservation is the point.
  // The WhatsApp self-service tests act on "the next upcoming appointment" for
  // +923009990001, so an appointment seeded for patA1 is silently rescheduled out
  // from under the reminder job — which is how a seeded tomorrow's appointment came
  // to produce `processed=0` and look like a broken cron.
  const patA3 = await q("insert into patients (clinic_id, full_name, phone) values ($1,'Reminder Target','+923009990003') returning id", [cA.id]);
  ids.patients = [patA1.id, patA2.id, patB1.id, patA3.id];

  // "Revenue Recovered" scenario: patA1 got a 'sent' recall 10d ago AND a completed appt 2d ago → 1 recovered × 4000.
  await q("insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()-interval '2 days',5)", [cA.id, patA1.id, docA.id]);
  ids.apptA = (await q("insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()+interval '3 days',1) returning id", [cA.id, patA1.id, docA.id])).id;
  await q("insert into recalls (clinic_id, patient_id, reason, due_at, status, sent_at) values ($1,$2,'6-month cleaning', now()-interval '12 days',3, now()-interval '10 days')", [cA.id, patA1.id]);
  // A due 'pending' recall whose patient has NO phone → cron should skip it.
  await q("insert into recalls (clinic_id, patient_id, reason, due_at, status) values ($1,$2,'checkup', now()-interval '1 day',1)", [cA.id, patA2.id]);
  // The recall cron's actual subject: one DUE recall for a patient who HAS a phone,
  // and one that is NOT yet due. The pair is what makes "due recalls only" testable —
  // a job that actioned everything, or nothing, satisfies a single-row check either way.
  ids.recallDue = (await q(
    "insert into recalls (clinic_id, patient_id, reason, due_at, status) values ($1,$2,'E2E due recall', now()-interval '2 days',1) returning id",
    [cA.id, patA1.id],
  )).id;
  ids.recallFuture = (await q(
    "insert into recalls (clinic_id, patient_id, reason, due_at, status) values ($1,$2,'E2E future recall', now()+interval '60 days',1) returning id",
    [cA.id, patA1.id],
  )).id;
  // Likewise for the reminder cron: one appointment TOMORROW and one next week, both
  // for a patient with a phone, so "tomorrow's only" has something to exclude.
  ids.apptTomorrow = (await q(
    "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()+interval '1 day',1) returning id",
    [cA.id, patA3.id, docA.id],
  )).id;
  ids.apptNextWeek = (await q(
    "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()+interval '8 days',1) returning id",
    [cA.id, patA3.id, docA.id],
  )).id;

  const note = {
    diagnosis: "Dental caries, tooth 26",
    prescriptions: [{ drug: "Amoxicillin", dosage: "500mg TDS", duration: "5 days" }],
    treatmentPlan: ["Composite filling on 26", "Review in 2 weeks"],
  };
  const visit = await q(
    "insert into visits (clinic_id, patient_id, doctor_id, module, status, note, approved_at, approved_by, visit_date) values ($1,$2,$3,'dental',3,$4, now(), $3, now()) returning id",
    [cA.id, patA1.id, docA.id, JSON.stringify(note)],
  );
  ids.visit = visit.id;

  await q("insert into whatsapp_messages (clinic_id, patient_id, direction, phone, status, body) values ($1,$2,1,'+923009990001',6,'Hello, I need an appointment')", [cA.id, patA1.id]);
  await q("insert into whatsapp_messages (clinic_id, patient_id, direction, phone, status, template_name, body, external_id) values ($1,$2,2,'+923009990001',2,'recall_reminder','Your recall is due','E2E-EXT-1')", [cA.id, patA1.id]);

  // --- Data for the CSV-export + live-queue sections ---
  // A completed visit that realised a sale + a cash payment, plus a procedure, so the
  // sales/payments/procedures CSV exports have real rows. Uses patA2 (a 'pending'
  // recall, NOT 'sent') so it can't skew the "1 return visit" revenue-recovered count.
  const saleAppt = await q(
    "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()-interval '1 day',5) returning id",
    [cA.id, patA2.id, docA.id],
  );
  await q(
    "insert into sales (clinic_id, appointment_id, doctor_id, doctor_name, gross_amount, discount_amount, net_amount, occurred_at) values ($1,$2,$3,'Dr E2E',5000,0,5000, now()-interval '1 day')",
    [cA.id, saleAppt.id, docA.id],
  );
  await q(
    // Raw SQL, so the vocabulary columns are the integer FKs (migration 0087):
    // kind_id 1 = 'payment', method_id 1 = 'cash'. Kept as literals rather than a
    // subselect so this seed still reads as one statement; src/core/db/vocabulary-seed.ts
    // is the authority for the numbers.
    "insert into patient_payments (clinic_id, patient_id, appointment_id, kind_id, amount, method_id, occurred_at, created_by, created_by_name) values ($1,$2,$3,1,5000,1, now()-interval '1 day', $4,'Recep E2E')",
    [cA.id, patA2.id, saleAppt.id, recepA.id],
  );
  await q("insert into procedures (clinic_id, name, price, module) values ($1,'Scaling & polishing',3000,'dental')", [cA.id]);
  // A patient in the doctor's live queue TODAY (token #1) to drive Arrived → in-room → done.
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (local)
  ids.queueAppt = (
    await q(
      "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status, queue_session, queue_number) values ($1,$2,$3, now(), 1, $4, 1) returning id",
      [cA.id, patA2.id, docA.id, `${docA.id}:${todayStr}:day`],
    )
  ).id;

  ids.sessions = {
    sadmin: await mintSession(sadmin.id),
    adminA: await mintSession(adminA.id),
    docA: await mintSession(docA.id),
    recepA: await mintSession(recepA.id),
    adminB: await mintSession(adminB.id),
    susp: await mintSession(suspU.id),
    mgrA: await mintSession(mgrA.id),
  };
  console.log(`  clinics A=${cA.id} B=${cB.id}; 6 users; 3 patients; approved visit=${visit.id}`);
}

/**
 * Is the SERVER a dev build? Asked of the server, not of this process.
 *
 * `process.env.NODE_ENV` here describes the harness, which is a different process and
 * may well be pointed at a production build on another port — so reading it would be
 * answering a question about the wrong thing. The CSP is the server's own statement:
 * `'unsafe-eval'` is added only in dev (HMR / React Refresh) and excluded in
 * production so a real eval is refused there (src/proxy.ts#scriptSrc).
 *
 * Two assertions genuinely only hold on a production build, and asserting them in dev
 * is how `npm run test:e2e` came to exit 1 on every ordinary dev run.
 */
async function detectServerMode() {
  const csp = (await req("/login")).headers.get("content-security-policy") || "";
  return { dev: csp.includes("'unsafe-eval'"), csp };
}

async function run() {
  const S = ids.sessions;
  const mode = await detectServerMode();
  console.log(`  server looks like a ${mode.dev ? "DEV" : "PRODUCTION"} build (from its CSP)`);

  section("AUTH & PANEL RENDERING");
  record("GET /login (no cookie) → 200", (await req("/login")).status === 200);
  record("GET /admin (no cookie) → redirect", is3xx((await req("/admin")).status));
  {
    const r = await req("/admin", { cookie: S.sadmin });
    record("super_admin GET /admin → 200 + shows Clinic A", r.status === 200 && r.text.includes("E2E Clinic A"));
  }
  {
    const r = await req(`/admin/clinics/${ids.clinics[0]}`, { cookie: S.sadmin });
    record("super_admin GET /admin/clinics/[A] → 200 + Features toggle", r.status === 200 && r.text.includes("Revenue dashboard"), r.status === 200 ? "" : `status=${r.status} ${snip(r.text)}`);
  }
  {
    // The DESTINATION is the case, not merely that something redirected: a super
    // admin has no clinic of their own, so /clinic has to send them to the company
    // panel. A bare is3xx check passes equally well on a redirect to /login, which
    // would mean the session had been dropped.
    const r = await req("/clinic", { cookie: S.sadmin });
    const to = r.headers.get("location") || "";
    record("TC-RBAC-008 super admin at /clinic is returned to the admin panel",
      is3xx(r.status) && to.includes("/admin"), `status=${r.status} → ${to || "(no Location)"}`);
  }

  {
    const r = await req("/clinic", { cookie: S.adminA });
    const okRev = r.text.includes("Revenue recovered");
    const okMoney = /Rs\s*4,000/.test(r.text) || r.text.includes("Rs 4,000");
    const okCount = /1\s*(<!--[^>]*-->)?\s*return visit/.test(r.text);
    record("clinic_admin (feature ON) GET /clinic → 200 + 'Revenue recovered'", r.status === 200 && okRev);
    record("Revenue Recovered = Rs 4,000 (1 return visit × 4000)", okMoney, okMoney ? "" : "money not found in HTML");
    record("Dashboard shows '1 return visit'", okCount, okCount ? "" : "count text not matched");
  }
  {
    // Clinic B has the feature OFF → the Revenue section must NOT appear.
    const r = await req("/clinic", { cookie: S.adminB });
    record("clinic_admin (feature OFF) GET /clinic → 200 + Revenue section hidden", r.status === 200 && !r.text.includes("Revenue recovered"), r.status === 200 ? "" : `status=${r.status}`);
  }
  {
    const r = await req("/clinic/staff", { cookie: S.adminA });
    record("clinic_admin GET /clinic/staff → 200 + 'Open' (no inline actions)", r.status === 200 && r.text.includes(">Open") && !r.text.includes("Reset password"));
  }
  {
    const r = await req("/clinic/staff/new", { cookie: S.adminA });
    record("add-staff form shows doctor schedule + fee fields", r.status === 200 && r.text.includes("Working days") && r.text.includes("Consultation fee"));
  }
  {
    const r = await req(`/clinic/staff/${ids.docAId}`, { cookie: S.adminA });
    const ok = r.status === 200 && r.text.includes("Schedule &amp; fees") && r.text.includes("Consultation fee") && r.text.includes("Leave &amp; vacation") && r.text.includes("Danger zone");
    record("clinic_admin GET staff detail → 200 + full management + leave", ok, r.status === 200 ? "" : `status=${r.status}`);
  }
  {
    const r = await req("/clinic/patients", { cookie: S.adminA });
    record("clinic_admin GET /clinic/patients → 200 + 'Open' to detail", r.status === 200 && r.text.includes("Ayesha Recovered") && r.text.includes(`/clinic/patients/${ids.patients[0]}`));
  }
  {
    const r = await req(`/clinic/patients/${ids.patients[0]}`, { cookie: S.adminA });
    record("clinic_admin GET patient detail → 200 + edit + delete", r.status === 200 && r.text.includes("Ayesha Recovered") && r.text.includes("Danger zone"));
  }
  {
    // Tenant isolation: clinic A admin must not see clinic B's patient data.
    const r = await req(`/clinic/patients/${ids.patients[2]}`, { cookie: S.adminA });
    record("TC-PAT-019 another clinic's patient cannot be opened by id",
      !r.text.includes("ClinicB Patient") &&
      // The positive half, same reasoning as TC-APPT-024: an absence proves nothing
      // on a page that failed to render or signed the user out.
      (is3xx(r.status) || isClinicShell(r)),
      `status=${r.status}`);
  }
  record("clinic_admin GET /clinic/recalls → 200", (await req("/clinic/recalls", { cookie: S.adminA })).status === 200);
  {
    // The dashboard must offer a way into Recalls (the stat card links there).
    const r = await req("/clinic", { cookie: S.adminA });
    record("dashboard links to /clinic/recalls", r.status === 200 && r.text.includes('href="/clinic/recalls"'));
  }
  {
    // Manage-appointments view: lists the seeded appt + status controls + New button.
    // The list defaults to TODAY, so query a wide range to include the seeded
    // appointment (scheduled 3 days out).
    const r = await req("/clinic/appointments?from=2000-01-01&to=2100-01-01", { cookie: S.adminA });
    const ok = r.status === 200 && r.text.includes("Ayesha Recovered") && r.text.includes('aria-label="Appointment status"') && r.text.includes("New appointment") && r.text.includes(`/clinic/appointments/${ids.apptA}`);
    record("clinic_admin GET /clinic/appointments → 200 + Open + status dropdown", ok, r.status === 200 ? "" : `status=${r.status}`);
  }
  {
    const r = await req(`/clinic/appointments/${ids.apptA}`, { cookie: S.adminA });
    // Themed status dropdown (Base UI Select) renders its trigger + current
    // value. The other options live in a portal that mounts on open, so they
    // aren't in the SSR HTML — assert the trigger + current label instead.
    const undoable = r.text.includes('aria-label="Appointment status"') && r.text.includes(">Scheduled<");
    record("clinic_admin GET appointment detail → 200 + edit + delete + status dropdown", r.status === 200 && r.text.includes("Danger zone") && r.text.includes(">Edit</") && undoable);
  }
  record("clinic_admin GET /clinic/appointments/new → 200 (schedule form)", (await req("/clinic/appointments/new", { cookie: S.adminA })).status === 200);
  {
    // Tenant scoping: clinic B (no appointments) must not see clinic A's patient.
    const r = await req("/clinic/appointments", { cookie: S.adminB });
    record("clinic appointments list is tenant-scoped (clinic B empty)", r.status === 200 && !r.text.includes("Ayesha Recovered"));
    // TC-APPT-024 is about opening one appointment BY ID, which is a different
    // question from whether the list is filtered — a list scoped correctly says
    // nothing about a detail route that trusts its own id parameter. The case also
    // names the page TITLE, which is rendered from the appointment and is the part a
    // body-only check would miss.
    const one = await req(`/clinic/appointments/${ids.apptA}`, { cookie: S.adminB });
    const title = (one.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? "";
    record("TC-APPT-024 another clinic's appointment cannot be opened by id",
      !one.text.includes("Ayesha Recovered") && !title.includes("Ayesha") &&
      // Positive half: clinic B's own session is still alive and its workspace still
      // renders. Without it, a 500 or a sign-out would read as perfect isolation.
      (is3xx(one.status) || isClinicShell(one)),
      `status=${one.status} title=${snip(title)}`);
  }
  {
    // "EVERY /admin URL", not just the panel root: the redirect lives in the admin
    // layout, and a page that reads the session itself before the layout runs would
    // slip through a check on /admin alone.
    const urls = ["/admin", "/admin/team", "/admin/overview", "/admin/clinics", "/admin/trash"];
    const bad = [];
    for (const u of urls) {
      const r = await req(u, { cookie: S.adminA });
      // A panel `redirect()` can arrive inside a 200 once the layout has begun
      // streaming (ADR-026), so the content is the honest test, with the status as
      // supporting detail.
      const leaked = r.text.includes("E2E Clinic B") || r.text.includes("Clinics</h1>");
      // And the POSITIVE half, without which this whole loop is satisfiable by a
      // blank page or a dropped session: a 200 has to be the clinic workspace the
      // admin was sent back to, which means its own nav is there.
      const landedInClinic = is3xx(r.status) || isClinicShell(r);
      if (leaked || !landedInClinic) bad.push(`${u}=${r.status}${leaked ? " LEAK" : " not-the-clinic-shell"}`);
    }
    record("TC-RBAC-007 clinic admin reaches no /admin URL and sees no cross-clinic data",
      bad.length === 0, bad.length ? bad.join(", ") : `${urls.length} URLs`);
    record("TC-RBAC-007b …and neither does a doctor", is3xx((await req("/admin", { cookie: S.docA })).status));
  }

  // Unified workspace: all clinic staff work from /clinic; the old /doctor and
  // /reception panels fold in (redirect).
  record("doctor GET /clinic → 200 (unified workspace)", (await req("/clinic", { cookie: S.docA })).status === 200);
  record("doctor GET /doctor → redirect (folded into /clinic)", is3xx((await req("/doctor", { cookie: S.docA })).status));

  record("receptionist GET /clinic → 200 (unified workspace)", (await req("/clinic", { cookie: S.recepA })).status === 200);
  record("receptionist GET /reception → redirect (folded)", is3xx((await req("/reception", { cookie: S.recepA })).status));
  record("receptionist GET /clinic/appointments/new → 200", (await req("/clinic/appointments/new", { cookie: S.recepA })).status === 200);
  {
    // The doctors/leave screen became `/clinic/schedule` (19cf342), and ADR-033 split
    // `schedule` out of `leave` at the same time: the front desk must SEE the rota to
    // book against it, but re-shaping a doctor's capacity is `schedule:edit`, which a
    // receptionist does not hold by default. So this asserts both halves — the page
    // renders, and the daily-cap control is NOT offered. It checked the old route and
    // the old permission split until now, which is why it failed against a product
    // that had deliberately changed.
    const r = await req("/clinic/schedule", { cookie: S.recepA });
    record(
      "receptionist GET /clinic/schedule → 200, rota visible, no cap editor",
      r.status === 200 &&
        r.text.includes("Doctor schedule") &&
        !r.text.includes('aria-label="Daily appointment limit"'),
    );
    // The old bookmark still works, but NOT as a 3xx: the panel layout has already
    // begun streaming when `redirect()` throws, so Next delivers it inside a 200 —
    // the same mechanism ADR-026 records for `notFound()` in a panel. Asserting a
    // redirect STATUS here would be asserting something this app never sends.
    const old = await req("/clinic/doctors", { cookie: S.recepA });
    record(
      "old /clinic/doctors bookmark still points at the schedule",
      old.status === 200 && old.text.includes("/clinic/schedule"),
    );
  }
  {
    // All four clinic roles, because the case is about WHO reaches the screen, and
    // checking only the receptionist leaves both halves of that unproven: a screen
    // open to everybody and a screen open to nobody else both pass.
    const r = await req("/clinic/whatsapp", { cookie: S.recepA });
    record("TC-WA-001 receptionist GET /clinic/whatsapp → 200 + inbound msg", r.status === 200 && r.text.includes("I need an appointment"));
    const mgr = await req("/clinic/whatsapp", { cookie: S.mgrA });
    const adm = await req("/clinic/whatsapp", { cookie: S.adminA });
    record("TC-WA-001b manager and clinic admin reach the same screen",
      mgr.status === 200 && mgr.text.includes("I need an appointment") &&
      adm.status === 200 && adm.text.includes("I need an appointment"),
      `manager=${mgr.status} admin=${adm.status}`);
    const doc = await req("/clinic/whatsapp", { cookie: S.docA });
    const docHome = await req("/clinic", { cookie: S.docA });
    // Assert on the inbound MESSAGE's absence, not on a status: a panel `redirect()`
    // arrives inside a 200 because the layout has begun streaming (ADR-026). The
    // workspace check is the positive half — a doctor whose session had died would
    // also see no messages and no nav item.
    record("TC-WA-001c doctor holds no WhatsApp permission — no messages, item hidden",
      !doc.text.includes("I need an appointment") &&
      !docHome.text.includes('href="/clinic/whatsapp"') &&
      isClinicShell(docHome),
      `status=${doc.status} workspace=${isClinicShell(docHome)}`);
  }

  section("SUSPENSION ENFORCEMENT");
  await pool.query("update users set is_active=false where id=$1", [ids.suspUserId]);
  record("TC-AUTH-028 suspended user's session is rejected → redirect", is3xx((await req("/clinic", { cookie: S.susp })).status));
  await pool.query("update users set is_active=true where id=$1", [ids.suspUserId]);

  section("PRESCRIPTION PDF + TENANT ISOLATION");
  {
    const r = await req(`/api/prescriptions/${ids.visit}`, { cookie: S.adminA });
    // NOT tagged TC-CLIN-007. That case is about what the prescription CONTAINS —
    // the drug lines, the prescriber, and the clinical note deliberately left out —
    // and a PDF's text lives in a compressed stream, so none of it is observable
    // from the response bytes. Content-type is a real property and a much smaller
    // one; claiming the case on it would be claiming the confidentiality half.
    record("own-clinic prescription PDF → 200 application/pdf", r.status === 200 && r.ct.includes("pdf"), r.status === 200 ? "" : `status=${r.status} ${snip(r.text)}`);
  }
  // Likewise not TC-CLIN-012: that case is the ATTACHMENT route (x-rays, photos), a
  // different surface. A prescription is generated from the visit; an attachment is
  // a stored file. Proving one says nothing about the other.
  record("cross-tenant prescription (clinic B admin) → 404", (await req(`/api/prescriptions/${ids.visit}`, { cookie: S.adminB })).status === 404);
  record("prescription without session → 401", (await req(`/api/prescriptions/${ids.visit}`)).status === 401);
  {
    // TC-RBAC-010 names three routes and the exact body. The body matters: a 401
    // from the proxy's cookie gate and a 401 from `apiRequireWorkspace` are
    // different code paths, and only the second one is the chokepoint ADR-013 built.
    const routes = ["/api/patients/export", "/api/appointments/export", "/api/finance/export?type=pl"];
    const seen = [];
    for (const route of routes) {
      const u = await req(route);
      seen.push(`${route.split("?")[0]}=${u.status}${u.text.includes("Not signed in.") ? "+msg" : ""}`);
      if (u.status !== 401 || !u.text.includes("Not signed in.")) seen.push("MISMATCH");
    }
    record("TC-RBAC-010 unauthenticated API callers get 401 \"Not signed in.\"",
      !seen.includes("MISMATCH"), seen.filter((s) => s !== "MISMATCH").join(", "));
  }
  {
    // A SIGNED-IN caller who lacks the grant is a different refusal from an anonymous
    // one — 403 rather than 401 — and conflating them would hide a route that
    // authenticates but never authorizes. The doctor is the right seat: a real
    // session, and neither grant.
    //
    // The assertion is on the STATUS and on no data coming back, not on the body
    // string, and that is a correction to the case rather than a softening of it.
    // TC-RBAC-009 says both answer "Not permitted.", which is what the shared
    // chokepoint (`apiRequireWorkspace`) sends. `/api/finance/export` gates per
    // REPORT TYPE — each one needs its own feature ∩ permission pair, which one call
    // cannot express — so it refuses in the route with a bare "Forbidden". Thirteen
    // such responses exist across four route files. Whether the API should speak one
    // denial vocabulary is a product decision; asserting a message the code does not
    // send would just make this suite red about somebody else's open question.
    const denied = [];
    for (const route of ["/api/finance/export?type=pl", "/api/staff/export"]) {
      const r = await req(route, { cookie: S.docA });
      denied.push(`${route.split("?")[0]}=${r.status} "${snip(r.text).slice(0, 20)}"`);
      if (r.status !== 403) denied.push("MISMATCH");
      // "No data rows" is the half a status check misses: a 403 that still streamed
      // the CSV would read as perfectly secure from the status line alone.
      if (r.text.includes("Powered by")) denied.push("LEAKED-CSV");
    }
    record("TC-RBAC-009 a signed-in caller without the grant is refused 403 with no data",
      !denied.includes("MISMATCH") && !denied.includes("LEAKED-CSV"),
      denied.filter((d) => !d.startsWith("MIS") && !d.startsWith("LEAK")).join(", "));
  }
  {
    // An unmatched URL inside a panel. The STATUS is deliberately 200, not 404 —
    // the workspace layout has begun streaming before notFound() throws, which is
    // the documented consequence of giving panels a server-rendered catch-all so
    // their scripts can be nonced (ADR-026). Asserting 404 here would fail against
    // correct code, so the assertion is on what the user actually gets: the
    // not-found page, and a route back off it.
    for (const [who, cookie, path] of [
      ["clinic", S.adminA, "/clinic/no-such-page-at-all"],
      ["admin", S.sadmin, "/admin/no-such-page-at-all"],
    ]) {
      const r = await req(path, { cookie });
      const shown = r.text.includes("We cannot find that page");
      const wayBack = r.text.includes('href="/"') || r.text.includes('href="/clinic"') || r.text.includes('href="/admin"');
      record(`TC-LIST-014${who === "admin" ? "b" : ""} an unknown ${who} URL shows a not-found page with a way back`,
        shown && wayBack, `status=${r.status} notFound=${shown} link=${wayBack}`);
    }
  }

  section("SIGNED PUBLIC LINK (/p/rx)");
  if (!SECRET_LINK) {
    record("signed public link checks", true, "skipped (LINK_SIGNING_SECRET unset)");
  } else {
    {
      const r = await req(`/p/rx/${signToken(ids.visit, Date.now() + 3600e3)}`);
      record("TC-CLIN-008 valid signed link → 200 PDF", r.status === 200 && r.ct.includes("pdf"), r.status === 200 ? "" : `status=${r.status} ${snip(r.text)}`);
    }
    {
      const tampered = signToken(ids.visit, Date.now() + 3600e3).slice(0, -3) + "AAA";
      record("TC-CLIN-008b tampered token → 404", (await req(`/p/rx/${tampered}`)).status === 404);
    }
    record("TC-CLIN-008c expired token → 404", (await req(`/p/rx/${signToken(ids.visit, Date.now() - 1000)}`)).status === 404);
  }

  section("WHATSAPP WEBHOOK");
  if (!WH_TOKEN) {
    record("webhook checks", true, "skipped (WHATSAPP_WEBHOOK_TOKEN unset)");
  } else {
    const json = { "content-type": "application/json" };
    {
      // Status, body AND the absence of a stored row. "Nothing is stored" is the half
      // that matters: a 401 returned after the insert would look identical from
      // outside and would still have logged an attacker's payload against a patient.
      const probe = "E2E unauthorized probe";
      const payload = JSON.stringify({ mobile: "+923009990001", text: probe });
      const none = await req("/api/whatsapp/webhook", { method: "POST", body: payload, headers: json });
      const wrong = await req("/api/whatsapp/webhook?token=WRONG", { method: "POST", body: payload, headers: json });
      const stored = (await pool.query("select count(*)::int c from whatsapp_messages where body=$1", [probe])).rows[0].c;
      record("TC-WA-005 webhook with no token and with a wrong token → 401 \"Unauthorized.\"",
        none.status === 401 && wrong.status === 401 &&
        none.text.includes("Unauthorized") && wrong.text.includes("Unauthorized"),
        `none=${none.status} wrong=${wrong.status}`);
      record("TC-WA-005b …and neither attempt stored anything", stored === 0, `rows=${stored}`);
    }
    {
      const body = JSON.stringify({ mobile: "+923009990001", text: "E2E inbound probe message" });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      const row = (await pool.query("select m.patient_id, wd.code as direction from whatsapp_messages m join whatsapp_directions wd on wd.id = m.direction where m.body=$1 order by m.created_at desc limit 1", ["E2E inbound probe message"])).rows[0];
      record("TC-WA-006 webhook inbound (valid token) → 200 + logged & patient-matched", r.status === 200 && row && row.direction === "inbound" && row.patient_id === ids.patients[0]);
      {
        // The other half of the case, and the one a tenant-matching bug would hide:
        // a message from a number nobody recognises must still be STORED, merely
        // unattributed. Discarding it loses a real patient's first contact.
        const probe = "E2E unknown-number probe";
        const unknown = JSON.stringify({ mobile: "+923001112233", text: probe });
        const ur = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body: unknown, headers: json });
        const urow = (await pool.query("select patient_id from whatsapp_messages where body=$1 order by created_at desc limit 1", [probe])).rows[0];
        record("TC-WA-006b an UNKNOWN number is stored but left unattributed",
          ur.status === 200 && Boolean(urow) && urow.patient_id === null,
          `status=${ur.status} stored=${Boolean(urow)} patient=${urow?.patient_id ?? "null"}`);
        // It is not ours to clean up via the clinic cascade: an unmatched inbound row
        // may carry a NULL clinic_id, which no clinic delete would reach.
        await pool.query("delete from whatsapp_messages where body=$1", [probe]);
      }
      // Both providers now share ONE pipeline (D-10), so the idempotency the Cloud
      // route proves must hold here too — this is the assertion that the AiSensy
      // adapter is genuinely feeding it and not a leftover copy.
      const mid = `e2e-aisensy-${Date.now()}`;
      const dupBody = JSON.stringify({ mobile: "+923009990001", text: "E2E replay probe", messageId: mid });
      const first = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body: dupBody, headers: json });
      const again = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body: dupBody, headers: json });
      const n = (await pool.query("select count(*)::int c from whatsapp_messages where external_id=$1 and direction=1 /* inbound */", [mid])).rows[0].c;
      record("TC-WA-007 webhook replay is idempotent → still one row", first.status === 200 && again.status === 200 && n === 1, `rows=${n}`);
    }
    {
      const body = JSON.stringify({ messageId: "E2E-EXT-1", status: "read" });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      const row = (await pool.query("select status from whatsapp_messages where external_id='E2E-EXT-1'")).rows[0];
      record("webhook status receipt → advances outbound to 'read'", r.status === 200 && row && row.status === 4 /* read */);
    }
    {
      // Patient self-service reschedule via WhatsApp reply (docA has no hours
      // restriction, so any future slot is valid). patA1 has an upcoming appt.
      const d = new Date(Date.now() + 6 * 864e5);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const body = JSON.stringify({ mobile: "+923009990001", text: `reschedule ${iso} 2pm` });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      let j = {};
      try { j = JSON.parse(r.text); } catch { /* ignore */ }
      const moved = (await pool.query("select scheduled_at from appointments where clinic_id=$1 and patient_id=$2 and status=1 /* scheduled */ order by scheduled_at desc limit 1", [ids.clinics[0], ids.patients[0]])).rows[0];
      const hour = moved ? new Date(moved.scheduled_at).getHours() : null;
      record("TC-WA-011 webhook reschedule reply moves the appointment", r.status === 200 && j.rescheduled === true && hour === 14, `rescheduled=${j.rescheduled} hour=${hour}`);
    }
    {
      // Patient self-booking via WhatsApp (docA is the clinic's only doctor, no
      // hours restriction → any future slot books).
      const d = new Date(Date.now() + 8 * 864e5);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const body = JSON.stringify({ mobile: "+923009990001", text: `book ${iso} 3pm` });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      let j = {};
      try { j = JSON.parse(r.text); } catch { /* ignore */ }
      const rows = (await pool.query(
        "select scheduled_at, source, status from appointments where clinic_id=$1 and patient_id=$2 and status=1 /* scheduled */",
        [ids.clinics[0], ids.patients[0]],
      )).rows;
      const booked = rows.find((row) => new Date(row.scheduled_at).getHours() === 15);
      record("TC-WA-013 webhook 'book …' creates a new appointment", r.status === 200 && j.booked === true && Boolean(booked), `booked=${j.booked}`);
      // The case is not "an appointment appeared" — it is that the appointment is
      // MARKED as the patient's own and stays a REQUEST. Both are the whole point:
      // a self-booking indistinguishable from a staff one would be confirmed by
      // nobody and treated as confirmed by everybody.
      record("TC-WA-013b …marked source=whatsapp, so staff can tell it apart",
        booked?.source === 2 /* whatsapp */, `source=${booked?.source}`);
      record("TC-WA-013c …and stays 'scheduled' rather than arriving confirmed",
        booked?.status === 1 /* scheduled */, `status=${booked?.status}`);
    }
    {
      // TC-WA-007's OTHER half, and the one the log-row check cannot reach: a
      // redelivered message must not repeat the self-service action it triggers. A
      // duplicated log line is untidy; a double-booked patient is a wasted slot and
      // a phone call.
      //
      // Deliberately a DIFFERENT patient from every test above. The self-service
      // handlers act on "this number's next upcoming appointment", so running this
      // on patA1 had the reschedule test move the very appointment being counted —
      // which read as a failing idempotency guard and was really two tests sharing a
      // patient. +923009990003 is touched by nothing else.
      const d = new Date(Date.now() + 11 * 864e5);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const bid = `e2e-replay-book-${Date.now()}`;
      const bookBody = JSON.stringify({ mobile: "+923009990003", text: `book ${iso} 3pm`, messageId: bid });
      const b1 = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body: bookBody, headers: json });
      const b2 = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body: bookBody, headers: json });
      const made = (await pool.query(
        "select count(*)::int c from appointments where clinic_id=$1 and patient_id=$2 and scheduled_at::date = $3::date",
        [ids.clinics[0], ids.patients[3], iso],
      )).rows[0].c;
      // Assert the booking HAPPENED as well as happening once: `made === 1` is also
      // what a webhook that silently booked nothing at all would produce if the
      // first call had failed and the second been deduped.
      record("TC-WA-007b a redelivered 'book …' books the patient exactly once",
        made === 1, `first=${b1.status} replay=${b2.status} appointments on ${iso}=${made}`);
    }
  }

  section("WHATSAPP CLOUD WEBHOOK (per-clinic routing)");
  {
    const hdr = { "content-type": "application/json" };
    // GET verification with a wrong/absent token → 403.
    const g = await req("/api/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=xyz");
    const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;
    if (VERIFY) {
      // The handshake Meta actually performs: the CORRECT token must echo the raw
      // challenge back with 200. The 403 alone is only half the case — an endpoint
      // that refuses everything would satisfy it and Meta could never subscribe.
      const ok = await req(`/api/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=E2ECHALLENGE`);
      record("TC-WA-009 cloud webhook verify handshake: correct token echoes the challenge",
        ok.status === 200 && ok.text.trim() === "E2ECHALLENGE", `status=${ok.status} body=${snip(ok.text)}`);
      record("TC-WA-009b …and a wrong token returns 403 with no challenge",
        g.status === 403 && !g.text.includes("xyz"), `status=${g.status}`);
    } else {
      // The bad-token half still runs and still has to hold — it just cannot carry
      // the case id on its own, because the handshake it is half of is unproven.
      record("cloud webhook GET verify (bad token) → 403", g.status === 403);
      record.skip(
        "TC-WA-009 cloud webhook verify handshake (correct token echoes the challenge)",
        "WHATSAPP_VERIFY_TOKEN is unset, so the positive handshake cannot be exercised and the 403 alone would not prove the case",
      );
    }

    // POST inbound routed by the RECEIVING number → clinic A + patient matched within it.
    const inId = `wamid.E2E_IN_${Date.now()}`;
    const body = JSON.stringify({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: ids.waPnid },
        messages: [{ from: "923009990001", id: inId, type: "text", text: { body: "hello" } }],
      } }] }],
    });
    // The webhook FAILS CLOSED: unsigned payloads are refused in production. So the
    // request must carry a real X-Hub-Signature-256 when the app secret is
    // configured — and when it isn't, the only correct outcome is a 401.
    if (WA_APP_SECRET) {
      hdr["x-hub-signature-256"] =
        "sha256=" + crypto.createHmac("sha256", WA_APP_SECRET).update(body).digest("hex");
    }
    const r = await req("/api/whatsapp/cloud", { method: "POST", body, headers: hdr });
    let j = null;
    try { j = JSON.parse(r.text); } catch { /* ignore */ }

    if (!WA_APP_SECRET) {
      // Signature verification itself is never REACHED without the secret, so
      // TC-WA-010 is unproven either way — said once here rather than in each
      // branch below, so a dev run cannot quietly leave the case unmentioned.
      record.skip(
        "TC-WA-010 cloud webhook refuses a wrongly-signed payload",
        "WHATSAPP_APP_SECRET is unset, so signature verification is never reached",
      );
    }

    if (!WA_APP_SECRET && mode.dev) {
      // Fail-closed is a PRODUCTION property: with no app secret configured, dev
      // deliberately accepts the payload so the webhook is testable at all, and
      // only a production build refuses it. Asserting the 401 here was asserting
      // something the code is correct not to do, so every dev run of this harness
      // reported a failure and exited 1.
      record.skip(
        "cloud webhook fail-closed (unsigned payload refused)",
        "the server is a DEV build, which accepts an unsigned payload by design — run against `npm start` to assert the 401, or set WHATSAPP_APP_SECRET to exercise delivery",
      );
    } else if (!WA_APP_SECRET) {
      // Production with no app secret: an unsigned payload must be refused rather
      // than silently trusted. Deliberately NOT tagged TC-WA-010 — that case is
      // about rejection WHEN THE SECRET IS CONFIGURED, which is the branch below.
      record("cloud webhook rejects an UNSIGNED payload in production → 401", r.status === 401, `status=${r.status} (set WHATSAPP_APP_SECRET to test delivery)`);
    } else {
      record("TC-WA-010 cloud webhook accepts a CORRECTLY signed payload → 200 {inbound:1}", r.status === 200 && j && j.inbound === 1, `status=${r.status}`);
      const row = (await pool.query("select clinic_id, patient_id from whatsapp_messages where external_id=$1", [inId])).rows[0];
      record("cloud inbound routed by number → clinic A + matched patient", Boolean(row) && row.clinic_id === ids.clinics[0] && row.patient_id === ids.patients[0]);

      // Idempotency (migration 0079): a provider REDELIVERY must not log the message
      // twice, because everything after the insert has patient-visible side effects.
      const again = await req("/api/whatsapp/cloud", { method: "POST", body, headers: hdr });
      const cnt = (await pool.query("select count(*)::int c from whatsapp_messages where external_id=$1 and direction=1 /* inbound */", [inId])).rows[0].c;
      record("cloud webhook replay is idempotent → still one row", again.status === 200 && cnt === 1, `status=${again.status} rows=${cnt}`);

      // A forged payload must never be accepted when the secret IS configured.
      const bad = await req("/api/whatsapp/cloud", { method: "POST", body, headers: { ...hdr, "x-hub-signature-256": "sha256=" + "0".repeat(64) } });
      record("TC-WA-010b …and refuses a BAD signature → 401", bad.status === 401, `status=${bad.status}`);
    }
  }

  section("RECALL ENGINE (cron)");
  if (!CRON) {
    record("cron checks", true, "skipped (CRON_SECRET unset)");
  } else {
    // ---- Every job route, not just the two with assertions below -------------
    // These are publicly reachable URLs. The case says EVERY endpoint, and checking
    // one of eight would have proved only that one of them was wired up: a new job
    // added without the guard is exactly the regression worth catching, and it is
    // invisible if the list is hardcoded to the jobs that already work.
    const CRON_JOBS = [
      "recalls", "reminders", "reconcile", "expenses",
      "company-expenses", "log-retention", "billing", "scribe-recover",
    ].map((j) => `/api/cron/${j}`);
    {
      const refused = [];
      for (const route of CRON_JOBS) {
        const s = (await req(route)).status;
        if (s !== 401) refused.push(`${route}=${s}`);
      }
      record("TC-CRON-001 every cron endpoint without a secret → 401",
        refused.length === 0, refused.length ? `NOT 401: ${refused.join(", ")}` : `${CRON_JOBS.length} endpoints`);
    }

    const r = await req(`/api/cron/recalls?token=${CRON}`);
    let j = {};
    try { j = JSON.parse(r.text); } catch { /* ignore */ }
    record("recall cron authorized → 200 {ok,processed,...}", r.status === 200 && j.ok === true && typeof j.processed === "number", `processed=${j.processed} sent=${j.sent} skipped=${j.skipped}`);
    record("due recall for no-phone patient was skipped", (j.skipped ?? 0) >= 1);
    {
      // "Due recalls only" is the actual claim, and it needs the NEGATIVE half: a job
      // that actioned every recall, and one that actioned none, both satisfy a check
      // on the due row alone.
      const after = (await pool.query(
        "select id, status from recalls where id = ANY($1)",
        [[ids.recallDue, ids.recallFuture]],
      )).rows;
      const due = after.find((x) => x.id === ids.recallDue);
      const future = after.find((x) => x.id === ids.recallFuture);
      const outbound = (await pool.query(
        "select count(*)::int c from whatsapp_messages where clinic_id=$1 and direction=2 /* outbound */ and template_name is not null and created_at > now() - interval '2 minutes'",
        [ids.clinics[0]],
      )).rows[0].c;
      record("recall cron recorded an outbound message for the DUE recall", outbound >= 1, `outbound rows=${outbound}`);
      record("recall cron left the NOT-yet-due recall alone", future?.status === 1 /* pending */, `future status=${future?.status}`);
      // The status only advances on a SUCCESSFUL send (core/recall/index.ts), so with
      // no provider credentials it correctly stays pending — which is why the case
      // cannot be closed here rather than a sign the job is wrong.
      record.skip(
        "TC-CRON-003 the recalls job sends reminders for due recalls only",
        `the due recall is actioned and an outbound row written, but its status only advances on a successful SEND, and WhatsApp is unconfigured (it is still ${due?.status === 1 ? "pending" : "status " + due?.status})`,
      );
    }

    const rr = await req(`/api/cron/reminders?token=${CRON}`);
    let jr = {};
    try { jr = JSON.parse(rr.text); } catch { /* ignore */ }
    record("reminder cron authorized → 200 {ok,processed}", rr.status === 200 && jr.ok === true && typeof jr.processed === "number", `processed=${jr.processed} sent=${jr.sent}`);
    {
      // The window half of the case: tomorrow's appointment is picked up, next week's
      // is not. Asserted on the ROWS the job considered, not on its count, because a
      // count cannot distinguish "the right one" from "one of them".
      const reminded = (await pool.query(
        "select count(*)::int c from whatsapp_messages where clinic_id=$1 and direction=2 and body like 'Reminder: your appointment%' and created_at > now() - interval '2 minutes'",
        [ids.clinics[0]],
      )).rows[0].c;
      record("reminder cron messaged TOMORROW's appointment", reminded >= 1, `reminder rows=${reminded}`);
      const nextWeek = (await pool.query("select reminder_sent_at from appointments where id=$1", [ids.apptNextWeek])).rows[0];
      record("reminder cron left next week's appointment unreminded", nextWeek?.reminder_sent_at === null, `reminder_sent_at=${nextWeek?.reminder_sent_at}`);
      // "Exactly once" rests on reminder_sent_at, which is deliberately only stamped
      // when the send SUCCEEDS so a failed run retries (core/notifications/appointment.ts).
      // Unconfigured, nothing is stamped and a second run would legitimately try again,
      // so the once-only property is not observable here.
      record.skip(
        "TC-CRON-005 the reminder job messages tomorrow's appointments once",
        "the right appointment is picked up, but `reminder_sent_at` is only stamped on a successful send and WhatsApp is unconfigured, so the once-only half cannot be observed",
      );
    }

    // ---- The cron credential is the ONLY key to these routes ----------------
    // A signed-in user must not be able to kick off a reconciliation from a browser.
    // These routes are reachable without a session by design, so a session being
    // IGNORED is the property — not a side effect of them being protected at all.
    {
      const seats = [["receptionist", S.recepA], ["clinic admin", S.adminA], ["super admin", S.sadmin]];
      const codes = [];
      for (const [, cookie] of seats) codes.push((await req("/api/cron/reconcile", { cookie })).status);
      record("TC-CRON-015 a user session is not a cron credential → 401",
        codes.every((c) => c === 401),
        seats.map(([who], i) => `${who}=${codes[i]}`).join(", "));
    }

    // The three accepted transports, each proven to work, plus a wrong value
    // refused. Deliberately NOT tagged with a case id: TC-CRON-002 also claims
    // the comparison is constant-time, and response latency over HTTP is far too
    // noisy to assert that — a green tick here would be claiming a property
    // nothing measured. The code path is `secretEquals` in core/security/cron.ts.
    {
      const bearer = await req("/api/cron/recalls", { headers: { Authorization: `Bearer ${CRON}` } });
      const header = await req("/api/cron/recalls", { headers: { "x-cron-token": CRON } });
      const query = await req(`/api/cron/recalls?token=${encodeURIComponent(CRON)}`);
      record("cron secret accepted as Bearer, x-cron-token and ?token= alike",
        [bearer, header, query].every((r) => r.status === 200),
        `bearer=${bearer.status} header=${header.status} query=${query.status}`);
      const wrong = await req(`/api/cron/recalls?token=${encodeURIComponent(CRON)}x`);
      record("a cron secret with one extra character is refused → 401", wrong.status === 401, `status=${wrong.status}`);
    }
  }

  section("VOICE SCRIBE (auth + tenant + unconfigured)");
  const mkForm = (patientId) => {
    const fd = new FormData();
    fd.append("patientId", patientId);
    fd.append("audio", new Blob([Buffer.from([1, 2, 3])], { type: "audio/webm" }), "r.webm");
    return fd;
  };
  record("doctor scribe on cross-tenant patient → 404", (await req("/api/ai/scribe", { cookie: S.docA, method: "POST", body: mkForm(ids.patients[2]) })).status === 404);
  {
    // The route ACCEPTS the recording and returns 202 (delta D-08 / ADR-020) — it no
    // longer waits for the AI, so an unconfigured provider is no longer a request-time
    // error. What must still hold: the visit exists with the audio stored, and the
    // failure lands ON IT rather than vanishing. Asserted below by polling the row.
    const r = await req("/api/ai/scribe", { cookie: S.docA, method: "POST", body: mkForm(ids.patients[0]) });
    record("doctor scribe → 202 accepted (the AI runs after the response)", r.status === 202, `status=${r.status}`);

    // `req` returns raw text, not parsed JSON.
    let visitId;
    try { visitId = JSON.parse(r.text)?.visitId; } catch { visitId = undefined; }
    record("…and it returns the visit it created", typeof visitId === "string", `visitId=${visitId}`);

    if (visitId) {
      // The job runs in `after()`, so give it a moment, then read the row directly.
      let row = null;
      for (let i = 0; i < 20 && !row?.settled; i++) {
        await new Promise((res) => setTimeout(res, 250));
        const q = await pool.query(
          `select vs.code as status, v.transcribe_error, v.audio_key from visits v
             join visit_statuses vs on vs.id = v.status where v.id = $1`,
          [visitId],
        );
        const v = q.rows[0];
        row = v ? { ...v, settled: v.status !== "transcribing" } : null;
      }
      // With no keys the run fails — which is the graceful outcome this used to assert
      // as a 400, now expressed where it actually belongs: on the visit.
      record("the run settles out of `transcribing` (no keys → failed)", row?.status === "failed", `status=${row?.status}`);
      record("with a reason the doctor can read", Boolean(row?.transcribe_error), `err=${row?.transcribe_error}`);
      record("and the recording was kept, so it can be retried", Boolean(row?.audio_key), `key=${row?.audio_key}`);
    }
  }
  {
    // The scribe gates on the `clinical:create` PERMISSION, not the `doctor` ROLE
    // (CLAUDE.md §8). A receptionist doesn't hold it → 403.
    const rec = await req("/api/ai/scribe", { cookie: S.recepA, method: "POST", body: mkForm(ids.patients[0]) });
    record("receptionist scribe → 403 (lacks clinical:create)", rec.status === 403, `status=${rec.status}`);

    // …and the clinic OWNER who is the practising dentist must NOT be locked out.
    // The old `role === "doctor"` check 401'd them even though /clinic/scribe let
    // them record. Anything but 401/403 means they got through the guard (400 here,
    // since AI keys aren't configured in the test env).
    const owner = await req("/api/ai/scribe", { cookie: S.adminA, method: "POST", body: mkForm(ids.patients[0]) });
    record("clinic admin (owner-dentist) scribe is NOT blocked", owner.status !== 401 && owner.status !== 403, `status=${owner.status}`);
  }

  section("API AUTH CHOKEPOINT (paused clinic can't reach data routes)");
  {
    // Regression guard: Route Handlers used to run their own `getCurrentUser() +
    // can()` check and skip the clinic-usable gate that every PAGE enforces, so a
    // suspended clinic's staff were bounced from the UI yet could still pull a full
    // patient CSV. `apiRequireWorkspace` closed that. Suspend clinic A and prove it.
    const before = await req("/api/patients/export", { cookie: S.adminA });
    record("active clinic can export patients → 200", before.status === 200, `status=${before.status}`);

    await pool.query("update clinics set status=3 /* suspended */ where id=$1", [ids.clinics[0]]);
    const paused = await req("/api/patients/export", { cookie: S.adminA });
    record("SUSPENDED clinic is refused the patients CSV → 403", paused.status === 403, `status=${paused.status}`);
    const pausedAppts = await req("/api/appointments/export", { cookie: S.adminA });
    record("SUSPENDED clinic is refused the appointments CSV → 403", pausedAppts.status === 403, `status=${pausedAppts.status}`);
    const pausedScribe = await req("/api/ai/scribe", { cookie: S.adminA, method: "POST", body: mkForm(ids.patients[0]) });
    record("SUSPENDED clinic can't reach the PAID AI scribe → 403", pausedScribe.status === 403, `status=${pausedScribe.status}`);

    // The PAGE side of the same lock. A pause has to take hold on an ALREADY-OPEN
    // session rather than at the next sign-in, so the existing cookie is used
    // deliberately — minting a fresh one would test a different thing.
    {
      const page = await req("/clinic", { cookie: S.adminA });
      const bounced = is3xx(page.status) || !page.text.includes("Ayesha Recovered");
      record("TC-SUPER-003 SUSPENDED clinic bounces its staff out of the workspace",
        bounced, `status=${page.status}`);
      const patients = await req("/clinic/patients", { cookie: S.adminA });
      record("TC-SUPER-003b …and no patient data renders on the way out",
        !patients.text.includes("Ayesha Recovered"), `status=${patients.status}`);
    }

    // Support must still be able to look at a suspended clinic — that is usually
    // exactly why they are looking. Deliberate, and not a defect.
    {
      const r = await req(`/admin/clinics/${ids.clinics[0]}`, { cookie: S.sadmin });
      record("TC-RBAC-022 support can still open a suspended clinic",
        r.status === 200 && r.text.includes("E2E Clinic A"), `status=${r.status}`);
    }

    await pool.query("update clinics set status=2 /* active */ where id=$1", [ids.clinics[0]]);
    const after = await req("/api/patients/export", { cookie: S.adminA });
    record("restoring the clinic restores API access → 200", after.status === 200, `status=${after.status}`);
    {
      // Reactivating must restore the PAGES too, with the data intact — a lock that
      // does not lift is a worse bug than one that never engaged.
      const page = await req("/clinic/patients", { cookie: S.adminA });
      record("TC-SUPER-003c reactivating restores the workspace with its data",
        page.status === 200 && page.text.includes("Ayesha Recovered"), `status=${page.status}`);
    }
  }

  section("LOGIN CREDENTIAL PATH (bcrypt round-trip)");
  {
    const admin = (await pool.query("select password_hash from users where username=$1", [process.env.SEED_ADMIN_USERNAME || "admin"])).rows[0];
    if (admin && process.env.SEED_ADMIN_PASSWORD) {
      const ok = await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD, admin.password_hash);
      record("seeded super-admin password verifies against stored bcrypt hash", ok);
    } else {
      record("seeded super-admin bcrypt check", true, "skipped (no seed creds)");
    }
  }

  section("SOFT DELETE / TRASH");
  {
    const cA = ids.clinics[0];
    const adminAId = ids.users[1];
    const grp = crypto.randomUUID();
    // A directly-trashed patient (mimics the deletePatient soft delete).
    await pool.query(
      "insert into patients (clinic_id, full_name, deleted_at, deleted_by, delete_group) values ($1,'ZZE2ETrashed', now(), $2, $3)",
      [cA, adminAId, grp],
    );

    {
      const r = await req("/clinic/patients", { cookie: S.adminA });
      record("trash: soft-deleted patient hidden from the patients list", r.status === 200 && !r.text.includes("ZZE2ETrashed"));
    }
    {
      const r = await req("/clinic/trash", { cookie: S.adminA });
      record("trash: clinic admin sees it in Trash with Restore", r.status === 200 && r.text.includes("ZZE2ETrashed") && r.text.includes("Restore"));
    }
    {
      const r = await req("/clinic/trash?type=procedure", { cookie: S.adminA });
      record("trash: type filter narrows it out", r.status === 200 && !r.text.includes("ZZE2ETrashed"));
    }
    {
      const r = await req("/clinic/trash", { cookie: S.recepA });
      record("trash: receptionist has Trash by default (view + Restore)", r.status === 200 && r.text.includes("ZZE2ETrashed") && r.text.includes("Restore"));
    }
    {
      const r = await req("/admin/trash", { cookie: S.sadmin });
      record("trash: super admin sees it across clinics with Purge", r.status === 200 && r.text.includes("ZZE2ETrashed") && r.text.includes("Purge"));
    }
    // Restore round-trip (revert the delete group) → back in the live list.
    await pool.query("update patients set deleted_at=null, delete_group=null, deleted_by=null, deleted_by_cascade=false where delete_group=$1", [grp]);
    {
      const r = await req("/clinic/patients", { cookie: S.adminA });
      record("trash: after restore, patient returns to the list", r.status === 200 && r.text.includes("ZZE2ETrashed"));
    }
  }

  section("LIVE QUEUE (doctor: Arrived → Call in → Complete)");
  {
    // Reception checks the patient in; the doctor's queue should offer "Call in".
    await pool.query("update appointments set status=3 /* arrived */, arrived_at=now() where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      const ok = r.status === 200 && r.text.includes("Bilal NoPhone") && r.text.includes("Call in") && r.text.includes("Arrived");
      record("doctor queue: Arrived patient shows a 'Call in' control", ok, ok ? "" : `status=${r.status} ${snip(r.text)}`);
    }
    // Call in → in the room. "Call in" gives way to "Complete"; now-serving shows the token.
    await pool.query("update appointments set status=4 /* in_progress */ where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      const ok = r.status === 200 && r.text.includes("In progress") && !r.text.includes("Call in");
      record("doctor queue: In progress patient — 'Call in' gone (now 'Complete')", ok, ok ? "" : `status=${r.status}`);
    }
    // Complete → done. No advance control remains for that patient.
    await pool.query("update appointments set status=5 /* completed */ where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      // "Call in" is the advance BUTTON's text (nextQueueAction), so its absence is the
      // real assertion. The status label "In progress" is no longer usable as evidence:
      // vocabulary labels come from the database and the whole snapshot is serialised
      // into every page payload for client components, so a bare text search finds them
      // as DATA whether or not anything rendered them (ADR-027).
      const ok = r.status === 200 && r.text.includes("Completed") && !r.text.includes("Call in");
      record("doctor queue: Completed patient — no advance controls left", ok, ok ? "" : `status=${r.status}`);
    }
  }

  section("CSV EXPORTS (auth + text/csv + BOM + brand footer)");
  {
    // Mirrors the default in core/lib/brand.ts rather than hardcoding a brand string.
    // This assertion was left reading "www.klenic.com" after the rebrand, so it had
    // been failing against every export it checks.
    const brandSite = process.env.NEXT_PUBLIC_BRAND_WEBSITE?.trim() || "www.flexicaai.com";
    const okCsv = (r, header) =>
      r.status === 200 &&
      r.ct.includes("text/csv") &&
      r.text.includes(`Powered by ${brandSite}`) &&
      r.text.includes(header);

    // Exports that need no billing feature (patients / staff / appointments).
    {
      const r = await req("/api/patients/export", { cookie: S.adminA });
      record("TC-PAT-017 patients CSV → text/csv + footer + header", okCsv(r, "MRN,Name,Phone"), okCsv(r, "MRN,Name,Phone") ? "" : `status=${r.status} ct=${r.ct}`);
      record("TC-PAT-017b patients CSV is clinic-scoped (has A patient, not B)", r.text.includes("Ayesha Recovered") && !r.text.includes("ClinicB Patient"));
    }
    {
      const r = await req("/api/staff/export", { cookie: S.adminA });
      record("staff CSV → text/csv + footer + header", okCsv(r, "Name,Username,Role"), okCsv(r, "Name,Username,Role") ? "" : `status=${r.status} ct=${r.ct}`);
    }
    {
      // `?period=year` was doing NOTHING. The appointments export reads from/to
      // (parseListFilters), and with neither it defaults to TODAY — so this export
      // was being asserted over an almost empty range, and the header check below
      // passes on a CSV with no rows at all. Give it a window that actually
      // contains the seeded appointments, then assert a row is IN it.
      const ymd = (offsetDays) => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local
      };
      const range = `from=${ymd(-30)}&to=${ymd(30)}`;
      const r = await req(`/api/appointments/export?${range}`, { cookie: S.adminA });
      record("TC-APPT-023 appointments CSV → text/csv + footer + header", okCsv(r, "Date,Token,Patient"), okCsv(r, "Date,Token,Patient") ? "" : `status=${r.status} ct=${r.ct}`);
      // The scoping half, and the half that proves the export produced DATA. Without
      // it the export could be answering for every clinic, or for none, and the
      // header check above would still be perfectly green.
      record("TC-APPT-023b appointments CSV is clinic-scoped (A's patient, not B's)",
        r.text.includes("Ayesha Recovered") && !r.text.includes("ClinicB Patient"),
        `${r.text.trim().split("\n").length} lines for ${range}`);
      // The on-screen filter must reach the download: a date range outside every
      // appointment returns the header and nothing else.
      const empty = await req(`/api/appointments/export?from=${ymd(-400)}&to=${ymd(-370)}`, { cookie: S.adminA });
      record("TC-APPT-023c the date filter reaches the export (empty range → no rows)",
        empty.status === 200 && !empty.text.includes("Ayesha Recovered"), `status=${empty.status}`);
    }

    // Raw-byte BOM check (fetch's text() decode strips a leading BOM, so read bytes).
    {
      const raw = await fetch(BASE + "/api/patients/export", { headers: { Cookie: `klenic_session=${S.adminA}` } });
      const buf = Buffer.from(await raw.arrayBuffer());
      const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      record("patients CSV begins with a UTF-8 BOM (EF BB BF)", hasBom, hasBom ? "" : `first bytes ${buf.subarray(0, 3).toString("hex")}`);
    }

    // Billing-gated + STREAMED exports: enable the sales + finance features on Clinic A.
    await pool.query("update clinics set features_enabled = ARRAY['revenue_dashboard','sales','finance'] where id = $1", [ids.clinics[0]]);

    // ── NAV GATING (the sidebar is now data: app/clinic/nav.ts + PanelShell) ──
    // Clinic A has sales+finance; Clinic B has neither. The nav items that declare
    // `feature: "sales"` must appear for one and not the other. This is the only
    // check that the declarative gating actually reaches the rendered sidebar —
    // everything else here is API-level and would pass with the nav wired wrong.
    {
      const a = await req("/clinic", { cookie: S.adminA });
      const b = await req("/clinic", { cookie: S.adminB });
      record("nav: sales-gated item shows for a clinic WITH the feature", a.text.includes("/clinic/sales"));
      record("nav: …and is hidden for a clinic without it", !b.text.includes("/clinic/sales"));
      record("nav: finance-gated item follows the same flag", a.text.includes("/clinic/pl") && !b.text.includes("/clinic/pl"));
      // Ungated items must still render for both — a gating bug that hid everything
      // would otherwise look like a pass above.
      record("nav: ungated items render for both", a.text.includes("/clinic/patients") && b.text.includes("/clinic/patients"));
      // The dead panels' nav is gone (D-04); nothing should link into them.
      record("nav: no links into the removed /doctor or /reception panels", !a.text.includes('href="/reception') && !a.text.includes('href="/doctor'));
    }
    // ── DAY BOOK: the dashboard entry point + the page it lands on ──
    // The dashboard button is gated on the SALES feature + billing:view (the day
    // book's own guard), not on `finance` — gating it on finance would show a button
    // that lands on notFound() for a sales-but-not-finance clinic.
    {
      const a = await req("/clinic", { cookie: S.adminA });
      const b = await req("/clinic", { cookie: S.adminB });
      record(
        "dashboard: Day book button links to the day book",
        a.text.includes('href="/clinic/reports/daybook"') && a.text.includes("Day book"),
      );
      record(
        "dashboard: it no longer points at the Overview as 'Day report'",
        !a.text.includes("Day report"),
      );
      record(
        "dashboard: hidden for a clinic without the sales feature",
        !b.text.includes('href="/clinic/reports/daybook"'),
      );

      const d = await req("/clinic/reports/daybook", { cookie: S.adminA });
      record("day book page → 200", d.status === 200, d.status === 200 ? "" : `status=${d.status}`);
      record("day book offers Download PDF", d.text.includes("Download PDF"));
      record("day book still offers Export CSV", d.text.includes("Export CSV"));
      // The payouts column is the third cash source; without it the report understates
      // what left the drawer.
      record("day book shows the Doctor payouts column", d.text.includes("Doctor payouts"));
      // A printed sheet with no clinic name or date is not a record.
      record("day book prints a clinic + date header", d.text.includes("print:block"));
      // Clinic B has no sales feature, so the page itself must refuse it too — the
      // button being hidden is not the same as the route being closed.
      // Assert on CONTENT, not status: a notFound() inside a panel returns 200 because
      // the layout has already begun streaming when it throws (ADR-026). Checking for
      // 404 here fails against correct code.
      const nb = await req("/clinic/reports/daybook", { cookie: S.adminB });
      record(
        "day book renders nothing for a clinic without the feature",
        !nb.text.includes("Download PDF") && !nb.text.includes("Doctor payouts"),
      );
    }

    {
      const r = await req("/api/finance/export?type=sales&period=year", { cookie: S.adminA });
      record("sales CSV (streamed) → text/csv + footer + header", okCsv(r, "Date,Patient,Phone,Doctor,Gross"), okCsv(r, "Date,Patient,Phone,Doctor,Gross") ? "" : `status=${r.status} ct=${r.ct}`);
      record("sales CSV contains the seeded sale row (5000)", r.text.includes("5000"));
    }
    {
      const r = await req("/api/finance/export?type=payments&period=year", { cookie: S.adminA });
      record("payments CSV (streamed) → text/csv + footer + header", okCsv(r, "Date,Patient,Phone,Doctor,Type,Method"), okCsv(r, "Date,Patient,Phone,Doctor,Type,Method") ? "" : `status=${r.status} ct=${r.ct}`);
      record("payments CSV contains the seeded payment (cash 5000)", r.text.includes("cash") && r.text.includes("5000"));
    }
    {
      const r = await req("/api/procedures/export", { cookie: S.adminA });
      record("procedures CSV → text/csv + footer + header", okCsv(r, "Procedure,Price"), okCsv(r, "Procedure,Price") ? "" : `status=${r.status} ct=${r.ct}`);
      record("procedures CSV contains seeded procedure", r.text.includes("Scaling & polishing"));
    }
    // Negative: Clinic B lacks the sales feature → sales export is forbidden.
    {
      const r = await req("/api/finance/export?type=sales", { cookie: S.adminB });
      record("sales CSV forbidden without the sales feature (clinic B) → 403", r.status === 403, `status=${r.status}`);
    }

    // ---- CSP is ENFORCED, in two strengths (D-15) ----------------------------
    // These guard the one property that makes the split correct and that nothing
    // else would catch: a nonce can only be applied to a SERVER-RENDERED response.
    // If Next ever stops noncing, or a panel response starts coming from the
    // prerender cache, the panel's scripts are refused and the workspace goes blank
    // — silently, because the app itself raises no error.
    section("CSP");
    {
      const csp = (r) => r.headers.get("content-security-policy") || "";
      const reportOnly = (r) => r.headers.get("content-security-policy-report-only") || "";

      const pub = await req("/privacy");
      const panel = await req("/clinic", { cookie: S.adminA });

      record("public page: CSP is enforced, not report-only", Boolean(csp(pub)) && !reportOnly(pub));
      record("panel page: CSP is enforced, not report-only", Boolean(csp(panel)) && !reportOnly(panel));

      // The public policy MUST NOT carry a nonce or a hash: under CSP3 either one
      // disables 'unsafe-inline', and a prerendered page's ~36 inline flight scripts
      // have no nonce to fall back on. That is the whole reason for two policies.
      const pubScript = (csp(pub).match(/script-src[^;]*/) || [""])[0];
      record("public script-src allows inline (prerender needs it)", pubScript.includes("'unsafe-inline'"), pubScript);
      record("public script-src carries NO nonce or hash (they would void unsafe-inline)",
        !pubScript.includes("nonce-") && !pubScript.includes("sha256-"));

      // The panel policy is the strict one, and must NOT weaken to 'unsafe-inline'.
      const panelScript = (csp(panel).match(/script-src[^;]*/) || [""])[0];
      record("panel script-src is strict: nonce + strict-dynamic", panelScript.includes("nonce-") && panelScript.includes("'strict-dynamic'"), panelScript);
      record("panel script-src does NOT allow inline", !panelScript.includes("'unsafe-inline'"));

      // The load-bearing one: every script Next emits on a panel page carries the
      // nonce from THIS response's header. A mismatch means a blank workspace.
      const headerNonce = (csp(panel).match(/'nonce-([^']+)'/) || [])[1];
      const panelScripts = panel.text.match(/<script[^>]*src=[^>]*>/g) || [];
      const unNonced = panelScripts.filter((s) => !s.includes(`nonce="${headerNonce}"`));
      record("every panel script carries this response's nonce", panelScripts.length > 0 && unNonced.length === 0,
        `${panelScripts.length} scripts, ${unNonced.length} un-nonced`);

      // Why the public side cannot use that policy, asserted rather than assumed.
      const pubScripts = pub.text.match(/<script[^>]*src=[^>]*>/g) || [];
      record("a prerendered page's scripts carry NO nonce (hence the second policy)",
        pubScripts.length > 0 && pubScripts.every((s) => !s.includes("nonce=")), `${pubScripts.length} scripts`);

      // An unmatched panel URL must be SERVER-RENDERED by the panel's catch-all, not
      // served from the prerendered /_not-found — which carries no nonce and would
      // have every script refused under the strict policy the path already got.
      const panel404 = await req("/clinic/no-such-page-at-all", { cookie: S.adminA });
      const p404Scripts = panel404.text.match(/<script[^>]*src=[^>]*>/g) || [];
      record("unmatched panel URL is server-rendered, so its scripts are nonced",
        p404Scripts.length > 0 && p404Scripts.every((s) => s.includes("nonce=")), `${p404Scripts.length} scripts`);

      // Directives that are pure gain and must not silently disappear.
      for (const d of ["frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'", "connect-src 'self'", "object-src 'none'"]) {
        record(`enforced on both policies: ${d}`, csp(pub).includes(d) && csp(panel).includes(d));
      }
    }
  }
}

async function cleanup() {
  section("CLEANUP");
  // Explicit dependency order — a clinic delete only sets users.clinic_id NULL, so delete users too.
  if (ids.users?.length) await pool.query("delete from sessions where user_id = ANY($1)", [ids.users]);
  if (ids.clinics?.length) {
    await pool.query("delete from users where clinic_id = ANY($1)", [ids.clinics]); // clinic-scoped staff
    await pool.query("delete from clinics where id = ANY($1)", [ids.clinics]); // cascades patients/appts/visits/recalls/wa
  }
  if (ids.users?.length) await pool.query("delete from users where id = ANY($1)", [ids.users]); // super_admin (null clinic)

  // The scribe test writes an audio file under storage/<clinicId>/ before failing on the missing key.
  // Remove any storage folder whose clinic no longer exists (never touch a live clinic's audio).
  try {
    const live = new Set((await pool.query("select id from clinics")).rows.map((r) => r.id));
    if (fs.existsSync(STORAGE_DIR)) {
      for (const name of fs.readdirSync(STORAGE_DIR)) {
        const full = path.join(STORAGE_DIR, name);
        if (fs.statSync(full).isDirectory() && !live.has(name)) fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch { /* best effort */ }
  console.log("  removed clinics, users, sessions, cascaded rows, and orphaned audio");
}

(async () => {
  console.log(`FlexicaAI e2e → ${BASE}`);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    await seed();
    await run();
  } catch (e) {
    console.error("\nHARNESS ERROR:", e);
    results.push({ name: "harness execution", pass: false, detail: e.message });
  } finally {
    try { await cleanup(); } catch (e) { console.error("cleanup error:", e.message); }
    await pool.end();
  }
  // A skip is neither a pass nor a failure, and the denominator is the checks that
  // were actually MADE — "121/123 passed" with two of them skipped reads as a
  // weaker run than it was, and as a stronger one than a run with two real passes.
  const skipped = results.filter((r) => r.skipped).length;
  const attempted = results.length - skipped;
  const passed = results.filter((r) => r.pass && !r.skipped).length;
  const failed = attempted - passed;
  console.log(
    `\n================ SUMMARY: ${passed}/${attempted} passed, ${failed} failed` +
      (skipped ? `, ${skipped} skipped` : "") +
      " ================",
  );
  if (failed) {
    console.log("FAILURES:");
    for (const r of results.filter((r) => !r.pass)) console.log("  - " + r.name + (r.detail ? "  (" + r.detail + ")" : ""));
  }

  // The reports are written whether the run passed or failed — a failing run is
  // precisely when somebody wants to read one. Reporting must never change the exit
  // code either, so it is wrapped: a disk error here is not a test failure, and
  // swallowing it silently would be the one thing worse than printing it.
  try {
    const { jsonPath, htmlPath, cases } = writeReports(results, {
      base: BASE,
      startedAt,
      ms: Date.now() - t0,
    });
    const casesPassed = cases.filter((c) => c.status === "Pass").length;
    console.log("");
    console.log(`report  ${htmlPath}`);
    console.log(`results ${jsonPath}  (${cases.length} workbook cases: ${casesPassed} Pass, ${cases.length - casesPassed} Fail)`);
    console.log("        apply them with: node scripts/qa/run/apply-results.mjs");
  } catch (e) {
    console.error("could not write the reports:", e.message);
  }

  process.exit(failed ? 1 : 0);
})();
