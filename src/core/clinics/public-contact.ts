import { z } from "zod";
import { clinicHoursSchema, type ClinicHour } from "@/core/lib/clinic-hours";
import { zodErrorMessage } from "@/core/lib/zod-error";

export type PublicContactValues = {
  publicAddress: string | null;
  openingHours: ClinicHour[] | null;
};

const addressSchema = z.string().max(400, "Address is too long (400 characters max).");

/**
 * Reads the clinic's public address and opening hours out of a submitted form.
 *
 * Shared because THREE actions post these two fields — the clinic admin editing their
 * own details, and the super admin setting them when creating or editing a clinic —
 * and the interesting part is not the parse but the two judgements below, which have
 * to be identical everywhere or the same form would mean different things depending on
 * who filled it in.
 *
 * The hours are `jsonb` written from a browser, so they are VALIDATED, not trusted
 * (conventions §4). Unparseable JSON is a client bug rather than something to store.
 *
 * Blank is meaningful and is stored as NULL: "we have not said" is distinct from "we
 * are closed", and the WhatsApp reply omits an unset line rather than printing a
 * heading with nothing under it. Likewise no windows at all means not stated — not the
 * same as a clinic that IS open some days and shut on others.
 *
 * Pure: no DB, no `server-only`, so an action can call it before deciding anything.
 */
export function parsePublicContact(
  formData: FormData,
): { ok: true; values: PublicContactValues } | { ok: false; error: string } {
  const address = addressSchema.safeParse(formData.get("publicAddress") ?? "");
  if (!address.success) return { ok: false, error: zodErrorMessage(address.error) };

  let raw: unknown = [];
  try {
    raw = JSON.parse(String(formData.get("openingHours") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read the opening hours. Please try again." };
  }
  const hours = clinicHoursSchema.safeParse(raw);
  if (!hours.success) return { ok: false, error: zodErrorMessage(hours.error) };

  return {
    ok: true,
    values: {
      publicAddress: address.data.trim() || null,
      openingHours: hours.data.length > 0 ? hours.data : null,
    },
  };
}
