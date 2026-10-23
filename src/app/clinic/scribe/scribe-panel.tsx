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
import { Download, FileText, Printer, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { Pagination } from "@/core/ui/pagination";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { EmptyState } from "@/core/ui/empty-state";
import { cn } from "@/core/lib/utils";
import { SendRxWhatsApp } from "@/app/clinic/scribe/send-rx-whatsapp";

/**
 * The voice-scribe workspace (record → AI draft → approve) + recent notes —
 * shared by the doctor panel and the unified clinic workspace. Gated by the
 * user's clinical / prescriptions permissions (server actions enforce the same).
 */
export async function ScribePanel({
  user,
  clinicId,
  searchParams = {},
}: {
  user: CurrentUser;
  clinicId: string;
  /** `page` / `size` for Recent notes (20 / 50 / 100). */
  searchParams?: Record<string, string | undefined>;
}) {
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.size);
  const canCreateClinical = can(user, "clinical", "create");
  // Drafts nobody can reach any more (D-18). Only fetched for a holder of the
  // `handover` grant — for everyone else the list stays empty and the card never
  // renders, so the exception is invisible to clinics that haven't granted it.
  const canSeeStranded = canCreateClinical && can(user, "handover", "view");
  const canViewClinical = can(user, "clinical", "view");
  const canViewRx = can(user, "prescriptions", "view");
  const canSendRx = can(user, "prescriptions", "create");

  const clinicRow = await getClinic(clinicId);

  const [recentPatients, recentPage, pendingDrafts, queue, strandedDrafts, scribeRuns] = await Promise.all([
    listScribePatients(clinicId),
    listRecentVisits(clinicId, user.id, { limit: pageSize, offset: pageOffset(page, pageSize) }),
    listOwnDrafts(clinicId, user.id),
    getDayQueue(clinicId, new Date(), { doctorId: user.id }),
    canSeeStranded ? listStrandedDrafts(clinicId) : Promise.resolve([]),
    canCreateClinical ? listScribeRuns(clinicId, user.id) : Promise.resolve([]),
  ]);

  const recentVisits = recentPage.rows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Voice scribe</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
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
          <CardContent className="space-y-3">
            {/* Above the list, like every paged list here (owner's call, 2026-10-20). */}
            <Pagination
              page={page}
              pageSize={pageSize}
              total={recentPage.total}
              basePath="/clinic/scribe"
              searchParams={searchParams}
              unit="note"
            />
            {recentVisits.length === 0 ? (
              <EmptyState
                compact
                icon={Stethoscope}
                title="No visits yet"
                description="Approved notes appear here, newest first, with a prescription to reprint."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {recentVisits.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {v.patientName}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-1.5 text-muted-foreground">
                      {v.status === "approved" ? (
                        <>
                          {/* The same three as a prescription on the patient's page
                              (owner's call, 2026-10-24) — and they print the prescription
                              as last edited, not the note (buildVisitPrescriptionPdf). */}
                          {canViewRx ? (
                            <>
                              <a
                                href={`/api/prescriptions/${v.id}`}
                                target="_blank"
                                rel="noopener"
                                title="For plain white paper: the clinic letterhead is printed with the prescription"
                                className={cn(buttonVariants({ size: "sm" }))}
                              >
                                <FileText className="size-3.5" aria-hidden="true" /> Print with letterhead
                              </a>
                              <a
                                href={`/api/prescriptions/${v.id}?pad=1`}
                                target="_blank"
                                rel="noopener"
                                title="For paper that already has your letterhead printed on it: only the prescription is printed, in the right place"
                                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                              >
                                <Printer className="size-3.5" aria-hidden="true" /> Print without letterhead
                              </a>
                              <a
                                href={`/api/prescriptions/${v.id}?download=1`}
                                title="Save the PDF with the letterhead, e.g. to send on WhatsApp"
                                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                              >
                                <Download className="size-3.5" aria-hidden="true" /> Download
                              </a>
                            </>
                          ) : null}
                          {canSendRx ? <SendRxWhatsApp visitId={v.id} /> : null}
                        </>
                      ) : null}
                      {/* Fixed width and tabular figures: the date is the only
                          variable-width cell between the buttons and the badge, so
                          without this "8/29/2026" and "9/8/2026" shunted the action
                          buttons to two different x-positions down the list. */}
                      <span className="hidden w-[5.5rem] shrink-0 text-right tabular-nums sm:inline">
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
