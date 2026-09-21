import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** 2FA and session security. The PanelShell persists around it. */
export default function AdminSecurityLoading() {
  return <FormSkeleton {...{ fields: 4 }} />;
}
