/**
 * Executes the deterministic subset of the manual QA suite against a running dev
 * server and writes OBSERVED results to results.json.
 *
 * It only covers cases whose outcome is unambiguous from the outside: login
 * behaviour, navigation visibility, route protection, API authorisation and tenant
 * isolation. Anything needing human judgement is deliberately left for a tester —
 * a Pass written here that nobody watched is worse than a blank cell.
 *
 *   node scripts/qa/run/run.mjs <clinicId> <otherClinicId> <patientId> <otherPatientId>
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [CLINIC, OTHER_CLINIC, PATIENT, OTHER_PATIENT, TAG] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const PASSWORD = "QaRun!2345";
const U = {
  admin: `${TAG}-admin`,
  manager: `${TAG}-manager`,
  doctor: `${TAG}-doctor`,
  recep: `${TAG}-recep`,
  susp: `${TAG}-susp`,
  lock: `${TAG}-lock`,
  other: `${TAG}-other`,
};

const exe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe`;
const port = 9488;
const proc = spawn(exe, ["--headless", `--remote-debugging-port=${port}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = l.find(t => t.type === "page")?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, q = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Page.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

const results = [];
const record = (id, pass, note) => {
  results.push({ id, status: pass ? "Pass" : "Fail", note });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id.padEnd(14)} ${note}`);
};

async function goto(path) {
  await send("Page.navigate", { url: BASE + path });
  await sleep(1600);
  return await ev(`location.pathname`);
}
async function clearCookies() { await send("Network.clearBrowserCookies"); }

/** Fills and submits the login form. Returns the landing path + any visible error. */
async function login(username, password = PASSWORD) {
  await clearCookies();
  await goto("/login");
  await ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if(!el) return false;
      const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      d.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); return true; };
    set('input[name=username]', ${JSON.stringify(username)});
    set('input[name=password]', ${JSON.stringify(password)});
    document.querySelector('form').requestSubmit(); return true;
  })()`);
  await sleep(2600);
  const path = await ev(`location.pathname`);
  const err = await ev(`(() => { const e=[...document.querySelectorAll('[role=alert],[role=status]')].map(n=>n.textContent.trim()).filter(Boolean); return e.join(' | '); })()`);
  return { path, err };
}

/** Sidebar link labels currently rendered. */
async function navLabels() {
  // Collapsed nav GROUPS do not render their links, so reading the sidebar without
  // expanding them makes a permitted item look missing. Open everything first.
  await ev(`(() => {
    document.querySelectorAll('button[aria-expanded="false"]').forEach(b=>b.click());
    return true;
  })()`);
  await sleep(500);
  return await ev(`(() => {
    const as=[...document.querySelectorAll('a[href^="/clinic"]')];
    return [...new Set(as.map(a=>a.textContent.trim()).filter(t=>t && t.length<30))].join('|');
  })()`);
}

/** Fetches a URL from inside the page so the session cookie rides along. */
async function apiStatus(path) {
  return await ev(`fetch(${JSON.stringify(BASE + path)},{redirect:'manual'}).then(r=>r.status+' '+r.type).catch(e=>'ERR '+e.message)`);
}
async function apiBody(path) {
  return await ev(`fetch(${JSON.stringify(BASE + path)}).then(r=>r.text()).then(t=>t.slice(0,200)).catch(e=>'ERR')`);
}

console.log("\n=== Authentication ===");
{
  const roles = [["admin", U.admin], ["manager", U.manager], ["doctor", U.doctor], ["receptionist", U.recep]];
  let allOk = true; const detail = [];
  for (const [label, un] of roles) {
    const { path } = await login(un);
    detail.push(`${label}->${path}`);
    if (path !== "/clinic") allOk = false;
  }
  record("TC-AUTH-001", allOk, `all four clinic roles land on /clinic (${detail.join(", ")})`);
}
{
  const { path, err } = await login(`${TAG}-nobody-at-all`);
  record("TC-AUTH-002", path === "/login" && /Incorrect username or password/i.test(err),
    `unknown username stays on /login, error="${err}"`);
}
{
  const { err } = await login(U.admin, "definitely-wrong-password");
  record("TC-AUTH-003", /Incorrect username or password/i.test(err),
    `wrong password gives the SAME message as unknown user: "${err}"`);
}
{
  await clearCookies(); await goto("/login");
  const blocked = await ev(`(() => { const f=document.querySelector('form'); f.requestSubmit(); return !f.checkValidity(); })()`);
  await sleep(600);
  const path = await ev(`location.pathname`);
  record("TC-AUTH-004", blocked === true && path === "/login", `empty fields blocked by required validation, still on ${path}`);
}
{
  const { path, err } = await login(U.susp);
  record("TC-AUTH-005", path === "/login" && /suspended/i.test(err),
    `suspended account refused AFTER password check: "${err}"`);
}
{
  // Five wrong passwords should lock the username, then a CORRECT one must still fail.
  for (let i = 0; i < 5; i++) await login(U.lock, `wrong-${i}`);
  const { path, err } = await login(U.lock);
  const locked = /Too many attempts/i.test(err);
  record("TC-AUTH-007", locked && path === "/login",
    locked ? `correct password still refused while locked: "${err}"` : `NOT locked after 5 failures — got "${err}" (path ${path})`);
}
{
  await clearCookies();
  const p1 = await goto("/clinic/patients");
  const p2 = await goto("/clinic/payments");
  const p3 = await goto("/admin");
  record("TC-AUTH-029", p1 === "/login" && p2 === "/login" && p3 === "/login",
    `anonymous hits redirect to /login (${p1}, ${p2}, ${p3})`);
}
{
  await clearCookies();
  await goto("/clinic/payments");
  await ev(`(() => { const set=(s,v)=>{const el=document.querySelector(s);const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('input[name=username]', ${JSON.stringify(U.recep)}); set('input[name=password]', ${JSON.stringify(PASSWORD)});
    document.querySelector('form').requestSubmit(); return true; })()`);
  await sleep(2600);
  const landed = await ev(`location.pathname`);
  record("TC-AUTH-030", landed === "/clinic",
    `deep link is NOT restored — landed on ${landed} rather than /clinic/payments (documented behaviour)`);
}
{
  await login(U.admin);
  const before = await ev(`location.pathname`);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/sign out/i.test(b.textContent)); if(b){b.click();return true;} return false; })()`);
  await sleep(2500);
  const after = await ev(`location.pathname`);
  const back = await goto("/clinic/patients");
  record("TC-AUTH-025", after === "/login" && back === "/login",
    `sign out left ${before} -> ${after}; protected page after sign-out -> ${back}`);
}

