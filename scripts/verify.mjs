/**
 * `npm run verify` — the one command to answer "did I break anything?"
 *
 * Runs the four checks that don't need a server, in the order that fails fastest:
 *   1. typecheck   — must pass
 *   2. lint        — must not get WORSE (see the baseline below)
 *   3. env coverage — .env.example must document every var env.ts reads
 *   4. unit tests  — must pass
 *
 * The end-to-end suite is deliberately NOT here: it needs the app running
 * (`npm start`) and a WhatsApp app secret to exercise the signed webhook path. Run it
 * separately with `npm run test:e2e` before anything ships.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY LINT HAS A BASELINE INSTEAD OF JUST PASS/FAIL
 * ─────────────────────────────────────────────────────────────────────────
 * `eslint` currently exits non-zero: there are pre-existing problems, 31 of them a
 * single React 19 rule (`react-hooks/set-state-in-effect`) across client components
 * that predate it. Chained naively, this script would fail every single time and be
 * worth nothing — a check that is always red teaches you to ignore it.
 *
 * So lint is a RATCHET, the same shape as the direct-DB-access allowlist in
 * `eslint.config.mjs`: the counts below may only go DOWN. New problems fail the run;
 * fixing old ones prompts you to lower the numbers, which locks the improvement in.
 * The alternative — muting the rule — would hide real React bugs to make a number
 * green, which is the wrong trade.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Lint problems that already existed. LOWER THESE as they're fixed; never raise. */
const BASELINE = { problems: 40, errors: 33 };

const BOLD = "[1m";
const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const DIM = "[2m";
const OFF = "[0m";

let failed = 0;
const step = (n, label) => console.log(`\n${BOLD}[${n}/4] ${label}${OFF}`);
const pass = (msg) => console.log(`  ${GREEN}✓${OFF} ${msg}`);
const fail = (msg) => {
  failed++;
  console.log(`  ${RED}✗${OFF} ${msg}`);
};

// ── 1. Typecheck ────────────────────────────────────────────────────────────
step(1, "Typecheck");
{
  const r = spawnSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", shell: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status === 0) pass("no type errors");
  else {
    fail("type errors:");
    console.log(
      out
        .split("\n")
        .slice(0, 15)
        .map((l) => "      " + l)
        .join("\n"),
    );
  }
}

// ── 2. Lint (ratchet) ───────────────────────────────────────────────────────
step(2, "Lint");
{
  const r = spawnSync("npx", ["eslint", "src", "scripts", "-f", "json"], {
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  let problems = 0;
  let errors = 0;
  let worst = [];
  try {
    const report = JSON.parse(r.stdout);
    for (const f of report) {
      problems += f.errorCount + f.warningCount;
      errors += f.errorCount;
      for (const m of f.messages) {
        if (m.severity === 2) worst.push(`${f.filePath.split(/[\\/]/).pop()}:${m.line} ${m.ruleId ?? ""}`);
      }
    }
  } catch {
    fail("could not parse the eslint report — is the config valid?");
    // A broken config makes eslint report ZERO problems, which reads exactly like
    // passing. Treat an unparseable report as a failure, never as a clean run.
    problems = Number.POSITIVE_INFINITY;
  }

  if (problems > BASELINE.problems || errors > BASELINE.errors) {
    fail(
      `lint got worse: ${problems} problems / ${errors} errors ` +
        `(baseline ${BASELINE.problems} / ${BASELINE.errors})`,
    );
    console.log(`      ${DIM}new or changed errors include:${OFF}`);
    console.log(worst.slice(0, 8).map((l) => "      " + l).join("\n"));
  } else if (problems < BASELINE.problems || errors < BASELINE.errors) {
    pass(`${problems} problems / ${errors} errors — better than baseline`);
    console.log(
      `      ${YELLOW}↓ lower BASELINE in scripts/verify.mjs to ` +
        `{ problems: ${problems}, errors: ${errors} } to lock this in${OFF}`,
    );
  } else {
    pass(`${problems} problems / ${errors} errors — at baseline (all pre-existing)`);
  }
}

// ── 3. Env coverage ─────────────────────────────────────────────────────────
// `.env.example` is what a production box gets provisioned from, so a variable that
// exists only in the zod schema is one nobody knows to set. That already happened:
// nine were missing, including STORAGE_DIR and APP_URL — the two whose defaults are
// silently WRONG in production rather than absent (attachments written outside the
// backup; prescription links texted to patients pointing at localhost).
//
// A grep, deliberately, not an import: env.ts is `server-only` and validates on load,
// so importing it here would need a full valid environment just to list key names.
step(3, "Env coverage");
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const declared = new Set(
    [...read("../src/core/lib/env.ts").matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]),
  );
  const documented = new Set(
    [...read("../.env.example").matchAll(/^#?\s?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );
  // NODE_ENV is set by the runtime (`next build` / `next start`), never by an operator.
  declared.delete("NODE_ENV");

  const missing = [...declared].filter((k) => !documented.has(k));
  if (missing.length === 0) pass(`${declared.size} env vars, all documented in .env.example`);
  else {
    fail(`read by env.ts but missing from .env.example: ${missing.join(", ")}`);
    console.log(`      ${DIM}add them there in the same commit — that file is what prod is provisioned from${OFF}`);
  }
}

// ── 4. Unit tests ───────────────────────────────────────────────────────────
step(4, "Unit tests");
{
  // Streamed, not captured: these take a while and the per-assertion output is the
  // point. Needs DATABASE_URL — several suites run against a real Postgres.
  const r = spawnSync("npm", ["run", "--silent", "test:unit"], { stdio: "inherit", shell: true });
  if (r.status === 0) pass("all suites passed");
  else fail("a suite failed (see above)");
}

console.log(
  failed === 0
    ? `\n${GREEN}${BOLD}verify: OK${OFF}  ${DIM}— end-to-end is separate: npm start, then npm run test:e2e${OFF}`
    : `\n${RED}${BOLD}verify: ${failed} check${failed === 1 ? "" : "s"} failed${OFF}`,
);
process.exit(failed === 0 ? 0 : 1);
