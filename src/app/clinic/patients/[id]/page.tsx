import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  DeletePatientButton,
  EditPatientForm,
} from "./patient-admin";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

/** Clinic Admin: open a patient — edit details, see their appointments, delete. */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { id } = await params;

  const [patient] = await db
    .select()
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, eq(patients.id, id)))
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
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.patientId, id)))
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
      <div>
        <Link
          href="/clinic/patients"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to patients
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{patient.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {patient.phone ?? "No phone"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Edit the patient&apos;s information.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
          <CardDescription>
            {appts.length} appointment{appts.length === 1 ? "" : "s"}. Manage them
            from the Appointments page.
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
    </div>
  );
}
