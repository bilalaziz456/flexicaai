import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import {
  countMasterMedicines,
  listMasterMedicines,
  listMedicinesAddedByClinics,
} from "@/core/clinical/medicines";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { MedicineManager } from "@/core/ui/medicine-manager";
import { PageHeader } from "@/core/ui/page-header";
import { TableCard } from "@/core/ui/table-card";
import { Input } from "@/core/ui/input";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import { retireMasterMedicine, restoreMasterMedicine, saveMasterMedicine } from "./actions";
import { ClinicAddedTable } from "./clinic-added-table";

type View = "list" | "retired" | "clinics";

/**
 * The MASTER medicine list (owner's call, 2026-10-19). Everything here is suggested
 * on every clinic's prescription and medical-history medicine lines; a clinic of a
 * tagged specialty sees it first. Retired medicines stop being suggested but stay,
 * because old prescriptions name them. "Added by clinics" shows what clinics typed
 * into their own lists, so a useful one can be copied in here.
 */
export default async function AdminMedicinesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; size?: string }>;
}) {
  const user = await requireAdminCapability("medicines:view");
  const sp = await searchParams;
  const view: View = sp.view === "retired" || sp.view === "clinics" ? sp.view : "list";
  const q = sp.q?.trim() ?? "";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const paging = { q, limit: pageSize, offset: pageOffset(page, pageSize) };
  const can = {
    create: canAdmin(user, "medicines:create"),
    edit: canAdmin(user, "medicines:edit"),
    remove: canAdmin(user, "medicines:delete"),
  };

  const empty = { rows: [], total: 0 };
  const [counts, master, added] = await Promise.all([
    countMasterMedicines(),
    view === "clinics" ? Promise.resolve(empty) : listMasterMedicines({ ...paging, retired: view === "retired" }),
    view === "clinics" ? listMedicinesAddedByClinics(paging) : Promise.resolve(empty),
  ]);
  const total = view === "clinics" ? added.total : master.total;
  const specialtyOptions = SPECIALTY_CATALOG.map((s) => ({ value: s.id, label: s.name }));

  const tab = (v: View, label: string) => (
    <Link
      href={v === "list" ? "/admin/medicines" : `/admin/medicines?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={cn(buttonVariants({ variant: view === v ? "default" : "outline", size: "sm" }))}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicines"
        description="The medicine list every clinic's prescriptions and medical history suggest from. Picking one fills in the medicine's name; clinics can still type any medicine."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tab("list", `List (${counts.active})`)}
          {tab("retired", `Retired (${counts.retired})`)}
          {tab("clinics", "Added by clinics")}
        </div>
        <form method="get" className="relative w-full sm:w-72">
          {view !== "list" ? <input type="hidden" name="view" value={view} /> : null}
          {sp.size ? <input type="hidden" name="size" value={sp.size} /> : null}
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={view === "clinics" ? "Search medicine or clinic" : "Search name or brand"}
            aria-label="Search medicines"
            className="pl-8"
          />
        </form>
      </div>

      {/* Above the list (owner's call, 2026-10-20): the count and the page size are
          read before the rows, not after scrolling past them. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/medicines"
        searchParams={sp}
        unit="medicine"
      />
      <TableCard>
        {view === "clinics" ? (
          <ClinicAddedTable rows={added.rows} canAdd={can.create} />
        ) : (
          <MedicineManager
            rows={master.rows}
            can={can}
            saveAction={saveMasterMedicine}
            removeAction={retireMasterMedicine}
            restoreAction={restoreMasterMedicine}
            removeLabel="Retire"
            specialtyOptions={specialtyOptions}
            retiredView={view === "retired"}
            empty={
              view === "retired"
                ? { title: "No retired medicines", description: "A medicine you retire shows here, and can be brought back." }
                : q
                  ? { title: "No medicine matches", description: `Nothing on the list matches "${q}".` }
                  : { title: "No medicines yet", description: "Add the medicines clinics prescribe; they are suggested on every prescription." }
            }
          />
        )}
      </TableCard>
    </div>
  );
}
