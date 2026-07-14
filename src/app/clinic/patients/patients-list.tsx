import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { count, desc, ilike, or } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
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

export type PatientsListSearchParams = {
  q?: string;
  page?: string;
  size?: string;
  created?: string;
  updated?: string;
  deleted?: string;
};

/**
 * The clinic's patient list — shared by the clinic-admin panel and any other
 * panel that surfaces patients (e.g. a doctor granted the `patients` permission).
 * Paths are parameterised; `canCreate` comes from the caller's permission check.
 */
export async function PatientsList({
  clinicId,
  canCreate,
  listPath,
  detailBase,
  newHref,
  searchParams,
}: {
  clinicId: string;
  canCreate: boolean;
  listPath: string;
  detailBase: string;
  newHref: string;
  searchParams: PatientsListSearchParams;
}) {
  const sp = searchParams;
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

  const search = query
    ? or(ilike(patients.fullName, `%${query}%`), ilike(patients.phone, `%${query}%`))
    : undefined;

  const where = byClinic(
    patients.clinicId,
    clinicId,
    notDeleted(patients.deletedAt),
    search,
  );
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
        {canCreate ? (
          <Link href={newHref} className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            Add patient
          </Link>
        ) : null}
      </div>

      <PatientsSearch initial={query ?? ""} />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={listPath}
        searchParams={sp}
        unit="patient"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query ? `No patients match “${query}”.` : "No patients yet."}
        </div>
      ) : (
        <>
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
                  <RowLink key={p.id} href={`${detailBase}/${p.id}`} className="border-b">
                    <TableCell className="font-medium">{p.fullName}</TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.gender ?? "—"}</TableCell>
                    <TableCell>{ageFromDob(p.dateOfBirth) ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`${detailBase}/${p.id}`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
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

          <ul className="space-y-3 md:hidden">
            {rows.map((p) => (
              <RowLink
                key={p.id}
                as="li"
                href={`${detailBase}/${p.id}`}
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
                  href={`${detailBase}/${p.id}`}
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

      {canCreate ? (
        <Link
          href={newHref}
          aria-label="Add patient"
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
