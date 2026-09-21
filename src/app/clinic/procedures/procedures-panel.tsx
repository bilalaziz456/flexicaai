import { Download, LockKeyhole } from "lucide-react";
import { procedureTemplatesFor } from "@/config/modules";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { buttonVariants } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { cn } from "@/core/lib/utils";
import { ProceduresManager } from "@/app/clinic/procedures/procedures-manager";

/**
 * Shared procedure-catalog body for both /clinic/procedures and
 * /reception/procedures (clinic admin + receptionist both manage it). The route
 * guards access + the `sales` feature; this just fetches and renders.
 */
export async function ProceduresPanel({
  clinicId,
  modulesEnabled,
}: {
  clinicId: string;
  modulesEnabled: string[];
}) {
  const user = await getCurrentUser();
  const perms = {
    view: user ? can(user, "procedures", "view") : false,
    create: user ? can(user, "procedures", "create") : false,
    edit: user ? can(user, "procedures", "edit") : false,
    delete: user ? can(user, "procedures", "delete") : false,
  };
  if (!perms.view) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={LockKeyhole}
            title="You don't have access to procedures"
            description="Ask a clinic admin to grant you the procedures permission."
          />
        </CardContent>
      </Card>
    );
  }

  const list = await listProcedureCatalog(clinicId);

  const templatesAvailable = procedureTemplatesFor(modulesEnabled).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Procedures</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Priced services patients can book. These feed appointment totals and
            the Sales report. {list.length} procedure{list.length === 1 ? "" : "s"}.
          </p>
        </div>
        {list.length > 0 ? (
          <a
            href="/api/procedures/export"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Download className="size-4" aria-hidden="true" /> CSV
          </a>
        ) : null}
      </div>
      <ProceduresManager
        procedures={list}
        templatesAvailable={templatesAvailable}
        perms={{ create: perms.create, edit: perms.edit, delete: perms.delete }}
      />
    </div>
  );
}
