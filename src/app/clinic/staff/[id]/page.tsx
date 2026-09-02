import { getClinic } from "@/core/clinics/get-clinic";
import { assertNotLastAdmin, getClinicStaffMember } from "@/core/users/clinic-staff";
import { listUpcomingLeaves } from "@/core/appointments/availability";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CalendarClock, CalendarOff, Percent, RotateCcw, ShieldCheck } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { setStaffActive } from "@/app/clinic/actions";
import { DoctorLeaves } from "@/app/clinic/doctors/doctor-leaves";
import { getBookingProcedures } from "@/core/appointments/procedures";
import { countOpenDrafts } from "@/core/clinical/drafts";
import { getDoctorProcedureOverrides } from "@/core/appointments/share-config";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import {
  defaultPermissionsForRole,
  resourcesForClinic,
} from "@/core/auth/permissions";
import { PermissionsGrid } from "./permissions-grid";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
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
        <Link
          href="/clinic/staff"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to staff
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{label}</h1>
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
