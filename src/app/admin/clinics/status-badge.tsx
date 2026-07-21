import { Badge } from "@/core/ui/badge";
import { CLINIC_STATUS_LABEL, isClinicStatus } from "@/core/clinics/status";
import { cn } from "@/core/lib/utils";

/** Clinic lifecycle status badge — shared by the clinics list + detail. */
export function ClinicStatusBadge({ status }: { status: string }) {
  const label = isClinicStatus(status) ? CLINIC_STATUS_LABEL[status] : status;
  const tone =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "trial"
        ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
        : status === "past_due"
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : // suspended / cancelled
            "bg-destructive/10 text-destructive";
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      {label}
    </Badge>
  );
}
