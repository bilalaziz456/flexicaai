/**
 * Doctor–clinic revenue split — CORE, PURE (no DB, no server-only) so it can run on
 * the server, in a form preview, and in tests. See docs/doctor-shares-plan.md.
 *
 * Shares are computed on GROSS (pre-discount) amounts, then the total discount is
 * attributed to whoever bears it. Every amount is whole PKR; the rounding remainder
 * lands on the clinic so `Σ doctors + clinic === net` exactly.
 */

export type ShareBorneBy = "clinic" | "doctor" | "split";

/** A doctor's configured rates: consultation %, default procedure %, and per-
 * procedure overrides (procedureId → %). A present override of `0` is meaningful
 * (0% — all to the clinic) and distinct from an absent one (→ the default). */
export type DoctorShareRates = {
  consultationPct: number;
  defaultProcedurePct: number;
  overrides: Record<string, number>;
};

export type ShareInput = {
  /** The consulting doctor + GROSS consultation fee + their consultation %. NULL
   *  when no consultation is charged or there's no doctor (→ that money is clinic). */
  consultation: { doctorId: string; fee: number; pct: number } | null;
  /** Procedure lines: performing doctor (NULL → clinic), GROSS (unit×qty) and the
   *  resolved share % for that doctor on that procedure. */
  lines: { doctorId: string | null; gross: number; pct: number }[];
  /** The net total the patient actually pays (from computeBill). discount = gross − net. */
  netTotal: number;
  borneBy: ShareBorneBy;
};

export type ShareResult = {
  /** doctorId → share amount (whole PKR, ≥ 0). */
  doctors: Record<string, number>;
  clinic: number;
  grossTotal: number;
  discount: number;
};

const CLINIC = "__clinic__";
const clampPct = (p: number) => Math.max(0, Math.min(100, Math.round(p)));

/**
 * The share % for a doctor on a procedure: a stored override wins (including `0`);
 * otherwise the doctor's default procedure %. A null procedureId (deleted procedure)
 * also falls back to the default.
 */
export function resolveProcedureRate(
  rates: DoctorShareRates,
  procedureId: string | null,
): number {
  if (procedureId && Object.prototype.hasOwnProperty.call(rates.overrides, procedureId)) {
    return rates.overrides[procedureId];
  }
  return rates.defaultProcedurePct;
}

/** Integer proportional split of `take` across `weights`, summing to exactly `take`
 *  with each cut ≤ its weight (largest-remainder rounding). */
function splitAmount(take: number, weights: { id: string; w: number }[]): Record<string, number> {
  const totalW = weights.reduce((s, x) => s + x.w, 0);
  const out: Record<string, number> = {};
  const fracs: { id: string; frac: number }[] = [];
  let allocated = 0;
  for (const { id, w } of weights) {
    const exact = totalW > 0 ? (take * w) / totalW : 0;
    const fl = Math.floor(exact);
    out[id] = fl;
    allocated += fl;
    fracs.push({ id, frac: exact - fl });
  }
  let rem = take - allocated;
  fracs.sort((a, b) => b.frac - a.frac);
  for (let i = 0; rem > 0 && fracs.length > 0; i++, rem--) {
    out[fracs[i % fracs.length].id] += 1;
  }
  return out;
}

/** Reduces `amount` from `net` across ordered buckets, proportionally within a
 *  bucket, spilling any leftover to the next bucket (so no party goes negative). */
function reduce(net: Record<string, number>, amount: number, buckets: string[][]): void {
  let remaining = amount;
  for (const bucket of buckets) {
    if (remaining <= 0) break;
    const ids = bucket.filter((id) => (net[id] ?? 0) > 0);
    const bucketGross = ids.reduce((s, id) => s + net[id], 0);
    if (bucketGross <= 0) continue;
    const take = Math.min(remaining, bucketGross);
    const cuts = splitAmount(take, ids.map((id) => ({ id, w: net[id] })));
    for (const id of ids) net[id] -= cuts[id] ?? 0;
    remaining -= take;
  }
}

/** Split one appointment's revenue into per-doctor + clinic shares. */
export function computeShare(input: ShareInput): ShareResult {
  const gross: Record<string, number> = {};
  const doctorIds = new Set<string>();
  const addDoctor = (id: string, amt: number) => {
    gross[id] = (gross[id] ?? 0) + amt;
    doctorIds.add(id);
  };

  let grossTotal = 0;

  if (input.consultation && input.consultation.fee > 0 && input.consultation.doctorId) {
    grossTotal += input.consultation.fee;
    addDoctor(
      input.consultation.doctorId,
      Math.round((input.consultation.fee * clampPct(input.consultation.pct)) / 100),
    );
  }

  for (const l of input.lines) {
    const g = Math.max(0, Math.round(l.gross));
    grossTotal += g;
    if (l.doctorId && g > 0) {
      addDoctor(l.doctorId, Math.round((g * clampPct(l.pct)) / 100));
    }
  }

  const doctorGrossSum = [...doctorIds].reduce((s, id) => s + (gross[id] ?? 0), 0);

  // Net map keyed by doctor ids + the clinic sentinel; clinic absorbs rounding.
  const net: Record<string, number> = { [CLINIC]: grossTotal - doctorGrossSum };
  for (const id of doctorIds) net[id] = gross[id] ?? 0;

  const discount = Math.max(0, grossTotal - Math.max(0, input.netTotal));
  if (discount > 0) {
    const doctorBucket = [...doctorIds];
    const buckets =
      input.borneBy === "doctor"
        ? [doctorBucket, [CLINIC]]
        : input.borneBy === "split"
          ? [[CLINIC, ...doctorBucket]]
          : [[CLINIC], doctorBucket]; // clinic (default)
    reduce(net, discount, buckets);
  }

  const doctors: Record<string, number> = {};
  for (const id of doctorIds) doctors[id] = Math.max(0, net[id] ?? 0);
  return {
    doctors,
    clinic: Math.max(0, net[CLINIC] ?? 0),
    grossTotal,
    discount,
  };
}
