import { asc, eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { listClinicTrash, parseTrashFilters } from "@/core/trash";
import { restoreTrashItem } from "./actions";
import { TrashTable } from "./trash-table";
import { TrashFilters } from "./trash-filters";

const TYPE_OPTIONS = [
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
 * Clinic Trash — items this clinic deleted, within its retention window. Gated by
 * `trash:view`; Restore needs `trash:create`. Filterable by search / type / who
 * deleted it / deletion date. Items past the window drop off this view but stay in
 * the database (super-admin-visible).
 */
export default async function ClinicTrashPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    by?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requireWorkspace("trash");
  const sp = await searchParams;
  const { filters, ui } = parseTrashFilters(sp);

  const [clinic] = await db
    .select({ retention: clinics.trashRetentionDays })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const retention = clinic?.retention ?? 30;

  const [items, staff] = await Promise.all([
    listClinicTrash(user.clinicId, retention, filters),
    // "Deleted by" options — this clinic's staff (anyone who could have deleted).
    db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(byClinic(users.clinicId, user.clinicId, notDeleted(users.deletedAt)))
      .orderBy(asc(users.fullName)),
  ]);
  const actors = staff.map((s) => ({ id: s.id, name: s.fullName ?? s.username }));
  const canRestore = can(user, "trash", "create");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Deleted items are kept here for {retention} day{retention === 1 ? "" : "s"}.
          Restore brings an item, and anything deleted along with it, back.
        </p>
      </div>
      <TrashFilters
        q={ui.q}
        type={ui.type}
        by={ui.by}
        from={ui.from}
        to={ui.to}
        typeOptions={TYPE_OPTIONS}
        actors={actors}
      />
      <TrashTable items={items} canRestore={canRestore} onRestore={restoreTrashItem} />
    </div>
  );
}
