import { getClinic } from "@/core/clinics/get-clinic";
import { assertNotLastAdmin, getClinicStaffMember } from "@/core/users/clinic-staff";
import { listUpcomingLeaves } from "@/core/appointments/availability";
import { notFound } from "next/navigation";
import { Activity, Ban, CalendarClock, CalendarOff, Percent, RotateCcw, ShieldCheck } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { setStaffActive } from "@/app/clinic/actions";
import { DoctorLeaves } from "@/app/clinic/schedule/doctor-leaves";
import { getBookingProcedures } from "@/core/appointments/procedures";
import { getDoctorActivity } from "@/core/users/doctor-activity";
import { resolveSalesRange } from "@/core/sales/report";
import { countOpenDrafts } from "@/core/clinical/drafts";
import { getDoctorProcedureOverrides } from "@/core/appointments/share-config";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import {
  defaultPermissionsForRole,
  resourcesForClinic,
} from "@/core/auth/permissions";
import { PermissionsGrid } from "./permissions-grid";
import Link from "next/link";
import { BackLink } from "@/core/ui/back-link";
import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/badge";
import { Button, buttonVariants } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ViewLogger } from "@/core/ui/view-logger";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import {
  DeleteStaffButton,
  DoctorSharesForm,
  EditStaffForm,
  ResetPasswordForm,
} from "./staff-admin";

