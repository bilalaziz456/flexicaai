import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ViewLogger } from "@/core/ui/view-logger";
import { ageFromDob } from "@/core/lib/age";
import { DeletePatientButton, EditPatientForm } from "./[id]/patient-admin";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

/**
 * Shared patient detail — used by the clinic-admin panel and any panel that
 * surfaces patients (e.g. a doctor granted `patients`). `backHref` is the list to
 * return to; `canEdit`/`canDelete` gate the edit form and delete (view-only shows
 * the details read-only).
 */
export async function PatientDetail({
  clinicId,
  patientId,
  backHref,
  canEdit,
  canDelete,
}: {
  clinicId: string;
  patientId: string;
  backHref: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [patient] = await db
    .select()
    .from(patients)
    .where(
      byClinic(
        patients.clinicId,
        clinicId,
        notDeleted(patients.deletedAt),
        eq(patients.id, patientId),
      ),
    )
    .limit(1);
  if (!patient) notFound();

  const appts = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      status: appointments.status,
      doctorName: users.fullName,
      doctorUsername: users.username,
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.patientId, patientId),
      ),
    )
    .orderBy(desc(appointments.scheduledAt))
    .limit(20);

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-6">
      <ViewLogger
        entity="patient"
        entityId={patient.id}
        summary={`Viewed patient ${patient.fullName}`}
      />
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to patients
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{patient.fullName}</h1>
        <p className="text-sm text-muted-foreground">{patient.phone ?? "No phone"}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {canEdit ? "Edit the patient's information." : "Patient information."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <EditPatientForm
              patient={{
                id: patient.id,
                fullName: patient.fullName,
                phone: patient.phone,
                email: patient.email,
                dateOfBirth: patient.dateOfBirth,
                gender: patient.gender,
                address: patient.address,
                dataConsent: patient.dataConsent,
              }}
            />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{patient.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{patient.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Age</dt>
                <dd>{ageFromDob(patient.dateOfBirth) ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Gender</dt>
                <dd className="capitalize">{patient.gender ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Address</dt>
                <dd>{patient.address ?? "—"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
          <CardDescription>
            {appts.length} appointment{appts.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments yet.</p>
          ) : (
            <ul className="space-y-2">
              {appts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <span>
                    {fmt(a.scheduledAt)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {a.doctorName ?? a.doctorUsername ?? "Any doctor"}
                    </span>
                  </span>
                  <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                    {a.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canDelete ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete this patient and all their appointments, visits and
              recalls. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeletePatientButton patientId={patient.id} name={patient.fullName} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
