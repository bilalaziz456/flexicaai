import { PanelLoader } from "@/core/ui/panel-loader";

/**
 * Loading boundary for /admin and its sub-routes (clinics list, clinic detail,
 * new clinic). Shows the spinner in the content area while a route loads, so
 * navigation never lingers on the previous screen. The AdminShell layout
 * (sidebar/header) persists around it.
 */
export default function AdminLoading() {
  return <PanelLoader />;
}
