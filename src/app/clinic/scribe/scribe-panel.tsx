import { can } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { getClinic } from "@/core/clinics/get-clinic";
import { getPatient } from "@/core/patients/manage";
import { clinicalRecordFor } from "@/config/modules";
import { clinicHasFeature } from "@/core/lib/features";
import { getDayQueue } from "@/core/appointments/queue";
import { listStrandedDrafts } from "@/core/clinical/drafts";
import { listOwnDrafts, listRecentVisits } from "@/core/clinical/scribe";
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
import Link from "next/link";
import { displayStaffName } from "@/core/types/auth";
import { localDateStr } from "@/core/appointments/availability";
import { appointmentDoctorFilter, appointmentDoctorScope } from "@/core/appointments/scope";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { getAppointmentForNote, listNotesAppointments } from "@/core/clinical/notes-appointments";
import { isNoteFilter, resolveNotesWindow } from "@/core/clinical/notes-period";
import { listNotesAwaitingDoctor, listNotesReturnedToAuthor } from "@/core/clinical/note-approval";
import { loadNoteToReview } from "@/app/clinic/scribe/actions";
import { NoteReview } from "@/app/clinic/scribe/note-review";
import { NotesAppointments } from "@/app/clinic/scribe/notes-appointments";

const NOTE_STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  draft: "Draft",
  transcribing: "Writing…",
  failed: "Failed",
  pending_approval: "Waiting for approval",
  returned: "Sent back",
};

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
  /** `page` / `size` for Recent notes (20 / 50 / 100); `patient` + `write=1` open a
   *  typed note for that patient (the patient page's "Write note"). */
  searchParams?: Record<string, string | undefined>;
}) {
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.size);
  const clinicRow = await getClinic(clinicId);
  // The clinic's voice scribe (a feature the super admin / account manager switches)
  // AND the person's own permission to dictate. Off, the page keeps the queue and the
  // recent notes; the recorder, the drafts and the runs wait until it is back on.
  const scribeOn = clinicHasFeature(clinicRow?.featuresEnabled, "voice_scribe");
  // Two grants the clinic admin gives separately (2026-11-14): RECORD with the voice
  // scribe, and WRITE a note by hand. A person may hold either, both or neither.
  const canRecord = scribeOn && can(user, "scribe", "create");
  const canType = can(user, "clinical", "create");
  // Drafts nobody can reach any more (D-18). Only fetched for a holder of the
  // `handover` grant — for everyone else the list stays empty and the card never
  // renders, so the exception is invisible to clinics that haven't granted it.
  const canSeeStranded = canRecord && can(user, "handover", "view");
  const canViewClinical = can(user, "clinical", "view");
  const canViewRx = can(user, "prescriptions", "view");
  const canSendRx = can(user, "prescriptions", "create");

  // "Write note" on a patient's page lands here with that patient already chosen.
  const writeFor = canType && searchParams.write === "1" && searchParams.patient ? searchParams.patient : null;
  const canWrite = canRecord || canType;

  // A note waiting for you, or one sent back to you, opened from its list or the bell.
  const review = searchParams.review && canWrite ? await loadNoteToReview(searchParams.review) : null;

  // A row of the appointments list: write the note for THAT appointment. A doctor may
  // open only their own; a cancelled or no-show visit has no note to write.
  const apptRow = searchParams.appointment && canWrite ? await getAppointmentForNote(clinicId, searchParams.appointment) : null;
  const ownScope = appointmentDoctorScope(user);
  const forAppointment =
    apptRow && (!ownScope || apptRow.doctorId === ownScope)
      ? {
          id: apptRow.id,
          label: `${apptRow.queueNumber ? `#${apptRow.queueNumber}, ` : ""}${apptRow.scheduledAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
          doctorName: apptRow.doctorId ? displayStaffName(apptRow.doctorPrefix, apptRow.doctorName, apptRow.doctorUsername ?? "") : null,
        }
      : null;

  // The appointments list: everyone who may read notes; a doctor sees their own.
  const today = localDateStr(new Date());
  const win = resolveNotesWindow(searchParams, today);
  const doctorFilter = appointmentDoctorFilter(user, searchParams.doctor ?? "");
  const noteFilter = isNoteFilter(searchParams.note) ? searchParams.note : "";
  const apage = parsePage(searchParams.apage);
  const asize = parsePageSize(searchParams.asize);

  const [awaiting, returned, apptList, clinicDoctors] = await Promise.all([
    canWrite ? listNotesAwaitingDoctor(clinicId, user.id) : Promise.resolve([]),
    canWrite ? listNotesReturnedToAuthor(clinicId, user.id) : Promise.resolve([]),
    canViewClinical
      ? listNotesAppointments(clinicId, {
          from: win.from,
          to: win.to,
          doctorId: doctorFilter || undefined,
          note: noteFilter,
          limit: asize,
          offset: pageOffset(apage, asize),
        })
      : Promise.resolve(null),
    listClinicDoctors(clinicId),
  ]);
  const activeDoctors = clinicDoctors.filter((d) => d.isActive);

  const [recentPage, pendingDrafts, queue, strandedDrafts, scribeRuns, writePatient] = await Promise.all([
    listRecentVisits(clinicId, user.id, { limit: pageSize, offset: pageOffset(page, pageSize) }),
    canRecord ? listOwnDrafts(clinicId, user.id) : Promise.resolve([]),
    getDayQueue(clinicId, new Date(), { doctorId: user.id }),
    canSeeStranded ? listStrandedDrafts(clinicId) : Promise.resolve([]),
    canRecord ? listScribeRuns(clinicId, user.id) : Promise.resolve([]),
    writeFor ? getPatient(clinicId, writeFor) : Promise.resolve(null),
  ]);
  // The typed note opens on the patient's current chart, as the in-scribe editor does.
  const chartRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  const writeForChart =
    writePatient && chartRecord && can(user, "clinical", "view")
      ? await chartRecord.loadChart(clinicId, writePatient.id)
      : null;

  const recentVisits = recentPage.rows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{canRecord ? "Voice scribe" : "Clinical notes"}</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {canRecord
            ? canType
              ? "Record a visit or type the note, review it, then save."
              : "Record a visit, review the AI draft, then approve to save."
            : canType
              ? "Write a visit note, and see today's queue and your clinic's recent notes."
              : "Today's queue and your clinic's recent notes."}
        </p>
      </div>

      <DoctorQueue sessions={queue} canWrite={canWrite} />

      <ScribeRuns runs={scribeRuns.map((r) => ({ id: r.id, status: r.status, error: r.error, patientName: r.patientName }))} />

      {awaiting.length > 0 || returned.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes for you to look at</CardTitle>
            <CardDescription>
              Notes colleagues wrote for your patients wait for your approval; notes you
              wrote that were sent back wait for you to correct.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {awaiting.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{n.patientName}</span>
                    <span className="text-muted-foreground">
                      {" "}· written by {displayStaffName(n.authorPrefix, n.authorName, n.authorUsername ?? "a colleague")}
                    </span>
                  </span>
                  <Link href={`/clinic/scribe?review=${n.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Review &amp; approve
                  </Link>
                </li>
              ))}
              {returned.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{n.patientName}</span>
                    <span className="text-muted-foreground">
                      {" "}· sent back by {displayStaffName(n.doctorPrefix, n.doctorName, n.doctorUsername ?? "the doctor")}
                    </span>
                    {n.reviewNote ? <span className="block truncate text-xs text-muted-foreground">{n.reviewNote}</span> : null}
                  </span>
                  <Link href={`/clinic/scribe?review=${n.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Correct
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {review ? (
        <NoteReview
          key={review.visitId}
          item={review}
          modulesEnabled={clinicRow?.modulesEnabled ?? []}
        />
      ) : canRecord || canType ? (
        // The queue's "Add note" scrolls here (`#note-workspace`).
        <div id="note-workspace" className="scroll-mt-20">
          <ScribeWorkspace
            // A fresh workspace when "Write note" or an appointment names another patient.
            key={forAppointment?.id ?? writePatient?.id ?? "workspace"}
            pendingDrafts={pendingDrafts}
            strandedDrafts={strandedDrafts}
            modulesEnabled={clinicRow?.modulesEnabled ?? []}
            canRecord={canRecord}
            canType={canType}
            writeFor={writePatient ? { id: writePatient.id, fullName: writePatient.fullName, phone: writePatient.phone } : null}
            writeForChart={writeForChart}
            forAppointment={forAppointment}
            appointmentPatient={forAppointment && apptRow ? { id: apptRow.patientId, fullName: apptRow.patientName, phone: apptRow.patientPhone } : null}
            doctors={activeDoctors.filter((d) => d.id !== user.id).map((d) => ({ id: d.id, name: d.name }))}
          />
        </div>
      ) : scribeOn ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <CardDescription>
              You don&apos;t have permission to record or write clinical notes. Ask your
              clinic admin if this is a mistake.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {apptList ? (
        <NotesAppointments
          rows={apptList.rows}
          total={apptList.total}
          completedWithoutNote={apptList.completedWithoutNote}
          page={apage}
          pageSize={asize}
          searchParams={searchParams}
          canWrite={canWrite}
          filters={{
            from: win.from,
            to: win.to,
            today,
            doctor: ownScope ? "" : (doctorFilter ?? ""),
            doctorOptions: ownScope ? [] : clinicDoctors.map((d) => ({ value: d.id, label: d.name })),
            note: noteFilter,
          }}
        />
      ) : null}

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
                        {NOTE_STATUS_LABEL[String(v.status)] ?? String(v.status)}
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
