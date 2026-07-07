import { desc, ilike, or } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients } from "@/core/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { AddPatientForm } from "./add-patient-form";
import { PatientsSearch } from "./patients-search";

/** Clinic Admin: register and search this clinic's patients. */
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
      <div>
        <h1 className="text-xl font-semibold">Patients</h1>
        <p className="text-sm text-muted-foreground">
          Register patients and search by name or phone.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add patient</CardTitle>
          <CardDescription>Only the name is required.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddPatientForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Patient list</CardTitle>
          <CardDescription>
            {rows.length} patient{rows.length === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PatientsSearch initial={query ?? ""} />
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? `No patients match “${query}”.` : "No patients yet."}
            </p>
          ) : (
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
                    <TableCell className="capitalize">
                      {p.gender ?? "—"}
                    </TableCell>
                    <TableCell>{p.dateOfBirth ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
