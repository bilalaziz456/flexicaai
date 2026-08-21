import type { ReactNode } from "react";
import { Megaphone, ShieldAlert } from "lucide-react";
import { PaymentNoticePill } from "@/core/ui/payment-notice-pill";
import { requireWorkspace } from "@/core/auth/user";
import { endImpersonation } from "@/core/auth/actions";
import { getClinic } from "@/core/clinics/get-clinic";
import { getClinicBalanceSummary } from "@/core/admin/billing";
import { listActiveForClinic } from "@/core/admin/announcements";
import { getThemeCookie } from "@/core/theme/server";
import { clinicHasFeature } from "@/core/lib/features";
import { getUnreadCount } from "@/core/notifications/in-app";
import { accessibleResourceIds, can } from "@/core/auth/permissions";
import { displayStaffName, staffInitials } from "@/core/types/auth";
import { ClinicShell } from "@/app/clinic/clinic-shell";

/**
 * Clinic Admin panel shell. Guards to clinic_admin (with a guaranteed clinicId)
 * and shows the clinic's own name. Every child page/action is scoped to this
 * clinic — the admin never sees another clinic's data. The responsive chrome
 * (sidebar / hamburger) is the shared PanelShell.
 */
export default async function ClinicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireWorkspace();
  const clinic = await getClinic(user.clinicId);
  const theme = await getThemeCookie();
  const unread = await getUnreadCount(user.clinicId, user.id);
  // A clinic admin only sees the activity log if the super admin granted it; the
  // log nav is otherwise gated by the per-user `logs`… (kept as log_access).
  const logsEnabled =
    user.role === "clinic_admin" && (clinic?.logAccess?.length ?? 0) > 0;

  // A doctor manages only their OWN leave, and does so from the dashboard — so we
  // hide the "Doctors" (leave) nav item for them. Admin / manager / reception
  // still get the full Doctors page (all doctors' caps + leave) in the nav.
  const navResources =
    user.role === "doctor"
      ? accessibleResourceIds(user).filter((r) => r !== "leave")
      : accessibleResourceIds(user);

  // Discount approvals nav shows for potential approvers: a doctor (decides
  // discounts off their own share) or anyone with the clinic approval capability.
  const approvalsEnabled =
    user.role === "doctor" || can(user, "discount_approval", "view");

  // Stacked shell notices, shown to EVERY clinic user.
  const notices: ReactNode[] = [];

  // Impersonation banner (Feature 5): a persistent, unmissable bar while a
  // super-admin is viewing this clinic read-only, with a one-click Exit.
  if (user.impersonation) {
    notices.push(
      <div
        key="impersonation"
        className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-900 dark:text-amber-100"
      >
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          Viewing <span className="font-semibold">{user.impersonation.clinicName}</span> as
          support: read-only.
        </span>
        <form action={endImpersonation}>
          <button
            type="submit"
            className="rounded-md border border-amber-600/50 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20"
          >
            Exit
          </button>
        </form>
      </div>,
    );
  }

  // Payment-due notice (Feature 6 toolkit): warn ALL staff while the subscription is
  // past its paid-through date but the clinic is still usable (within grace, or
  // overdue-but-not-yet-locked). Priced clinics only; skipped during impersonation;
  // and suppressible per clinic by the super-admin / account manager via
  // `payment_notice_enabled`. Rendered as a floating bottom pill (PaymentNoticePill),
  // matching the connectivity indicator — NOT a top banner.
  let paymentPill: ReactNode = null;
  if (!user.impersonation && clinic && clinic.monthlyPrice > 0 && clinic.paymentNoticeEnabled) {
    const bal = await getClinicBalanceSummary(clinic);
    if (bal.billingStatus === "due" || bal.billingStatus === "overdue") {
      paymentPill = <PaymentNoticePill status={bal.billingStatus} />;
    }
  }

  // Super-admin announcements (Feature 10): global + clinic-targeted, active + in window.
  const announcements = await listActiveForClinic(user.clinicId);
  for (const a of announcements) {
    const warn = a.level === "warning";
    notices.push(
      <div
        key={`ann-${a.id}`}
        className={
          "flex items-start gap-2 border-b px-4 py-2 text-sm " +
          (warn
            ? "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-100"
            : "border-sky-500/40 bg-sky-500/15 text-sky-900 dark:text-sky-100")
        }
      >
        <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{a.title}</span>: {a.body}
        </span>
      </div>,
    );
  }

  const banner = notices.length ? <>{notices}</> : null;

  return (
    <ClinicShell
      banner={banner}
      identityLabel={clinic?.name ?? user.username}
      userName={displayStaffName(user.prefix, user.fullName, user.username)}
      userInitials={staffInitials(user.fullName, user.username)}
      accountHref="/clinic/settings"
      avatarVersion={user.avatarKey ?? "none"}
      notificationCount={unread}
      theme={theme}
      // Keyed by what the nav items declare, so adding a gated page is a change to
      // nav.ts alone (ADR-019).
      features={{
        sales: clinicHasFeature(clinic?.featuresEnabled, "sales"),
        finance: clinicHasFeature(clinic?.featuresEnabled, "finance"),
      }}
      gates={{ logs: logsEnabled, approvals: approvalsEnabled }}
      accessibleResources={navResources}
      bottomPill={paymentPill}
    >
      {children}
    </ClinicShell>
  );
}
