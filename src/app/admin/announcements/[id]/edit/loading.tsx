import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** Edit an announcement. The PanelShell persists around it. */
export default function AdminEditAnnouncementLoading() {
  return <FormSkeleton {...{ fields: 6 }} />;
}
