import { getClinic } from "@/core/clinics/get-clinic";
import { getPatientHeader } from "@/core/patients/list";
import { getTreatmentPlan, listTreatmentPlanItems, planBillOf } from "@/core/patients/treatment-plans";
import { discountByLabel } from "@/core/patients/plan-bill";
import { describeOfferAmount, offerLabel } from "@/core/appointments/procedure-offer";
import { notFound } from "next/navigation";
import { formatPkr } from "@/core/appointments/fee";
import { BackLink } from "@/core/ui/back-link";
import { InvoicePrintFrame } from "@/core/ui/invoice-print";
import { PATIENT_DOCUMENT_PAPERS } from "@/core/lib/print-papers";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

/**
 * Printable treatment-plan ESTIMATE (a patient-facing quote). Thermal/A5/A4 via the
 * shared print frame. Lists the plan's items (tooth, qty, price, offer, discount), then
 * the subtotal, the plan's discounts with WHO gives them, and the total. Gated by
 * the caller (`plans:view`); clinic-scoped. Prices are the plan-item snapshots.
 */
export async function TreatmentEstimate({
  clinicId,
  patientId,
  planId,
  backHref,
}: {
  clinicId: string;
  patientId: string;
  planId: string;
  backHref: string;
}) {
  const plan = await getTreatmentPlan(clinicId, planId);
  if (!plan) notFound();

  const patient = await getPatientHeader(clinicId, patientId);
  if (!patient) notFound();

  const clinic = await getClinic(clinicId);
  const mrnLabel = patient.mrnLabel;

  const items = await listTreatmentPlanItems(clinicId, planId);

  const bill = planBillOf(plan, items);
  const discountBy = discountByLabel(plan.discountBorneBy, plan.doctorName, clinic?.name);
  const offerName = offerLabel(clinic?.name);
  const discounted = bill.offers > 0 || bill.planDiscount > 0;
  const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <BackLink href={backHref}>
          Back to patient
        </BackLink>
      </div>

      <InvoicePrintFrame
        fileName={`${patient.fullName} - Treatment estimate`}
        defaultFormat="a4"
        allowed={PATIENT_DOCUMENT_PAPERS}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">{clinic?.name ?? "Clinic"}</div>
            <div className="text-[0.9em] opacity-70">Treatment estimate</div>
          </div>
          <div className="text-right text-[0.9em]">
            <div className="font-semibold">{plan.title}</div>
            <div>{fmtDate(plan.createdAt)}</div>
          </div>
        </div>

        <div className="mt-2 text-[0.95em]">
          <span className="opacity-70">Patient: </span>
          <span className="font-medium">{patient.fullName}</span>
          {patient.phone ? <span className="opacity-70"> · {patient.phone}</span> : null}
        </div>
        {mrnLabel ? (
          <div className="text-[0.95em]">
            <span className="opacity-70">MRN#: </span>
            <span className="tabular-nums">{mrnLabel}</span>
          </div>
        ) : null}

        {items.length > 0 ? (
          <table className="mt-3 w-full border-collapse text-[0.95em]">
            <thead>
              <tr className="border-b border-black/20 text-left">
                <th className="py-1 font-normal opacity-70">Treatment</th>
                <th className="py-1 text-center font-normal opacity-70">Tooth / teeth</th>
                {/* Where each item stands — the estimate doubles as a progress sheet
                    once treatment has begun (owner's ask, 2026-10-15). */}
                <th className="py-1 text-center font-normal opacity-70">Status</th>
                <th className="py-1 text-right font-normal opacity-70">Qty</th>
                <th className="py-1 text-right font-normal opacity-70">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className="border-b border-black/10">
                  <td className="py-1">
                    {it.name}
                    {bill.items[i].offer > 0 ? (
                      <div className="text-[0.85em] opacity-70">
                        {offerName}: {describeOfferAmount(it.offerType, it.offerValue)} (−{formatPkr(bill.items[i].offer)})
                      </div>
                    ) : null}
                    {bill.items[i].discount > 0 ? (
                      <div className="text-[0.85em] opacity-70">
                        Discount: {describeOfferAmount(it.discountType, it.discountValue)} (−{formatPkr(bill.items[i].discount)})
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1 text-center">{it.tooth ?? "—"}</td>
                  <td className="py-1 text-center">{vocabularyLabel("treatment_item_statuses", it.status)}</td>
                  <td className="py-1 text-right">{it.quantity}</td>
                  <td className="py-1 text-right tabular-nums">
                    {/* A cancelled item shows its price but costs nothing (computePlanBill). */}
                    {formatPkr(it.status === "cancelled" ? it.unitPrice * it.quantity : bill.items[i].net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-[0.9em] opacity-70">No items on this plan.</p>
        )}

        {discounted ? (
          <div className="mt-2 space-y-0.5 text-[0.95em]">
            <div className="flex justify-between">
              <span className="opacity-70">Subtotal</span>
              <span className="tabular-nums">{formatPkr(bill.gross)}</span>
            </div>
            {bill.offers > 0 ? (
              <div className="flex justify-between">
                <span className="opacity-70">{offerName}</span>
                <span className="tabular-nums">−{formatPkr(bill.offers)}</span>
              </div>
            ) : null}
            {bill.itemDiscounts > 0 ? (
              <div className="flex justify-between">
                <span className="opacity-70">Treatment discounts</span>
                <span className="tabular-nums">−{formatPkr(bill.itemDiscounts)}</span>
              </div>
            ) : null}
            {bill.overallDiscount > 0 ? (
              <div className="flex justify-between">
                <span className="opacity-70">
                  Overall discount
                  {plan.discountType === "percent" ? ` (${plan.discountValue}%)` : ""}
                </span>
                <span className="tabular-nums">−{formatPkr(bill.overallDiscount)}</span>
              </div>
            ) : null}
            {/* Who gives it — the doctor, the clinic, or both (owner's call, 2026-10-18).
                The clinic's own offer is named on its own line above. */}
            {bill.planDiscount > 0 ? (
              <div className="text-[0.9em] font-medium">Discount by {discountBy}</div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex justify-between border-t border-black/20 pt-1 text-[1.05em] font-bold">
          <span>Estimated total</span>
          <span className="tabular-nums">{formatPkr(bill.total)}</span>
        </div>

        {plan.note ? <p className="mt-2 text-[0.9em] opacity-80">{plan.note}</p> : null}

        <div className="mt-3 border-t border-black/20 pt-2 text-center text-[0.8em] opacity-70">
          <div>This is an estimate. The final cost may vary with treatment.</div>
          {clinic?.whatsappSignature ? <div>{clinic.whatsappSignature}</div> : null}
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
