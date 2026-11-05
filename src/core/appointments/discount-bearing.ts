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
  /** Per-doctor absorption (sums to doctorBorne). Set by `computeBearingPieces`. */
  doctorBorneById?: Record<string, number>;
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

// ─── Per-line bearing: a visit's discount as a list of PIECES ──────────────────
// docs/per-line-discount-plan.md §3. A piece is one discount with its own bearer —
// a line's clinic offer, a line's patient discount, the consultation's discount, or
// the visit's overall discount. A doctor-borne part comes out of the piece's own
// `doctorId` alone; a piece with no doctor (the overall discount) is shared across the
// visit's doctors by gross share, exactly as `computeBearing` does for the whole
// discount today.

export type BearingPiece = {
  /** PKR, ≥ 0. */
  amount: number;
  borneBy: BearBorneBy;
  split?: BearSplit;
  /** Whose share a doctor-borne part comes from. NULL = every doctor on the visit,
   *  by gross share (the overall discount). */
  doctorId: string | null;
};

export type PiecesBearingInput = {
  clinicGross: number;
  doctorGross: Record<string, number>;
  pieces: BearingPiece[];
};

/**
 * `computeBearing` for a list of pieces. Same make-whole targets, same zero-sum
 * settlement; only WHICH doctor bears each doctor-side part changes.
 *
 * One piece with `doctorId: null` is today's calculation exactly — the per-line rule
 * is a generalisation, not a second formula (scripts/test-discount-pieces.ts asserts
 * it over random visits).
 *
 * Edge cases, each falling back to the party that CAN bear it:
 *  - a piece naming a doctor who has no share on this visit → the clinic bears it;
 *  - a NULL-doctor piece on a visit with no doctors → the clinic bears it;
 *  - pieces adding up to more than the visit's gross are cut, in order, to fit.
 */
export function computeBearingPieces(input: PiecesBearingInput): BearingResult {
  const doctorIds = Object.keys(input.doctorGross);
  const doctorGrossSum = doctorIds.reduce((s, id) => s + Math.max(0, input.doctorGross[id] ?? 0), 0);
  const clinicGross = Math.max(0, input.clinicGross);
  const grossTotal = clinicGross + doctorGrossSum;

  let room = grossTotal;
  let clinicBorne = 0;
  let pooled = 0; // doctor-side parts of NULL-doctor pieces, shared by gross share
  const named: Record<string, number> = {};
  for (const p of input.pieces) {
    const amount = clamp(Math.round(p.amount), 0, room);
    room -= amount;
    if (amount === 0) continue;
    const part = discountBorneSplit(amount, p.borneBy, p.split);
    clinicBorne += part.clinicBorne;
    if (part.doctorBorne === 0) continue;
    if (p.doctorId === null) pooled += part.doctorBorne;
    else if (doctorIds.includes(p.doctorId)) named[p.doctorId] = (named[p.doctorId] ?? 0) + part.doctorBorne;
    else clinicBorne += part.doctorBorne;
  }
  if (doctorIds.length === 0) {
    clinicBorne += pooled;
    pooled = 0;
  }

  const K = grossTotal - room;
  const netTotal = grossTotal - K;
  const kdById = allocate(pooled, doctorIds, input.doctorGross);
  for (const [id, v] of Object.entries(named)) kdById[id] = (kdById[id] ?? 0) + v;
  const doctorBorne = K - clinicBorne;

  const allIds = [CLINIC, ...doctorIds];
  const grossById: Record<string, number> = { [CLINIC]: clinicGross, ...input.doctorGross };
  const netEarnings = allocate(netTotal, allIds, grossById);

  const clinic = clinicGross - clinicBorne - (netEarnings[CLINIC] ?? 0);
  const doctors: Record<string, number> = {};
  for (const id of doctorIds) {
    const target = (input.doctorGross[id] ?? 0) - (kdById[id] ?? 0);
    doctors[id] = target - (netEarnings[id] ?? 0);
  }

  return { grossTotal, netTotal, clinic, doctors, clinicBorne, doctorBorne, doctorBorneById: kdById };
}

/** How a clinic offer is borne: the three bearers, or "proportional" — today's rule,
 *  where the doctor's share is worked out on the price AFTER the offer, so each side
 *  gives up its own % of it (plan §5; the default for every offer). */
export type OfferBorneBy = BearBorneBy | "proportional";

/** One discount on a line, as stored: what it took off the bill, and who bears it. */
export type LineDiscount = { amount: number; borneBy: BearBorneBy; split?: BearSplit };

export type PieceLine = {
  /** The performing doctor (NULL = the clinic's line). */
  doctorId: string | null;
  /** A service / other charge: earns no doctor share, so its discounts are the
   *  clinic's whatever was chosen (plan §2, decision 3). */
  isService: boolean;
  /** unit × qty, before any discount. */
  gross: number;
  /** The doctor's share % on this line. */
  pct: number;
  offer: { amount: number; borneBy: OfferBorneBy; split?: BearSplit };
  patient: LineDiscount;
};

export type PieceVisit = {
  consultation: { doctorId: string; fee: number; pct: number; discount: LineDiscount } | null;
  lines: PieceLine[];
  /** The visit's overall discount (on the subtotal). */
  overall: LineDiscount;
};

/**
 * A visit's lines → the share BASES `computeShare` works on, and the bearing pieces.
 *
 * A "proportional" offer is not a piece: it lowers the line's share base, so each side
 * gives up its own % (today's rule). Every other offer leaves the base at the full
 * price and is borne as chosen. Patient discounts never touch the base — they are
 * pieces, like the overall discount is today. Pure.
 */
export function buildDiscountPieces(visit: PieceVisit): {
  consultation: { doctorId: string; fee: number; pct: number } | null;
  lines: { doctorId: string | null; gross: number; pct: number }[];
  pieces: BearingPiece[];
} {
  const pieces: BearingPiece[] = [];
  const push = (d: LineDiscount | PieceLine["offer"], doctorId: string | null, clinicOnly: boolean) => {
    if (!(d.amount > 0)) return;
    // A line no doctor earns from: the clinic bears all of it, "proportional" included
    // (its base is never lowered, so skipping it would leave the offer borne by nobody).
    if (clinicOnly || doctorId === null) {
      pieces.push({ amount: d.amount, borneBy: "clinic", doctorId: null });
      return;
    }
    if (d.borneBy === "proportional") return; // taken off the share base instead
    pieces.push({ amount: d.amount, borneBy: d.borneBy, split: d.split, doctorId });
  };

  const c = visit.consultation;
  if (c) push(c.discount, c.doctorId, false);

  const lines = visit.lines.map((l) => {
    const clinicOnly = l.isService || l.doctorId === null;
    const proportional = !clinicOnly && l.offer.borneBy === "proportional";
    push(l.offer, l.doctorId, clinicOnly);
    push(l.patient, l.doctorId, clinicOnly);
    return {
      doctorId: l.isService ? null : l.doctorId,
      gross: Math.max(0, Math.round(l.gross - (proportional ? l.offer.amount : 0))),
      pct: l.isService ? 0 : l.pct,
    };
  });

  // The overall discount last: it is taken off what is left (plan §4), and its
  // doctor side is shared by gross share — no single doctor gave it.
  if (visit.overall.amount > 0) {
    pieces.push({ amount: visit.overall.amount, borneBy: visit.overall.borneBy, split: visit.overall.split, doctorId: null });
  }

  return {
    consultation: c ? { doctorId: c.doctorId, fee: c.fee, pct: c.pct } : null,
    lines,
    pieces,
  };
}
