import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients, users } from "@/core/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
// Same schedule form as reception; createAppointment routes back to /clinic for
// this role.
import { NewAppointmentForm } from "@/app/reception/new-appointment-form";

/** Clinic Admin: schedule a new appointment (shared form with reception). */
export default async function ClinicNewAppointmentPage() {
  const { clinicId } = await requireClinicAdmin();

  const [recentPatients, doctors] = await Promise.all([
    db
      .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId))
      .orderBy(desc(patients.createdAt))
      .limit(20),
    db
      .select({ id: users.id, fullName: users.fullName, username: users.username, flexibleHours: users.flexibleHours, consultationFee: users.consultationFee })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, inArray(users.role, ["doctor"])))
      .orderBy(desc(users.createdAt)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clinic/appointments"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointments
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New appointment</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Pick a patient and a date &amp; time.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm initialPatients={recentPatients} doctors={doctors} />
        </CardContent>
      </Card>
    </div>
  );
}
