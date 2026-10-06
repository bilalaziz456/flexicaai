/**
 * Turns an e2e run into two artefacts: a results JSON the workbook can consume, and
 * a standalone HTML report a human can read.
 *
 * It lives here rather than inside `scripts/e2e.mjs` because the harness is about
 * ASSERTIONS and this is about presentation — and because `apply-results.mjs`, which
 * sits in this folder, is the other half of the same bridge.
 *
 * ── Why a case id is parsed out of the assertion NAME ──────────────────────────
 * The harness has ~90 assertions, written long before the manual workbook existed.
 * Tagging by name means an assertion that maps onto a case gains an id by having one
 * typed in front of its description, and the other eighty are untouched. A new
 * argument on `record()` would have meant editing every call site to credit a few.
 *
 * ── Why a trailing letter collapses onto the base case ─────────────────────────
 * A workbook case usually makes SEVERAL claims ("the export is CSV, contains this
 * clinic's patients, and no one else's"), and one assertion per claim reads far
 * better than one that ANDs them together and reports a single opaque false. So
 * `TC-PAT-017` and `TC-PAT-017b` are the same case, and the case passes only if
 * EVERY assertion carrying its id passed. Reporting the base case as green while a
 * sub-assertion was red is the exact failure this whole workbook exists to avoid.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** `TC-PAT-017b` → `TC-PAT-017`. A suffix is a sub-assertion, not another case. */
const baseCase = (tc) => tc.replace(/[a-z]$/, "");

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Groups the tagged assertions by workbook case.
 *
 * `status` is Pass only when every assertion for the case passed. The note carries
 * what was OBSERVED, not what was expected — a Pass nobody can check is a Pass
 * nobody should believe.
 */
export function caseResults(results) {
  const byCase = new Map();
  for (const r of results) {
    // A skipped check carries no id anyway (record.skip sets tc: null), but guard it
    // here too: the whole point of a skip is that no cell gets written.
    if (!r.tc || r.skipped) continue;
    const id = baseCase(r.tc);
    if (!byCase.has(id)) byCase.set(id, []);
    byCase.get(id).push(r);
  }
  return [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, rs]) => {
      const failed = rs.filter((r) => !r.pass);
      const describe = (r) => {
        const text = r.name.replace(/^TC-[A-Z0-9]+-\d+[a-z]?\s+/, "");
        return r.detail ? `${text} (${r.detail})` : text;
      };
      return {
        id,
        status: failed.length ? "Fail" : "Pass",
        note: failed.length
          ? `Automated (e2e) FAILED: ${failed.map(describe).join("; ")}`
          : `Automated (e2e): ${rs.map(describe).join("; ")}`,
      };
    });
}

