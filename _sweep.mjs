import pg from "pg";
import crypto from "node:crypto";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const mk = async (roleCode, clinicName) => {
  const q = clinicName
    ? `select u.id from users u join clinics c on c.id=u.clinic_id where c.name=$2 and u.role=(select id from user_roles where code=$1) and u.deleted_at is null limit 1`
    : `select id from users where role=(select id from user_roles where code=$1) and deleted_at is null limit 1`;
  const { rows: [u] } = await pool.query(q, clinicName ? [roleCode, clinicName] : [roleCode]);
  if (!u) return null;
  const t = crypto.randomBytes(32).toString("base64url");
  await pool.query("insert into sessions (user_id, token_hash, expires_at) values ($1,$2, now()+interval '2 hours')", [u.id, sha256(t)]);
  return t;
};
const admin = await mk("clinic_admin", "Clinic001");
const su = await mk("super_admin", null);

const CLINIC = "/clinic /clinic/appointments /clinic/appointments/new /clinic/approvals /clinic/discounts /clinic/doctors /clinic/expenses /clinic/history /clinic/invoices /clinic/logs /clinic/no-shows /clinic/patients /clinic/patients/new /clinic/payments /clinic/pl /clinic/procedures /clinic/recalls /clinic/receivables /clinic/reports /clinic/reports/daybook /clinic/reports/overview /clinic/sales /clinic/scribe /clinic/settings /clinic/shares /clinic/staff /clinic/staff/new /clinic/trash /clinic/whatsapp /account".split(" ");
const ADMIN = "/admin /admin/account /admin/announcements /admin/clinics/new /admin/finance /admin/finance/costs /admin/finance/expenses /admin/finance/invoices /admin/logs /admin/overview /admin/security /admin/team /admin/trash".split(" ");
const PUBLIC = "/ /login /contact /privacy /terms /ai-medical-scribe /billing-and-revenue /whatsapp-for-patients".split(" ");

let bad = 0, n = 0;
const check = async (path, cookie, who) => {
  n++;
  const r = await fetch("http://localhost:3000" + path, { headers: cookie ? { Cookie: `klenic_session=${cookie}` } : {}, redirect: "manual" });
  const html = r.status === 200 ? await r.text() : "";
  // A Next error page still returns 200, so look for its markers too.
  const broken = html.includes("Application error") || html.includes("digest&quot;") || /Internal Server Error/i.test(html);
  const ok = (r.status === 200 && !broken) || r.status === 307 || r.status === 302;
  if (!ok) { bad++; console.log(`  ✗ ${who} ${path} → ${r.status}${broken ? " (error page)" : ""}`); }
};
for (const p of PUBLIC) await check(p, null, "public");
for (const p of CLINIC) await check(p, admin, "clinic_admin");
for (const p of ADMIN) await check(p, su, "super_admin");
console.log(`\n${n - bad}/${n} routes OK`);
await pool.query("delete from sessions where token_hash = any($1)", [[sha256(admin), sha256(su)]]);
await pool.end();
