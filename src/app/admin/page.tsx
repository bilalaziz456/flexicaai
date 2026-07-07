import Link from "next/link";
import { desc, ilike } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { buttonVariants } from "@/core/ui/button";
import { Badge } from "@/core/ui/badge";
import { ClinicsSearch } from "./clinics-search";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

const SPECIALTY_NAME = new Map(SPECIALTY_CATALOG.map((s) => [s.id, s.name]));

/** Super Admin home — all clinics on the platform, with name search. */
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim();

  const allClinics = await db
    .select()
    .from(clinics)
    .where(query ? ilike(clinics.name, `%${query}%`) : undefined)
    .orderBy(desc(clinics.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Clinics</h1>
          <p className="text-sm text-muted-foreground">
            {allClinics.length} clinic{allClinics.length === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : " on the platform"}.
          </p>
        </div>
        <Link href="/admin/clinics/new" className={buttonVariants()}>
          New clinic
        </Link>
      </div>

      <ClinicsSearch initial={query ?? ""} />

      {allClinics.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query
            ? `No clinics match “${query}”.`
            : "No clinics yet. Create the first one to enable its specialties and add its admin."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clinic</TableHead>
              <TableHead>Specialties</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allClinics.map((clinic) => (
              <TableRow key={clinic.id}>
                <TableCell className="font-medium">{clinic.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {clinic.modulesEnabled.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      clinic.modulesEnabled.map((id) => (
                        <Badge key={id} variant="secondary">
                          {SPECIALTY_NAME.get(id) ?? id}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {clinic.createdAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/clinics/${clinic.id}`}
                    className="underline underline-offset-4"
                  >
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
