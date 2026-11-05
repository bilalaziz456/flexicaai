/**
 * Per-line discounts, phase 1 (docs/per-line-discount-plan.md): the layered bill and
 * the bearing PIECES. Pure — no DB.
 *
 *   tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-discount-pieces.ts
 *
 * The load-bearing checks are the first two: with nothing new set, the bill and the
 * bearing come out EXACTLY as before, over thousands of random visits. That is what
 * lets every existing visit keep its figures (plan decision 6).
 */
import assert from "node:assert/strict";
import {
  billFromTotals,
  computeBill,
  computeFee,
  computeProcedureLine,
  type DiscountType,
} from "../src/core/appointments/fee";
import {
  buildDiscountPieces,
  computeBearing,
  computeBearingPieces,
  type BearBorneBy,
} from "../src/core/appointments/discount-bearing";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// Deterministic randomness, so a failure reproduces.
let seed = 20261106;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)];
const TYPES: DiscountType[] = ["amount", "percent"];
const BEARERS: BearBorneBy[] = ["clinic", "doctor", "split"];

type OldLine = { unitPrice: number; quantity: number; discountType: DiscountType; discountValue: number };

/** The bill formula as it was before this change (2026-11-06), for comparison. */
function oldBill(fee: number, lines: OldLine[], t: DiscountType, v: number) {
  const ls = lines.map((l) => {
    const gross = Math.max(0, Math.round(l.unitPrice)) * Math.max(0, Math.round(l.quantity));
    const { discount, net } = computeFee(gross, l.discountType, l.discountValue);
    return { gross, discount, net };
  });
  return billFromTotals(fee, ls.reduce((s, l) => s + l.gross, 0), ls.reduce((s, l) => s + l.net, 0), t, v);
}

check("bill: with no patient or consultation discount, identical to before (3,000 visits)", () => {
  for (let i = 0; i < 3000; i++) {
    const fee = pick([0, 500, 1000, int(0, 5000)]);
    const lines: OldLine[] = Array.from({ length: int(0, 4) }, () => {
      const t = pick(TYPES);
      return { unitPrice: int(0, 20000), quantity: int(1, 3), discountType: t, discountValue: t === "percent" ? int(0, 100) : int(0, 5000) };
    });
    const t = pick(TYPES);
    const v = t === "percent" ? int(0, 100) : int(0, 3000);
    const now = computeBill(fee, lines, t, v);
    const before = oldBill(fee, lines, t, v);
    for (const k of ["gross", "discount", "net", "subtotal", "appointmentDiscount", "proceduresNet"] as const) {
      assert.equal(now[k], before[k], `${k} differs on visit ${i}`);
    }
    assert.equal(now.consultationDiscount, 0);
  }
});

check("bearing: one NULL-doctor piece is exactly today's computeBearing (5,000 visits)", () => {
  for (let i = 0; i < 5000; i++) {
    const doctorGross: Record<string, number> = {};
    const nDoctors = int(0, 3);
    for (let d = 0; d < nDoctors; d++) doctorGross[`d${d}`] = int(0, 8000);
    const clinicGross = int(0, 20000);
    const borneBy = pick(BEARERS);
    const split = { type: pick(TYPES), value: int(0, 100) };
    const discount = int(0, 30000);
    const a = computeBearing({ clinicGross, doctorGross, discount, borneBy, split });
    const b = computeBearingPieces({ clinicGross, doctorGross, pieces: [{ amount: discount, borneBy, split, doctorId: null }] });
    const { doctorBorneById: _perDoctor, ...bCore } = b;
    void _perDoctor;
    assert.deepEqual(bCore, a, `visit ${i}`);
  }
});

check("line: patient discount is taken after the offer (10% then 10% of 1,000 = 810)", () => {
  const l = computeProcedureLine({ unitPrice: 1000, quantity: 1, discountType: "percent", discountValue: 10, patientDiscountType: "percent", patientDiscountValue: 10 });
  assert.deepEqual(l, { gross: 1000, discount: 190, net: 810, offerDiscount: 100, patientDiscount: 90 });
});

check("line: a patient discount larger than what is left stops at zero", () => {
  const l = computeProcedureLine({ unitPrice: 1000, quantity: 1, discountType: "amount", discountValue: 600, patientDiscountType: "amount", patientDiscountValue: 900 });
  assert.equal(l.net, 0);
  assert.equal(l.patientDiscount, 400);
});

check("bill: consultation discount comes off the fee before the overall discount", () => {
  // fee 1,000 − 20% = 800; procedure 4,000; subtotal 4,800; overall 10% = 480 → 4,320.
  const b = computeBill(1000, [{ unitPrice: 4000, quantity: 1, discountType: "amount", discountValue: 0 }], "percent", 10, { type: "percent", value: 20 });
  assert.equal(b.consultationDiscount, 200);
  assert.equal(b.subtotal, 4800);
  assert.equal(b.appointmentDiscount, 480);
  assert.equal(b.net, 4320);
  assert.equal(b.gross - b.discount, b.net);
});

