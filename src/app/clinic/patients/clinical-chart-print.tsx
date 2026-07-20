import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients } from "@/core/db/schema";
import { clinicalRecordFor } from "@/config/modules";
import { InvoicePrintFrame } from "@/app/reception/invoice-print";

/**
 * Printable clinical chart — the patient's current odontogram + latest perio summary,
 * for the record/referral. Renders the enabled module's read-only chart via the
 * contract (core never knows it's dental). Gated by the caller (`clinical:view`).
 */
export async function ClinicalChartPrint({
  clinicId,
  patientId,
  backHref,
}: {
  clinicId: string;
  patientId: string;
  backHref: string;
}) {
  const [patient] = await db
    .select({ fullName: patients.fullName, phone: patients.phone })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  if (!patient) notFound();

  const [clinic] = await db
    .select({ name: clinics.name, modulesEnabled: clinics.modulesEnabled, invoicePaper: clinics.invoicePaper, signature: clinics.whatsappSignature })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const clinicalRecord = clinicalRecordFor(clinic?.modulesEnabled ?? []);
  if (!clinicalRecord) notFound();

  const chart = await clinicalRecord.loadChart(clinicId, patientId);
  const perioTrend = clinicalRecord.perio ? await clinicalRecord.perio.trend(clinicId, patientId) : [];
  const latestPerio = perioTrend.length ? perioTrend[perioTrend.length - 1] : null;
  const ChartView = clinicalRecord.PatientChart;
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <Link href={backHref} className="text-sm text-muted-foreground underline underline-offset-4">
          ← Back to patient
        </Link>
      </div>

      <InvoicePrintFrame defaultFormat={clinic?.invoicePaper ?? "a4"}>
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">{clinic?.name ?? "Clinic"}</div>
            <div className="text-[0.9em] opacity-70">Clinical chart</div>
          </div>
          <div className="text-right text-[0.9em]">{today}</div>
        </div>

        <div className="mt-2 text-[0.95em]">
          <span className="opacity-70">Patient: </span>
          <span className="font-medium">{patient.fullName}</span>
          {patient.phone ? <span className="opacity-70"> · {patient.phone}</span> : null}
        </div>

        <div className="mt-3">
          <ChartView chart={chart} />
        </div>

        {latestPerio ? (
          <div className="mt-3 border-t border-black/20 pt-2 text-[0.9em]">
            <span className="font-medium">Periodontal (latest): </span>
            BOP {latestPerio.bop}% · deepest pocket {latestPerio.maxPocket} mm
          </div>
        ) : null}

        <div className="mt-3 border-t border-black/20 pt-2 text-center text-[0.8em] opacity-70">
          {clinic?.signature ? <div>{clinic.signature}</div> : null}
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
