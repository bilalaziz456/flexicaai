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
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";

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
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? "  — " + detail : ""}`);
}
async function req(pathname, { cookie, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = `klenic_session=${cookie}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(BASE + pathname, { method, body, headers: h, redirect: "manual", signal: ctl.signal });
    const ct = r.headers.get("content-type") || "";
    const text = ct.includes("pdf") ? "" : await r.text().catch(() => "");
    return { status: r.status, ct, text };
  } finally {
    clearTimeout(t);
  }
}
const is3xx = (s) => s >= 300 && s < 400;
const snip = (t) => (t || "").slice(0, 160).replace(/\s+/g, " ");

const ids = {};

async function seed() {
  console.log("\n== SEED ==");
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

  const sadmin = await mkUser(null, `e2e_super_${uniq}`, "super_admin");
  const adminA = await mkUser(cA.id, `e2e_adminA_${uniq}`, "clinic_admin");
  const docA = await mkUser(cA.id, `e2e_docA_${uniq}`, "doctor");
  const recepA = await mkUser(cA.id, `e2e_recepA_${uniq}`, "receptionist");
  const adminB = await mkUser(cB.id, `e2e_adminB_${uniq}`, "clinic_admin");
  const suspU = await mkUser(cA.id, `e2e_susp_${uniq}`, "receptionist");
  ids.users = [sadmin, adminA, docA, recepA, adminB, suspU].map((u) => u.id);
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
  ids.patients = [patA1.id, patA2.id, patB1.id];

  // "Revenue Recovered" scenario: patA1 got a 'sent' recall 10d ago AND a completed appt 2d ago → 1 recovered × 4000.
  await q("insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()-interval '2 days','completed')", [cA.id, patA1.id, docA.id]);
  ids.apptA = (await q("insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()+interval '3 days','scheduled') returning id", [cA.id, patA1.id, docA.id])).id;
  await q("insert into recalls (clinic_id, patient_id, reason, due_at, status, sent_at) values ($1,$2,'6-month cleaning', now()-interval '12 days','sent', now()-interval '10 days')", [cA.id, patA1.id]);
  // A due 'pending' recall whose patient has NO phone → cron should skip it.
  await q("insert into recalls (clinic_id, patient_id, reason, due_at, status) values ($1,$2,'checkup', now()-interval '1 day','pending')", [cA.id, patA2.id]);

  const note = {
    diagnosis: "Dental caries, tooth 26",
    prescriptions: [{ drug: "Amoxicillin", dosage: "500mg TDS", duration: "5 days" }],
    treatmentPlan: ["Composite filling on 26", "Review in 2 weeks"],
  };
  const visit = await q(
    "insert into visits (clinic_id, patient_id, doctor_id, module, status, note, approved_at, approved_by, visit_date) values ($1,$2,$3,'dental','approved',$4, now(), $3, now()) returning id",
    [cA.id, patA1.id, docA.id, JSON.stringify(note)],
  );
  ids.visit = visit.id;

  await q("insert into whatsapp_messages (clinic_id, patient_id, direction, phone, status, body) values ($1,$2,'inbound','+923009990001','received','Hello, I need an appointment')", [cA.id, patA1.id]);
  await q("insert into whatsapp_messages (clinic_id, patient_id, direction, phone, status, template_name, body, external_id) values ($1,$2,'outbound','+923009990001','sent','recall_reminder','Your recall is due','E2E-EXT-1')", [cA.id, patA1.id]);

  // --- Data for the CSV-export + live-queue sections ---
  // A completed visit that realised a sale + a cash payment, plus a procedure, so the
  // sales/payments/procedures CSV exports have real rows. Uses patA2 (a 'pending'
  // recall, NOT 'sent') so it can't skew the "1 return visit" revenue-recovered count.
  const saleAppt = await q(
    "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status) values ($1,$2,$3, now()-interval '1 day','completed') returning id",
    [cA.id, patA2.id, docA.id],
  );
  await q(
    "insert into sales (clinic_id, appointment_id, doctor_id, doctor_name, gross_amount, discount_amount, net_amount, occurred_at) values ($1,$2,$3,'Dr E2E',5000,0,5000, now()-interval '1 day')",
    [cA.id, saleAppt.id, docA.id],
  );
  await q(
    "insert into patient_payments (clinic_id, patient_id, appointment_id, kind, amount, method, occurred_at, created_by, created_by_name) values ($1,$2,$3,'payment',5000,'cash', now()-interval '1 day', $4,'Recep E2E')",
    [cA.id, patA2.id, saleAppt.id, recepA.id],
  );
  await q("insert into procedures (clinic_id, name, price, module) values ($1,'Scaling & polishing',3000,'dental')", [cA.id]);
  // A patient in the doctor's live queue TODAY (token #1) to drive Arrived → in-room → done.
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (local)
  ids.queueAppt = (
    await q(
      "insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at, status, queue_session, queue_number) values ($1,$2,$3, now(), 'scheduled', $4, 1) returning id",
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
  };
  console.log(`  clinics A=${cA.id} B=${cB.id}; 6 users; 3 patients; approved visit=${visit.id}`);
}

async function run() {
  const S = ids.sessions;

  console.log("\n== AUTH & PANEL RENDERING ==");
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
  record("super_admin GET /clinic → redirect (role isolation)", is3xx((await req("/clinic", { cookie: S.sadmin })).status));

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
    record("patient detail tenant-scoped (no clinic-B leak)", !r.text.includes("ClinicB Patient"));
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
    record("clinic appointments tenant-scoped (clinic B empty)", r.status === 200 && !r.text.includes("Ayesha Recovered"));
  }
  record("clinic_admin GET /admin → redirect (isolation)", is3xx((await req("/admin", { cookie: S.adminA })).status));

  // Unified workspace: all clinic staff work from /clinic; the old /doctor and
  // /reception panels fold in (redirect).
  record("doctor GET /clinic → 200 (unified workspace)", (await req("/clinic", { cookie: S.docA })).status === 200);
  record("doctor GET /doctor → redirect (folded into /clinic)", is3xx((await req("/doctor", { cookie: S.docA })).status));
  record("doctor GET /admin → redirect (isolation)", is3xx((await req("/admin", { cookie: S.docA })).status));

  record("receptionist GET /clinic → 200 (unified workspace)", (await req("/clinic", { cookie: S.recepA })).status === 200);
  record("receptionist GET /reception → redirect (folded)", is3xx((await req("/reception", { cookie: S.recepA })).status));
  record("receptionist GET /clinic/appointments/new → 200", (await req("/clinic/appointments/new", { cookie: S.recepA })).status === 200);
  {
    const r = await req("/clinic/doctors", { cookie: S.recepA });
    record("receptionist GET /clinic/doctors → 200 + limit + leave controls", r.status === 200 && r.text.includes("Daily appointment limit") && r.text.includes("Leave / vacation"));
  }
  {
    const r = await req("/clinic/whatsapp", { cookie: S.recepA });
    record("receptionist GET /clinic/whatsapp → 200 + inbound msg", r.status === 200 && r.text.includes("I need an appointment"));
  }

  console.log("\n== SUSPENSION ENFORCEMENT ==");
  await pool.query("update users set is_active=false where id=$1", [ids.suspUserId]);
  record("suspended user's session is rejected → redirect", is3xx((await req("/clinic", { cookie: S.susp })).status));
  await pool.query("update users set is_active=true where id=$1", [ids.suspUserId]);

  console.log("\n== PRESCRIPTION PDF + TENANT ISOLATION ==");
  {
    const r = await req(`/api/prescriptions/${ids.visit}`, { cookie: S.adminA });
    record("own-clinic prescription PDF → 200 application/pdf", r.status === 200 && r.ct.includes("pdf"), r.status === 200 ? "" : `status=${r.status} ${snip(r.text)}`);
  }
  record("cross-tenant prescription (clinic B admin) → 404", (await req(`/api/prescriptions/${ids.visit}`, { cookie: S.adminB })).status === 404);
  record("prescription without session → 401", (await req(`/api/prescriptions/${ids.visit}`)).status === 401);

  console.log("\n== SIGNED PUBLIC LINK (/p/rx) ==");
  if (!SECRET_LINK) {
    record("signed public link checks", true, "skipped (LINK_SIGNING_SECRET unset)");
  } else {
    {
      const r = await req(`/p/rx/${signToken(ids.visit, Date.now() + 3600e3)}`);
      record("valid signed link → 200 PDF", r.status === 200 && r.ct.includes("pdf"), r.status === 200 ? "" : `status=${r.status} ${snip(r.text)}`);
    }
    {
      const tampered = signToken(ids.visit, Date.now() + 3600e3).slice(0, -3) + "AAA";
      record("tampered token → 404", (await req(`/p/rx/${tampered}`)).status === 404);
    }
    record("expired token → 404", (await req(`/p/rx/${signToken(ids.visit, Date.now() - 1000)}`)).status === 404);
  }

  console.log("\n== WHATSAPP WEBHOOK ==");
  if (!WH_TOKEN) {
    record("webhook checks", true, "skipped (WHATSAPP_WEBHOOK_TOKEN unset)");
  } else {
    const json = { "content-type": "application/json" };
    record("webhook no token → 401", (await req("/api/whatsapp/webhook", { method: "POST", body: "{}", headers: json })).status === 401);
    record("webhook wrong token → 401", (await req("/api/whatsapp/webhook?token=WRONG", { method: "POST", body: "{}", headers: json })).status === 401);
    {
      const body = JSON.stringify({ mobile: "+923009990001", text: "E2E inbound probe message" });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      const row = (await pool.query("select patient_id, direction from whatsapp_messages where body=$1 order by created_at desc limit 1", ["E2E inbound probe message"])).rows[0];
      record("webhook inbound (valid token) → 200 + logged & patient-matched", r.status === 200 && row && row.direction === "inbound" && row.patient_id === ids.patients[0]);
    }
    {
      const body = JSON.stringify({ messageId: "E2E-EXT-1", status: "read" });
      const r = await req(`/api/whatsapp/webhook?token=${WH_TOKEN}`, { method: "POST", body, headers: json });
      const row = (await pool.query("select status from whatsapp_messages where external_id='E2E-EXT-1'")).rows[0];
      record("webhook status receipt → advances outbound to 'read'", r.status === 200 && row && row.status === "read");
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
      const moved = (await pool.query("select scheduled_at from appointments where clinic_id=$1 and patient_id=$2 and status='scheduled' order by scheduled_at desc limit 1", [ids.clinics[0], ids.patients[0]])).rows[0];
      const hour = moved ? new Date(moved.scheduled_at).getHours() : null;
      record("webhook reschedule reply moves the appointment", r.status === 200 && j.rescheduled === true && hour === 14, `rescheduled=${j.rescheduled} hour=${hour}`);
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
      const rows = (await pool.query("select scheduled_at from appointments where clinic_id=$1 and patient_id=$2 and status='scheduled'", [ids.clinics[0], ids.patients[0]])).rows;
      const has3pm = rows.some((row) => new Date(row.scheduled_at).getHours() === 15);
      record("webhook 'book …' creates a new appointment", r.status === 200 && j.booked === true && has3pm, `booked=${j.booked}`);
    }
  }

  console.log("\n== WHATSAPP CLOUD WEBHOOK (per-clinic routing) ==");
  {
    const hdr = { "content-type": "application/json" };
    // GET verification with a wrong/absent token → 403.
    const g = await req("/api/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=xyz");
    record("cloud webhook GET verify (bad token) → 403", g.status === 403);

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
      // Fail-closed check. `npm start` runs NODE_ENV=production, so an unsigned
      // payload must be rejected rather than silently trusted. Set
      // WHATSAPP_APP_SECRET in .env.local to exercise the delivery path too.
      record("cloud webhook rejects UNSIGNED payload in production → 401", r.status === 401, `status=${r.status} (set WHATSAPP_APP_SECRET to test delivery)`);
    } else {
      record("cloud webhook POST inbound (signed) → 200 {inbound:1}", r.status === 200 && j && j.inbound === 1, `status=${r.status}`);
      const row = (await pool.query("select clinic_id, patient_id from whatsapp_messages where external_id=$1", [inId])).rows[0];
      record("cloud inbound routed by number → clinic A + matched patient", Boolean(row) && row.clinic_id === ids.clinics[0] && row.patient_id === ids.patients[0]);

      // Idempotency (migration 0079): a provider REDELIVERY must not log the message
      // twice, because everything after the insert has patient-visible side effects.
      const again = await req("/api/whatsapp/cloud", { method: "POST", body, headers: hdr });
      const cnt = (await pool.query("select count(*)::int c from whatsapp_messages where external_id=$1 and direction='inbound'", [inId])).rows[0].c;
      record("cloud webhook replay is idempotent → still one row", again.status === 200 && cnt === 1, `status=${again.status} rows=${cnt}`);

      // A forged payload must never be accepted when the secret IS configured.
      const bad = await req("/api/whatsapp/cloud", { method: "POST", body, headers: { ...hdr, "x-hub-signature-256": "sha256=" + "0".repeat(64) } });
      record("cloud webhook rejects a BAD signature → 401", bad.status === 401, `status=${bad.status}`);
    }
  }

  console.log("\n== RECALL ENGINE (cron) ==");
  if (!CRON) {
    record("cron checks", true, "skipped (CRON_SECRET unset)");
  } else {
    record("cron without secret → 401", (await req("/api/cron/recalls")).status === 401);
    const r = await req(`/api/cron/recalls?token=${CRON}`);
    let j = {};
    try { j = JSON.parse(r.text); } catch { /* ignore */ }
    record("cron authorized → 200 {ok,processed,...}", r.status === 200 && j.ok === true && typeof j.processed === "number", `processed=${j.processed} sent=${j.sent} skipped=${j.skipped}`);
    record("due recall for no-phone patient was skipped", (j.skipped ?? 0) >= 1);

    record("reminder cron without secret → 401", (await req("/api/cron/reminders")).status === 401);
    const rr = await req(`/api/cron/reminders?token=${CRON}`);
    let jr = {};
    try { jr = JSON.parse(rr.text); } catch { /* ignore */ }
    record("reminder cron authorized → 200 {ok,processed}", rr.status === 200 && jr.ok === true && typeof jr.processed === "number", `processed=${jr.processed} sent=${jr.sent}`);
  }

  console.log("\n== VOICE SCRIBE (auth + tenant + unconfigured) ==");
  const mkForm = (patientId) => {
    const fd = new FormData();
    fd.append("patientId", patientId);
    fd.append("audio", new Blob([Buffer.from([1, 2, 3])], { type: "audio/webm" }), "r.webm");
    return fd;
  };
  record("doctor scribe on cross-tenant patient → 404", (await req("/api/ai/scribe", { cookie: S.docA, method: "POST", body: mkForm(ids.patients[2]) })).status === 404);
  {
    // With no AI keys configured this must fail GRACEFULLY (400), never 500.
    const r = await req("/api/ai/scribe", { cookie: S.docA, method: "POST", body: mkForm(ids.patients[0]) });
    const okGraceful = r.status === 200 || r.status === 400; // 200 only if keys ARE configured
    record("doctor scribe → graceful (200 configured / 400 unconfigured, not 500)", okGraceful, `status=${r.status}`);
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

  console.log("\n== API AUTH CHOKEPOINT (paused clinic can't reach data routes) ==");
  {
    // Regression guard: Route Handlers used to run their own `getCurrentUser() +
    // can()` check and skip the clinic-usable gate that every PAGE enforces, so a
    // suspended clinic's staff were bounced from the UI yet could still pull a full
    // patient CSV. `apiRequireWorkspace` closed that. Suspend clinic A and prove it.
    const before = await req("/api/patients/export", { cookie: S.adminA });
    record("active clinic can export patients → 200", before.status === 200, `status=${before.status}`);

    await pool.query("update clinics set status='suspended' where id=$1", [ids.clinics[0]]);
    const paused = await req("/api/patients/export", { cookie: S.adminA });
    record("SUSPENDED clinic is refused the patients CSV → 403", paused.status === 403, `status=${paused.status}`);
    const pausedAppts = await req("/api/appointments/export", { cookie: S.adminA });
    record("SUSPENDED clinic is refused the appointments CSV → 403", pausedAppts.status === 403, `status=${pausedAppts.status}`);
    const pausedScribe = await req("/api/ai/scribe", { cookie: S.adminA, method: "POST", body: mkForm(ids.patients[0]) });
    record("SUSPENDED clinic can't reach the PAID AI scribe → 403", pausedScribe.status === 403, `status=${pausedScribe.status}`);

    await pool.query("update clinics set status='active' where id=$1", [ids.clinics[0]]);
    const after = await req("/api/patients/export", { cookie: S.adminA });
    record("restoring the clinic restores API access → 200", after.status === 200, `status=${after.status}`);
  }

  console.log("\n== LOGIN CREDENTIAL PATH (bcrypt round-trip) ==");
  {
    const admin = (await pool.query("select password_hash from users where username=$1", [process.env.SEED_ADMIN_USERNAME || "admin"])).rows[0];
    if (admin && process.env.SEED_ADMIN_PASSWORD) {
      const ok = await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD, admin.password_hash);
      record("seeded super-admin password verifies against stored bcrypt hash", ok);
    } else {
      record("seeded super-admin bcrypt check", true, "skipped (no seed creds)");
    }
  }

  console.log("\n== SOFT DELETE / TRASH ==");
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

  console.log("\n== LIVE QUEUE (doctor: Arrived → Call in → Complete) ==");
  {
    // Reception checks the patient in; the doctor's queue should offer "Call in".
    await pool.query("update appointments set status='arrived', arrived_at=now() where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      const ok = r.status === 200 && r.text.includes("Bilal NoPhone") && r.text.includes("Call in") && r.text.includes("Arrived");
      record("doctor queue: Arrived patient shows a 'Call in' control", ok, ok ? "" : `status=${r.status} ${snip(r.text)}`);
    }
    // Call in → in the room. "Call in" gives way to "Complete"; now-serving shows the token.
    await pool.query("update appointments set status='in_progress' where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      const ok = r.status === 200 && r.text.includes("In progress") && !r.text.includes("Call in");
      record("doctor queue: In progress patient — 'Call in' gone (now 'Complete')", ok, ok ? "" : `status=${r.status}`);
    }
    // Complete → done. No advance control remains for that patient.
    await pool.query("update appointments set status='completed' where id=$1", [ids.queueAppt]);
    {
      const r = await req("/clinic/scribe", { cookie: S.docA });
      const ok = r.status === 200 && r.text.includes("Completed") && !r.text.includes("Call in") && !r.text.includes("In progress");
      record("doctor queue: Completed patient — no advance controls left", ok, ok ? "" : `status=${r.status}`);
    }
  }

  console.log("\n== CSV EXPORTS (auth + text/csv + BOM + brand footer) ==");
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
      record("patients CSV → text/csv + footer + header", okCsv(r, "MRN,Name,Phone"), okCsv(r, "MRN,Name,Phone") ? "" : `status=${r.status} ct=${r.ct}`);
      record("patients CSV is clinic-scoped (has A patient, not B)", r.text.includes("Ayesha Recovered") && !r.text.includes("ClinicB Patient"));
    }
    {
      const r = await req("/api/staff/export", { cookie: S.adminA });
      record("staff CSV → text/csv + footer + header", okCsv(r, "Name,Username,Role"), okCsv(r, "Name,Username,Role") ? "" : `status=${r.status} ct=${r.ct}`);
    }
    {
      const r = await req("/api/appointments/export?period=year", { cookie: S.adminA });
      record("appointments CSV → text/csv + footer + header", okCsv(r, "Date,Token,Patient"), okCsv(r, "Date,Token,Patient") ? "" : `status=${r.status} ct=${r.ct}`);
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
  }
}

async function cleanup() {
  console.log("\n== CLEANUP ==");
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
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n================ SUMMARY: ${passed}/${results.length} passed, ${failed} failed ================`);
  if (failed) {
    console.log("FAILURES:");
    for (const r of results.filter((r) => !r.pass)) console.log("  - " + r.name + (r.detail ? "  (" + r.detail + ")" : ""));
  }
  process.exit(failed ? 1 : 0);
})();
