import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { EditScheduleForm } from "./edit-schedule-form";

/** Clinic Admin: manage one doctor's schedule (working hours + daily limit). */
export default async function DoctorSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { id } = await params;

  const [doc] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      role: users.role,
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, id)))
    .limit(1);

  // Clinic-scoped + doctor-only: a non-doctor or foreign id is a 404.
  if (!doc || doc.role !== "doctor") notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clinic/staff"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to staff
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {doc.fullName ?? doc.username}
        </h1>
        <p className="text-sm text-muted-foreground">Doctor schedule</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Working hours &amp; capacity</CardTitle>
          <CardDescription>
            Set the days and hours this doctor works, and how many appointments
            they can take per day. Bookings outside these are blocked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditScheduleForm
            userId={doc.id}
            availability={doc.availability}
            dailyLimit={doc.dailyLimit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
