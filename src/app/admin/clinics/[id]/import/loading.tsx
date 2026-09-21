import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The CSV importer, which opens on its upload step. The PanelShell persists around it. */
export default function AdminClinicImportLoading() {
  return <FormSkeleton {...{ fields: 4 }} />;
}