console.log("\n=== Navigation visibility ===");
{
  await login(U.doctor);
  await goto("/clinic");
  const nav = await navLabels();
  const mustHave = ["Voice scribe", "Patients", "Appointments"];
  const mustNot = ["Staff", "Expenses", "Payments", "Invoices"];
  const loaded = nav.includes("Dashboard");
  const ok = loaded && mustHave.every(l => nav.includes(l)) && mustNot.every(l => !nav.includes(l));
  record("TC-RBAC-001", ok, `doctor nav = ${nav}`);
}
{
  await login(U.recep);
  await goto("/clinic");
  const nav = await navLabels();
  const ok = nav.includes("Dashboard") && nav.includes("Payments") && !nav.includes("Voice scribe") && !nav.includes("Staff");
  record("TC-RBAC-002", ok, `receptionist nav = ${nav}`);
}
{
  await login(U.manager);
  await goto("/clinic");
  const nav = await navLabels();
  // Guard against a FALSE PASS: an empty sidebar also contains no "Staff".
  const ok = nav.includes("Dashboard") && !nav.includes("Staff") && !nav.includes("Expenses");
  record("TC-RBAC-003", ok, `manager nav = ${nav}`);
}

console.log("\n=== Direct-URL route protection ===");
{
  await login(U.doctor);
  const a = await goto("/clinic/staff");
  const b = await goto("/clinic/staff/new");
  record("TC-RBAC-004", a === "/clinic" && b === "/clinic", `doctor -> /clinic/staff = ${a}, /clinic/staff/new = ${b}`);
}
{
  await login(U.recep);
  const paths = ["/clinic/staff", "/clinic/expenses", "/clinic/pl", "/clinic/scribe", "/clinic/logs"];
  const got = []; for (const p of paths) got.push(`${p}->${await goto(p)}`);
  record("TC-RBAC-005", got.every(g => g.endsWith("->/clinic")), got.join(", "));
}
{
  await login(U.manager);
  const got = []; for (const p of ["/clinic/staff", "/clinic/expenses", "/clinic/pl"]) got.push(`${p}->${await goto(p)}`);
  record("TC-RBAC-006", got.every(g => g.endsWith("->/clinic")), got.join(", "));
}
{
  await login(U.admin);
  const got = []; for (const p of ["/admin", "/admin/team", "/admin/overview"]) got.push(`${p}->${await goto(p)}`);
  record("TC-RBAC-007", got.every(g => g.endsWith("->/clinic")), `clinic admin bounced from the company panel: ${got.join(", ")}`);
}
{
  await login(U.recep);
  const p = await goto("/clinic/scribe");
  record("TC-AI-002", p === "/clinic", `receptionist -> /clinic/scribe = ${p} (scribe unreachable)`);
}
{
  await login(U.manager);
  const p = await goto("/clinic/scribe");
  // MAIN only, untruncated: body.innerText starts with the whole sidebar, which ate
  // the 400-char budget before reaching the message and failed a case that passes.
  const body = await ev(`((document.querySelector('main')||document.body).innerText||'')`);
  const noRecorder = await ev(`![...document.querySelectorAll('button')].some(b=>/start recording/i.test(b.textContent))`);
  const hasMsg = /permission to create clinical notes/i.test(body);
  record("TC-AI-003", p === "/clinic/scribe" && hasMsg && noRecorder,
    hasMsg && noRecorder
      ? "manager opens the page, sees the no-permission card, and no Start recording button is rendered"
      : `page=${p}, permissionMessage=${hasMsg}, recorderAbsent=${noRecorder}`);
}

