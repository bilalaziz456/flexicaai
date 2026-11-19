import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { getAppointmentForDocument } from "@/core/billing/invoice";
import { displayStaffName } from "@/core/types/auth";
import { InvoicePrintFrame } from "@/core/ui/invoice-print";
import { EarlyPrint } from "@/core/ui/early-print";
import { BackLink } from "@/core/ui/back-link";
import { BRAND_POWERED_BY } from "@/core/lib/brand";

/**
 * The appointment TOKEN slip (owner, 2026-11-20): what the desk hands the patient to
 * wait with — the appointment number as big as the paper allows, the doctor and the
 * patient, and the "Powered by" line the print frame adds at the foot. Thermal only,
 * and deliberately short, so the printer feeds a few centimetres and stops. No logo,
 * no clinic header, no money: anyone who can see appointments may print it.
 */
export default async function AppointmentTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const user = await requireWorkspace("appointments");
  const { id } = await params;
  const { print } = await searchParams;
  const row = await getAppointmentForDocument(user.clinicId, id);
  if (!row) notFound();

  const doctor =
    row.doctorName || row.doctorUsername
      ? displayStaffName(row.doctorPrefix, row.doctorName, row.doctorUsername ?? "")
      : null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print">
        <BackLink href={`/clinic/appointments/${id}`}>Back to appointment</BackLink>
      </div>
      <InvoicePrintFrame
        fileName={row.queueNumber != null ? `Token ${row.queueNumber}` : "Token"}
        defaultFormat="thermal"
        allowed={["thermal"]}
        serverPrintPaper={print ?? null}
        // The slip carries its own, tighter credit line: the frame's (a heavy rule and
        // a gap above it) was a third of the slip's length (owner, 2026-11-20).
        credit={false}
      >
        {/* Kept as short as it can be read (owner: "the print is very big"): every line
            is tight, and the number is large without taking the length of the slip. */}
        <div className="text-center leading-tight">
          <div className="text-[0.75em] font-semibold tracking-[0.3em] uppercase">Token</div>
          <div className="text-[3.6em] leading-none font-bold tabular-nums">
            {row.queueNumber != null ? row.queueNumber : "—"}
          </div>
          {doctor ? <div className="mt-1 text-[1.05em] font-bold">{doctor}</div> : null}
          <div className="text-[0.95em]">{row.patientName}</div>
          <div className="mt-1 border-t border-black pt-0.5 text-[0.72em] font-semibold">{BRAND_POWERED_BY}</div>
        </div>
      </InvoicePrintFrame>
      {print ? <EarlyPrint nonce={(await headers()).get("x-nonce")} /> : null}
    </div>
  );
}
