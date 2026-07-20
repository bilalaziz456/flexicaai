import { TriangleAlert } from "lucide-react";
import type { Allergy } from "@/core/lib/medical-history";

/**
 * A prominent allergy warning — shown wherever a patient's record is viewed (patient
 * page, scribe). Safety read: visible even to front-desk (a `patients:view` holder),
 * not gated behind full clinical access. Renders nothing when there are no allergies.
 */
export function AllergyBanner({ allergies }: { allergies: Allergy[] }) {
  if (!allergies || allergies.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">Allergies: </span>
        {allergies
          .map((a) => `${a.substance}${a.severity ? ` (${a.severity})` : ""}`)
          .join(", ")}
      </span>
    </div>
  );
}
