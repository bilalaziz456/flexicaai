import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { Breadcrumbs } from "@/core/ui/breadcrumbs";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { listBatches } from "@/core/admin/import";
import { ImportUI } from "./import-ui";

/** Super Admin: import a clinic's existing data (patients / procedures). Gated by
 *  the `import:create` capability. See docs/import-plan.md. */
export default async function ClinicImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = await requireAdminCapability("import:create");

  const clinic = await getClinic(id);
  if (!clinic) notFound();
  // Same visibility scope as the clinic detail page.
  if (!canManageTeam(admin) && clinic.assignedTo !== admin.id) notFound();

  const batches = await listBatches(clinic.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Clinics", href: "/admin" },
            { label: clinic.name, href: `/admin/clinics/${clinic.id}` },
            { label: "Import data" },
          ]}
        />
        <h1 className="mt-2 text-xl font-semibold">Import data</h1>
        <p className="text-sm text-muted-foreground">
          Bring {clinic.name}&apos;s existing records into FlexicaAI. Download a template,
          fill it, upload, preview, then import. Nothing is written until you confirm,
          and every import can be undone.
        </p>
      </div>

      <ImportUI
        clinicId={clinic.id}
        batches={batches.map((b) => ({
          id: b.id,
          entity: b.entity,
          filename: b.filename,
          counts: b.counts,
          status: b.status,
          createdByName: b.createdByName,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
