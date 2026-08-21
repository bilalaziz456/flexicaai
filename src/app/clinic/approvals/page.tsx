import { redirect } from "next/navigation";
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
export default async function ApprovalsPage() {
  const user = await requireWorkspace();
  const isClinicApprover = can(user, "discount_approval", "view");
  const isDoctor = user.role === "doctor";
  if (!isClinicApprover && !isDoctor) redirect("/clinic");

  const rows = await listPendingApprovalsForUser(user.clinicId, {
    doctorId: user.id,
    isClinicApprover,
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
            {isClinicApprover
              ? "Clinic-borne discounts and any off your own share."
              : "Discounts taken from your revenue share."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApprovalQueue items={items} />
        </CardContent>
      </Card>
    </div>
  );
}
