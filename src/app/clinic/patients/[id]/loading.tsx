import { DetailSkeleton } from "@/core/ui/panel-skeleton";

/** The patient record — the section rail is a real column, so it is here too. The PanelShell persists around it. */
export default function ClinicPatientDetailLoading() {
  return <DetailSkeleton {...{ cards: 4, rail: true }} />;
}
