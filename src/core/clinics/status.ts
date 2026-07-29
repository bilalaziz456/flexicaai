import type { Clinic } from "@/core/db/schema";

/**
 * Clinic lifecycle status — CORE, specialty-agnostic (super-admin control plane).
 * `isClinicUsable` is the SINGLE source of truth for "may this clinic's staff use
 * the app right now"; it's enforced once in `requireRole` (all panels + every
 * clinic mutation) and drives the /paused page. See docs/super-admin-plan.md §11
 * Feature 2. super_admin has no clinic and is never subject to this.
 */

export const CLINIC_STATUSES = [
  "trial",
  "active",
  "suspended",
  "past_due",
  "cancelled",
] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

export function isClinicStatus(v: string): v is ClinicStatus {
  return (CLINIC_STATUSES as readonly string[]).includes(v);
}

/** Billing-cycle (subscription package) values + human labels. Mirrors the
 *  `billingCycle` enum on `clinics` (monthly|2m|quarter|half|annual). */
export const BILLING_CYCLE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  "2m": "2-monthly",
  quarter: "Quarterly",
  half: "Half-yearly",
  annual: "Annual",
};
export function billingCycleLabel(cycle: string | null | undefined): string {
  return (cycle && BILLING_CYCLE_LABEL[cycle]) || cycle || "—";
}

/** Human label for a status badge. */
export const CLINIC_STATUS_LABEL: Record<ClinicStatus, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  past_due: "Past due",
  cancelled: "Cancelled",
};

/**
 * True when the clinic may be used. `active` always; `trial` until it expires
 * (a null `trialEndsAt` = open-ended trial, still usable); suspended / past_due /
 * cancelled (and any unknown status) are NOT usable.
 */
export function isClinicUsable(
  clinic: Pick<Clinic, "status" | "trialEndsAt">,
): boolean {
  switch (clinic.status) {
    case "active":
      return true;
    case "trial":
      return !clinic.trialEndsAt || clinic.trialEndsAt.getTime() > Date.now();
    default:
      return false;
  }
}

/** A short reason a clinic isn't usable — shown on the /paused page. */
export function unusableReason(
  clinic: Pick<Clinic, "status" | "trialEndsAt" | "suspendReason">,
): string {
  switch (clinic.status) {
    case "trial":
      return "Your free trial has ended.";
    case "suspended":
      return clinic.suspendReason?.trim()
        ? `Access is suspended: ${clinic.suspendReason.trim()}`
        : "Access to your workspace is currently suspended.";
    case "past_due":
      return "Your subscription payment is past due.";
    case "cancelled":
      return "Your subscription has been cancelled.";
    default:
      return "Access to your workspace is currently paused.";
  }
}
