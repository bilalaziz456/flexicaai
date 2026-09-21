import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** One team member's record. The PanelShell persists around it. */
export default function AdminTeamMemberLoading() {
  return <FormSkeleton {...{ fields: 6 }} />;
}
