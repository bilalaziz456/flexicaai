/**
 * Discount bearing — CORE, PURE (no DB, no server-only) so it runs on the server, in
 * a form preview, and in unit tests. Implements docs/discount-bearing-plan.md §3:
 *
 *  - Whoever BEARS a discount absorbs it in full; the other party keeps its normal
 *    cut. No spillover. A bearer may go negative (a doctor can owe; the clinic's cut
 *    can be negative).
 *  - The SETTLEMENT is a zero-sum transfer between the parties, computed on the NET
 *    bill + gross shares only — it does NOT move when the patient pays. Earnings
 *    (collected-basis, `sale_shares`) float with collection, so totals converge to
 *    the make-whole result as the patient pays down.
 *
 *      settlement(party) = target(party) − netEarnings(party)
 *      target = the make-whole position for the borne-by
 *      netEarnings = the party's gross share of the NET bill (Σ = net)
 *
 * `computeBearing` returns the signed per-party settlement (for the ledger/balances)
 * and the discount ABSORPTION split (`clinicBorne` / `doctorBorne`, Σ = discount) for
 * the discounts report.
 */

export type BearBorneBy = "clinic" | "doctor" | "split";
/** For borneBy='split', the DOCTOR side's portion of the discount. */
export type BearSplit = { type: "percent" | "amount"; value: number };

export type BearingInput = {
  /** The clinic's pre-discount gross cut (whole PKR). */
  clinicGross: number;
  /** doctorId → that doctor's pre-discount gross cut (whole PKR). */
  doctorGross: Record<string, number>;
  /** The effective (approved) discount in PKR (≥ 0). */
  discount: number;
  borneBy: BearBorneBy;
  split?: BearSplit;
};

export type BearingResult = {
  grossTotal: number;
  netTotal: number;
  /** Signed settlement (balance adjustment) per party; Σ(clinic + doctors) = 0. */
  clinic: number;
  doctors: Record<string, number>;
  /** Discount absorption for the report; clinicBorne + doctorBorne = discount. */
  clinicBorne: number;
  doctorBorne: number;
};

const CLINIC = "__clinic__";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How a discount is split between clinic and doctor by borne-by (no spillover — the
 * new rule): clinic-borne → clinic bears all; doctor-borne → doctors bear all; split →
 * the doctor side bears its configured portion, the clinic the rest. Depends only on
 * the amount + borne-by + split (not gross shares), so the discounts report can call
 * it directly. `clinicBorne + doctorBorne = amount`.
 */
export function discountBorneSplit(
  amount: number,
  borneBy: BearBorneBy,
  split?: BearSplit,
): { clinicBorne: number; doctorBorne: number } {
  const K = Math.max(0, Math.round(amount));
  let doctorBorne: number;
  if (borneBy === "doctor") doctorBorne = K;
  else if (borneBy === "split") {
    const s = split ?? { type: "percent", value: 0 };
    doctorBorne = s.type === "amount" ? clamp(Math.round(s.value), 0, K) : clamp(Math.round((K * s.value) / 100), 0, K);
  } else doctorBorne = 0; // clinic
  return { clinicBorne: K - doctorBorne, doctorBorne };
}

/**
 * Integer proportional split of `total` across `ids` by `weight` (largest-remainder,
 * summing to exactly `total`). Falls back to an equal split when every weight is 0.
 */
function allocate(
  total: number,
  ids: string[],
  weight: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (ids.length === 0) return out;
  const w = (id: string) => Math.max(0, weight[id] ?? 0);
  const sumW = ids.reduce((s, id) => s + w(id), 0);
  const fracs: { id: string; frac: number }[] = [];
  let allocated = 0;
  for (const id of ids) {
    const exact = sumW > 0 ? (total * w(id)) / sumW : total / ids.length;
    const fl = Math.floor(exact);
    out[id] = fl;
    allocated += fl;
    fracs.push({ id, frac: exact - fl });
  }
  let rem = total - allocated;
  fracs.sort((a, b) => b.frac - a.frac);
  for (let i = 0; rem > 0 && fracs.length > 0; i++, rem--) {
    out[fracs[i % fracs.length].id] += 1;
  }
  return out;
}

export function computeBearing(input: BearingInput): BearingResult {
  const doctorIds = Object.keys(input.doctorGross);
  const doctorGrossSum = doctorIds.reduce((s, id) => s + Math.max(0, input.doctorGross[id] ?? 0), 0);
  const clinicGross = Math.max(0, input.clinicGross);
  const grossTotal = clinicGross + doctorGrossSum;
  const K = clamp(Math.round(input.discount), 0, grossTotal);
  const netTotal = grossTotal - K;

  // How much of the discount the DOCTOR side bears (the rest is the clinic's).
  let { clinicBorne, doctorBorne } = discountBorneSplit(K, input.borneBy, input.split);
  // No doctor to bear it → the clinic takes it (degenerate doctor/split visit).
  if (doctorIds.length === 0) {
    doctorBorne = 0;
    clinicBorne = K;
  }

  // Make-whole targets (Σ = net) and each party's gross share of the net (Σ = net).
  const kdById = allocate(doctorBorne, doctorIds, input.doctorGross);
  const allIds = [CLINIC, ...doctorIds];
  const grossById: Record<string, number> = { [CLINIC]: clinicGross, ...input.doctorGross };
  const netEarnings = allocate(netTotal, allIds, grossById);

  const clinic = clinicGross - clinicBorne - (netEarnings[CLINIC] ?? 0);
  const doctors: Record<string, number> = {};
  for (const id of doctorIds) {
    const target = (input.doctorGross[id] ?? 0) - (kdById[id] ?? 0);
    doctors[id] = target - (netEarnings[id] ?? 0);
  }

  return { grossTotal, netTotal, clinic, doctors, clinicBorne, doctorBorne };
}
