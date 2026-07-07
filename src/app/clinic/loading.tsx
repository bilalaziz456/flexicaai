import { PanelLoader } from "@/core/ui/panel-loader";

/**
 * Loading boundary for /clinic and its sub-routes (dashboard, staff, patients).
 * Shows the spinner in the content area while a route loads, so navigating
 * between pages never lingers on the previous screen. The PanelShell layout
 * (sidebar/header) persists around it.
 */
export default function ClinicLoading() {
  return <PanelLoader />;
}
