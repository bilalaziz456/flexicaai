import { DetailSkeleton } from "@/core/ui/panel-skeleton";

/** One appointment: status, bill, payment, share, edit. The PanelShell persists around it. */
export default function ClinicAppointmentDetailLoading() {
  return <DetailSkeleton {...{ cards: 5 }} />;
}
