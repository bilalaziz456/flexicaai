import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** The announcements list. The PanelShell persists around it. */
export default function AdminAnnouncementsLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
