"use client";

import { Badge } from "@/core/ui/badge";
import { useVocabularyLabel } from "@/core/ui/vocabulary-provider";

/** Clinic lifecycle status badge — shared by the clinics list + detail. */
export function ClinicStatusBadge({ status }: { status: string }) {
  const label = useVocabularyLabel("clinic_statuses", status);
  const variant =
    status === "active"
      ? "success"
      : status === "trial"
        ? "info"
        : status === "past_due"
          ? "warning"
          : "destructive"; // suspended / cancelled
  return <Badge variant={variant}>{label}</Badge>;
}
