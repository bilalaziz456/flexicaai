import { desc, eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients, visits } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ScribeWorkspace } from "./scribe-workspace";

/** Doctor home — voice scribe + recent notes, scoped to the doctor's clinic. */
export default async function DoctorHome() {
  const user = await requireRole("doctor");
  const clinicId = user.clinicId;

  if (!clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet. Ask your clinic admin.
      </p>
    );
  }

  const [recentPatients, recentVisits] = await Promise.all([
    db
      .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId))
      .orderBy(desc(patients.createdAt))
      .limit(20),
    db
      .select({
        id: visits.id,
        status: visits.status,
        visitDate: visits.visitDate,
        patientName: patients.fullName,
      })
      .from(visits)
      .innerJoin(patients, eq(visits.patientId, patients.id))
      .where(byClinic(visits.clinicId, clinicId))
      .orderBy(desc(visits.visitDate))
      .limit(10),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Voice scribe</h1>
        <p className="text-sm text-muted-foreground">
          Record a visit; review the AI draft, then approve to save.
        </p>
      </div>

      <ScribeWorkspace initialPatients={recentPatients} />

      <Card>
        <CardHeader>
          <CardTitle>Recent notes</CardTitle>
          <CardDescription>Your clinic&apos;s latest visits.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentVisits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visits yet.</p>
          ) : (
            <ul className="divide-y">
              {recentVisits.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {v.patientName}
                  </span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    {v.status === "approved" ? (
                      <a
                        href={`/api/prescriptions/${v.id}`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline underline-offset-4"
                      >
                        Prescription
                      </a>
                    ) : null}
                    <span className="hidden sm:inline">
                      {v.visitDate.toLocaleDateString()}
                    </span>
                    <Badge variant={v.status === "approved" ? "default" : "secondary"}>
                      {v.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
