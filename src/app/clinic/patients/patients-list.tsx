import Link from "next/link";
import { CalendarPlus, ChevronRight, Download, Plus } from "lucide-react";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients } from "@/core/db/schema";
import { formatMrn, mrnDigits, mrnMatchesSql } from "@/core/patients/mrn";
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
  canBook = false,
  bookPath,
  listPath,
  detailBase,
  newHref,
  searchParams,
}: {
  clinicId: string;
  canCreate: boolean;
  /** Show a "Book" (create appointment) action per patient — needs
   *  `appointments:create` and the new-appointment page path (`bookPath`). */
  canBook?: boolean;
  bookPath?: string;
  listPath: string;
  detailBase: string;
  newHref: string;
  searchParams: PatientsListSearchParams;
}) {
  const showBook = canBook && Boolean(bookPath);
  const bookHref = (patientId: string) => `${bookPath}?patientId=${patientId}`;
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

  // Search matches name, phone, or MRN. For MRN we match the digits of the term
  // (so "MRN-42", "42" and "#42" all find patient 42) against `mrn::text`.
  let search;
  if (query) {
    const conds = [ilike(patients.fullName, `%${query}%`), ilike(patients.phone, `%${query}%`)];
    const digits = mrnDigits(query);
    // Match the MRN's digits (registration date + padded counter) so "42",
    // "0000042", or a pasted "KL-202607270000042" all resolve to the patient.
    if (digits) conds.push(mrnMatchesSql(digits));
    search = or(...conds);
  }

  const where = byClinic(
    patients.clinicId,
    clinicId,
    notDeleted(patients.deletedAt),
    search,
  );
  const [clinicRow, rows, [{ total }]] = await Promise.all([
    db.select({ mrnPrefix: clinics.mrnPrefix }).from(clinics).where(eq(clinics.id, clinicId)).limit(1),
    db
      .select({
        id: patients.id,
        mrn: patients.mrn,
        createdAt: patients.createdAt,
        fullName: patients.fullName,
        phone: patients.phone,
        gender: patients.gender,
        dateOfBirth: patients.dateOfBirth,
        reference: patients.reference,
      })
      .from(patients)
      .where(where)
      .orderBy(desc(patients.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ total: count() }).from(patients).where(where),
  ]);
  const mrnPrefix = clinicRow[0]?.mrnPrefix ?? "";

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
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <a
              href={`/api/patients/export${query ? `?q=${encodeURIComponent(query)}` : ""}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
          ) : null}
          {canCreate ? (
            <Link href={newHref} className={cn(buttonVariants(), "hidden sm:inline-flex")}>
              Add patient
            </Link>
          ) : null}
        </div>
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
                  <TableHead>MRN</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <RowLink key={p.id} href={`${detailBase}/${p.id}`} className="border-b">
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatMrn(mrnPrefix, p.mrn, p.createdAt) ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{p.fullName}</TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.gender ?? "—"}</TableCell>
                    <TableCell>{ageFromDob(p.dateOfBirth) ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {showBook ? (
                          <Link
                            href={bookHref(p.id)}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                          >
                            <CalendarPlus className="size-4" aria-hidden="true" />
                            Book
                          </Link>
                        ) : null}
                        <Link
                          href={`${detailBase}/${p.id}`}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          Open
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
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
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{p.fullName}</div>
                  {formatMrn(mrnPrefix, p.mrn, p.createdAt) ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatMrn(mrnPrefix, p.mrn, p.createdAt)}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  {p.phone ?? "No phone"}
                  {p.gender ? ` · ${p.gender}` : ""}
                  {ageFromDob(p.dateOfBirth) != null
                    ? ` · ${ageFromDob(p.dateOfBirth)} yrs`
                    : ""}
                </div>
                {p.reference ? (
                  <div className="text-sm text-muted-foreground">
                    Ref: {p.reference}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  {showBook ? (
                    <Link
                      href={bookHref(p.id)}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Book
                    </Link>
                  ) : null}
                  <Link
                    href={`${detailBase}/${p.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Open
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
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
