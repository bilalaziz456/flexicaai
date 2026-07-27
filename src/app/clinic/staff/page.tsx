import Link from "next/link";
import { ChevronRight, Download, Plus } from "lucide-react";
import { and, count, desc, ilike, inArray, or } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { describeAvailability } from "@/core/lib/availability";
import { CLINIC_STAFF_ROLES, displayStaffName } from "@/core/types/auth";
import { FlashToast } from "@/core/ui/toast";
import { RowLink } from "@/core/ui/row-link";
import { StaffSearch } from "./staff-search";

/** Clinic Admin: the staff list, with search + add. Mirrors the admin flow. */
export default async function ClinicStaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    size?: string;
    created?: string;
    updated?: string;
  }>;
}) {
  const user = await requireWorkspace("staff");
  const { clinicId } = user;
  // Viewing staff needs `staff:view`; creating/managing stays clinic-admin-only.
  const canCreate = user.role === "clinic_admin";
  const sp = await searchParams;
  const query = sp.q?.trim();
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.created
    ? "Staff member added."
    : sp.updated
      ? "Staff member updated."
      : null;

  const roleFilter = inArray(users.role, [...CLINIC_STAFF_ROLES]);
  const search = query
    ? or(
        ilike(users.fullName, `%${query}%`),
        ilike(users.username, `%${query}%`),
      )
    : undefined;

  const where = byClinic(
    users.clinicId,
    clinicId,
    notDeleted(users.deletedAt),
    search ? and(roleFilter, search) : roleFilter,
  );
  const [staff, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        prefix: users.prefix,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        availability: users.availability,
        dailyLimit: users.dailyAppointmentLimit,
        fee: users.consultationFee,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return (
    <div className="space-y-6">
      <FlashToast message={toastMessage} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            {total} staff member{total === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <a
              href={`/api/staff/export${query ? `?q=${encodeURIComponent(query)}` : ""}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
          ) : null}
          {/* Desktop/tablet: inline button. Hidden on mobile (see FAB below). */}
          {canCreate ? (
            <Link
              href="/clinic/staff/new"
              className={cn(buttonVariants(), "hidden sm:inline-flex")}
            >
              Add staff
            </Link>
          ) : null}
        </div>
      </div>

      <StaffSearch initial={query ?? ""} />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/clinic/staff"
        searchParams={sp}
        unit="staff member"
      />

      {staff.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query
            ? `No staff match “${query}”.`
            : "No staff yet. Add your first doctor or receptionist."}
        </div>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((u) => (
                  <RowLink key={u.id} href={`/clinic/staff/${u.id}`} className="border-b">
                    <TableCell className="font-medium">
                      {displayStaffName(u.prefix, u.fullName, u.username)}
                    </TableCell>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        "Active"
                      ) : (
                        <span className="text-muted-foreground">Suspended</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/clinic/staff/${u.id}`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        Open
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </RowLink>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
          <ul className="space-y-3 md:hidden">
            {staff.map((u) => (
              <RowLink
                key={u.id}
                as="li"
                href={`/clinic/staff/${u.id}`}
                className="block space-y-2 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {displayStaffName(u.prefix, u.fullName, u.username)}
                  </span>
                  <Badge variant="secondary">{u.role}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  @{u.username} · {u.isActive ? "Active" : "Suspended"}
                </div>
                {u.role === "doctor" ? (
                  <div className="text-xs text-muted-foreground">
                    {describeAvailability(u.availability)} ·{" "}
                    {u.dailyLimit > 0 ? `${u.dailyLimit}/day` : "no daily limit"}
                    {u.fee > 0
                      ? ` · Rs ${new Intl.NumberFormat("en-PK").format(u.fee)}`
                      : ""}
                  </div>
                ) : null}
                <Link
                  href={`/clinic/staff/${u.id}`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                  )}
                >
                  Open
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </RowLink>
            ))}
          </ul>
        </>
      )}

      {/* Mobile: floating "+" to add staff (replaces the header button). */}
      {canCreate ? (
        <Link
          href="/clinic/staff/new"
          aria-label="Add staff"
          className={cn(
            buttonVariants({ size: "icon" }),
            "fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-lg sm:hidden",
          )}
        >
          <Plus className="size-6" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