/**
 * Clinic Admin: open a staff member and manage everything in one place — edit
 * profile, (doctors) working hours + daily cap + fee, reset password, suspend/
 * reactivate, and delete. Clinic-scoped, any clinic role including a peer admin —
 * except that the LAST active admin cannot be suspended or deleted.
 */
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireWorkspace("staff");
  const { clinicId } = viewer;
  // Viewing is `staff:view`; managing (edit / permissions / password / suspend /
  // delete) is clinic-admin-only — a manager can't escalate their own access.
  const isAdmin = viewer.role === "clinic_admin";
  const { id } = await params;

  const member = await getClinicStaffMember(clinicId, id);

  // Clinic-scoped, and only roles a clinic admin may manage (which now includes
  // clinic_admin — admins are peers). A super_admin id still 404s here.
  if (!member || !(CLINIC_STAFF_ROLES as readonly string[]).includes(member.role)) {
    notFound();
  }

  const label = member.fullName ?? member.username;

  // Admins are peers and can manage each other — but the clinic must never be left
  // with none, so the last active admin's suspend and delete controls are withheld.
  // Computed here, once, because two cards below branch on it.
  const isLastAdmin =
    member.role === "clinic_admin" &&
    Boolean(await assertNotLastAdmin(clinicId, member.id, "delete"));

  // Permission grid inputs: the resources this clinic can use, and the member's
  // effective permissions (their overrides, or the role defaults when unset).
  const clinic = await getClinic(clinicId);
  const permResources = resourcesForClinic(clinic?.featuresEnabled);
  const roleDefaults = defaultPermissionsForRole(member.role);
  const effectivePermissions = member.permissions ?? roleDefaults;

  // What this doctor has been doing, for the activity card. Clinic admin only —
  // a manager holding `staff:view` can open this page, and one colleague's output
  // is not something the viewing permission was granted for.
  //
  // Last 90 days: long enough that a quiet fortnight does not read as a collapse,
  // short enough to describe what is happening NOW. The money figures carry their
  // own lifetime totals alongside, because a balance is not a rate.
  const activityRange = resolveSalesRange("quarter", undefined, undefined);
  const activity =
    isAdmin && member.role === "doctor"
      ? await getDoctorActivity(clinicId, member.id, activityRange)
      : null;

  // Current + upcoming leave for doctors.
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const leaves =
    member.role === "doctor"
      ? await listUpcomingLeaves(clinicId, today, { doctorId: member.id })
      : [];

  // Revenue-share config inputs (doctors only): the clinic's priced procedures for
  // per-procedure rate overrides (empty unless the `sales` feature is on) and this
  // doctor's existing overrides.
  const shareProcedures =
    isAdmin && member.role === "doctor"
      ? await getBookingProcedures(clinicId)
      : [];
  const shareOverrides =
    isAdmin && member.role === "doctor"
      ? await getDoctorProcedureOverrides(clinicId, member.id)
      : [];
  const overrideMap: Record<string, number> = {};
  for (const o of shareOverrides) overrideMap[o.procedureId] = o.sharePct;

  return (
    <div className="space-y-6">
      <ViewLogger
        entity="staff"
        entityId={member.id}
        summary={`Viewed staff member ${label}`}
      />
      <div>
        <BackLink href="/clinic/staff">
          Back to staff
        </BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{label}</h1>
          <Badge variant="secondary">{vocabularyLabel("user_roles", member.role)}</Badge>
          {member.isActive ? (
            <Badge variant="outline">Active</Badge>
          ) : (
            <Badge variant="destructive">Suspended</Badge>
          )}
        </div>
      </div>

      {!isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Read-only: ask a clinic admin to make changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Username</dt>
                <dd>@{member.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{vocabularyLabel("user_roles", member.role)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{member.isActive ? "Active" : "Suspended"}</dd>
              </div>
              {member.role === "doctor" && member.fee > 0 ? (
                <div>
                  <dt className="text-muted-foreground">Consultation fee</dt>
                  <dd>Rs {new Intl.NumberFormat("en-PK").format(member.fee)}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {member.role === "doctor" ? (
                <CalendarClock
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              Details
            </CardTitle>
            <CardDescription>
              {member.role === "doctor"
                ? "Name, login, working hours, daily cap and fee. Saved together."
                : "Edit the name and login username."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditStaffForm
              userId={member.id}
              prefix={member.prefix}
              fullName={member.fullName}
              username={member.username}
              role={member.role}
              availability={member.availability}
              dailyLimit={member.dailyLimit}
              fee={member.fee}
              flexibleHours={member.flexibleHours}
            />
          </CardContent>
        </Card>
      ) : null}

      {activity ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
              Activity
            </CardTitle>
            <CardDescription>
              The last 90 days. Figures, not a score — each one is shown with what it
              is measured against, because a single number over these would hide more
              than it told you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border/60 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Appointments",
                  value: activity.appointments.toLocaleString("en-PK"),
                  // EVERY bucket, or none. Naming two of the five read as a sum that
                  // did not come out — 13 appointments, "5 completed · 4 cancelled",
                  // and the missing four looked like an error rather than the
                  // no-shows and the visits nobody had closed out. A breakdown under
                  // a total is a promise that it reconciles, so the terms are the
                  // outcomes plus the remainder, and only the zero ones drop out.
                  //
                  // The spaces are non-breaking ON PURPOSE. Four terms do not fit a
                  // quarter-width tile, and the first wrap landed between "5" and
                  // "cancelled" — a figure orphaned from its noun, which is worse
                  // than the two-term line this replaces. Binding each term, and
                  // binding the separator to the term before it, leaves the only
                  // legal break points AFTER a "·".
                  hint:
                    [
                      activity.completed ? `${activity.completed} completed` : null,
                      activity.noShows ? `${activity.noShows} no-show` : null,
                      activity.cancelled ? `${activity.cancelled} cancelled` : null,
                      activity.stillOpen ? `${activity.stillOpen} still open` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "none booked",
                },
                {
                  label: "No-show rate",
                  value:
                    activity.noShowRate === null
                      ? "—"
                      : `${Math.round(activity.noShowRate * 100)}%`,
                  // The denominator is EXPECTED visits, and saying so matters: a
                  // rate over everything booked would fall every time someone
                  // cancelled a week ahead.
                  hint:
                    activity.noShowRate === null
                      ? "no completed or missed visits yet"
                      : `${activity.noShows} of ${activity.completed + activity.noShows} expected`,
                },
                {
                  label: "Visits recorded",
                  value: activity.visits.toLocaleString("en-PK"),
                  hint: `${activity.scribeRuns} dictated`,
                },
                {
                  label: "Earned",
                  value: rs(activity.earnedInWindow),
                  hint: activity.hasShareRate
                    ? "revenue share, this period"
                    : "no share percentage set",
                },
              ].map((k, i, all) => (
                <div
                  key={k.label}
                  className={cn(
                    "p-4",
                    i < all.length - 1 && "border-b border-border/60",
                    i >= all.length - 2 && "sm:border-b-0",
                    i < all.length - 4 ? "lg:border-b" : "lg:border-b-0",
                    i % 2 === 0 && "sm:border-r sm:border-border/60",
                    (i + 1) % 4 === 0 ? "lg:border-r-0" : "lg:border-r lg:border-border/60",
                  )}
                >
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">{k.value}</div>
                  <div className="text-xs text-muted-foreground">{k.hint}</div>
                </div>
              ))}
            </div>

            {/* The BALANCE. Same ledger the shares page settles against, read rather
                than re-derived.

                It LEADS WITH WHAT IT MEANS, because the arithmetic alone was
                misleading in the one case that matters. A NEGATIVE balance does not
                mean a small amount is outstanding — it means the money runs the other
                way, and the doctor owes the clinic (they bore a discount). Printing
                that as "Rs -9,868 outstanding" said the opposite of the truth while
                looking precise, and put the minus sign in a different place from the
                one on the adjustment beside it. Which side owes is the fact; the
                terms are the working, so they sit underneath in smaller type and the
                zero ones are left out. */}
            {activity.hasShareRate ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 well p-3">
                <div className="text-sm">
                  <div>
                    {activity.outstanding > 0 ? (
                      <>
                        <span className="font-medium">{rs(activity.outstanding)}</span>{" "}
                        <span className="text-muted-foreground">owed to this doctor</span>
                      </>
                    ) : activity.outstanding < 0 ? (
                      <>
                        <span className="font-medium">{rs(Math.abs(activity.outstanding))}</span>{" "}
                        <span className="text-muted-foreground">
                          owed BY this doctor to the clinic
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Settled up — nothing owed either way</span>
                    )}
                  </div>
                  {/* The working. Earnings ALWAYS lead, even at zero — they are what
                      the other two terms modify, and "less Rs 9,868 in adjustments"
                      standing alone reads as a fragment rather than a subtraction.
                      A zero adjustment or payout is dropped, because those are
                      genuinely absent rather than a starting point of nothing. */}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Lifetime:{" "}
                    {[
                      `${rs(activity.earnedLifetime)} earned`,
                      activity.adjustments !== 0
                        ? `${activity.adjustments < 0 ? "less " : "plus "}${rs(Math.abs(activity.adjustments))} in adjustments`
                        : null,
                      activity.paidLifetime !== 0 ? `${rs(activity.paidLifetime)} paid out` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                </div>
                <Link
                  href={`/clinic/shares?doctorId=${member.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Open shares
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && member.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="size-5 text-muted-foreground" aria-hidden="true" />
              Leave &amp; vacation
            </CardTitle>
            <CardDescription>
              Mark days off. Appointments in the range are cancelled and no new
              bookings are allowed on those days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorLeaves doctorId={member.id} leaves={leaves} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && member.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="size-5 text-muted-foreground" aria-hidden="true" />
              Revenue share
            </CardTitle>
            <CardDescription>
              The doctor&apos;s cut of the consultation fee and of procedures, with
              optional per-procedure rates. Used to split each completed visit
              between the doctor and the clinic.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorSharesForm
              userId={member.id}
              consultationSharePct={member.consultationSharePct}
              procedureSharePct={member.procedureSharePct}
              discountNeedsApproval={member.discountNeedsApproval}
              procedures={shareProcedures}
              initialOverrides={overrideMap}
            />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            Permissions
          </CardTitle>
          <CardDescription>
            {/* The WHOLE sentence is one expression on purpose. Mixing `{expr}` with
                adjacent JSX text drops the space between them — the original
                `{member.role} can do` rendered as "clinic_admincan do", and moving
                the interpolation just moved the join to "can do.Tick". One string
                has no boundary to lose. the database's label also keeps the enum slug off
                the screen. */}
            {`What this ${vocabularyLabel("user_roles", member.role).toLowerCase()} can do. Tick View / Create / Edit / Delete per module. View is required for the others. Starts from the role's defaults until you change it.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionsGrid
            userId={member.id}
            resources={permResources}
            initial={effectivePermissions}
            roleDefaults={roleDefaults}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a temporary password. They must change it at next login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm userId={member.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account access</CardTitle>
          <CardDescription>
            {isLastAdmin
              ? "This is the clinic's only active admin. Add another admin before suspending or deleting this account — otherwise nobody can reach staff or settings."
              : member.isActive
                ? "Suspend to block sign-in and end active sessions immediately."
                : "This account is suspended. Reactivate to restore access."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Hidden rather than disabled-with-a-tooltip: there is nothing the admin
              can do here until they add a second admin, and the server refuses it
              anyway. `setStaffActive` returns void, so a refusal has nowhere to
              render — the control must not be offered in the first place. */}
          {isLastAdmin ? (
            <p className="text-sm text-muted-foreground">
              Suspending is unavailable while this is the last admin.
            </p>
          ) : (
            <form action={setStaffActive.bind(null, member.id, !member.isActive)}>
              <Button type="submit" variant="outline">
                {member.isActive ? (
                  <>
                    <Ban className="size-4" aria-hidden="true" /> Suspend
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-4" aria-hidden="true" /> Reactivate
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* The whole card goes when this is the last admin — deleting them would leave
          the clinic unable to reach staff or settings at all, and only the super
          admin could undo it. The action refuses too; this stops the offer. */}
      {isLastAdmin ? null : (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete this staff member. Visit history is kept, and their
              sessions end immediately. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteStaffButton
              userId={member.id}
              label={label}
              openDrafts={await countOpenDrafts(clinicId, member.id)}
            />
          </CardContent>
        </Card>
      )}
        </>
      ) : null}
    </div>
  );
}
