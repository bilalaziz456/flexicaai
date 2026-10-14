/**
 * One state + several conditions per tooth (owner's call, 2026-10-15):
 *  - older charts (a condition or `root_canal` stored as the status) read in the new
 *    shape without being rewritten;
 *  - the rules refuse an impossible tooth — nothing on a missing tooth, no root
 *    treatment or caries on an implant — in the shared check AND the chart schema;
 *  - a change of conditions alone is a change (history, visit diff).
 * Pure — no database. Run:
 * `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-tooth-conditions.ts`
 */
import type { ChartTooth } from "@/modules/dental/db/schema";
import {
  MAIN_TOOTH_STATUSES,
  allowedOn,
  normalizeTooth,
  toothLabel,
  toothRuleError,
} from "@/modules/dental/tooth-status";
import { diffTeeth, isBlankTooth, toothHistory } from "@/modules/dental/chart-logic";
import { dentalChartSchema } from "@/modules/dental/note-schema";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Older charts read in the new shape:");
const oldCaries = normalizeTooth({ status: "caries", surfaces: ["O"] });
ok("a 'caries' status is sound + caries", oldCaries.status === "sound" && oldCaries.conditions?.join() === "caries");
ok("…surfaces are kept", oldCaries.surfaces?.join() === "O");
const oldRct = normalizeTooth({ status: "root_canal" });
ok("a 'root_canal' status is sound + root treated", oldRct.status === "sound" && oldRct.endo === true);
const mixed = normalizeTooth({ status: "watch", conditions: ["caries"] });
ok("conditions merge and come out in picker order", mixed.conditions?.join() === "caries,watch");
ok("a crown with no extras is untouched", JSON.stringify(normalizeTooth({ status: "crown" })) === JSON.stringify({ status: "crown" }));
ok("the picker offers no condition or root_canal as a main status", !MAIN_TOOTH_STATUSES.some((s) => ["caries", "fractured", "to_extract", "watch", "root_canal"].includes(s.value)));

console.log("\nLabels:");
ok("crown + conditions + root treated", toothLabel({ status: "crown", conditions: ["caries", "watch"], endo: true }) === "Crown + caries, watch, root canal", toothLabel({ status: "crown", conditions: ["caries", "watch"], endo: true }));
ok("a sound tooth with caries reads 'Caries'", toothLabel({ status: "caries" }) === "Caries");
ok("plain status", toothLabel({ status: "implant" }) === "Implant");

console.log("\nThe rules:");
const fine: ChartTooth[] = [
  { status: "crown", conditions: ["caries", "watch"], endo: true },
  { status: "filled", conditions: ["caries"] },
  { status: "implant", conditions: ["watch", "fractured"] },
  { status: "missing" },
  { status: "sound", conditions: ["to_extract"] },
];
for (const t of fine) ok(`allowed: ${toothLabel(t)}`, toothRuleError(t) === null, toothRuleError(t) ?? "");
const bad: ChartTooth[] = [
  { status: "implant", endo: true },
  { status: "implant", conditions: ["caries"] },
  { status: "missing", conditions: ["caries"] },
  { status: "exfoliated", endo: true },
  { status: "unerupted", surfaces: ["O"] },
];
for (const t of bad) ok(`refused: ${JSON.stringify(t)}`, toothRuleError(t) !== null);
ok("allowedOn agrees: caries not on an implant", !allowedOn("implant", "caries") && allowedOn("implant", "watch"));
ok("allowedOn agrees: nothing on missing", !allowedOn("missing", "watch") && !allowedOn("missing", "endo"));

console.log("\nThe chart schema applies the same rules:");
ok("a valid chart parses", dentalChartSchema.safeParse({ "48": { status: "crown", conditions: ["caries"], endo: true } }).success);
ok("an implant with a root treatment is refused", !dentalChartSchema.safeParse({ "36": { status: "implant", endo: true } }).success);
ok("an unknown condition is refused", !dentalChartSchema.safeParse({ "36": { status: "crown", conditions: ["gold"] } }).success);
ok("an old chart still parses", dentalChartSchema.safeParse({ "21": { status: "caries" }, "11": { status: "root_canal" } }).success);

console.log("\nA change of conditions alone is a change:");
ok("a sound tooth with a condition is not blank", !isBlankTooth({ status: "sound", conditions: ["watch"] }));
const history = toothHistory(
  [
    { at: 1, chartAfter: { "48": { status: "crown" } } },
    { at: 2, chartAfter: { "48": { status: "crown", conditions: ["caries"] } } },
    { at: 3, chartAfter: { "48": { status: "crown", conditions: ["caries"] } } },
  ],
  "48",
);
ok("history: adding caries to a crown is an entry; repeating it is not", history.length === 2, String(history.length));
ok(
  "an old 'caries' and a new sound+caries are the same tooth",
  toothHistory([{ at: 1, chartAfter: { "21": { status: "caries" } } }, { at: 2, chartAfter: { "21": { status: "sound", conditions: ["caries"] } } }], "21").length === 1,
);
const diff = diffTeeth({ "48": { status: "crown" } }, { "48": { status: "crown", conditions: ["caries"] } });
ok("visit diff names the whole tooth", diff.length === 1 && diff[0].labelFrom === "Crown" && diff[0].labelTo === "Crown + caries", JSON.stringify(diff));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
