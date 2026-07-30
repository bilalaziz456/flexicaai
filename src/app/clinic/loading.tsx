import { PanelSkeleton } from "@/core/ui/panel-skeleton";

/**
 * Loading boundary for /clinic and its sub-routes — a content-shaped skeleton (not a
 * spinner) shown the instant you navigate, so the content area never lingers on the
 * previous screen. The PanelShell (sidebar/header) persists around it.
 */
export default function ClinicLoading() {
  return <PanelSkeleton />;
}
