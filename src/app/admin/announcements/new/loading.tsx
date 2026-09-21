import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** Compose an announcement. The PanelShell persists around it. */
export default function AdminNewAnnouncementLoading() {
  return <FormSkeleton {...{ fields: 6 }} />;
}
