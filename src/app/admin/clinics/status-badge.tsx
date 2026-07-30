import { Badge } from "@/core/ui/badge";
import { CLINIC_STATUS_LABEL, isClinicStatus } from "@/core/clinics/status";

/** Clinic lifecycle status badge — shared by the clinics list + detail. */
export function ClinicStatusBadge({ status }: { status: string }) {
  const label = isClinicStatus(status) ? CLINIC_STATUS_LABEL[status] : status;
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
