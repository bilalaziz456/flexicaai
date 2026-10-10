import "server-only";

/**
 * Which doctor's appointments a viewer is limited to, or undefined for the whole
 * clinic.
 *
 * A doctor sees their OWN schedule — the list, the month calendar's counts, the
 * live queue and the CSV export all narrow to them. Reception, managers and the
 * clinic admin run the front desk and see everyone.
 *
 * This is a SCOPE, not a filter: it is applied server-side on every path and is
 * never surfaced as something the viewer can clear. It lives here alone so the
 * rule can't drift between the page and the export route — the export is the one
 * that matters most, since a missed check there hands over the whole clinic's
 * schedule as a file.
 */
export function appointmentDoctorScope(user: {
  id: string;
  role: string;
}): string | undefined {
  return user.role === "doctor" ? user.id : undefined;
}

/**
 * The doctor every figure on the appointments screen is narrowed to: the viewer's
 * SCOPE when they have one, otherwise the Doctor filter they picked ("" = everyone).
 * The scope always wins, so a doctor cannot widen their view to a colleague's
 * schedule by editing `?doctor=` — the page and the CSV export both go through here.
 */
export function appointmentDoctorFilter(
  user: { id: string; role: string },
  requested: string,
): string | undefined {
  return appointmentDoctorScope(user) ?? (requested || undefined);
}