function html({ results, cases, base, startedAt, ms }) {
  const skipped = results.filter((r) => r.skipped).length;
  const attempted = results.length - skipped;
  const passed = results.filter((r) => r.pass && !r.skipped).length;
  const failed = attempted - passed;
  const casesPassed = cases.filter((c) => c.status === "Pass").length;

  const sections = [];
  for (const r of results) {
    const name = r.section ?? "general";
    let s = sections.find((x) => x.name === name);
    if (!s) sections.push((s = { name, rows: [] }));
    s.rows.push(r);
  }

  const verdict = (r) => (r.skipped ? "skip" : r.pass ? "pass" : "fail");
  const row = (r) => `
        <tr class="${verdict(r)}">
          <td class="verdict"><span class="pill">${verdict(r)}</span></td>
          <td class="case">${r.tc && !r.skipped ? `<code>${esc(baseCase(r.tc))}</code>` : ""}</td>
          <td class="what">${esc(r.name.replace(/^TC-[A-Z0-9]+-\d+[a-z]?\s+/, ""))}
            ${r.detail ? `<span class="detail">${esc(r.detail)}</span>` : ""}</td>
        </tr>`;

  const sectionBlock = (s) => {
    const bad = s.rows.filter((r) => !r.pass).length;
    const skip = s.rows.filter((r) => r.skipped).length;
    const made = s.rows.length - skip;
    return `
      <section class="block${bad ? " has-failures" : ""}">
        <h2>${esc(s.name)}
          <span class="count">${made - bad}/${made}${skip ? ` · ${skip} skipped` : ""}</span>
        </h2>
        <table>
          <tbody>${s.rows.map(row).join("")}</tbody>
        </table>
      </section>`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlexicaAI e2e run — ${esc(startedAt.slice(0, 16).replace("T", " "))}</title>
<style>
  :root {
    --ground: #f6f6f4; --card: #ffffff; --ink: #16181c; --muted: #6a7078;
    --line: #e3e4e1; --ok: #1b6b38; --ok-bg: #e9f4ec; --bad: #9c2626; --bad-bg: #fbecec;
    --skip: #7a6a2e; --skip-bg: #f6f1df; --accent: #0b7f86;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #15171a; --card: #1d2024; --ink: #eef0f2; --muted: #9aa2ab;
      --line: #2c3035; --ok: #6ed49a; --ok-bg: #16281d; --bad: #f3a2a2; --bad-bg: #2a1718;
      --skip: #d8c88a; --skip-bg: #27231a; --accent: #4ec8d0;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  header { margin-bottom: 28px; }
  h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  .sub code { font-size: 12.5px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin: 22px 0 8px; }
  .kpi {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 16px; min-width: 132px; flex: 1 1 132px;
  }
  .kpi b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .kpi span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .kpi.is-pass b { color: var(--ok); }
  .kpi.is-fail b { color: var(--bad); }
  .kpi.is-skip b { color: var(--skip); }
  .note {
    background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 8px; padding: 12px 16px; margin: 22px 0 28px; color: var(--muted); font-size: 13px;
  }
  .block { background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
  .block.has-failures { border-color: var(--bad); }
  h2 {
    margin: 0; padding: 12px 16px; font-size: 12.5px; font-weight: 650;
    text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted);
    border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px;
  }
  .count { font-variant-numeric: tabular-nums; letter-spacing: 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 16px; border-top: 1px solid var(--line); vertical-align: top; }
  tr:first-child td { border-top: 0; }
  .verdict { width: 1%; }
  .pill {
    display: inline-block; padding: 1px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .pass .pill { background: var(--ok-bg); color: var(--ok); }
  .fail .pill { background: var(--bad-bg); color: var(--bad); }
  .fail td { background: var(--bad-bg); }
  .skip .pill { background: var(--skip-bg); color: var(--skip); }
  .skip .what { color: var(--muted); }
  .case { width: 1%; white-space: nowrap; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--accent); }
  .detail { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12.5px; }
  @media (max-width: 560px) {
    .case { white-space: normal; }
    td { padding: 8px 12px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>FlexicaAI end-to-end run</h1>
    <p class="sub">
      ${esc(startedAt.replace("T", " ").slice(0, 19))} ·
      <code>${esc(base)}</code> ·
      ${(ms / 1000).toFixed(1)}s
    </p>
  </header>

  <div class="kpis">
    <div class="kpi"><b>${attempted}</b><span>checks made</span></div>
    <div class="kpi is-pass"><b>${passed}</b><span>passed</span></div>
    <div class="kpi ${failed ? "is-fail" : ""}"><b>${failed}</b><span>failed</span></div>
    ${skipped ? `<div class="kpi is-skip"><b>${skipped}</b><span>skipped</span></div>` : ""}
    <div class="kpi"><b>${casesPassed}/${cases.length}</b><span>workbook cases</span></div>
  </div>

  <p class="note">
    Every line below was <strong>observed over HTTP against a running app</strong> — real
    sessions, real routes, a throwaway two-clinic world seeded and removed around the run.
    An assertion carrying a <code>TC-</code> id maps onto a manual test case; several may
    share one, and that case passes only if all of them did. Assertions with no id cover
    behaviour the workbook does not have a case for, and they still fail the run.
    A <strong>skip</strong> is a check this environment could not make — a missing secret,
    or a property that only holds on a production build. It is never counted as a pass and
    never writes a result into the workbook, so the cell stays blank for a human.
  </p>

  ${sections.map(sectionBlock).join("")}

  <footer>
    Produced by <code>scripts/e2e.mjs</code>. The matching workbook rows are written by
    <code>node scripts/qa/run/apply-results.mjs</code>; cases with no automated result are
    left blank there on purpose, because they need a human.
  </footer>
</div>
</body>
</html>`;
}

/**
 * Writes both artefacts and returns where they went.
 *
 * The JSON holds ONLY the tagged cases, in the shape `apply-results.mjs` reads. The
 * HTML holds everything, because an untagged assertion failing is still a failing
 * run and hiding it in a report would be the worst kind of green.
 */
export function writeReports(results, { base, startedAt, ms }) {
  const cases = caseResults(results);
  const jsonPath = resolve(here, "e2e-results.json");
  const htmlPath = resolve(here, "e2e-report.html");
  writeFileSync(jsonPath, JSON.stringify(cases, null, 2) + "\n", "utf8");
  writeFileSync(htmlPath, html({ results, cases, base, startedAt, ms }), "utf8");
  return { jsonPath, htmlPath, cases };
}
