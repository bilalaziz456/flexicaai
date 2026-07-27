import { desc } from "drizzle-orm";
import { Download } from "lucide-react";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { procedures } from "@/core/db/schema";
import { procedureTemplatesFor } from "@/config/modules";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { ProceduresManager } from "./procedures-manager";

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
      <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
        You don&apos;t have permission to view procedures.
      </div>
    );
  }

  const list = await db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
      isActive: procedures.isActive,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)))
    .orderBy(desc(procedures.createdAt));

  const templatesAvailable = procedureTemplatesFor(modulesEnabled).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Procedures</h1>
          <p className="text-sm text-muted-foreground">
            Priced services patients can book — these feed appointment totals and
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
