import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Breadcrumbs } from "@/core/ui/breadcrumbs";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { CLINIC_FEATURES } from "@/core/lib/features";
import { resourcesForClinic } from "@/core/auth/permissions";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin, canManageBilling, canManageTeam, canSeeBilling } from "@/core/auth/admin-permissions";
import { getClinicBilling } from "@/core/admin/billing";
import { listAssignableTeam } from "@/core/admin/assignment";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { ClinicSettingsForm } from "./clinic-settings-form";
import { ClinicLogoForm } from "./clinic-logo-form";
import { ClinicLifecycle } from "./clinic-lifecycle";
import { ClinicAssignee } from "./clinic-assignee";
import { ImpersonateClinic } from "./impersonate-clinic";
import { ClinicContactForm } from "./clinic-contact-form";
import { ClinicBilling } from "./clinic-billing";
import { ClinicCapabilities } from "./clinic-capabilities";
import { ClinicLogAccess } from "./clinic-log-access";
import { StaffActions } from "./staff-actions";
import { DeleteClinic } from "./delete-clinic";

/** Super Admin: manage one clinic — toggle specialties, view its staff. */
export default async function ClinicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [clinic] = await db
    .select()
    .from(clinics)
    .where(eq(clinics.id, id))
    .limit(1);

  if (!clinic) notFound();

  // Viewing a clinic needs clinics:view (redirects otherwise).
  const admin = await requireAdminCapability("clinics:view");
  // Visibility scope: a non-full-access team member may only open clinics
  // assigned to them (owner + super_admin see all).
  if (!canManageTeam(admin) && clinic.assignedTo !== admin.id) notFound();
  // Billing card: visible to billing VISIBILITY (owner/sales/billing/support), and
  // editable only with a billing manage action (sales sees it read-only).
  const showBilling = canSeeBilling(admin);
  const canManageBillingCard = canManageBilling(admin);
  const billing = showBilling ? await getClinicBilling(clinic.id) : null;
  // Serve the preview via a route (not a data URI) so the large image isn't a prop on
  // the server-action-using logo form. `v` busts the cache after an upload.
  const logo = clinic.logoKey
    ? `/api/admin/clinics/${clinic.id}/logo?v=${clinic.updatedAt.getTime()}`
    : null;
  const team = await listAssignableTeam();

  // Tenant-scoped: this clinic's staff only (byClinic = the isolation boundary).
  const staff = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(users)
    .where(byClinic(users.clinicId, id, notDeleted(users.deletedAt)));

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Clinics", href: "/admin" }, { label: clinic.name }]} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{clinic.name}</h1>
          <div className="flex items-center gap-4">
            {canAdmin(admin, "import:create") ? (
              <Link
                href={`/admin/clinics/${clinic.id}/import`}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Import data
              </Link>
            ) : null}
            <a
              href={`/api/admin/clinics/${clinic.id}/export`}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Export data (JSON)
            </a>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscription & access</CardTitle>
          <CardDescription>
            Control whether this clinic can use the app. Suspending, cancelling or an
            expired trial locks out all its staff immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicLifecycle
            clinicId={clinic.id}
            status={clinic.status}
            trialEndsAt={clinic.trialEndsAt ? clinic.trialEndsAt.toISOString() : null}
            canPause={canManageTeam(admin)}
          />
          <div className="mt-4 border-t pt-4">
            <ImpersonateClinic clinicId={clinic.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Printed at the top of this clinic&apos;s invoices &amp; receipts (in black &amp; white).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicLogoForm clinicId={clinic.id} logo={logo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan &amp; features</CardTitle>
          <CardDescription>
            Name, specialties, the optional features included for this clinic, and its
            configuration — what the clinic <span className="font-medium">has</span>.
            Access control (who can do what) is below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicSettingsForm
            clinicId={clinic.id}
            name={clinic.name}
            catalog={SPECIALTY_CATALOG}
            features={CLINIC_FEATURES}
            modulesEnabled={clinic.modulesEnabled}
            featuresEnabled={clinic.featuresEnabled}
            trashRetentionDays={clinic.trashRetentionDays}
            whatsappPhoneNumberId={clinic.whatsappPhoneNumberId}
            whatsappDisplayNumber={clinic.whatsappDisplayNumber}
            whatsappSenderName={clinic.whatsappSenderName}
          />
        </CardContent>
      </Card>

      {billing ? (
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>
              Subscription price, paid-through date and carried-forward balance. Recording
              a payment extends paid-through; overdue past grace flips the clinic to
              past-due (locking staff out).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClinicBilling
              clinicId={clinic.id}
              monthlyPrice={billing.clinic.monthlyPrice}
              billingCycle={billing.clinic.billingCycle}
              graceDays={billing.clinic.graceDays}
              commitmentAt={billing.clinic.commitmentAt ? billing.clinic.commitmentAt.toISOString() : null}
              commitmentNote={billing.clinic.commitmentNote}
              balance={{
                billingStatus: billing.balance.billingStatus,
                paidThrough: billing.balance.paidThrough.toISOString(),
                monthsPaid: billing.balance.monthsPaid,
                totalPaid: billing.balance.totalPaid,
                accrued: billing.balance.accrued,
                owed: billing.balance.owed,
                credit: billing.balance.credit,
                daysRemaining: billing.balance.daysRemaining,
                daysOverdue: billing.balance.daysOverdue,
              }}
              payments={billing.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                kind: p.kind,
                method: p.method,
                reference: p.reference,
                monthsCovered: p.monthsCovered,
                note: p.note,
                occurredAt: p.occurredAt.toISOString(),
                recordedByName: p.recordedByName,
              }))}
              canManage={canManageBillingCard}
              paymentNoticeEnabled={clinic.paymentNoticeEnabled}
              paymentReminderDays={clinic.paymentReminderDays}
              canToggleNotice
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Account manager</CardTitle>
          <CardDescription>
            The team member who owns this clinic on our side — for &ldquo;my clinics&rdquo; and
            payment-due / follow-up updates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicAssignee
            clinicId={clinic.id}
            assignedTo={team.some((m) => m.id === clinic.assignedTo) ? clinic.assignedTo : null}
            team={team}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owner &amp; contact</CardTitle>
          <CardDescription>
            Who owns this clinic and how to reach them, its data region and timezone,
            plus private internal notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicContactForm
            clinicId={clinic.id}
            contact={{
              ownerName: clinic.ownerName,
              ownerEmail: clinic.ownerEmail,
              ownerPhone: clinic.ownerPhone,
              country: clinic.country,
              city: clinic.city,
              address: clinic.address,
              region: clinic.region,
              timezone: clinic.timezone,
              notes: clinic.notes,
            }}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Access control</h2>
          <p className="text-sm text-muted-foreground">
            The ceiling on what this clinic&apos;s staff can <span className="font-medium">do</span>{" "}
            and <span className="font-medium">see</span> — independent of the plan features above.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
            <CardDescription>
              Which actions this clinic&apos;s staff may perform. Disabling one turns off
              that button for every user here (the ceiling their own per-user permissions
              sit within).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClinicCapabilities
              clinicId={clinic.id}
              resources={resourcesForClinic(clinic.featuresEnabled)}
              capabilities={clinic.capabilities}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity-log access</CardTitle>
            <CardDescription>
              Which parts of the audit log the clinic admin can see on their Logs page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClinicLogAccess clinicId={clinic.id} logAccess={clinic.logAccess} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            {staff.length} account{staff.length === 1 ? "" : "s"}. The clinic
            admin adds doctors and receptionists from their own panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No staff yet. The clinic admin adds doctors and receptionists.
            </p>
          ) : (
            <>
              {/* Desktop: full table. */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.fullName ?? "—"}
                        </TableCell>
                        <TableCell>{u.username}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          {u.isActive ? (
                            "Active"
                          ) : (
                            <span className="text-muted-foreground">Disabled</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StaffActions
                            userId={u.id}
                            username={u.username}
                            fullName={u.fullName}
                            isActive={u.isActive}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
              <ul className="space-y-3 md:hidden">
                {staff.map((u) => (
                  <li key={u.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{u.fullName ?? "—"}</span>
                      <Badge variant="secondary">{u.role}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      @{u.username} · {u.isActive ? "Active" : "Disabled"}
                    </div>
                    <StaffActions
                      userId={u.id}
                      username={u.username}
                      fullName={u.fullName}
                      isActive={u.isActive}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this clinic and all its data — staff, patients,
            appointments, visits and recalls. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteClinic clinicId={clinic.id} clinicName={clinic.name} />
        </CardContent>
      </Card>
    </div>
  );
}
