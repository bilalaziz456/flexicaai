import { DetailSkeleton } from "@/core/ui/panel-skeleton";

/** One clinic: billing, capabilities, contact, logo, analytics. The PanelShell persists around it. */
export default function AdminClinicDetailLoading() {
  return <DetailSkeleton {...{ cards: 6 }} />;
}
