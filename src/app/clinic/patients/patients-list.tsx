import { TableCard } from "@/core/ui/table-card";
import { listClinicPatients } from "@/core/patients/list";
import Link from "next/link";
import { CalendarPlus, ChevronRight, Download, Plus, Users } from "lucide-react";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
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
import { LiveSearchInput } from "@/core/ui/live-search-input";
import { Badge } from "@/core/ui/badge";
import { formatPkr } from "@/core/appointments/fee";

export type PatientsListSearchParams = {
  q?: string;
  page?: string;
  size?: string;
  created?: string;
  updated?: string;
  deleted?: string;
  /** "1" = only patients who owe money. */
  owes?: string;
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
  showOwed = false,
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
  /** Highlight who owes money and offer the "Owes money" filter — for someone who
   *  may see Receivables, in a clinic with billing on. */
  showOwed?: boolean;
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

  // Search (name / phone / MRN) and paging live in core, shared with the CSV export
  // so the download can never return a different set from the list (ADR-014).
  const owesOnly = showOwed && sp.owes === "1";
  const { rows, total, owing } = await listClinicPatients(
    clinicId,
    query ?? "",
    { offset: pageOffset(page, pageSize), limit: pageSize },
    { withOwed: showOwed, owesOnly },
  );
  // The filter links keep the search and the page size; the page goes back to 1.
  const filterHref = (owes: boolean) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (sp.size) p.set("size", sp.size);
    if (owes) p.set("owes", "1");
    const s = p.toString();
    return s ? `${listPath}?${s}` : listPath;
  };
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (owesOnly) exportParams.set("owes", "1");
  const exportQs = exportParams.toString();

  return (
    <div className="space-y-6">
      <FlashToast message={toastMessage} />
      <PageHeader
        title="Patients"
        description={
          <>
            {owesOnly && owing
              ? `${owing.count} patient${owing.count === 1 ? "" : "s"} owe${owing.count === 1 ? "s" : ""} ${formatPkr(owing.amount)}`
              : `${total} patient${total === 1 ? "" : "s"}`}
            {query ? ` matching “${query}”` : ""}.
          </>
        }
        actions={
          <>
          {total > 0 ? (
            <a
              href={`/api/patients/export${exportQs ? `?${exportQs}` : ""}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
          ) : null}
          {canCreate ? (
            <Link href={newHref} data-shortcut="create" aria-keyshortcuts="Alt+C" title="Add patient (Alt+C)" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
              Add patient
            </Link>
          ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <LiveSearchInput
          initial={query ?? ""}
          placeholder="Search name, phone or MRN…"
          ariaLabel="Search patients"
          className="relative w-full max-w-xs"
        />
        {showOwed ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            <Link
              href={filterHref(false)}
              aria-current={!owesOnly ? "page" : undefined}
              className={cn(buttonVariants({ variant: owesOnly ? "outline" : "default", size: "sm" }))}
            >
              All patients
            </Link>
            <Link
              href={filterHref(true)}
              aria-current={owesOnly ? "page" : undefined}
              className={cn(buttonVariants({ variant: owesOnly ? "default" : "outline", size: "sm" }))}
            >
              Owes money{owing ? ` (${owing.count})` : ""}
            </Link>
          </div>
        ) : null}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={listPath}
        searchParams={sp}
        unit="patient"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={owesOnly ? "Nobody owes money" : query ? "No matching patients" : "No patients yet"}
          description={
            owesOnly
              ? query
                ? `No patient matching “${query}” has money outstanding.`
                : "Every patient's visits are paid up."
              : query
              ? `Nothing matches “${query}”. Try a name, a phone number or an MRN.`
              : "Patients you register appear here, newest first."
          }
        />
      ) : (
        <TableCard>
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
                  <RowLink
                    key={p.id}
                    href={`${detailBase}/${p.id}`}
                    className={cn("border-b", (p.owed ?? 0) > 0 && "bg-destructive/5 hover:bg-destructive/10")}
                  >
                    <TableCell className="tabular-nums text-muted-foreground">
                      {p.mrnLabel ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.fullName}
                        <OwedBadge owed={p.owed} />
                      </div>
                    </TableCell>
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

          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 md:hidden">
            {rows.map((p) => (
              <RowLink
                key={p.id}
                as="li"
                href={`${detailBase}/${p.id}`}
                className={cn("block space-y-2 p-3", (p.owed ?? 0) > 0 && "bg-destructive/5")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {p.fullName}
                    <OwedBadge owed={p.owed} />
                  </div>
                  {p.mrnLabel ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.mrnLabel}
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
        </TableCard>
      )}

      {canCreate ? (
        <Link
          href={newHref}
          aria-label="Add patient"
          aria-keyshortcuts="Alt+C"
          data-shortcut="create"
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

/** "Owes Rs 2,000" beside a patient who owes; nothing for one who does not. */
function OwedBadge({ owed }: { owed?: number }) {
  if (!owed || owed <= 0) return null;
  return <Badge variant="destructive">Owes {formatPkr(owed)}</Badge>;
}
