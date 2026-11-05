/**
 * Remembered list filters (core/lib/remembered-filters.ts) and the appointment
 * period windows they lean on (core/appointments/period-window.ts). Pure — no DB.
 *
 *   tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-remembered-filters.ts
 */
import assert from "node:assert/strict";
import { rememberedFilterAction, type RememberedFilterPage } from "../src/core/lib/remembered-filters";
import { apptPeriodOf, apptWindow } from "../src/core/appointments/period-window";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const invoices: RememberedFilterPage = { key: "invoices", path: "/clinic/invoices", params: ["period", "from", "to"] };
const appts: RememberedFilterPage = {
  key: "appointments",
  path: "/clinic/appointments",
  params: ["period", "dir", "from", "to"],
  ignoreWhen: ["session"],
};
const qs = (s: string) => new URLSearchParams(s);

check("a request carrying the filter is SAVED, and only the filter", () => {
  const a = rememberedFilterAction(invoices, qs("period=30d&q=ali&page=2"), undefined);
  assert.deepEqual(a, { kind: "save", value: "period=30d" });
});

check("a bare request with nothing remembered does nothing (page default = Today)", () => {
  assert.equal(rememberedFilterAction(invoices, qs(""), undefined), null);
});

check("a bare request RESTORES the remembered filter, keeping other params", () => {
  const a = rememberedFilterAction(invoices, qs("q=ali"), "period=custom&from=2026-10-01&to=2026-10-31");
  assert.equal(a?.kind, "restore");
  if (a?.kind === "restore") {
    assert.equal(a.params.get("period"), "custom");
    assert.equal(a.params.get("from"), "2026-10-01");
    assert.equal(a.params.get("q"), "ali");
  }
});

check("a restore never adds params the page does not remember (cookie is untrusted)", () => {
  const a = rememberedFilterAction(invoices, qs(""), "period=7d&q=evil&redirect=https://x");
  assert.equal(a?.kind, "restore");
  if (a?.kind === "restore") assert.deepEqual([...a.params.keys()], ["period"]);
});

check("a cookie holding nothing the page remembers restores nothing (no redirect loop)", () => {
  assert.equal(rememberedFilterAction(invoices, qs(""), "junk=1"), null);
});

check("an over-long value is ignored", () => {
  assert.equal(rememberedFilterAction(invoices, qs(""), `period=${"x".repeat(65)}`), null);
});

check("an appointments queue view is neither saved nor restored", () => {
  assert.equal(rememberedFilterAction(appts, qs("session=abc&from=2026-11-01"), undefined), null);
  assert.equal(rememberedFilterAction(appts, qs("session=abc"), "period=7d&dir=upcoming"), null);
});

check("a status-only link (dashboard tile) gets the remembered period added", () => {
  const a = rememberedFilterAction(appts, qs("status=completed&payment=unpaid"), "period=7d&dir=past");
  assert.equal(a?.kind, "restore");
  if (a?.kind === "restore") assert.equal(a.params.toString(), "status=completed&payment=unpaid&period=7d&dir=past");
});

check("appointment windows: upcoming runs forward from today, past backward", () => {
  assert.deepEqual(apptWindow("today", "2026-11-06", "upcoming"), { from: "2026-11-06", to: "2026-11-06" });
  assert.deepEqual(apptWindow("7d", "2026-11-06", "upcoming"), { from: "2026-11-06", to: "2026-11-12" });
  assert.deepEqual(apptWindow("7d", "2026-11-06", "past"), { from: "2026-10-31", to: "2026-11-06" });
});

check("a remembered '7d upcoming' moves with the calendar (the reason it is a preset)", () => {
  assert.deepEqual(apptWindow("7d", "2026-11-09", "upcoming"), { from: "2026-11-09", to: "2026-11-15" });
});

check("apptPeriodOf names a pill's range, and nothing for a hand-picked one", () => {
  assert.equal(apptPeriodOf("2026-11-06", "2026-11-12", "2026-11-06", "upcoming"), "7d");
  assert.equal(apptPeriodOf("2026-10-31", "2026-11-06", "2026-11-06", "past"), "7d");
  assert.equal(apptPeriodOf("2026-11-02", "2026-11-04", "2026-11-06", "upcoming"), "");
});

console.log(`\n${passed} checks passed`);
