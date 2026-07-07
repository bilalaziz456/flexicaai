import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
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
import { NewAppointmentForm } from "../new-appointment-form";

/** Receptionist: schedule a new appointment. */
export default async function NewAppointmentPage() {
  const user = await requireRole("receptionist");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }

  const [recentPatients, doctors] = await Promise.all([
    db
      .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(byClinic(patients.clinicId, user.clinicId))
      .orderBy(desc(patients.createdAt))
      .limit(20),
    db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(byClinic(users.clinicId, user.clinicId, inArray(users.role, ["doctor"])))
      .orderBy(desc(users.createdAt)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reception"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointments
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New appointment</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Pick a patient and a date & time.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm initialPatients={recentPatients} doctors={doctors} />
        </CardContent>
      </Card>
    </div>
  );
}