// The plan's worked example (§3).
const visit = buildDiscountPieces({
  consultation: { doctorId: "A", fee: 1000, pct: 50, discount: { amount: 200, borneBy: "clinic" } },
  lines: [
    { doctorId: "A", isService: false, gross: 4000, pct: 40, offer: { amount: 0, borneBy: "proportional" }, patient: { amount: 0, borneBy: "clinic" } },
    { doctorId: "B", isService: false, gross: 10000, pct: 50, offer: { amount: 0, borneBy: "proportional" }, patient: { amount: 2000, borneBy: "doctor" } },
  ],
  overall: { amount: 300, borneBy: "split", split: { type: "percent", value: 50 } },
});
// Gross shares: A 500 + 1,600 = 2,100 · B 5,000 · clinic 7,900.
const example = computeBearingPieces({ clinicGross: 7900, doctorGross: { A: 2100, B: 5000 }, pieces: visit.pieces });

check("plan §3 example: Dr B bears 2,106, Dr A 44, the clinic 350", () => {
  assert.equal(example.clinicBorne, 350);
  assert.deepEqual(example.doctorBorneById, { A: 44, B: 2106 });
  assert.equal(example.netTotal, 12500);
  const sum = example.clinic + Object.values(example.doctors).reduce((s, v) => s + v, 0);
  assert.equal(sum, 0, "settlements are zero-sum");
});

check("the same discount under TODAY's rule charged Dr A for Dr B's root canal", () => {
  const today = computeBearingPieces({ clinicGross: 7900, doctorGross: { A: 2100, B: 5000 }, pieces: [{ amount: 2000, borneBy: "doctor", doctorId: null }] });
  assert.deepEqual(today.doctorBorneById, { A: 592, B: 1408 });
  const perLine = computeBearingPieces({ clinicGross: 7900, doctorGross: { A: 2100, B: 5000 }, pieces: [{ amount: 2000, borneBy: "doctor", doctorId: "B" }] });
  assert.equal(perLine.doctorBorneById?.B, 2000);
  assert.equal(perLine.doctorBorneById?.A ?? 0, 0);
});

check("one doctor on the visit: a per-line piece and a whole-visit piece agree", () => {
  for (let i = 0; i < 500; i++) {
    const g = { X: int(0, 9000) };
    const c = int(0, 20000);
    const p = { amount: int(0, 15000), borneBy: pick(BEARERS), split: { type: pick(TYPES), value: int(0, 100) } };
    assert.deepEqual(
      computeBearingPieces({ clinicGross: c, doctorGross: g, pieces: [{ ...p, doctorId: "X" }] }),
      computeBearingPieces({ clinicGross: c, doctorGross: g, pieces: [{ ...p, doctorId: null }] }),
    );
  }
});

check("a service line's discount is the clinic's, whatever was chosen", () => {
  const v = buildDiscountPieces({
    consultation: null,
    lines: [{ doctorId: "A", isService: true, gross: 3000, pct: 40, offer: { amount: 300, borneBy: "proportional" }, patient: { amount: 500, borneBy: "doctor" } }],
    overall: { amount: 0, borneBy: "clinic" },
  });
  assert.deepEqual(v.pieces, [
    { amount: 300, borneBy: "clinic", doctorId: null },
    { amount: 500, borneBy: "clinic", doctorId: null },
  ]);
  assert.deepEqual(v.lines, [{ doctorId: null, gross: 3000, pct: 0 }]);
});

check("an 'In proportion' offer lowers the share base (today's rule); a borne offer is a piece", () => {
  const v = buildDiscountPieces({
    consultation: null,
    lines: [
      { doctorId: "A", isService: false, gross: 1000, pct: 50, offer: { amount: 100, borneBy: "proportional" }, patient: { amount: 0, borneBy: "clinic" } },
      { doctorId: "A", isService: false, gross: 1000, pct: 50, offer: { amount: 100, borneBy: "doctor" }, patient: { amount: 0, borneBy: "clinic" } },
    ],
    overall: { amount: 0, borneBy: "clinic" },
  });
  assert.deepEqual(v.lines.map((l) => l.gross), [900, 1000]);
  assert.deepEqual(v.pieces, [{ amount: 100, borneBy: "doctor", split: undefined, doctorId: "A" }]);
});

check("a piece naming a doctor with no share on the visit falls to the clinic", () => {
  const r = computeBearingPieces({ clinicGross: 5000, doctorGross: { A: 1000 }, pieces: [{ amount: 400, borneBy: "doctor", doctorId: "Z" }] });
  assert.equal(r.clinicBorne, 400);
  assert.equal(r.doctorBorne, 0);
});

check("pieces adding up to more than the visit are cut to fit, and settlements stay zero-sum", () => {
  const r = computeBearingPieces({
    clinicGross: 600,
    doctorGross: { A: 400 },
    pieces: [
      { amount: 700, borneBy: "doctor", doctorId: "A" },
      { amount: 700, borneBy: "clinic", doctorId: null },
    ],
  });
  assert.equal(r.netTotal, 0);
  assert.equal(r.clinicBorne + r.doctorBorne, 1000);
  assert.equal(r.clinic + (r.doctors.A ?? 0), 0);
});

console.log(`\n${passed} checks passed`);
