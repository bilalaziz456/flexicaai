import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { listPendingApprovalsForUser } from "@/core/appointments/approvals";
import { normalizeDiscountType } from "@/core/appointments/fee";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  ApprovalQueue,
  ClinicDiscountPolicy,
  type QueueItem,
} from "./approvals-ui";

const BORNE_LABEL: Record<string, string> = {
  clinic: "Clinic",
  doctor: "Doctor",
  split: "Split",
};

/**
 * Discount approvals — the queue of discounts awaiting sign-off, plus (for a clinic
 * admin) the clinic-borne approval switch. A doctor sees discounts off their own
 * share; a clinic approver sees clinic-borne ones. Only potential approvers reach
 * this page.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ appointment?: string }>;
}) {
  const user = await requireWorkspace();
  const isClinicApprover = can(user, "discount_approval", "view");
  const isDoctor = user.role === "doctor";
  if (!isClinicApprover && !isDoctor) redirect("/clinic");

  // `?appointment=` arrives from a "discount needs approval" notification, so the
  // click lands on that one discount instead of the top of the queue.
  // Shape-checked, not passed through: it reaches an `eq()` on a uuid column, and
  // Postgres THROWS on a malformed one — so a hand-edited URL would 500 the page
  // rather than simply matching nothing. An invalid value falls back to the full
  // queue, which is the harmless reading.
  //
  // `.guid()`, NOT `.uuid()`. In zod 4 `.uuid()` enforces the RFC variant/version
  // bits, so it REJECTS ids Postgres accepts and stores happily — anything not
  // generated as a conforming v4, including fixtures and ids carried in from another
  // system. The question here is only "will Postgres take this as a uuid", and
  // `.guid()` is exactly that check. Verified: `1111…1111` fails `.uuid()`, passes
  // `.guid()`, and is a perfectly valid Postgres uuid.
  const { appointment } = await searchParams;
  const appointmentId = z.string().guid().safeParse(appointment).data;

  const rows = await listPendingApprovalsForUser(user.clinicId, {
    doctorId: user.id,
    isClinicApprover,
    appointmentId,
  });

  const items: QueueItem[] = rows.map((r) => {
    const type = normalizeDiscountType(r.discountType);
    const amount =
      type === "percent" ? `${r.discountValue}%` : `Rs ${r.discountValue.toLocaleString("en-PK")}`;
    return {
      id: r.id,
      appointmentId: r.appointmentId,
      approverKind: r.approverKind,
      patientName: r.patientName,
      scheduledAt: r.scheduledAt.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      discountLabel: `${amount} discount · borne by ${BORNE_LABEL[r.borneBy] ?? "Clinic"}`,
      mine: r.approverKind === "doctor" && r.approverDoctorId === user.id,
    };
  });

  // Clinic admins can toggle the clinic-borne approval requirement here.
  let policyInitial: boolean | null = null;
  if (user.role === "clinic_admin") {
    const clinic = await getClinic(user.clinicId);
    policyInitial = Boolean(clinic?.discountNeedsApproval);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Discount approvals</h1>
        <p className="text-sm text-muted-foreground">
          Discounts waiting for sign-off before they apply to the bill.
        </p>
      </div>

      {policyInitial !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>Clinic policy</CardTitle>
            <CardDescription>
              Require approval for discounts the clinic absorbs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClinicDiscountPolicy initial={policyInitial} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Pending</CardTitle>
          <CardDescription>
            {appointmentId ? (
              <>
                {/* Empty here means SOMEONE ELSE already decided it — the common
                    case, since notifications are often opened late. Saying so beats
                    showing "nothing pending" and letting the approver wonder whether
                    the link was broken. */}
                {items.length === 0
                  ? "This discount has already been decided."
                  : "Showing one discount from a notification."}{" "}
                <Link href="/clinic/approvals" className="underline underline-offset-4">
                  Show all pending
                </Link>
              </>
            ) : isClinicApprover ? (
              "Clinic-borne discounts and any off your own share."
            ) : (
              "Discounts taken from your revenue share."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* The queue's own empty state ("nothing to approve") would contradict the
              description above, so it is skipped when a filter found nothing. */}
          {appointmentId && items.length === 0 ? null : <ApprovalQueue items={items} />}
        </CardContent>
      </Card>
    </div>
  );
}
