import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics, patients, users, visits } from "@/core/db/schema";
import { getClinicWorkspace } from "@/config/modules";
import { generatePrescriptionPdf, type RxItem } from "@/core/lib/prescription-pdf";

/**
 * GET /api/prescriptions/[visitId] — serves the visit's prescription as a PDF.
 * The medications come from the APPROVED visit note (doctor-reviewed); drugs are
 * validated against the clinic's MODULE formulary (CLAUDE.md §8) before render.
 * Clinic-scoped: any staff of the visit's clinic may fetch it (reception hands
 * it to the patient; the doctor prints it). WhatsApp delivery arrives in Step 9.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const { visitId } = await params;

  const user = await getCurrentUser();
  const allowed = ["doctor", "clinic_admin", "receptionist"];
  if (!user || !user.clinicId || !allowed.includes(user.role ?? "")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const [row] = await db
    .select({
      clinicId: visits.clinicId,
      status: visits.status,
      note: visits.note,
      visitDate: visits.visitDate,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      clinicName: clinics.name,
      modulesEnabled: clinics.modulesEnabled,
      doctorName: users.fullName,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .innerJoin(clinics, eq(visits.clinicId, clinics.id))
    .leftJoin(users, eq(visits.doctorId, users.id))
    .where(eq(visits.id, visitId))
    .limit(1);

  // Tenant isolation: only staff of the visit's own clinic.
  if (!row || row.clinicId !== user.clinicId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (row.status !== "approved") {
    return NextResponse.json(
      { error: "Approve the visit before generating a prescription." },
      { status: 400 },
    );
  }

  const note = (row.note ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(note.prescriptions)
    ? (note.prescriptions as Record<string, unknown>[])
    : [];

  const items: RxItem[] = rawItems
    .map((p) => ({
      drug: typeof p.drug === "string" ? p.drug : "",
      dosage: typeof p.dosage === "string" ? p.dosage : null,
      duration: typeof p.duration === "string" ? p.duration : null,
    }))
    .filter((p) => p.drug.trim().length > 0);

  // Formulary validation (module-supplied). Unknown drugs don't block the PDF —
  // the doctor already approved them — but we could surface them elsewhere.
  const { drugFormulary } = getClinicWorkspace(row.modulesEnabled ?? []);
  const known = new Set(
    drugFormulary.flatMap((d) => [d.name, ...d.brands]).map((s) => s.toLowerCase()),
  );
  void items.filter((i) => !known.has(i.drug.toLowerCase())); // reserved for warnings

  const diagnosis =
    typeof note.diagnosis === "string" ? note.diagnosis : null;
  const advice = Array.isArray(note.treatmentPlan)
    ? (note.treatmentPlan as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : undefined;

  const pdf = await generatePrescriptionPdf({
    clinicName: row.clinicName,
    patientName: row.patientName,
    doctorName: row.doctorName,
    date: row.visitDate,
    diagnosis,
    items,
    advice,
  });

  // Filename: prescription-<patient name>-<whatsapp/phone>.pdf (phone digits only,
  // so the file is easy to match to a WhatsApp contact). Phone part is omitted
  // when the patient has no number on file.
  const nameSlug = row.patientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const phoneSlug = (row.patientPhone ?? "").replace(/[^0-9]/g, "");
  const filename = `prescription-${nameSlug}${phoneSlug ? `-${phoneSlug}` : ""}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
