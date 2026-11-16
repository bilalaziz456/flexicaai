import { Clock } from "lucide-react";

/**
 * "Free trial · ends 16 Dec 2026 (12 days left)" — the bottom-centre pill every user
 * of a clinic on trial sees (owner, 2026-11-17), in the same place and style as the
 * connectivity and payment pills. Calm while there is time; amber in the last
 * `URGENT_DAYS`, when it also says who to call to keep going. Access ends on the date
 * by itself (`isClinicUsable`); this only makes sure nobody is surprised by it.
 */
const URGENT_DAYS = 7;

export function TrialNoticePill({
  endsOn,
  daysLeft,
  contact,
}: {
  /** Already formatted for display ("16 Dec 2026"). */
  endsOn: string;
  daysLeft: number;
  /** "Ali Raza, 0300…" — the account manager, else the company's number. */
  contact: string | null;
}) {
  const urgent = daysLeft <= URGENT_DAYS;
  const left = daysLeft <= 0 ? "ends today" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex max-w-[92vw] items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg " +
        (urgent
          ? "bg-warning text-[color-mix(in_oklch,var(--warning)_18%,black)]"
          : "bg-[var(--brand-navy)] text-white")
      }
    >
      <Clock className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">Free trial</span>: ends {endsOn} ({left})
        {urgent && contact ? <>. To continue, contact {contact}</> : null}
      </span>
    </div>
  );
}
