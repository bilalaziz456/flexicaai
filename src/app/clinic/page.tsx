import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients, users } from "@/core/db/schema";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/** Clinic Admin dashboard — quick counts + links, scoped to this clinic. */
export default async function ClinicDashboard() {
  const { clinicId } = await requireClinicAdmin();

  // Two small COUNTs, both index-backed by clinic_id (perf rule).
  const [[staff], [patientRows]] = await Promise.all([
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          inArray(users.role, ["doctor", "receptionist"]),
        ),
      ),
    db
      .select({ value: count() })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId)),
  ]);

  const cards = [
    {
      title: "Staff",
      count: staff.value,
      description: "Doctors & receptionists",
      href: "/clinic/staff",
    },
    {
      title: "Patients",
      count: patientRows.value,
      description: "Registered patients",
      href: "/clinic/patients",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Manage your clinic&apos;s staff and patients.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.title} href={c.href}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <CardDescription>{c.title}</CardDescription>
                <CardTitle className="text-3xl">{c.count}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
