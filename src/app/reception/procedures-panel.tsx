import { desc } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { procedures } from "@/core/db/schema";
import { procedureTemplatesFor } from "@/config/modules";
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
  const list = await db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
      isActive: procedures.isActive,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId))
    .orderBy(desc(procedures.createdAt));

  const templatesAvailable = procedureTemplatesFor(modulesEnabled).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Procedures</h1>
        <p className="text-sm text-muted-foreground">
          Priced services patients can book — these feed appointment totals and
          the Sales report. {list.length} procedure{list.length === 1 ? "" : "s"}.
        </p>
      </div>
      <ProceduresManager procedures={list} templatesAvailable={templatesAvailable} />
    </div>
  );
}
