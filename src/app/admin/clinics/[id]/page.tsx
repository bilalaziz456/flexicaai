import { getClinic } from "@/core/clinics/get-clinic";
import { listAllClinicUsers } from "@/core/users/clinic-staff";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/core/ui/empty-state";
import { Breadcrumbs } from "@/core/ui/breadcrumbs";
import { Download, Upload, Users } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { SectionRail, type RailSection } from "@/core/ui/section-rail";
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
import { FlashToast } from "@/core/ui/toast";
import { ClinicAnalyticsDialog } from "./clinic-analytics-dialog";
import { ClinicPublicContact } from "./clinic-public-contact";
import { StaffActions } from "./staff-actions";
import { DeleteClinic } from "./delete-clinic";
import { getCityName, listCities } from "@/core/clinics/cities";

/** Super Admin: manage one clinic — toggle specialties, view its staff. */
export default async function ClinicDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  // Set by createClinicWithAdmin, which now lands here rather than on the list.
  const { created } = await searchParams;

  const clinic = await getClinic(id);

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
  // The city list feeds the combobox; the name renders whatever this clinic already has.
  const [cityOptions, cityName] = await Promise.all([listCities(), getCityName(clinic.cityId)]);

  // Tenant-scoped: this clinic's staff only (byClinic = the isolation boundary).
  const staff = await listAllClinicUsers(id);

  // Mirrors the guards below, so the rail can never point at a card this admin
  // cannot see — the bug the patient record's rail was written to avoid.
  const railSections: RailSection[] = [
    { id: "subscription", label: "Subscription", group: "Account" },
    { id: "logo", label: "Logo", group: "Account" },
    { id: "plan", label: "Plan & features", group: "Account" },
    ...(billing ? [{ id: "billing", label: "Billing", group: "Account" }] : []),
    { id: "manager", label: "Account manager", group: "Relationship" },
    { id: "contact", label: "Owner & contact", group: "Relationship" },
    { id: "public", label: "Patient-facing", group: "Relationship" },
    { id: "capabilities", label: "Capabilities", group: "Access" },
    { id: "log-access", label: "Activity-log access", group: "Access" },
    { id: "staff", label: "Staff", group: "Access" },
    { id: "danger", label: "Danger zone", group: "Danger" },
  ];

  return (
    <div className="space-y-6">
      <FlashToast message={created ? "Clinic created." : null} />
      <div>
        <Breadcrumbs items={[{ label: "Clinics", href: "/admin" }, { label: clinic.name }]} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{clinic.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ClinicAnalyticsDialog clinicId={clinic.id} />
            {canAdmin(admin, "import:create") ? (
              <Link
                href={`/admin/clinics/${clinic.id}/import`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Upload aria-hidden="true" />
                Import data
              </Link>
            ) : null}
            <a
              href={`/api/admin/clinics/${clinic.id}/export`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download aria-hidden="true" />
              Export JSON
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <SectionRail sections={railSections} />
        <div className="min-w-0 space-y-6">

      <Card id="subscription" className="scroll-mt-24">
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

      <Card id="logo" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Printed at the top of this clinic&apos;s invoices and receipts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicLogoForm clinicId={clinic.id} logo={logo} />
        </CardContent>
      </Card>

      <Card id="plan" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Plan &amp; features</CardTitle>
          <CardDescription>
            Name, specialties, the optional features included for this clinic, and its
            configuration: what the clinic <span className="font-medium">has</span>.
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
        <Card id="billing" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>
              Subscription price, paid-through date and carried-forward balance. Recording
              a payment extends paid-through, and overdue past grace flips the clinic to
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

      <Card id="manager" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Account manager</CardTitle>
          <CardDescription>
            The team member who owns this clinic on our side, for &ldquo;my clinics&rdquo; and
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

      <Card id="contact" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Owner &amp; contact</CardTitle>
          <CardDescription>
            Who owns this clinic and how to reach them, its data region and timezone,
            plus private internal notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicContactForm
            cityOptions={cityOptions}
            clinicId={clinic.id}
            contact={{
              ownerName: clinic.ownerName,
              ownerEmail: clinic.ownerEmail,
              ownerPhone: clinic.ownerPhone,
              country: clinic.country,
              province: clinic.province,
              city: cityName,
              address: clinic.address,
              region: clinic.region,
              timezone: clinic.timezone,
              notes: clinic.notes,
            }}
          />
        </CardContent>
      </Card>

      <Card id="public" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Patient-facing details</CardTitle>
          <CardDescription>
            What a patient is told over WhatsApp when they ask where the clinic is or
            when it opens. Distinct from the billing address above, which prints on our
            invoices to them. The clinic can change these itself; set them here so the
            answers work from their first day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicPublicContact
            clinicId={clinic.id}
            address={clinic.publicAddress}
            hours={clinic.openingHours}
            readOnly={!canAdmin(admin, "clinics:edit")}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Access control</h2>
          <p className="text-sm text-muted-foreground">
            The ceiling on what this clinic&apos;s staff can <span className="font-medium">do</span>{" "}
            and <span className="font-medium">see</span>, independent of the plan features above.
          </p>
        </div>

        <Card id="capabilities" className="scroll-mt-24">
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

        <Card id="log-access" className="scroll-mt-24">
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

      <Card id="staff" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            {staff.length} account{staff.length === 1 ? "" : "s"}. The clinic
            admin adds doctors and receptionists from their own panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No staff accounts yet"
              description="The clinic admin adds doctors and receptionists from their own panel — you do not create them here."
            />
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
                  <li key={u.id} className="space-y-2 rounded-md border well p-3">
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

      <Card id="danger" className="scroll-mt-24 border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this clinic and all its data: staff, patients,
            appointments, visits and recalls. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteClinic clinicId={clinic.id} clinicName={clinic.name} />
        </CardContent>
      </Card>

        </div>
      </div>
    </div>
  );
}
