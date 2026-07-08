import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { and, desc, ilike, inArray, or } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { describeAvailability } from "@/core/lib/availability";
import { StaffSearch } from "./staff-search";

/** Clinic Admin: the staff list, with search + add. Mirrors the admin flow. */
export default async function ClinicStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { q } = await searchParams;
  const query = q?.trim();

  const roleFilter = inArray(users.role, ["doctor", "receptionist"]);
  const search = query
    ? or(
        ilike(users.fullName, `%${query}%`),
        ilike(users.username, `%${query}%`),
      )
    : undefined;

  const staff = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        search ? and(roleFilter, search) : roleFilter,
      ),
    )
    .orderBy(desc(users.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            {staff.length} staff member{staff.length === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}.
          </p>
        </div>
        {/* Desktop/tablet: inline button. Hidden on mobile (see FAB below). */}
        <Link
          href="/clinic/staff/new"
          className={cn(buttonVariants(), "hidden sm:inline-flex")}
        >
          Add staff
        </Link>
      </div>

      <StaffSearch initial={query ?? ""} />

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
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.fullName ?? "—"}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
          <ul className="space-y-3 md:hidden">
            {staff.map((u) => (
              <li key={u.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{u.fullName ?? "—"}</span>
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
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Mobile: floating "+" to add staff (replaces the header button). */}
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
    </div>
  );
}
