import { Search } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { listClinicMedicinesPage, listMasterMedicines } from "@/core/clinical/medicines";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { MedicineManager } from "@/core/ui/medicine-manager";
import { PageHeader } from "@/core/ui/page-header";
import { Pagination } from "@/core/ui/pagination";
import { TableCard } from "@/core/ui/table-card";
import { Input } from "@/core/ui/input";
import { removeClinicMedicine, saveClinicMedicine } from "./actions";

/**
 * The clinic's OWN medicines (owner's call, 2026-10-19): brands the master list does
 * not have, suggested on this clinic's prescriptions and medical history only. They
 * never reach the master list or another clinic by themselves. Below them, read-only,
 * the master list — what is suggested already, so nobody adds it twice.
 *
 * Two lists, so two pagers with their own URL keys (`page`/`size` for the clinic's,
 * `mPage`/`mSize` for the master list); one search narrows both.
 */
export default async function ClinicMedicinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; size?: string; mPage?: string; mSize?: string }>;
}) {
  const user = await requireWorkspace("medicines");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = parsePage(sp.page);
  const size = parsePageSize(sp.size);
  const mPage = parsePage(sp.mPage);
  const mSize = parsePageSize(sp.mSize);

  const [own, master] = await Promise.all([
    listClinicMedicinesPage(user.clinicId, { q, limit: size, offset: pageOffset(page, size) }),
    listMasterMedicines({ q, limit: mSize, offset: pageOffset(mPage, mSize) }),
  ]);
  const perms = {
    create: can(user, "medicines", "create"),
    edit: can(user, "medicines", "edit"),
    remove: can(user, "medicines", "delete"),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicines"
        description="Medicines your prescriptions and medical history suggest. Add a brand the list below doesn't have; it is kept for your clinic only."
        actions={
          <form method="get" className="relative w-full sm:w-72">
            {sp.size ? <input type="hidden" name="size" value={sp.size} /> : null}
            {sp.mSize ? <input type="hidden" name="mSize" value={sp.mSize} /> : null}
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input name="q" defaultValue={q} placeholder="Search name or brand" aria-label="Search medicines" className="pl-8" />
          </form>
        }
      />

      {/* Each pager sits ABOVE its list (owner's call, 2026-10-20). */}
      <div className="space-y-3">
        <Pagination page={page} pageSize={size} total={own.total} basePath="/clinic/medicines" searchParams={sp} unit="medicine" />
        <TableCard title={`Your clinic's medicines (${own.total})`}>
          <MedicineManager
            rows={own.rows}
            can={perms}
            saveAction={saveClinicMedicine}
            removeAction={removeClinicMedicine}
            removeLabel="Delete"
            empty={
              q
                ? { title: "No match", description: `None of your clinic's medicines match "${q}".` }
                : {
                    title: "None added yet",
                    description: "The medicine list below is suggested already. Add a medicine here only if it is missing.",
                  }
            }
          />
        </TableCard>
      </div>

      <div className="space-y-3">
        <Pagination
          page={mPage}
          pageSize={mSize}
          total={master.total}
          basePath="/clinic/medicines"
          searchParams={sp}
          unit="medicine"
          pageParam="mPage"
          sizeParam="mSize"
        />
        <TableCard title={`Medicine list (${master.total})`}>
          <MedicineManager
            rows={master.rows}
            can={{ create: false, edit: false, remove: false }}
            saveAction={saveClinicMedicine}
            removeAction={removeClinicMedicine}
            removeLabel="Delete"
            showAddedBy={false}
            empty={
              q
                ? { title: "No match", description: `Nothing on the medicine list matches "${q}".` }
                : { title: "The medicine list is empty", description: "Your account manager adds medicines to it." }
            }
          />
        </TableCard>
      </div>
    </div>
  );
}
