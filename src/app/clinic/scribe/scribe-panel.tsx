import { can } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { getClinic } from "@/core/clinics/get-clinic";
import { getDayQueue } from "@/core/appointments/queue";
import { listStrandedDrafts } from "@/core/clinical/drafts";
import { listOwnDrafts, listRecentVisits, listScribePatients } from "@/core/clinical/scribe";
import { listScribeRuns } from "@/core/ai/scribe-job";
import { ScribeRuns } from "@/app/clinic/scribe/scribe-runs";
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
  // Drafts nobody can reach any more (D-18). Only fetched for a holder of the
  // `handover` grant — for everyone else the list stays empty and the card never
  // renders, so the exception is invisible to clinics that haven't granted it.
  const canSeeStranded = canCreateClinical && can(user, "handover", "view");
  const canViewClinical = can(user, "clinical", "view");
  const canViewRx = can(user, "prescriptions", "view");
  const canSendRx = can(user, "prescriptions", "create");

  const clinicRow = await getClinic(clinicId);

  const [recentPatients, recentVisits, pendingDrafts, queue, strandedDrafts, scribeRuns] = await Promise.all([
    listScribePatients(clinicId),
    listRecentVisits(clinicId, user.id),
    listOwnDrafts(clinicId, user.id),
    getDayQueue(clinicId, new Date(), { doctorId: user.id }),
    canSeeStranded ? listStrandedDrafts(clinicId) : Promise.resolve([]),
    canCreateClinical ? listScribeRuns(clinicId, user.id) : Promise.resolve([]),
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

      <ScribeRuns runs={scribeRuns.map((r) => ({ id: r.id, status: r.status, error: r.error, patientName: r.patientName }))} />

      {canCreateClinical ? (
        <ScribeWorkspace
          initialPatients={recentPatients}
          pendingDrafts={pendingDrafts}
          strandedDrafts={strandedDrafts}
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
