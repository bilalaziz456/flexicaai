import { desc, eq, or } from "drizzle-orm";
import { can } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients, visits } from "@/core/db/schema";
import { getDayQueue } from "@/core/appointments/queue";
import { DoctorQueue } from "@/app/clinic/scribe/doctor-queue";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ScribeWorkspace } from "@/app/clinic/scribe/scribe-workspace";
import { SendRxWhatsApp } from "@/app/clinic/scribe/send-rx-whatsapp";

/**
 * The voice-scribe workspace (record → AI draft → approve) + recent notes —
 * shared by the doctor panel and the unified clinic workspace. Gated by the
 * user's clinical / prescriptions permissions (server actions enforce the same).
 */
export async function ScribePanel({
  user,
  clinicId,
}: {
  user: CurrentUser;
  clinicId: string;
}) {
  const canCreateClinical = can(user, "clinical", "create");
  const canViewClinical = can(user, "clinical", "view");
  const canViewRx = can(user, "prescriptions", "view");
  const canSendRx = can(user, "prescriptions", "create");

  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const [recentPatients, recentVisits, pendingDrafts, queue] = await Promise.all([
    db
      .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)))
      .orderBy(desc(patients.createdAt))
      .limit(20),
    // Approved notes, plus your own drafts — the same rule the patient's clinical
    // history follows. An unapproved note is the author's until they sign it off.
    db
      .select({
        id: visits.id,
        status: visits.status,
        visitDate: visits.visitDate,
        patientName: patients.fullName,
      })
      .from(visits)
      .innerJoin(patients, eq(visits.patientId, patients.id))
      .where(
        byClinic(
          visits.clinicId,
          clinicId,
          notDeleted(visits.deletedAt),
          or(eq(visits.status, "approved"), eq(visits.doctorId, user.id)),
        ),
      )
      .orderBy(desc(visits.visitDate))
      .limit(10),
    // Drafts this doctor started and never approved. Oldest first: the one left
    // longest is the one most likely to be forgotten.
    db
      .select({
        id: visits.id,
        visitDate: visits.visitDate,
        patientName: patients.fullName,
      })
      .from(visits)
      .innerJoin(patients, eq(visits.patientId, patients.id))
      .where(
        byClinic(
          visits.clinicId,
          clinicId,
          notDeleted(visits.deletedAt),
          eq(visits.status, "draft"),
          eq(visits.doctorId, user.id),
        ),
      )
      .orderBy(visits.visitDate)
      .limit(20),
    getDayQueue(clinicId, new Date(), { doctorId: user.id }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Voice scribe</h1>
        <p className="text-sm text-muted-foreground">
          Record a visit, review the AI draft, then approve to save.
        </p>
      </div>

      <DoctorQueue sessions={queue} />

      {canCreateClinical ? (
        <ScribeWorkspace
          initialPatients={recentPatients}
          pendingDrafts={pendingDrafts}
          modulesEnabled={clinicRow?.modulesEnabled ?? []}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Voice scribe</CardTitle>
            <CardDescription>
              You don&apos;t have permission to create clinical notes. Ask your
              clinic admin if this is a mistake.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {canViewClinical ? (
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
                        <>
                          {canViewRx ? (
                            <a
                              href={`/api/prescriptions/${v.id}`}
                              target="_blank"
                              rel="noopener"
                              className="text-primary-text underline underline-offset-4"
                            >
                              Prescription
                            </a>
                          ) : null}
                          {canSendRx ? <SendRxWhatsApp visitId={v.id} /> : null}
                        </>
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
      ) : null}
    </div>
  );
}
