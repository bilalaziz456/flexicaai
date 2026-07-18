import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getPatientAccount } from "@/core/billing/account";
import { formatPkr } from "@/core/appointments/fee";
import { InvoicePrintFrame } from "@/app/reception/invoice-print";

/**
 * Printable patient statement (Finance) — the patient's account on one sheet:
 * per-visit bill/collected/outstanding, the money-in/out ledger, and the closing
 * balance + advance credit. Thermal / A5 / A4 via the shared print frame. Gated by
 * the sales feature + billing:view; clinic-scoped.
 */
export default async function PatientStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const { id } = await params;

  const [patient] = await db
    .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
    .from(patients)
    .where(
      byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, id)),
    )
    .limit(1);
  if (!patient) notFound();

  const [clinic] = await db
    .select({
      name: clinics.name,
      featuresEnabled: clinics.featuresEnabled,
      invoicePaper: clinics.invoicePaper,
      signature: clinics.whatsappSignature,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales") || !can(user, "billing", "view")) {
    notFound();
  }

  const account = await getPatientAccount(clinicId, patient.id);
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const KIND_LABEL: Record<string, string> = {
    payment: "Payment",
    advance: "Advance",
    advance_applied: "Advance applied",
    refund: "Refund",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <Link
          href={`/clinic/patients/${patient.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to patient
        </Link>
      </div>

      <InvoicePrintFrame defaultFormat={clinic?.invoicePaper ?? "a4"}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">{clinic?.name ?? "Clinic"}</div>
            <div className="text-[0.9em] opacity-70">Account statement</div>
          </div>
          <div className="text-right text-[0.9em]">
            <div>{fmtDate(new Date())}</div>
          </div>
        </div>

        {/* Patient */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          <div>
            <span className="opacity-70">Patient: </span>
            <span className="font-medium">{patient.fullName}</span>
            {patient.phone ? <span className="opacity-70"> · {patient.phone}</span> : null}
          </div>
        </div>

        {/* Visits */}
        {account.visits.length > 0 ? (
          <table className="mt-3 w-full border-collapse text-[0.95em]">
            <thead>
              <tr className="border-b border-black/20 text-left">
                <th className="py-1 font-normal opacity-70">Visit</th>
                <th className="py-1 text-right font-normal opacity-70">Bill</th>
                <th className="py-1 text-right font-normal opacity-70">Paid</th>
                <th className="py-1 text-right font-normal opacity-70">Balance</th>
              </tr>
            </thead>
            <tbody>
              {account.visits.map((v) => (
                <tr key={v.id} className="border-b border-black/10">
                  <td className="py-1">{fmtDate(v.scheduledAt)}</td>
                  <td className="py-1 text-right tabular-nums">{formatPkr(v.bill)}</td>
                  <td className="py-1 text-right tabular-nums">{formatPkr(v.collected)}</td>
                  <td className="py-1 text-right tabular-nums">{formatPkr(v.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-[0.9em] opacity-70">No completed visits yet.</p>
        )}

        {/* Totals */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          <div className="flex justify-between">
            <span className="opacity-70">Total billed</span>
            <span className="tabular-nums">{formatPkr(account.totals.billed)}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">Total collected</span>
            <span className="tabular-nums">{formatPkr(account.totals.collected)}</span>
          </div>
          <div className="flex justify-between border-t border-black/20 pt-1 text-[1.05em] font-bold">
            <span>Outstanding</span>
            <span className="tabular-nums">{formatPkr(account.totals.outstanding)}</span>
          </div>
          {account.credit > 0 ? (
            <div className="flex justify-between">
              <span className="opacity-70">Advance credit</span>
              <span className="tabular-nums">{formatPkr(account.credit)}</span>
            </div>
          ) : null}
        </div>

        {/* Ledger */}
        {account.payments.length > 0 ? (
          <div className="mt-4">
            <div className="text-[0.9em] font-semibold opacity-70">Payment history</div>
            <table className="mt-1 w-full border-collapse text-[0.9em]">
              <tbody>
                {account.payments.map((p) => (
                  <tr key={p.id} className="border-b border-black/10">
                    <td className="py-1">{fmtDate(p.occurredAt)}</td>
                    <td className="py-1">
                      {KIND_LABEL[p.kind] ?? p.kind}
                      {p.method ? <span className="opacity-70"> · {p.method}</span> : null}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {p.kind === "refund" ? "−" : ""}
                      {formatPkr(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-3 border-t border-black/20 pt-2 text-center text-[0.85em] opacity-70">
          {clinic?.signature ? <div>{clinic.signature}</div> : null}
          <div>Thank you.</div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
