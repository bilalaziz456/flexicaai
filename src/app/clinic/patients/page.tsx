import Link from "next/link";
import { Plus } from "lucide-react";
import { desc, ilike, or } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients } from "@/core/db/schema";
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
import { PatientsSearch } from "./patients-search";

/** Clinic Admin: the patient list, with search + add. Mirrors the admin flow. */
export default async function ClinicPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { q } = await searchParams;
  const query = q?.trim();

  // Contains-search on name/phone (trigram-indexed); always clinic-scoped; capped.
  const search = query
    ? or(
        ilike(patients.fullName, `%${query}%`),
        ilike(patients.phone, `%${query}%`),
      )
    : undefined;

  const rows = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      gender: patients.gender,
      dateOfBirth: patients.dateOfBirth,
    })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, search))
    .orderBy(desc(patients.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Patients</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} patient{rows.length === 1 ? "" : "s"}
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
                  <TableHead>Date of birth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.fullName}</TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.gender ?? "—"}</TableCell>
                    <TableCell>{p.dateOfBirth ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((p) => (
              <li key={p.id} className="space-y-1 rounded-md border p-3">
                <div className="font-medium">{p.fullName}</div>
                <div className="text-sm text-muted-foreground">
                  {p.phone ?? "No phone"}
                  {p.gender ? ` · ${p.gender}` : ""}
                  {p.dateOfBirth ? ` · ${p.dateOfBirth}` : ""}
                </div>
              </li>
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
