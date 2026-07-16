/**
 * Unit tests for core/appointments/discount-bearing.ts — pure, no DB.
 * Run: `npm run test:unit`. Asserts the docs/discount-bearing-plan.md §3 worked
 * table, settlement zero-sum, make-whole convergence as the patient pays, the split
 * (percent + amount), multi-doctor proportional, and the degenerate edges.
 */
import { computeBearing, type BearingInput } from "../src/core/appointments/discount-bearing";

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

/** Integer gross-% split of collected P (mirrors the Phase-2 earnings basis). */
function earnings(P: number, gross: Record<string, number>): Record<string, number> {
  const ids = Object.keys(gross);
  const G = ids.reduce((s, id) => s + gross[id], 0);
  const out: Record<string, number> = {};
  const fr: { id: string; f: number }[] = [];
  let acc = 0;
  for (const id of ids) {
    const ex = G > 0 ? (P * gross[id]) / G : 0;
    out[id] = Math.floor(ex);
    acc += out[id];
    fr.push({ id, f: ex - Math.floor(ex) });
  }
  let rem = P - acc;
  fr.sort((a, b) => b.f - a.f);
  for (let i = 0; rem > 0; i++, rem--) out[fr[i % fr.length].id] += 1;
  return out;
}

// Baseline: procedure Rs 2000, doctor 10% → clinicGross 1800, doctor "dr" 200.
const base = (over: Partial<BearingInput>): BearingInput => ({
  clinicGross: 1800,
  doctorGross: { dr: 200 },
  discount: 0,
  borneBy: "clinic",
  ...over,
});

console.log("§3 worked table (settlement dr / clinic):");
{
  const r = computeBearing(base({ borneBy: "doctor", discount: 2000 }));
  check("doctor-borne 100% → dr", r.doctors.dr, -1800);
  check("doctor-borne 100% → clinic", r.clinic, 1800);
  check("doctor-borne 100% → doctorBorne", r.doctorBorne, 2000);
}
{
  const r = computeBearing(base({ borneBy: "clinic", discount: 2000 }));
  check("clinic-borne 100% → dr", r.doctors.dr, 200);
  check("clinic-borne 100% → clinic", r.clinic, -200);
  check("clinic-borne 100% → clinicBorne", r.clinicBorne, 2000);
}
{
  const r = computeBearing(base({ borneBy: "doctor", discount: 500 }));
  check("doctor-borne 500 → dr", r.doctors.dr, -450);
  check("doctor-borne 500 → clinic", r.clinic, 450);
}
{
  const r = computeBearing(base({ borneBy: "clinic", discount: 500 }));
  check("clinic-borne 500 → dr", r.doctors.dr, 50);
  check("clinic-borne 500 → clinic", r.clinic, -50);
}

console.log("Convergence (earnings on collected P + fixed settlement):");
{
  // Doctor-borne 500, net 1500. Settlement is fixed (-450 / +450); earnings float.
  const r = computeBearing(base({ borneBy: "doctor", discount: 500 }));
  const gross = { __clinic__: 1800, dr: 200 };
  for (const [P, wantDr, wantClinic] of [
    [1000, -350, 1350],
    [1500, -300, 1800],
  ] as const) {
    const e = earnings(P, gross);
    check(`P=${P} doctor total`, e.dr + r.doctors.dr, wantDr);
    check(`P=${P} clinic total`, e.__clinic__ + r.clinic, wantClinic);
  }
}

console.log("Zero-sum settlement (a pure transfer):");
for (const b of ["clinic", "doctor", "split"] as const) {
  const r = computeBearing(base({ borneBy: b, discount: 700, split: { type: "percent", value: 40 } }));
  const sum = r.clinic + Object.values(r.doctors).reduce((s, v) => s + v, 0);
  check(`${b} settlement sums to 0`, sum, 0);
  check(`${b} clinicBorne+doctorBorne=discount`, r.clinicBorne + r.doctorBorne, 700);
}

console.log("Split — percent & amount:");
{
  const r = computeBearing(base({ borneBy: "split", discount: 500, split: { type: "percent", value: 50 } }));
  check("split 50% → doctorBorne", r.doctorBorne, 250);
  check("split 50% → dr settlement", r.doctors.dr, -200);
  check("split 50% → clinic settlement", r.clinic, 200);
}
{
  const r = computeBearing(base({ borneBy: "split", discount: 500, split: { type: "amount", value: 100 } }));
  check("split Rs100 → doctorBorne", r.doctorBorne, 100);
  check("split Rs100 → dr settlement", r.doctors.dr, -50);
  check("split Rs100 → clinic settlement", r.clinic, 50);
}

console.log("Multi-doctor proportional (doctor-borne):");
{
  const r = computeBearing({ clinicGross: 1000, doctorGross: { a: 600, b: 400 }, discount: 500, borneBy: "doctor" });
  check("multi → a settlement", r.doctors.a, -150);
  check("multi → b settlement", r.doctors.b, -100);
  check("multi → clinic settlement", r.clinic, 250);
}

console.log("Edges:");
{
  const r = computeBearing({ clinicGross: 2000, doctorGross: {}, discount: 500, borneBy: "doctor" });
  check("no doctor → clinicBorne (shifts to clinic)", r.clinicBorne, 500);
  check("no doctor → clinic settlement 0 (no counterparty)", r.clinic, 0);
}
{
  const r = computeBearing({ clinicGross: 2000, doctorGross: { dr: 0 }, discount: 500, borneBy: "doctor" });
  check("0-share doctor bears fully → dr settlement", r.doctors.dr, -500);
  check("0-share doctor bears fully → clinic settlement", r.clinic, 500);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
