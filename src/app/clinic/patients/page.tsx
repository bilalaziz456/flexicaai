import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { count, desc, ilike, or } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients } from "@/core/db/schema";
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
import { FlashToast } from "@/core/ui/toast";
import { RowLink } from "@/core/ui/row-link";
import { ageFromDob } from "@/core/lib/age";
import { PatientsSearch } from "./patients-search";

/** Clinic Admin: the patient list, with search + add. Mirrors the admin flow. */
export default async function ClinicPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    size?: string;
    created?: string;
    updated?: string;
    deleted?: string;
  }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const sp = await searchParams;
  const query = sp.q?.trim();
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.created
    ? "Patient added."
    : sp.updated
      ? "Patient updated."
      : sp.deleted
        ? "Patient deleted."
        : null;

  // Contains-search on name/phone (trigram-indexed); always clinic-scoped; capped.
  const search = query
    ? or(
        ilike(patients.fullName, `%${query}%`),
        ilike(patients.phone, `%${query}%`),
      )
    : undefined;

  const where = byClinic(patients.clinicId, clinicId, search);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: patients.id,
        fullName: patients.fullName,
        phone: patients.phone,
        gender: patients.gender,
        dateOfBirth: patients.dateOfBirth,
      })
      .from(patients)
      .where(where)
      .orderBy(desc(patients.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ total: count() }).from(patients).where(where),
  ]);

  return (
    <div className="space-y-6">
      <FlashToast message={toastMessage} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Patients</h1>
          <p className="text-sm text-muted-foreground">
            {total} patient{total === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}.
          </p>
        </div>
        {/* Desktop/tablet: inline button. Hidden on mobile (see FAB below). */}
        <Link
          href="/clinic/patients/new"
          className={cn(buttonVariants(), "hidden sm:inline-flex")}
        >
          Add patient
        </Link>
      </div>

      <PatientsSearch initial={query ?? ""} />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/clinic/patients"
        searchParams={sp}
        unit="patient"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query ? `No patients match “${query}”.` : "No patients yet."}
        </div>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <RowLink key={p.id} href={`/clinic/patients/${p.id}`} className="border-b">
                    <TableCell className="font-medium">{p.fullName}</TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.gender ?? "—"}</TableCell>
                    <TableCell>{ageFromDob(p.dateOfBirth) ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/clinic/patients/${p.id}`}
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

          {/* Mobile: stacked cards — no horizontal scroll. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((p) => (
              <RowLink
                key={p.id}
                as="li"
                href={`/clinic/patients/${p.id}`}
                className="block space-y-2 rounded-md border p-3"
              >
                <div className="font-medium">{p.fullName}</div>
                <div className="text-sm text-muted-foreground">
                  {p.phone ?? "No phone"}
                  {p.gender ? ` · ${p.gender}` : ""}
                  {ageFromDob(p.dateOfBirth) != null
                    ? ` · ${ageFromDob(p.dateOfBirth)} yrs`
                    : ""}
                </div>
                <Link
                  href={`/clinic/patients/${p.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Open
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </RowLink>
            ))}
          </ul>
        </>
      )}

      {/* Mobile: floating "+" to add a patient (replaces the header button). */}
      <Link
        href="/clinic/patients/new"
        aria-label="Add patient"
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
