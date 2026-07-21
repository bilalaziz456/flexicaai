import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { endImpersonation } from "@/app/admin/actions";
import { getClinic } from "@/core/clinics/get-clinic";
import { getThemeCookie } from "@/core/theme/server";
import { clinicHasFeature } from "@/core/lib/features";
import { getUnreadCount } from "@/core/notifications/in-app";
import { accessibleResourceIds, can } from "@/core/auth/permissions";
import { displayStaffName, staffInitials } from "@/core/types/auth";
import { PanelShell } from "@/core/ui/panel-shell";

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

  // Impersonation banner (Feature 5): a persistent, unmissable bar while a
  // super-admin is viewing this clinic read-only, with a one-click Exit.
  const banner = user.impersonation ? (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
      <span className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
        Viewing <span className="font-semibold">{user.impersonation.clinicName}</span> as
        support — read-only.
      </span>
      <form action={endImpersonation}>
        <button
          type="submit"
          className="rounded-md border border-amber-600/50 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20"
        >
          Exit
        </button>
      </form>
    </div>
  ) : null;

  return (
    <PanelShell
      panel="clinic"
      banner={banner}
      identityLabel={clinic?.name ?? user.username}
      userName={displayStaffName(user.prefix, user.fullName, user.username)}
      userInitials={staffInitials(user.fullName, user.username)}
      accountHref="/clinic/settings"
      avatarVersion={user.avatarKey ?? "none"}
      notificationCount={unread}
      theme={theme}
      logsEnabled={logsEnabled}
      salesEnabled={clinicHasFeature(clinic?.featuresEnabled, "sales")}
      financeEnabled={clinicHasFeature(clinic?.featuresEnabled, "finance")}
      approvalsEnabled={approvalsEnabled}
      accessibleResources={navResources}
    >
      {children}
    </PanelShell>
  );
}