console.log("\n=== API authorisation and isolation ===");
{
  await clearCookies(); await goto("/login");
  const s1 = await apiStatus("/api/patients/export");
  const s2 = await apiStatus("/api/finance/export?type=pl");
  record("TC-RBAC-010", s1.startsWith("401") && s2.startsWith("401"), `anonymous API: patients=${s1}, finance=${s2}`);
}
{
  await login(U.doctor); await goto("/clinic");
  const s1 = await apiStatus("/api/finance/export?type=pl");
  const s2 = await apiStatus("/api/staff/export");
  const b = await apiBody("/api/finance/export?type=pl");
  record("TC-RBAC-009", s1.startsWith("403") && s2.startsWith("403"),
    `doctor API: finance=${s1}, staff=${s2}, body=${b.slice(0, 60)}`);
}
{
  await login(U.admin); await goto("/clinic");
  const own = await goto(`/clinic/patients/${PATIENT}`);
  const foreign = await goto(`/clinic/patients/${OTHER_PATIENT}`);
  const body = await ev(`document.body.innerText.slice(0,300)`);
  const leaked = /QA Other Patient/i.test(body);
  record("TC-PAT-019", !leaked,
    `own patient page=${own}; other clinic's patient page=${foreign}; name leaked=${leaked}`);
}
{
  await login(U.admin); await goto("/clinic");
  const body = await ev(`fetch('${BASE}/api/patients/export').then(r=>r.text()).then(t=>t.slice(0,4000)).catch(()=>'')`);
  const mine = /QA Test Patient/.test(body);
  const theirs = /QA Other Patient/.test(body);
  record("TC-PAT-017", mine && !theirs, `export contains own patient=${mine}, contains other clinic's patient=${theirs}`);
}

console.log("\n=== Unknown routes ===");
{
  await login(U.admin); await goto("/clinic");
  const st = await ev(`fetch('${BASE}/clinic/does-not-exist-at-all').then(r=>r.status).catch(()=>0)`);
  record("TC-LIST-014", st === 200, `unknown /clinic path returns HTTP ${st} (200 is the documented, deliberate behaviour)`);
}

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
const pass = results.filter(r => r.status === "Pass").length;
console.log(`\n${pass}/${results.length} passed. Written to scripts/qa/run/results.json`);
ws.close(); proc.kill(); process.exit(0);
