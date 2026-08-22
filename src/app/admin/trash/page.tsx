import { asc } from "drizzle-orm";
import { requireAdminCapability } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { listAllTrash, parseTrashFilters } from "@/core/trash";
import { Pagination } from "@/core/ui/pagination";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { TrashTable } from "@/core/ui/trash-table";
import { TrashFilters } from "@/core/ui/trash-filters";
import { restoreTrashGlobal, purgeTrashGlobal } from "./actions";
import { allModuleTrashRows } from "@/config/module-trash";

const TYPE_OPTIONS = [
  { value: "clinic", label: "Clinic" },
  { value: "patient", label: "Patient" },
  { value: "appointment", label: "Appointment" },
  { value: "visit", label: "Clinical note" },
  { value: "recall", label: "Recall" },
  { value: "procedure", label: "Procedure" },
  { value: "expense", label: "Expense" },
  { value: "leave", label: "Doctor leave" },
  { value: "staff", label: "Staff" },
];

/**
 * Super-admin Trash — every trashed item across ALL clinics, no retention limit
 * (incl. past-window items and whole trashed clinics). Restore anything, or
 * permanently Purge for a legal-erasure request (step-up password). Filterable by
 * search / clinic / type / who deleted it / deletion date; the "Deleted by" list
 * is the selected clinic's staff.
 */
export default async function AdminTrashPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    by?: string;
    from?: string;
    to?: string;
    clinic?: string;
    page?: string;
    size?: string;
  }>;
}) {
  await requireAdminCapability("clinics:edit");
  const sp = await searchParams;
  const { filters, ui } = parseTrashFilters(sp);

  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const paging = { offset: pageOffset(page, pageSize), limit: pageSize };

  const [trash, clinicRows, staff] = await Promise.all([
    allModuleTrashRows(filters.clinicId).then((rows) => listAllTrash(filters, rows, paging)),
    db.select({ id: clinics.id, name: clinics.name }).from(clinics).orderBy(asc(clinics.name)),
    // Actor options depend on the chosen clinic (like the activity-log filter).
    filters.clinicId
      ? db
          .select({ id: users.id, fullName: users.fullName, username: users.username })
          .from(users)
          .where(byClinic(users.clinicId, filters.clinicId, notDeleted(users.deletedAt)))
          .orderBy(asc(users.fullName))
      : Promise.resolve([] as { id: string; fullName: string | null; username: string }[]),
  ]);
  const actors = staff.map((s) => ({ id: s.id, name: s.fullName ?? s.username }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Everything deleted across all clinics. Kept indefinitely. Restore brings
          an item back; Purge permanently erases it (legal requests only).
        </p>
      </div>
      <TrashFilters
        q={ui.q}
        type={ui.type}
        by={ui.by}
        from={ui.from}
        to={ui.to}
        clinic={ui.clinic}
        typeOptions={TYPE_OPTIONS}
        actors={actors}
        clinics={clinicRows}
      />
      <TrashTable
        items={trash.items}
        canRestore
        showClinic
        onRestore={restoreTrashGlobal}
        onPurge={purgeTrashGlobal}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={trash.total}
        basePath="/admin/trash"
        searchParams={sp}
        unit="item"
      />
    </div>
  );
}
