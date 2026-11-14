/**
 * Two DEMO clinics with a full calendar year (1 Jan – 31 Dec 2026) of history:
 *
 *   • "Smile Care Dental (Demo)"   — the dental module, voice scribe on.
 *   • "Derma Glow Skin Clinic (Demo)" — CORE features only (modules_enabled
 *     ["derma"], which no module implements yet, so it gets the generic note,
 *     no tooth chart, no scribe).
 *
 * Everything before the moment it runs is history (completed / no-show / cancelled,
 * paid, noted); everything after is a booking still to come. Idempotent: wipes the two
 * clinics (by name) and rebuilds them under the SAME ids, so links survive a re-seed.
 *
 * Run (from the app root, so STORAGE_DIR resolves like the app's):
 *   npx tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/seed-demo-year.ts
 *
 * WHY it is shaped this way — numbers have to be right, not just present:
 *   • MRNs, invoice numbers and receipt numbers are allocated in the ORDER the app
 *     would have allocated them (registration / booking / first money-in), one
 *     running series per clinic, and the clinic's counters are left at the next free
 *     number — so the next real booking in the demo continues the series.
 *   • Appointment numbers are per doctor per day, in booking order (the desk rule).
 *   • What a patient owes is read from the app's own bill (`getAppointmentBill`), and
 *     revenue, doctor shares and discount settlements are derived by the app's own
 *     `backfillClinicSales` — so every report reconciles exactly.
 *   • The petty-cash counts are reckoned with the same formula the drawer uses
 *     (created_at windows over cash payments, refunds, expenses, payouts, transfers).
 */
import "./_seed/tz";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import {
  clinics,
  users,
  patients,
  procedures as proceduresTbl,
  appointments,
  appointmentProcedures,
  patientPayments,
  recalls,
  expenses,
  expenseCategories,
  whatsappMessages,
  invoices,
  doctorPayouts,
  clinicPayments,
  clinicInvoices,
  clinicPriceChanges,
  companySettings,
  visits,
  prescriptions,
  patientMedicalHistory,
  treatmentPlans,
  treatmentPlanItems,
  doctorLeaves,
  doctorProcedureShares,
  cashCounts,
  cashTransfers,
  clinicMedicines,
} from "@/core/db/schema";
import { dentalRecords, labCases } from "@/modules/dental/db/schema";
import { recomputeChart } from "@/modules/dental/db/records";
import type { ChartTeeth, ChartTooth } from "@/modules/dental/db/schema";
import { backfillClinicSales } from "@/core/sales/ledger";
import { getAppointmentBill } from "@/core/billing/bill";
import { paymentKindId } from "@/core/db/vocabulary-seed";
import { findOrCreateCity } from "@/core/clinics/cities";
import { queueSessionKey } from "@/core/appointments/queue";
import { formatMrnLabel } from "@/core/patients/mrn-series";
import type { DayAvailability } from "@/core/lib/availability";
import type { PrescriptionItem } from "@/core/lib/prescription-items";
import type { Allergy, Medication } from "@/core/lib/medical-history";

// ─── time ────────────────────────────────────────────────────────────────────
const YEAR = 2026;
const YEAR_START = new Date(YEAR, 0, 1, 0, 0, 0, 0);
const YEAR_END = new Date(YEAR, 11, 31, 23, 59, 59, 0);
const NOW = new Date();
const TODAY_START = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const DAY = 86400000;
const MIN = 60000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const atTime = (d: Date, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
};
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

// Pakistan public holidays 2026 (Eid dates as announced in advance; a demo, not a calendar).
const HOLIDAYS = new Set([
  "2026-02-05", "2026-03-21", "2026-03-22", "2026-03-23", "2026-05-01",
  "2026-05-27", "2026-05-28", "2026-05-29", "2026-06-25", "2026-06-26",
  "2026-08-14", "2026-11-09", "2026-12-25",
]);
const inRamadan = (d: Date) => d >= new Date(YEAR, 1, 18) && d <= new Date(YEAR, 2, 19);

// ─── deterministic PRNG (re-runs build the same world) ─────────────────────────
let seedState = 1;
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number) => rnd() < p;
const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    if ((r -= w) <= 0) return v;
  }
  return items[items.length - 1][0];
};
const round100 = (n: number) => Math.round(n / 100) * 100;

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// ─── people ────────────────────────────────────────────────────────────────────
const MALE = ["Ahmed", "Ali", "Usman", "Hamza", "Bilal", "Omar", "Imran", "Faisal", "Kashif", "Tariq", "Junaid", "Waqar", "Asad", "Saad", "Danish", "Zeeshan", "Hassan", "Haris", "Fahad", "Adnan", "Shahid", "Naveed", "Rizwan", "Salman", "Arslan", "Kamran", "Talha", "Shoaib", "Yasir", "Moiz", "Abdullah", "Murtaza", "Sohail", "Waseem", "Noman", "Owais"];
const FEMALE = ["Ayesha", "Fatima", "Sara", "Zainab", "Maryam", "Hina", "Sana", "Nadia", "Rabia", "Amna", "Sadia", "Lubna", "Mahnoor", "Iqra", "Aiman", "Areeba", "Hira", "Kiran", "Mehwish", "Saima", "Bushra", "Farah", "Komal", "Anum", "Javeria", "Sidra", "Uzma", "Rida", "Alina", "Maham", "Noor", "Eman", "Laiba", "Hafsa", "Sobia", "Tayyaba"];
const LAST = ["Khan", "Ahmed", "Malik", "Qureshi", "Siddiqui", "Sheikh", "Butt", "Raza", "Hussain", "Iqbal", "Chaudhry", "Farooq", "Mirza", "Abbasi", "Baig", "Rana", "Javed", "Aslam", "Hashmi", "Zaidi", "Rizvi", "Ansari", "Memon", "Shah", "Bhatti", "Nawaz", "Akhtar", "Saleem", "Anwar", "Rehman"];
const AREAS_KHI = ["DHA Phase 6", "Clifton Block 5", "Gulshan-e-Iqbal Block 13", "PECHS Block 2", "North Nazimabad Block H", "Bahadurabad", "Gulistan-e-Jauhar Block 15", "Tariq Road", "Nazimabad No. 3", "Saddar", "Federal B Area Block 10", "Malir Cantt"];
const AREAS_LHR = ["DHA Phase 5", "Gulberg III", "Model Town", "Johar Town", "Bahria Town", "Cantt", "Garden Town", "Faisal Town", "Wapda Town", "Iqbal Town", "Valencia Town", "Township"];
const usedPhones = new Set<string>();
const mobile = () => {
  for (;;) {
    const p = `+923${pick(["0", "1", "2", "3", "4"])}${int(0, 9)}${String(int(0, 9999999)).padStart(7, "0")}`;
    if (!usedPhones.has(p)) {
      usedPhones.add(p);
      return p;
    }
  }
};

// ─── data model of what we will write ───────────────────────────────────────────
type DiscType = "amount" | "percent";
type Bearer = "clinic" | "doctor" | "split";

type ProcDef = {
  key: string;
  name: string;
  price: number;
  service?: boolean;
  offer?: { type: DiscType; value: number; starts: string; ends: string | null };
};

type DocDef = {
  key: string;
  prefix: string;
  name: string;
  username: string;
  fee: number;
  cShare: number;
  pShare: number;
  windows: DayAvailability[];
  leave?: { start: string; end: string; reason: string }[];
};

type LineSpec = {
  proc: string;
  qty?: number;
  tooth?: string;
  /** price typed on the bill (a changed price) */
  price?: number;
  /** patient discount on this line */
  pdisc?: { type: DiscType; value: number; bearer: Bearer; split?: number; fromPlan?: boolean };
  planItemIdx?: number;
};

type Rx = { drug: string; dose: string; form?: Medication["form"]; frequency: Medication["frequency"]; instruction?: Medication["instruction"]; days: number; unit?: "days" | "weeks" | "months"; note?: string };

type NoteSpec = {
  chiefComplaint: string;
  diagnosis: string;
  findings: { tooth?: string | null; finding: string }[];
  treatmentPerformed: string[];
  treatmentPlan?: string[];
  rx?: Rx[];
  nextVisit?: { reason: string; afterDays: number };
  /** dental chart change this visit makes */
  chart?: Record<string, ChartTooth>;
};

type VisitSpec = {
  /** days after the previous visit (first visit: 0) */
  gap: number;
  lines: LineSpec[];
  consult: boolean;
  reason: string;
  note: NoteSpec;
  lab?: { item: string; tooth: string; shade?: string; cost: number; lab: string };
  /** an extra payment taken at this visit toward an earlier visit (instalments) */
  instalmentTo?: number;
};

type EpisodeSpec = {
  kind: string;
  doctor: string;
  visits: VisitSpec[];
  plan?: {
    title: string;
    items: { proc: string; tooth?: string; qty?: number }[];
    discount?: { type: DiscType; value: number };
    note?: string;
  };
  /** money paid up front as patient credit, applied to each visit's bill */
  advance?: number;
  /** patient age range for this kind of episode */
  age?: [number, number];
  gender?: "male" | "female";
  recall?: { reason: string; afterDays: number };
};

type ClinicDef = {
  name: string;
  module: string;
  features: string[];
  city: string;
  province: "sindh" | "punjab";
  areas: string[];
  address: string;
  publicAddress: string;
  ownerPhone: string;
  mrnPrefix: string;
  mrnWidth: number;
  mrnStart: number;
  price: number;
  /** how late each month's subscription was paid (days after the 1st), null = unpaid */
  subscriptionLateness: (month: number) => number | null;
  admin: { username: string; prefix: string; name: string };
  staff: { username: string; role: "receptionist" | "manager"; name: string }[];
  doctors: DocDef[];
  procs: ProcDef[];
  shareOverrides?: { doctor: string; proc: string; pct: number }[];
  episodesPerYear: number;
  makeEpisode: () => EpisodeSpec;
  expenses: (month: number, revenue: number, labCost: number) => { cat: string; amount: number; day: number; vendor: string; method: "cash" | "bank" | "cheque"; note?: string; recurring?: boolean }[];
  pettySpend: string[];
  ownMedicines: { name: string; form: string; strength: string }[];
  scribe: boolean;
  recallReasonDefault: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// DENTAL
// ═══════════════════════════════════════════════════════════════════════════
const weekdays = (from: number, to: number, start: string, end: string): DayAvailability[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ weekday: from + i, start, end }));

const MOLARS = ["16", "17", "26", "27", "36", "37", "46", "47"];
const PREMOLARS = ["14", "15", "24", "25", "34", "35", "44", "45"];
const ANTERIOR = ["11", "12", "13", "21", "22", "23", "31", "32", "33", "41", "42", "43"];
const surfacesFor = (t: string) => (ANTERIOR.includes(t) ? [pick(["M", "D", "B"])] : pick([["O"], ["M", "O"], ["O", "D"], ["M", "O", "D"]]));

const RX_DENTAL = {
  amox: { drug: "Amoxicillin 500 mg", dose: "1 capsule", form: "oral", frequency: "tds", instruction: "after_meal", days: 5 },
  coamox: { drug: "Amoxicillin + Clavulanic acid 625 mg", dose: "1 tablet", form: "oral", frequency: "bd", instruction: "after_meal", days: 5 },
  metro: { drug: "Metronidazole 400 mg", dose: "1 tablet", form: "oral", frequency: "tds", instruction: "after_meal", days: 5 },
  ibu: { drug: "Ibuprofen 400 mg", dose: "1 tablet", form: "oral", frequency: "tds", instruction: "after_meal", days: 3 },
  pcm: { drug: "Paracetamol 500 mg", dose: "2 tablets", form: "oral", frequency: "tds", instruction: "after_meal", days: 3 },
  mef: { drug: "Mefenamic acid 500 mg", dose: "1 tablet", form: "oral", frequency: "tds", instruction: "after_meal", days: 3 },
  chx: { drug: "Chlorhexidine 0.12% mouthwash", dose: "10 ml rinse", form: "other", frequency: "bd", days: 7, note: "Do not eat or drink for 30 minutes after" },
  sensodyne: { drug: "Potassium nitrate toothpaste", dose: "Brush twice daily", form: "topical", frequency: "bd", days: 4, unit: "weeks" },
} satisfies Record<string, Rx>;

const dentalDoctors: DocDef[] = [
  {
    key: "ayesha", prefix: "Dr", name: "Ayesha Siddiqui", username: "demo.dental.ayesha", fee: 2000, cShare: 50, pShare: 40,
    windows: [...weekdays(1, 6, "11:00", "15:00"), ...weekdays(1, 5, "17:00", "21:00")],
    leave: [{ start: "2026-07-13", end: "2026-07-25", reason: "Annual leave" }],
  },
  {
    key: "hamza", prefix: "Dr", name: "Hamza Qureshi", username: "demo.dental.hamza", fee: 2500, cShare: 50, pShare: 35,
    windows: weekdays(1, 6, "17:00", "22:00"),
    leave: [{ start: "2026-12-21", end: "2026-12-26", reason: "Conference — Dubai" }],
  },
  {
    key: "sana", prefix: "Dr", name: "Sana Malik", username: "demo.dental.sana", fee: 1500, cShare: 50, pShare: 40,
    windows: [...weekdays(1, 6, "10:00", "16:00")],
    leave: [{ start: "2026-04-06", end: "2026-04-11", reason: "Family wedding" }],
  },
  {
    key: "faisal", prefix: "Dr", name: "Faisal Rana", username: "demo.dental.faisal", fee: 3000, cShare: 40, pShare: 30,
    windows: [{ weekday: 2, start: "18:00", end: "22:00" }, { weekday: 4, start: "18:00", end: "22:00" }, { weekday: 6, start: "12:00", end: "18:00" }],
  },
];

const dentalProcs: ProcDef[] = [
  { key: "scaling", name: "Scaling & polishing", price: 4000 },
  { key: "deepscaling", name: "Deep scaling & root planing (per quadrant)", price: 6000 },
  { key: "composite", name: "Composite filling", price: 5000 },
  { key: "gic", name: "Glass ionomer filling", price: 3500 },
  { key: "rct_ant", name: "Root canal treatment — anterior", price: 12000 },
  { key: "rct_molar", name: "Root canal treatment — molar", price: 18000 },
  { key: "ext", name: "Tooth extraction", price: 3000 },
  { key: "surg_ext", name: "Surgical extraction (wisdom tooth)", price: 12000 },
  { key: "pfm", name: "PFM crown", price: 15000 },
  { key: "zirconia", name: "Zirconia crown", price: 30000 },
  { key: "whitening", name: "Teeth whitening (in-office)", price: 25000, offer: { type: "percent", value: 20, starts: "2026-08-01", ends: "2026-08-31" } },
  { key: "denture", name: "Complete denture (per arch)", price: 35000 },
  { key: "implant", name: "Dental implant with crown", price: 150000 },
  { key: "braces", name: "Orthodontic braces (metal, full treatment)", price: 180000 },
  { key: "fluoride", name: "Fluoride varnish", price: 2500 },
  { key: "sealant", name: "Pit & fissure sealant (per tooth)", price: 2000 },
  { key: "pa", name: "Periapical X-ray", price: 1000, service: true },
  { key: "opg", name: "OPG X-ray", price: 2500, service: true },
  { key: "meds", name: "Medicines dispensed", price: 800, service: true },
];

function dentalEpisode(): EpisodeSpec {
  const kind = weighted([
    ["checkup", 24], ["filling", 20], ["pain", 10], ["rct", 10], ["extraction", 9], ["gum", 8],
    ["kids", 6], ["whitening", 4], ["denture", 3], ["implant", 2], ["braces", 2], ["wisdom", 2],
  ] as const);
  const general = () => pick(["ayesha", "sana", "hamza"]);
  switch (kind) {
    case "checkup": {
      const opg = chance(0.25);
      const caries = chance(0.3) ? pick([...MOLARS, ...PREMOLARS]) : null;
      return {
        kind, doctor: general(),
        recall: { reason: "6-month check-up & cleaning", afterDays: 180 },
        visits: [{
          gap: 0, consult: true, reason: "Check-up and cleaning",
          lines: [{ proc: "scaling" }, ...(opg ? [{ proc: "opg" }] : [])],
          note: {
            chiefComplaint: pick(["Routine check-up", "Wants teeth cleaned", "Stains on teeth", "Bad breath"]),
            diagnosis: pick(["Generalised plaque and calculus deposits", "Mild generalised gingivitis", "Extrinsic stains with supragingival calculus"]),
            findings: [
              { tooth: null, finding: pick(["Calculus on lower anteriors", "Supragingival calculus, generalised", "Tea/tobacco stains, generalised"]) },
              ...(caries ? [{ tooth: caries, finding: "Early occlusal caries" }] : []),
            ],
            treatmentPerformed: ["Full-mouth scaling and polishing", ...(opg ? ["OPG taken"] : [])],
            treatmentPlan: caries ? [`Composite filling on ${caries}`] : [],
            nextVisit: { reason: "6-month check-up & cleaning", afterDays: 180 },
            chart: caries ? { [caries]: { status: "caries", surfaces: ["O"] } } : undefined,
          },
        }],
      };
    }
    case "filling": {
      const teeth = [pick([...MOLARS, ...PREMOLARS])];
      if (chance(0.3)) teeth.push(pick([...MOLARS, ...PREMOLARS].filter((t) => t !== teeth[0])));
      const material = chance(0.8) ? "composite" : "gic";
      return {
        kind, doctor: general(), recall: { reason: "6-month check-up & cleaning", afterDays: 180 },
        visits: [{
          gap: 0, consult: true, reason: "Filling",
          lines: [{ proc: "pa" }, ...teeth.map((t) => ({ proc: material, tooth: t }))],
          note: {
            chiefComplaint: pick(["Food lodgement in back tooth", "Sensitivity to cold", "Black spot on tooth", "Broken old filling"]),
            diagnosis: `Dental caries — ${teeth.join(", ")}`,
            findings: teeth.map((t) => ({ tooth: t, finding: pick(["Occlusal caries", "Mesial caries, dentine-deep", "Secondary caries under old filling"]) })),
            treatmentPerformed: teeth.map((t) => `${material === "composite" ? "Composite" : "GIC"} restoration ${t}`),
            nextVisit: { reason: "6-month check-up & cleaning", afterDays: 180 },
            chart: Object.fromEntries(teeth.map((t) => [t, { status: "filled", surfaces: surfacesFor(t) } as ChartTooth])),
          },
        }],
      };
    }
    case "pain": {
      const t = pick(MOLARS);
      return {
        kind, doctor: general(),
        visits: [{
          gap: 0, consult: true, reason: "Toothache",
          lines: [{ proc: "pa" }, ...(chance(0.5) ? [{ proc: "meds" }] : [])],
          note: {
            chiefComplaint: `Severe pain in ${t} for ${int(2, 5)} days, worse at night`,
            diagnosis: `Irreversible pulpitis ${t}`,
            findings: [{ tooth: t, finding: "Deep caries approaching pulp, tender on percussion" }],
            treatmentPerformed: ["Examination and periapical X-ray", "Advised root canal treatment"],
            treatmentPlan: [`Root canal treatment ${t}`, `Crown ${t}`],
            rx: [RX_DENTAL.coamox, RX_DENTAL.ibu],
            chart: { [t]: { status: "caries", conditions: ["watch"], note: "Pulpitis — RCT advised" } },
          },
        }],
      };
    }
    case "rct": {
      const t = chance(0.8) ? pick(MOLARS) : pick(ANTERIOR);
      const molar = MOLARS.includes(t);
      const crown = chance(0.6) ? "zirconia" : "pfm";
      const discount = chance(0.4) ? { type: "percent" as const, value: pick([5, 10]) } : undefined;
      return {
        kind, doctor: pick(["ayesha", "hamza"]),
        plan: {
          title: `Root canal and crown — ${t}`,
          items: [{ proc: molar ? "rct_molar" : "rct_ant", tooth: t }, { proc: crown, tooth: t }],
          discount,
          note: "Crown to be placed within 3 weeks of root canal.",
        },
        visits: [
          {
            gap: 0, consult: true, reason: "Root canal treatment",
            lines: [{ proc: "pa" }, { proc: molar ? "rct_molar" : "rct_ant", tooth: t, planItemIdx: 0 }],
            note: {
              chiefComplaint: `Pain in ${t}, sensitive to hot`,
              diagnosis: `Irreversible pulpitis ${t}`,
              findings: [{ tooth: t, finding: "Deep caries involving pulp" }],
              treatmentPerformed: [`Access opening, canal cleaning and shaping ${t}`, `Obturation ${t}`],
              treatmentPlan: [`${crown === "zirconia" ? "Zirconia" : "PFM"} crown ${t}`],
              rx: [RX_DENTAL.coamox, RX_DENTAL.ibu],
              chart: { [t]: { status: "filled", endo: true, surfaces: ["O"] } },
            },
          },
          {
            gap: int(7, 14), consult: false, reason: "Crown preparation",
            lines: [{ proc: crown, tooth: t, planItemIdx: 1 }],
            lab: { item: "crown", tooth: t, shade: pick(["A2", "A3", "B2", "A1"]), cost: crown === "zirconia" ? 9000 : 4500, lab: pick(["Precision Dental Lab", "City Ceramics Lab"]) },
            note: {
              chiefComplaint: "Crown preparation after root canal",
              diagnosis: `Root-treated ${t}`,
              findings: [{ tooth: t, finding: "Asymptomatic, RCT satisfactory on X-ray" }],
              treatmentPerformed: [`Crown preparation ${t}`, "Impression taken, temporary crown cemented"],
              nextVisit: { reason: "Crown cementation", afterDays: 10 },
            },
          },
          {
            gap: int(8, 12), consult: false, reason: "Crown fitting",
            lines: [],
            note: {
              chiefComplaint: "Crown fitting",
              diagnosis: `Root-treated ${t}`,
              findings: [{ tooth: t, finding: "Crown fit and occlusion checked" }],
              treatmentPerformed: [`${crown === "zirconia" ? "Zirconia" : "PFM"} crown cemented on ${t}`],
              nextVisit: { reason: "6-month check-up & cleaning", afterDays: 180 },
              chart: { [t]: { status: "crown", endo: true } },
            },
          },
        ],
      };
    }
    case "extraction": {
      const t = pick([...MOLARS, ...PREMOLARS]);
      return {
        kind, doctor: general(),
        visits: [
          {
            gap: 0, consult: true, reason: "Extraction",
            lines: [{ proc: "pa" }, { proc: "ext", tooth: t }],
            note: {
              chiefComplaint: `Broken tooth ${t}, pain on chewing`,
              diagnosis: `Grossly decayed, non-restorable ${t}`,
              findings: [{ tooth: t, finding: "Root stumps, non-restorable" }],
              treatmentPerformed: [`Extraction ${t} under local anaesthesia`],
              rx: [RX_DENTAL.amox, RX_DENTAL.pcm],
              nextVisit: { reason: "Post-extraction review", afterDays: 7 },
              chart: { [t]: { status: "missing" } },
            },
          },
          ...(chance(0.5)
            ? [{
                gap: 7, consult: false, reason: "Review", lines: [],
                note: {
                  chiefComplaint: "Post-extraction review",
                  diagnosis: "Healing socket",
                  findings: [{ tooth: t, finding: "Socket healing well, no dry socket" }],
                  treatmentPerformed: ["Review, advice on replacement options"],
                  treatmentPlan: ["Discussed implant / bridge"],
                },
              }]
            : []),
        ],
      };
    }
    case "wisdom": {
      const t = pick(["38", "48"]);
      return {
        kind, doctor: "faisal",
        visits: [
          {
            gap: 0, consult: true, reason: "Wisdom tooth",
            lines: [{ proc: "opg" }, { proc: "surg_ext", tooth: t }],
            note: {
              chiefComplaint: `Recurrent swelling and pain behind ${t === "38" ? "lower left" : "lower right"} molars`,
              diagnosis: `Mesioangular impacted ${t} with pericoronitis`,
              findings: [{ tooth: t, finding: "Partially erupted, mesioangular impaction on OPG" }],
              treatmentPerformed: [`Surgical removal of ${t}, sutures placed`],
              rx: [RX_DENTAL.coamox, RX_DENTAL.metro, RX_DENTAL.ibu, RX_DENTAL.chx],
              nextVisit: { reason: "Suture removal", afterDays: 7 },
              chart: { [t]: { status: "missing" } },
            },
          },
          {
            gap: 7, consult: false, reason: "Suture removal", lines: [],
            note: {
              chiefComplaint: "Suture removal",
              diagnosis: "Post-operative review",
              findings: [{ tooth: t, finding: "Healing satisfactory" }],
              treatmentPerformed: ["Sutures removed"],
            },
          },
        ],
      };
    }
    case "gum": {
      const quads = int(2, 4);
      return {
        kind, doctor: pick(["sana", "ayesha"]), recall: { reason: "Periodontal maintenance", afterDays: 90 },
        visits: [{
          gap: 0, consult: true, reason: "Bleeding gums",
          lines: [{ proc: "deepscaling", qty: quads }],
          note: {
            chiefComplaint: "Bleeding gums while brushing",
            diagnosis: pick(["Chronic generalised periodontitis, stage II", "Localised chronic periodontitis"]),
            findings: [{ tooth: null, finding: `Pocket depths 4–6 mm in ${quads} quadrants, bleeding on probing` }],
            treatmentPerformed: [`Scaling and root planing, ${quads} quadrants`],
            rx: [RX_DENTAL.chx, RX_DENTAL.metro],
            nextVisit: { reason: "Periodontal maintenance", afterDays: 90 },
          },
        }],
      };
    }
    case "kids": {
      const teeth = pick([["16", "26"], ["36", "46"], ["16", "26", "36", "46"]]);
      return {
        kind, doctor: "sana", age: [6, 12], recall: { reason: "Child check-up", afterDays: 180 },
        visits: [{
          gap: 0, consult: true, reason: "Child check-up",
          lines: [{ proc: "fluoride" }, ...teeth.map((t) => ({ proc: "sealant", tooth: t }))],
          note: {
            chiefComplaint: "Parents want a check-up for the child",
            diagnosis: "Mixed dentition, caries-free",
            findings: [{ tooth: null, finding: "Deep pits and fissures on first permanent molars" }],
            treatmentPerformed: ["Fluoride varnish applied", ...teeth.map((t) => `Fissure sealant ${t}`)],
            nextVisit: { reason: "Child check-up", afterDays: 180 },
            chart: Object.fromEntries(teeth.map((t) => [t, { status: "sealant" } as ChartTooth])),
          },
        }],
      };
    }
    case "whitening":
      return {
        kind, doctor: "hamza", age: [20, 40],
        visits: [{
          gap: 0, consult: false, reason: "Teeth whitening",
          lines: [{ proc: "scaling" }, { proc: "whitening" }],
          note: {
            chiefComplaint: "Wants whiter teeth before a wedding",
            diagnosis: "Extrinsic and age-related discolouration",
            findings: [{ tooth: null, finding: "Shade A3 at start" }],
            treatmentPerformed: ["Scaling and polishing", "In-office whitening, 3 cycles — final shade A1"],
            rx: [RX_DENTAL.sensodyne],
          },
        }],
      };
    case "denture": {
      const arch = pick(["upper", "lower", "both"]);
      const qty = arch === "both" ? 2 : 1;
      return {
        kind, doctor: "ayesha", age: [58, 78], advance: round100(35000 * qty * 0.5),
        plan: { title: `Complete denture — ${arch === "both" ? "upper and lower" : arch}`, items: [{ proc: "denture", qty }] },
        visits: [
          {
            gap: 0, consult: true, reason: "Denture",
            lines: [{ proc: "denture", qty, planItemIdx: 0 }],
            lab: { item: "denture", tooth: arch === "lower" ? "31" : "11", cost: 8000 * qty, lab: "Precision Dental Lab" },
            note: {
              chiefComplaint: "Difficulty chewing, wants new teeth",
              diagnosis: `Edentulous ${arch === "both" ? "maxilla and mandible" : arch === "upper" ? "maxilla" : "mandible"}`,
              findings: [{ tooth: null, finding: "Well-formed ridges, healthy mucosa" }],
              treatmentPerformed: ["Primary impressions taken"],
              treatmentPlan: ["Jaw relation and try-in", "Denture insertion"],
            },
          },
          {
            gap: 10, consult: false, reason: "Denture try-in", lines: [],
            note: {
              chiefComplaint: "Denture try-in",
              diagnosis: "Complete denture in progress",
              findings: [{ tooth: null, finding: "Bite registration recorded, teeth set-up approved by patient" }],
              treatmentPerformed: ["Jaw relation and wax try-in"],
            },
          },
          {
            gap: 12, consult: false, reason: "Denture fitting", lines: [],
            note: {
              chiefComplaint: "Denture insertion",
              diagnosis: "Complete denture",
              findings: [{ tooth: null, finding: "Good retention and stability" }],
              treatmentPerformed: ["Denture inserted, care instructions given"],
              nextVisit: { reason: "Denture review", afterDays: 7 },
            },
          },
        ],
      };
    }
    case "implant": {
      const t = pick(["36", "46", "26", "16", "21", "11"]);
      return {
        kind, doctor: "faisal", age: [30, 65], advance: 75000,
        plan: { title: `Dental implant — ${t}`, items: [{ proc: "implant", tooth: t }], discount: chance(0.5) ? { type: "amount", value: 10000 } : undefined },
        visits: [
          {
            gap: 0, consult: true, reason: "Implant placement",
            lines: [{ proc: "opg" }, { proc: "implant", tooth: t, planItemIdx: 0 }],
            note: {
              chiefComplaint: `Missing ${t}, wants fixed replacement`,
              diagnosis: `Missing ${t}, adequate bone on OPG`,
              findings: [{ tooth: t, finding: "Edentulous space, bone width adequate" }],
              treatmentPerformed: [`Implant placed at ${t}, cover screw, sutures`],
              rx: [RX_DENTAL.coamox, RX_DENTAL.ibu, RX_DENTAL.chx],
              nextVisit: { reason: "Implant crown after osseointegration", afterDays: 90 },
              chart: { [t]: { status: "implant", note: "Implant placed — awaiting crown" } },
            },
          },
          {
            gap: int(85, 100), consult: false, reason: "Implant crown", lines: [],
            lab: { item: "implant crown", tooth: t, shade: "A2", cost: 18000, lab: "City Ceramics Lab" },
            note: {
              chiefComplaint: "Implant crown",
              diagnosis: `Osseointegrated implant ${t}`,
              findings: [{ tooth: t, finding: "Implant stable, healthy peri-implant tissue" }],
              treatmentPerformed: [`Abutment and screw-retained crown on implant ${t}`],
              nextVisit: { reason: "Implant review", afterDays: 180 },
            },
          },
        ],
      };
    }
    case "braces":
    default: {
      const adjust = (n: number): VisitSpec => ({
        gap: int(28, 35), consult: false, reason: "Braces adjustment", lines: [], instalmentTo: 0,
        note: {
          chiefComplaint: `Braces adjustment #${n}`,
          diagnosis: "Fixed orthodontic treatment in progress",
          findings: [{ tooth: null, finding: pick(["Good progress, spaces closing", "Arch levelling well", "Minor bracket debond on 25, rebonded"]) }],
          treatmentPerformed: [pick(["Archwire changed to 0.016 NiTi", "Archwire changed to 0.018 SS", "Elastic chains replaced"])],
        },
      });
      return {
        kind: "braces", doctor: "hamza", age: [12, 25], advance: 60000,
        plan: { title: "Orthodontic treatment — fixed braces", items: [{ proc: "braces" }], note: "18–24 months. Balance paid in monthly instalments." },
        visits: [
          {
            gap: 0, consult: true, reason: "Braces",
            lines: [{ proc: "opg" }, { proc: "braces", planItemIdx: 0 }],
            note: {
              chiefComplaint: "Crooked front teeth",
              diagnosis: "Class I malocclusion with anterior crowding",
              findings: [{ tooth: null, finding: "Moderate crowding upper and lower anteriors" }],
              treatmentPerformed: ["Upper and lower metal brackets bonded, 0.014 NiTi archwires"],
              treatmentPlan: ["Monthly adjustments", "Retainers at the end of treatment"],
              nextVisit: { reason: "Braces adjustment", afterDays: 30 },
            },
          },
          ...Array.from({ length: 11 }, (_, i) => adjust(i + 1)),
        ],
      };
    }
  }
}

const dentalClinic: ClinicDef = {
  name: "Smile Care Dental (Demo)",
  module: "dental",
  features: ["sales", "finance", "revenue_dashboard", "voice_scribe"],
  city: "Karachi",
  province: "sindh",
  areas: AREAS_KHI,
  address: "Plot 24-C, Khayaban-e-Ittehad, DHA Phase 6, Karachi",
  publicAddress: "Plot 24-C, Khayaban-e-Ittehad, DHA Phase 6, Karachi",
  ownerPhone: "+923001234567",
  mrnPrefix: "SC-",
  mrnWidth: 6,
  mrnStart: 100001,
  price: 15000,
  subscriptionLateness: (m) => (m === 10 ? 4 : m === 6 ? 9 : m % 3 === 0 ? 0 : 2),
  admin: { username: "demo.dental", prefix: "Dr", name: "Kamran Shah" },
  staff: [
    { username: "demo.dental.front", role: "receptionist", name: "Mahnoor Iqbal" },
    { username: "demo.dental.front2", role: "receptionist", name: "Saad Ahmed" },
    { username: "demo.dental.manager", role: "manager", name: "Tariq Javed" },
  ],
  doctors: dentalDoctors,
  procs: dentalProcs,
  shareOverrides: [{ doctor: "faisal", proc: "implant", pct: 50 }, { doctor: "hamza", proc: "braces", pct: 45 }],
  episodesPerYear: 2150,
  makeEpisode: dentalEpisode,
  expenses: (month, revenue, labCost) => [
    { cat: "Rent", amount: 180000, day: 1, vendor: "Property owner", method: "bank", recurring: true },
    { cat: "Salaries", amount: 285000, day: 1, vendor: "Staff payroll", method: "bank", recurring: true, note: "2 receptionists, manager, 2 dental assistants, cleaner" },
    { cat: "Utilities", amount: [5, 6, 7, 8].includes(month) ? int(68000, 82000) : int(38000, 52000), day: 12, vendor: "K-Electric", method: "bank" },
    { cat: "Utilities", amount: int(6000, 9000), day: 14, vendor: "PTCL internet & phone", method: "bank" },
    { cat: "Dental supplies", amount: round100(revenue * (0.07 + rnd() * 0.02)), day: int(3, 8), vendor: pick(["Dental Mart Karachi", "Medident Supplies"]), method: "bank" },
    { cat: "Dental supplies", amount: round100(int(15000, 35000)), day: int(18, 24), vendor: "Dental Mart Karachi", method: "cash" },
    { cat: "Lab fees", amount: labCost, day: 28, vendor: "Precision Dental Lab / City Ceramics Lab", method: "cheque" },
    { cat: "Marketing", amount: int(25, 45) * 1000, day: 5, vendor: "Meta ads", method: "bank" },
    ...(month % 3 === 2 ? [{ cat: "Maintenance", amount: int(12, 28) * 1000, day: 20, vendor: pick(["Chair service — Dentech", "Autoclave service", "AC service"]), method: "cash" as const }] : []),
    ...(month === 3 ? [{ cat: "Equipment", amount: 420000, day: 9, vendor: "Dentech Pakistan", method: "bank" as const, note: "Second dental chair" }] : []),
  ],
  pettySpend: ["Tea and milk", "Courier to lab", "Printer paper", "Cleaning supplies", "Water bottles", "Rider fuel", "Gloves (box)", "Tissue rolls"],
  ownMedicines: [
    { name: "Clove oil (dental)", form: "drops", strength: "" },
    { name: "Benzocaine gel 20%", form: "gel", strength: "20%" },
  ],
  scribe: true,
  recallReasonDefault: "6-month check-up & cleaning",
};

// ═══════════════════════════════════════════════════════════════════════════
// DERMA (core features only)
// ═══════════════════════════════════════════════════════════════════════════
const RX_DERMA = {
  iso: { drug: "Isotretinoin 20 mg", dose: "1 capsule", form: "oral", frequency: "od", instruction: "after_dinner", days: 3, unit: "months", note: "Avoid pregnancy; liver function test at 1 month" },
  doxy: { drug: "Doxycycline 100 mg", dose: "1 capsule", form: "oral", frequency: "od", instruction: "after_breakfast", days: 6, unit: "weeks" },
  adap: { drug: "Adapalene 0.1% gel", dose: "Pea-sized amount", form: "topical", frequency: "hs", days: 3, unit: "months" },
  clinda: { drug: "Clindamycin 1% gel", dose: "Thin layer on spots", form: "topical", frequency: "bd", days: 6, unit: "weeks" },
  bpo: { drug: "Benzoyl peroxide 2.5% face wash", dose: "Wash face", form: "topical", frequency: "bd", days: 3, unit: "months" },
  hq: { drug: "Hydroquinone 4% cream", dose: "Thin layer on patches", form: "topical", frequency: "hs", days: 8, unit: "weeks" },
  tret: { drug: "Tretinoin 0.025% cream", dose: "Thin layer", form: "topical", frequency: "hs", days: 3, unit: "months" },
  mom: { drug: "Mometasone 0.1% cream", dose: "Thin layer", form: "topical", frequency: "od", days: 2, unit: "weeks", note: "Not on the face" },
  terb: { drug: "Terbinafine 250 mg", dose: "1 tablet", form: "oral", frequency: "od", instruction: "after_meal", days: 4, unit: "weeks" },
  keto: { drug: "Ketoconazole 2% cream", dose: "Apply on rash", form: "topical", frequency: "bd", days: 4, unit: "weeks" },
  cet: { drug: "Cetirizine 10 mg", dose: "1 tablet", form: "oral", frequency: "hs", days: 2, unit: "weeks" },
  fexo: { drug: "Fexofenadine 180 mg", dose: "1 tablet", form: "oral", frequency: "od", days: 4, unit: "weeks" },
  minox: { drug: "Minoxidil 5% solution", dose: "1 ml on scalp", form: "topical", frequency: "bd", days: 6, unit: "months" },
  sun: { drug: "Sunscreen SPF 50+", dose: "Apply every 3 hours outdoors", form: "topical", frequency: "other", days: 3, unit: "months" },
  tacro: { drug: "Tacrolimus 0.1% ointment", dose: "Thin layer", form: "topical", frequency: "bd", days: 6, unit: "weeks" },
  emoll: { drug: "Emollient cream (urea 10%)", dose: "Apply liberally after bath", form: "topical", frequency: "bd", days: 3, unit: "months" },
} satisfies Record<string, Rx>;

const dermaDoctors: DocDef[] = [
  {
    key: "nadia", prefix: "Dr", name: "Nadia Hashmi", username: "demo.derma.nadia", fee: 4000, cShare: 50, pShare: 35,
    windows: weekdays(1, 6, "12:00", "18:00"),
    leave: [{ start: "2026-09-07", end: "2026-09-12", reason: "Dermatology conference" }],
  },
  {
    key: "omar", prefix: "Dr", name: "Omar Farooq", username: "demo.derma.omar", fee: 3000, cShare: 50, pShare: 35,
    windows: weekdays(1, 6, "16:00", "21:00"),
  },
  {
    key: "hira", prefix: "Dr", name: "Hira Zaidi", username: "demo.derma.hira", fee: 3000, cShare: 40, pShare: 30,
    windows: [...weekdays(1, 5, "11:00", "17:00")],
    leave: [{ start: "2026-12-14", end: "2026-12-19", reason: "Annual leave" }],
  },
];

const dermaProcs: ProcDef[] = [
  { key: "peel", name: "Chemical peel", price: 8000 },
  { key: "hydra", name: "HydraFacial", price: 12000, offer: { type: "percent", value: 15, starts: "2026-11-01", ends: "2026-12-31" } },
  { key: "carbon", name: "Carbon laser facial", price: 10000 },
  { key: "lhr_face", name: "Laser hair removal — full face", price: 9000 },
  { key: "lhr_ua", name: "Laser hair removal — underarms", price: 6000 },
  { key: "lhr_legs", name: "Laser hair removal — full legs", price: 18000 },
  { key: "mn_prp", name: "Microneedling with PRP (face)", price: 15000 },
  { key: "prp_hair", name: "PRP for hair (per session)", price: 14000 },
  { key: "botox", name: "Botulinum toxin (per area)", price: 25000 },
  { key: "filler", name: "Dermal filler (1 ml)", price: 45000 },
  { key: "qswitch", name: "Q-switch laser (pigmentation)", price: 10000 },
  { key: "cautery", name: "Skin tag / mole removal (electrocautery)", price: 6000 },
  { key: "cryo", name: "Cryotherapy (warts)", price: 4000 },
  { key: "ilk", name: "Intralesional steroid injection", price: 5000 },
  { key: "dermoscopy", name: "Dermoscopy", price: 1500, service: true },
  { key: "patch", name: "Patch test", price: 3000, service: true },
  { key: "products", name: "Skincare products dispensed", price: 3500, service: true },
  { key: "biopsy", name: "Skin biopsy (lab fee)", price: 6000, service: true },
];

const SITES_FACE = ["forehead", "cheeks", "chin and jawline", "both cheeks and forehead"];

function dermaEpisode(): EpisodeSpec {
  const kind = weighted([
    ["acne", 20], ["lhr", 12], ["hydra", 10], ["eczema", 10], ["fungal", 8], ["melasma", 8],
    ["peel", 8], ["prp", 7], ["botox", 7], ["lesion", 6], ["urticaria", 4],
  ] as const);
  const doc = () => pick(["nadia", "omar", "hira"]);
  switch (kind) {
    case "acne": {
      const severe = chance(0.3);
      const site = pick(SITES_FACE);
      const followUps = int(1, 3);
      return {
        kind, doctor: doc(), age: [15, 30],
        visits: [
          {
            gap: 0, consult: true, reason: "Acne", lines: chance(0.4) ? [{ proc: "products", price: pick([2500, 3500, 4200]) }] : [],
            note: {
              chiefComplaint: `Pimples on ${site} for ${int(3, 18)} months`,
              diagnosis: severe ? "Acne vulgaris — moderate to severe, nodulocystic" : "Acne vulgaris — mild to moderate",
              findings: [{ finding: severe ? `Inflammatory papules, pustules and nodules on ${site}; early scarring` : `Comedones and papules on ${site}` }],
              treatmentPerformed: ["Counselling on skincare and diet"],
              rx: severe ? [RX_DERMA.iso, RX_DERMA.bpo, RX_DERMA.sun] : [RX_DERMA.doxy, RX_DERMA.adap, RX_DERMA.clinda, RX_DERMA.bpo],
              nextVisit: { reason: "Acne follow-up", afterDays: 42 },
            },
          },
          ...Array.from({ length: followUps }, (_, i): VisitSpec => ({
            gap: int(35, 49), consult: true, reason: "Acne follow-up",
            lines: i === 0 && chance(0.4) ? [{ proc: "peel" }] : [],
            note: {
              chiefComplaint: "Acne follow-up",
              diagnosis: "Acne vulgaris — improving",
              findings: [{ finding: pick(["50% reduction in lesions", "Few active papules, post-acne marks", "Marked improvement, mild dryness"]) }],
              treatmentPerformed: i === 0 ? ["Review", "Salicylic peel"] : ["Review"],
              rx: severe ? [RX_DERMA.iso, RX_DERMA.emoll] : [RX_DERMA.adap, RX_DERMA.sun],
              nextVisit: i < followUps - 1 ? { reason: "Acne follow-up", afterDays: 42 } : undefined,
            },
          })),
        ],
      };
    }
    case "lhr": {
      const area = weighted([["lhr_face", 5], ["lhr_ua", 3], ["lhr_legs", 2]] as const);
      const price = dermaProcs.find((p) => p.key === area)!.price;
      const sessions = 6;
      const disc = 15;
      const total = Math.round(price * sessions * (1 - disc / 100));
      const label = area === "lhr_face" ? "full face" : area === "lhr_ua" ? "underarms" : "full legs";
      return {
        kind, doctor: pick(["omar", "hira"]), gender: chance(0.85) ? "female" : "male", age: [18, 40],
        advance: chance(0.6) ? round100(total * pick([0.5, 1])) : undefined,
        plan: {
          title: `Laser hair removal — ${label}, 6 sessions`,
          items: Array.from({ length: sessions }, () => ({ proc: area })),
          discount: { type: "percent", value: disc },
          note: "Package price. Sessions 4–6 weeks apart.",
        },
        visits: Array.from({ length: sessions }, (_, i): VisitSpec => ({
          gap: i === 0 ? 0 : int(28, 42), consult: i === 0, reason: `Laser session ${i + 1} of ${sessions}`,
          lines: [{ proc: area, planItemIdx: i }],
          note: {
            chiefComplaint: i === 0 ? `Unwanted hair — ${label}` : `Laser hair removal session ${i + 1}`,
            diagnosis: i === 0 ? pick(["Hirsutism, PCOS ruled out", "Unwanted hair growth"]) : "Laser hair reduction in progress",
            findings: [{ finding: i === 0 ? "Fitzpatrick skin type IV, dark coarse hair" : `${Math.min(90, 20 + i * 15)}% reduction in hair density` }],
            treatmentPerformed: [`Diode laser, ${label}, session ${i + 1}`],
            rx: i === 0 ? [RX_DERMA.sun] : undefined,
            nextVisit: i < sessions - 1 ? { reason: `Laser session ${i + 2}`, afterDays: 35 } : undefined,
          },
        })),
      };
    }
    case "hydra":
      return {
        kind, doctor: pick(["hira", "omar"]), gender: chance(0.8) ? "female" : "male", age: [20, 45],
        visits: [{
          gap: 0, consult: false, reason: "Facial", lines: [{ proc: chance(0.6) ? "hydra" : "carbon" }],
          note: {
            chiefComplaint: pick(["Dull skin before an event", "Open pores and oily skin", "Wants a glow facial"]),
            diagnosis: pick(["Dehydrated, dull skin", "Oily skin with enlarged pores"]),
            findings: [{ finding: "Comedones on T-zone, uneven texture" }],
            treatmentPerformed: ["Facial performed, no adverse reaction"],
            rx: [RX_DERMA.sun],
          },
        }],
      };
    case "eczema": {
      const kindOf = pick(["Atopic dermatitis", "Contact dermatitis", "Chronic plaque psoriasis", "Seborrhoeic dermatitis"]);
      return {
        kind, doctor: doc(),
        visits: [
          {
            gap: 0, consult: true, reason: "Itchy rash", lines: kindOf === "Contact dermatitis" && chance(0.5) ? [{ proc: "patch" }] : [],
            note: {
              chiefComplaint: `Itchy rash on ${pick(["hands", "elbows and knees", "scalp and face", "neck and arms"])}`,
              diagnosis: kindOf,
              findings: [{ finding: kindOf.includes("psoriasis") ? "Well-defined erythematous plaques with silvery scale" : "Erythematous, scaly, excoriated patches" }],
              treatmentPerformed: ["Counselling, trigger avoidance"],
              rx: kindOf.includes("psoriasis") ? [RX_DERMA.mom, RX_DERMA.emoll] : [RX_DERMA.mom, RX_DERMA.cet, RX_DERMA.emoll],
              nextVisit: { reason: "Rash follow-up", afterDays: 28 },
            },
          },
          {
            gap: int(25, 35), consult: true, reason: "Follow-up", lines: [],
            note: {
              chiefComplaint: "Follow-up of rash",
              diagnosis: `${kindOf} — controlled`,
              findings: [{ finding: "Lesions much improved, mild residual dryness" }],
              treatmentPerformed: ["Review, steroid tapered"],
              rx: [RX_DERMA.tacro, RX_DERMA.emoll],
            },
          },
        ],
      };
    }
    case "fungal":
      return {
        kind, doctor: doc(),
        visits: [
          {
            gap: 0, consult: true, reason: "Fungal infection", lines: [],
            note: {
              chiefComplaint: `Ring-shaped itchy rash on ${pick(["groin", "waist", "neck", "thighs"])}`,
              diagnosis: "Tinea corporis / cruris",
              findings: [{ finding: "Annular scaly plaques with active border" }],
              treatmentPerformed: ["Advice: keep area dry, wash clothes separately"],
              rx: [RX_DERMA.terb, RX_DERMA.keto, RX_DERMA.cet],
              nextVisit: { reason: "Fungal follow-up", afterDays: 21 },
            },
          },
          ...(chance(0.6)
            ? [{
                gap: int(20, 28), consult: true, reason: "Follow-up", lines: [],
                note: { chiefComplaint: "Follow-up", diagnosis: "Tinea — resolving", findings: [{ finding: "No active lesions, post-inflammatory pigmentation" }], treatmentPerformed: ["Review"], rx: [RX_DERMA.keto] },
              }]
            : []),
        ],
      };
    case "melasma": {
      const sessions = 3;
      return {
        kind, doctor: "nadia", gender: "female", age: [25, 50],
        plan: { title: "Melasma — Q-switch laser, 3 sessions", items: Array.from({ length: sessions }, () => ({ proc: "qswitch" })), discount: { type: "amount", value: 3000 } },
        visits: Array.from({ length: sessions }, (_, i): VisitSpec => ({
          gap: i === 0 ? 0 : int(28, 35), consult: i === 0, reason: `Melasma session ${i + 1}`,
          lines: [...(i === 0 ? [{ proc: "dermoscopy" }] : []), { proc: "qswitch", planItemIdx: i }],
          note: {
            chiefComplaint: i === 0 ? "Brown patches on cheeks for 2 years" : `Q-switch session ${i + 1}`,
            diagnosis: i === 0 ? "Melasma — mixed type, malar pattern" : "Melasma — improving",
            findings: [{ finding: i === 0 ? "Symmetrical brown macules on both cheeks; MASI 14" : `MASI ${14 - i * 3}` }],
            treatmentPerformed: [`Q-switch Nd:YAG toning, session ${i + 1}`],
            rx: i === 0 ? [RX_DERMA.hq, RX_DERMA.sun] : [RX_DERMA.sun],
            nextVisit: i < sessions - 1 ? { reason: "Q-switch session", afterDays: 30 } : undefined,
          },
        })),
      };
    }
    case "peel": {
      const sessions = 4;
      return {
        kind, doctor: pick(["hira", "nadia"]), age: [18, 40],
        plan: { title: "Chemical peel series — 4 sessions", items: Array.from({ length: sessions }, () => ({ proc: "peel" })), discount: { type: "percent", value: 10 } },
        visits: Array.from({ length: sessions }, (_, i): VisitSpec => ({
          gap: i === 0 ? 0 : int(18, 24), consult: i === 0, reason: `Peel ${i + 1} of ${sessions}`,
          lines: [{ proc: "peel", planItemIdx: i }],
          note: {
            chiefComplaint: i === 0 ? "Post-acne marks and uneven tone" : `Chemical peel session ${i + 1}`,
            diagnosis: "Post-inflammatory hyperpigmentation",
            findings: [{ finding: i === 0 ? "PIH on cheeks, no active acne" : "Improving tone, no irritation" }],
            treatmentPerformed: [`${pick(["Glycolic 35%", "Salicylic 30%", "Lactic 40%"])} peel`],
            rx: [RX_DERMA.sun],
            nextVisit: i < sessions - 1 ? { reason: "Next peel", afterDays: 21 } : undefined,
          },
        })),
      };
    }
    case "prp": {
      const sessions = 4;
      return {
        kind, doctor: "omar", age: [22, 45],
        advance: chance(0.5) ? 40000 : undefined,
        plan: { title: "PRP for hair loss — 4 sessions", items: Array.from({ length: sessions }, () => ({ proc: "prp_hair" })), discount: { type: "amount", value: 6000 } },
        visits: Array.from({ length: sessions }, (_, i): VisitSpec => ({
          gap: i === 0 ? 0 : int(28, 35), consult: i === 0, reason: `PRP session ${i + 1}`,
          lines: [{ proc: "prp_hair", planItemIdx: i }],
          note: {
            chiefComplaint: i === 0 ? "Hair fall and thinning for 1 year" : `PRP session ${i + 1}`,
            diagnosis: i === 0 ? pick(["Androgenetic alopecia — Norwood III", "Female pattern hair loss — Ludwig I", "Telogen effluvium"]) : "Hair loss — on treatment",
            findings: [{ finding: i === 0 ? "Reduced density on vertex and frontal scalp; pull test positive" : "Reduced shedding, new vellus hair" }],
            treatmentPerformed: [`PRP injected on scalp, session ${i + 1}`],
            rx: i === 0 ? [RX_DERMA.minox] : undefined,
            nextVisit: i < sessions - 1 ? { reason: "PRP session", afterDays: 30 } : undefined,
          },
        })),
      };
    }
    case "botox": {
      const filler = chance(0.35);
      return {
        kind, doctor: "nadia", age: [28, 55],
        visits: [
          {
            gap: 0, consult: true, reason: filler ? "Filler" : "Botox",
            lines: filler ? [{ proc: "filler", qty: pick([1, 1, 2]) }] : [{ proc: "botox", qty: pick([1, 2, 3]) }],
            note: {
              chiefComplaint: filler ? "Wants fuller lips / under-eye hollows" : "Forehead lines and crow's feet",
              diagnosis: filler ? "Volume loss" : "Dynamic facial wrinkles",
              findings: [{ finding: filler ? "Mild volume loss, good skin quality" : "Moderate forehead and lateral canthal lines" }],
              treatmentPerformed: [filler ? "Hyaluronic acid filler injected" : "Botulinum toxin injected"],
              nextVisit: { reason: "Review", afterDays: 14 },
            },
          },
          {
            gap: 14, consult: false, reason: "Review", lines: [],
            note: { chiefComplaint: "Two-week review", diagnosis: "Post-procedure review", findings: [{ finding: "Good result, symmetrical" }], treatmentPerformed: ["Review, no touch-up needed"] },
          },
        ],
      };
    }
    case "lesion": {
      const wart = chance(0.4);
      return {
        kind, doctor: doc(),
        visits: [{
          gap: 0, consult: true, reason: wart ? "Warts" : "Skin tags",
          lines: wart ? [{ proc: "cryo", qty: pick([1, 2]) }] : [{ proc: "dermoscopy" }, { proc: "cautery", qty: pick([1, 1, 2]) }],
          note: {
            chiefComplaint: wart ? "Rough growths on fingers" : "Skin tags on neck",
            diagnosis: wart ? "Verruca vulgaris" : "Acrochordons; benign naevus on dermoscopy",
            findings: [{ finding: wart ? "Multiple verrucous papules on fingers" : "Multiple pedunculated skin tags on neck" }],
            treatmentPerformed: [wart ? "Cryotherapy with liquid nitrogen" : "Electrocautery removal"],
            rx: [{ drug: "Fusidic acid 2% cream", dose: "Apply on treated area", form: "topical", frequency: "bd", days: 7 }],
          },
        }],
      };
    }
    case "urticaria":
    default:
      return {
        kind: "urticaria", doctor: doc(),
        visits: [{
          gap: 0, consult: true, reason: "Hives", lines: chance(0.3) ? [{ proc: "patch" }] : [],
          note: {
            chiefComplaint: "Recurrent itchy wheals for 2 months",
            diagnosis: "Chronic spontaneous urticaria",
            findings: [{ finding: "Wheals on trunk and arms, no angioedema" }],
            treatmentPerformed: ["Counselling, avoid NSAIDs"],
            rx: [RX_DERMA.fexo],
            nextVisit: { reason: "Urticaria review", afterDays: 30 },
          },
        }],
      };
  }
}

const dermaClinic: ClinicDef = {
  name: "Derma Glow Skin Clinic (Demo)",
  module: "derma",
  features: ["sales", "finance", "revenue_dashboard"],
  city: "Lahore",
  province: "punjab",
  areas: AREAS_LHR,
  address: "45-B, Main Boulevard, Gulberg III, Lahore",
  publicAddress: "45-B, Main Boulevard, Gulberg III, Lahore",
  ownerPhone: "+923211234567",
  mrnPrefix: "DG-",
  mrnWidth: 6,
  mrnStart: 200001,
  price: 12000,
  // A clinic that paid on time most of the year, slipped in autumn and owes November.
  subscriptionLateness: (m) => (m === 10 ? null : m === 9 ? 18 : m === 8 ? 11 : m % 4 === 0 ? 1 : 3),
  admin: { username: "demo.derma", prefix: "Dr", name: "Rabia Anwar" },
  staff: [
    { username: "demo.derma.front", role: "receptionist", name: "Iqra Saleem" },
    { username: "demo.derma.manager", role: "manager", name: "Adnan Mirza" },
  ],
  doctors: dermaDoctors,
  procs: dermaProcs,
  shareOverrides: [{ doctor: "nadia", proc: "filler", pct: 45 }, { doctor: "nadia", proc: "botox", pct: 45 }],
  episodesPerYear: 1150,
  makeEpisode: dermaEpisode,
  expenses: (month, revenue) => [
    { cat: "Rent", amount: 220000, day: 1, vendor: "Gulberg Properties", method: "bank", recurring: true },
    { cat: "Salaries", amount: 240000, day: 1, vendor: "Staff payroll", method: "bank", recurring: true, note: "Receptionist, manager, 2 nurses, laser technician, cleaner" },
    { cat: "Utilities", amount: [5, 6, 7, 8].includes(month) ? int(75000, 95000) : int(42000, 55000), day: 12, vendor: "LESCO", method: "bank" },
    { cat: "Utilities", amount: int(6000, 9000), day: 14, vendor: "Nayatel internet", method: "bank" },
    { cat: "Consumables", amount: round100(revenue * (0.09 + rnd() * 0.03)), day: int(3, 8), vendor: pick(["Aesthetic Supplies Lahore", "MedSkin Distributors"]), method: "bank", note: "Peels, PRP kits, filler and toxin stock" },
    { cat: "Consumables", amount: round100(int(10000, 25000)), day: int(18, 24), vendor: "MedSkin Distributors", method: "cash" },
    { cat: "Marketing", amount: int(55, 85) * 1000, day: 5, vendor: pick(["Meta ads", "Instagram influencer campaign"]), method: "bank" },
    ...(month % 4 === 1 ? [{ cat: "Maintenance", amount: int(25, 45) * 1000, day: 20, vendor: "Laser machine service", method: "bank" as const }] : []),
    ...(month === 4 ? [{ cat: "Equipment", amount: 650000, day: 16, vendor: "Lumenis distributor", method: "bank" as const, note: "Q-switch laser handpiece" }] : []),
  ],
  pettySpend: ["Tea and biscuits", "Courier", "Printer toner", "Cleaning supplies", "Disposable sheets", "Water bottles", "Cotton and gauze"],
  ownMedicines: [
    { name: "Glow Serum (in-house)", form: "serum", strength: "" },
    { name: "Tranexamic acid 3% cream (compounded)", form: "cream", strength: "3%" },
  ],
  scribe: false,
  recallReasonDefault: "Follow-up",
};

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════════════
type Status = "scheduled" | "confirmed" | "arrived" | "in_progress" | "completed" | "cancelled" | "no_show";

type PatientRec = {
  id?: string;
  fullName: string;
  gender: "male" | "female";
  dob: string;
  phone: string;
  email: string | null;
  address: string;
  reference: string | null;
  registeredAt: Date | null;
  lastVisitAt: Date | null;
  age: number;
};

type ApptRec = {
  id?: string;
  patient: PatientRec;
  doctor: DocDef;
  scheduledAt: Date;
  createdAt: Date;
  status: Status;
  source: "staff" | "whatsapp";
  createdByName: string;
  reason: string;
  consult: boolean;
  lines: LineSpec[];
  visit?: VisitSpec;
  episode: EpisodeRec;
  /** whole-visit discount */
  disc?: { type: DiscType; value: number; bearer: Bearer; split: number };
  consultDisc?: { type: DiscType; value: number; bearer: Bearer };
  bearingV2: boolean;
  bill?: number;
  noteWritten?: "approved" | "draft" | "pending_approval";
};

type EpisodeRec = {
  spec: EpisodeSpec;
  patient: PatientRec;
  appts: ApptRec[];
  planId?: string;
  planItemIds?: string[];
  advanceAt?: Date;
};

const DENTAL_DOCTOR_FOR_PENDING = "sana";

async function wipeClinic(name: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`select id from clinics where name = ${name}`);
  let previousId: string | null = null;
  for (const r of rows.rows as { id: string }[]) {
    previousId = r.id;
    await db.execute(sql`delete from sessions where user_id in (select id from users where clinic_id = ${r.id})`);
    await db.execute(sql`delete from notifications where user_id in (select id from users where clinic_id = ${r.id})`);
    await db.execute(sql`delete from users where clinic_id = ${r.id}`);
    await db.execute(sql`delete from clinics where id = ${r.id}`);
  }
  return previousId;
}

async function seedClinic(def: ClinicDef, seed: number) {
  seedState = seed;
  console.log(`\n━━ ${def.name}`);
  const previousId = await wipeClinic(def.name);
  // Users keep the clinic's id through `set null`, so a re-seed must clear the old
  // logins by username too (they are unique across the platform).
  const allUsernames = [def.admin.username, ...def.staff.map((s) => s.username), ...def.doctors.map((d) => d.username)];
  for (const u of allUsernames) {
    await db.execute(sql`delete from sessions where user_id in (select id from users where username = ${u})`);
    await db.execute(sql`delete from notifications where user_id in (select id from users where username = ${u})`);
    await db.execute(sql`delete from users where username = ${u}`);
  }

  const cityId = await findOrCreateCity(def.city, def.province);
  const activatedAt = new Date(YEAR, 0, 1, 9, 0);
  const [clinic] = await db
    .insert(clinics)
    .values({
      ...(previousId ? { id: previousId } : {}),
      name: def.name,
      modulesEnabled: [def.module],
      featuresEnabled: def.features,
      avgVisitValue: def.module === "dental" ? 6000 : 9000,
      province: def.province,
      cityId,
      address: def.address,
      publicAddress: def.publicAddress,
      country: "Pakistan",
      timezone: "Asia/Karachi",
      ownerName: `${def.admin.prefix} ${def.admin.name}`,
      ownerPhone: def.ownerPhone,
      monthlyPrice: def.price,
      activatedAt,
      status: "active" as never,
      billingCycle: "monthly" as never,
      graceDays: 7,
      mrnPrefix: def.mrnPrefix,
      mrnWidth: def.mrnWidth,
      nextMrn: def.mrnStart,
      createdAt: new Date(YEAR - 1, 11, 20, 11, 0),
    })
    .returning({ id: clinics.id });
  const clinicId = clinic.id;
  await db.insert(clinicPriceChanges).values({ clinicId, price: def.price, effectiveFrom: activatedAt, createdByName: "Super Admin" });

  // ── users ──
  const PASSWORD = "Demo@2026";
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [admin] = await db
    .insert(users)
    .values({ clinicId, username: def.admin.username, passwordHash: hash, role: "clinic_admin" as never, prefix: def.admin.prefix, fullName: def.admin.name, phone: def.ownerPhone, isActive: true })
    .returning({ id: users.id });
  const adminActor = { id: admin.id, name: `${def.admin.prefix}. ${def.admin.name}` };
  const staffIds: { id: string; name: string; role: string }[] = [];
  for (const s of def.staff) {
    const [row] = await db
      .insert(users)
      .values({ clinicId, username: s.username, passwordHash: hash, role: s.role as never, fullName: s.name, phone: mobile(), isActive: true })
      .returning({ id: users.id });
    staffIds.push({ id: row.id, name: s.name, role: s.role });
  }
  const front = staffIds.filter((s) => s.role === "receptionist");
  const docIds = new Map<string, string>();
  for (const d of def.doctors) {
    const [row] = await db
      .insert(users)
      .values({
        clinicId, username: d.username, passwordHash: hash, role: "doctor" as never, prefix: d.prefix, fullName: d.name, phone: mobile(),
        isActive: true, availability: d.windows, flexibleHours: false, consultationFee: d.fee, consultationSharePct: d.cShare, procedureSharePct: d.pShare,
        dailyAppointmentLimit: 24,
      })
      .returning({ id: users.id });
    docIds.set(d.key, row.id);
    for (const l of d.leave ?? []) {
      await db.insert(doctorLeaves).values({ clinicId, doctorId: row.id, startDate: l.start, endDate: l.end, reason: l.reason, createdAt: addDays(new Date(l.start), -14) });
    }
  }
  const docByKey = new Map(def.doctors.map((d) => [d.key, d]));
  const docName = (d: DocDef) => `${d.prefix}. ${d.name}`;

  // ── procedures / services ──
  const procIds = new Map<string, string>();
  const procByKey = new Map(def.procs.map((p) => [p.key, p]));
  for (const p of def.procs) {
    const [row] = await db
      .insert(proceduresTbl)
      .values({
        clinicId, name: p.name, price: p.price, module: def.module, isActive: true, isService: !!p.service,
        ...(p.offer ? { offerType: p.offer.type as never, offerValue: p.offer.value, offerStartsOn: p.offer.starts, offerEndsOn: p.offer.ends, offerBorneBy: "clinic" as never } : {}),
        createdAt: new Date(YEAR - 1, 11, 22),
      })
      .returning({ id: proceduresTbl.id });
    procIds.set(p.key, row.id);
  }
  for (const o of def.shareOverrides ?? []) {
    await db.insert(doctorProcedureShares).values({ clinicId, doctorId: docIds.get(o.doctor)!, procedureId: procIds.get(o.proc)!, sharePct: o.pct });
  }
  for (const m of def.ownMedicines) {
    await db.insert(clinicMedicines).values({ clinicId, name: m.name, form: m.form || null, strength: m.strength || null, createdBy: admin.id, createdByName: adminActor.name });
  }

  // ── schedule the year ──
  const occupied = new Map<string, Set<number>>(); // doctorKey|ymd → minute starts
  const onLeave = (d: DocDef, day: Date) => (d.leave ?? []).some((l) => ymd(day) >= l.start && ymd(day) <= l.end);
  const slotsFor = (d: DocDef, day: Date) => {
    if (day.getDay() === 0 || HOLIDAYS.has(ymd(day)) || onLeave(d, day)) return [];
    const out: number[] = [];
    for (const w of d.windows.filter((w) => w.weekday === day.getDay())) {
      for (let m = toMin(w.start); m + 30 <= toMin(w.end); m += 30) out.push(m);
    }
    return out;
  };
  /** Book the doctor on the first day on/after `from` that has a free slot. */
  const book = (d: DocDef, from: Date, latest?: Date): Date | null => {
    for (let i = 0; i < 30; i++) {
      const day = addDays(from, i);
      if (latest && day > latest) return null;
      const key = `${d.key}|${ymd(day)}`;
      const taken = occupied.get(key) ?? new Set<number>();
      const free = slotsFor(d, day).filter((m) => !taken.has(m));
      if (free.length === 0) continue;
      const m = pick(free);
      taken.add(m);
      occupied.set(key, taken);
      return atTime(day, fromMin(m));
    }
    return null;
  };

  const patientsAll: PatientRec[] = [];
  const newPatient = (spec: EpisodeSpec): PatientRec => {
    const gender = spec.gender ?? (chance(def.module === "derma" ? 0.68 : 0.52) ? "female" : "male");
    const [lo, hi] = spec.age ?? [16, 70];
    const age = int(lo, hi);
    const first = pick(gender === "female" ? FEMALE : MALE);
    const last = pick(LAST);
    const p: PatientRec = {
      id: randomUUID(),
      fullName: `${first} ${last}`,
      gender,
      age,
      dob: ymd(new Date(YEAR - age, int(0, 11), int(1, 28))),
      phone: mobile(),
      email: chance(0.35) ? `${first.toLowerCase()}.${last.toLowerCase()}${int(1, 99)}@example.com` : null,
      address: `House ${int(1, 250)}, ${pick(def.areas)}, ${def.city}`,
      reference: chance(0.7) ? weighted([["Walk-in", 3], ["Google", 3], ["Instagram", def.module === "derma" ? 5 : 2], ["Facebook ad", 2], ["Friend / family", 4], ["Existing patient", 1], ["Doctor referral", 1]] as const) : null,
      registeredAt: null,
      lastVisitAt: null,
    };
    patientsAll.push(p);
    return p;
  };

  const episodes: EpisodeRec[] = [];
  const appts: ApptRec[] = [];
  const lastNewStart = addDays(TODAY_START, 12);
  const yearDays = Math.round((YEAR_END.getTime() - YEAR_START.getTime()) / DAY);
  const target = def.episodesPerYear;

  for (let e = 0; e < target; e++) {
    const spec = def.makeEpisode();
    const doctor = docByKey.get(spec.doctor)!;
    let start = addDays(YEAR_START, int(0, yearDays));
    if (start > lastNewStart) continue; // nobody books a first visit months ahead
    if (inRamadan(start) && chance(0.3)) continue;
    // A returning patient (their earlier course ended before this one starts).
    const returning = chance(0.22) ? patientsAll.find((p) => p.lastVisitAt && p.lastVisitAt < addDays(start, -20) && (!spec.age || (p.age >= spec.age[0] && p.age <= spec.age[1])) && (!spec.gender || p.gender === spec.gender) && chance(0.05)) : undefined;
    const patient = returning ?? newPatient(spec);
    const ep: EpisodeRec = { spec, patient, appts: [] };
    let prev: Date | null = null;
    let lost = false;
    for (let vi = 0; vi < spec.visits.length && !lost; vi++) {
      const v = spec.visits[vi];
      const want: Date = prev ? addDays(prev, v.gap) : start;
      const when = book(doctor, want);
      if (!when || when > YEAR_END) break;
      const isPast = when < NOW;
      const bookedAt = prev
        ? new Date(prev.getTime() + int(20, 50) * MIN) // booked at the desk at the end of the previous visit
        : chance(0.35)
          ? new Date(when.getTime() - int(20, 90) * MIN) // walk-in / same day
          : new Date(atTime(addDays(when, -int(1, 6)), fromMin(int(10 * 60, 20 * 60))).getTime());
      // The clinic opened its books on 1 January: nothing is booked before that.
      const opened = new Date(Math.min(atTime(YEAR_START, "08:30").getTime(), when.getTime() - 15 * MIN));
      const createdAt = bookedAt > NOW ? new Date(NOW.getTime() - int(5, 600) * MIN) : bookedAt < opened ? opened : bookedAt;
      const source = !prev && chance(0.12) ? "whatsapp" : "staff";
      const createdByName = source === "whatsapp" ? null : pick(front).name;

      // A missed visit first (history only), then the real one a few days later.
      if (isPast && when < TODAY_START && chance(0.1)) {
        const missed: Status = chance(0.5) ? "no_show" : "cancelled";
        appts.push({
          id: randomUUID(), patient, doctor, scheduledAt: when, createdAt, status: missed, source, createdByName: createdByName ?? "WhatsApp", reason: v.reason,
          consult: v.consult, lines: v.lines.map((l) => ({ ...l, planItemIdx: undefined })), episode: ep, bearingV2: false,
        });
        if (vi === 0 && chance(0.4)) {
          lost = true;
          break;
        }
        const again = book(doctor, addDays(when, int(1, 5)));
        if (!again || again > YEAR_END) break;
        start = again;
        prev = null;
        // fall through with the rebooked time
        const rec = makeVisitAppt(ep, v, doctor, again, new Date(when.getTime() + int(60, 300) * MIN), "staff", pick(front).name);
        if (rec.scheduledAt >= NOW && ep.appts.some((a) => a.scheduledAt >= NOW)) break;
        appts.push(rec);
        ep.appts.push(rec);
        prev = again;
        if (again >= NOW) break;
        continue;
      }
      const rec = makeVisitAppt(ep, v, doctor, when, createdAt, source, createdByName ?? "WhatsApp");
      appts.push(rec);
      ep.appts.push(rec);
      prev = when;
      // Only the NEXT visit is ever booked ahead; the rest of the course comes later.
      if (when >= NOW) break;
    }
    if (ep.appts.length > 0) {
      episodes.push(ep);
      const first = ep.appts[0];
      if (!patient.registeredAt || first.createdAt < patient.registeredAt) patient.registeredAt = first.createdAt;
      const last = ep.appts[ep.appts.length - 1].scheduledAt;
      if (!patient.lastVisitAt || last > patient.lastVisitAt) patient.lastVisitAt = last;
    }
  }

  function makeVisitAppt(ep: EpisodeRec, v: VisitSpec, doctor: DocDef, when: Date, createdAt: Date, source: "staff" | "whatsapp", by: string): ApptRec {
    let status: Status;
    if (when < TODAY_START) status = "completed";
    else if (when.getTime() + 30 * MIN <= NOW.getTime()) status = "completed";
    else if (when <= NOW) status = chance(0.5) ? "in_progress" : "arrived";
    else if (when < addDays(TODAY_START, 1)) status = pick(["confirmed", "confirmed", "scheduled", "arrived"]) as Status;
    else status = chance(0.35) ? "confirmed" : "scheduled";
    if (status === "arrived" && when > NOW) status = "confirmed";
    const rec: ApptRec = {
      id: randomUUID(),
      patient: ep.patient, doctor, scheduledAt: when, createdAt, status, source, createdByName: by, reason: v.reason, consult: v.consult,
      lines: v.lines.map((l) => ({ ...l })), visit: v, episode: ep, bearingV2: false,
    };
    // Plan lines carry the plan's discount on their own line (no approval needed).
    const pd = ep.spec.plan?.discount;
    if (pd) {
      for (const l of rec.lines) {
        if (l.planItemIdx === undefined) continue;
        const proc = procByKey.get(l.proc)!;
        const itemsTotal = ep.spec.plan!.items.reduce((s, it) => s + procByKey.get(it.proc)!.price * (it.qty ?? 1), 0);
        const lineGross = proc.price * (l.qty ?? 1);
        const value = pd.type === "percent" ? Math.round((lineGross * pd.value) / 100) : Math.round((pd.value * lineGross) / itemsTotal);
        l.pdisc = { type: "amount", value, bearer: "clinic", fromPlan: true };
        rec.bearingV2 = true;
      }
    } else if (rec.lines.length > 0 && chance(0.07)) {
      // A desk discount on one line, borne by the clinic, the doctor or both.
      const l = pick(rec.lines.filter((x) => !procByKey.get(x.proc)!.service).length ? rec.lines.filter((x) => !procByKey.get(x.proc)!.service) : rec.lines);
      const bearer = weighted([["clinic", 6], ["doctor", 2], ["split", 2]] as const);
      l.pdisc = { type: "percent", value: pick([5, 10, 15]), bearer, split: bearer === "split" ? doctor.pShare : undefined };
      rec.bearingV2 = true;
    } else if (chance(0.06)) {
      const bearer = weighted([["clinic", 7], ["doctor", 1], ["split", 2]] as const);
      rec.disc = chance(0.6)
        ? { type: "amount", value: pick([500, 1000, 1500, 2000]), bearer, split: bearer === "split" ? doctor.pShare : 0 }
        : { type: "percent", value: pick([5, 10]), bearer, split: bearer === "split" ? doctor.pShare : 0 };
    }
    if (rec.consult && ep.patient.lastVisitAt && chance(0.15)) {
      // Returning patients often get the consultation at a reduced rate.
      rec.consultDisc = { type: "percent", value: 50, bearer: "clinic" };
      rec.bearingV2 = true;
    }
    // A changed price on the bill now and then (owner's "price changed on one bill").
    for (const l of rec.lines) {
      const p = procByKey.get(l.proc)!;
      if (!l.pdisc && !p.service && p.price >= 10000 && chance(0.03)) l.price = round100(p.price * pick([0.85, 0.9]));
      if (p.key === "meds" || p.key === "products") l.price = l.price ?? round100(p.price * (0.6 + rnd()));
    }
    return rec;
  }

  // Cancel a few FUTURE bookings (the patient called), and a few made today were WhatsApp requests.
  for (const a of appts) if (a.scheduledAt > NOW && chance(0.04)) a.status = "cancelled";

  // Registered when their FIRST booking was made — including a booking they never
  // came to, which still created the patient record at the desk.
  for (const a of appts) {
    if (!a.patient.registeredAt || a.createdAt < a.patient.registeredAt) a.patient.registeredAt = a.createdAt;
  }

  // ── patients (MRN in registration order) ──
  const usedPatients = patientsAll.filter((p) => p.registeredAt);
  usedPatients.sort((a, b) => a.registeredAt!.getTime() - b.registeredAt!.getTime());
  let mrn = def.mrnStart;
  const patientRows = usedPatients.map((p) => ({
    id: p.id!,
    clinicId,
    mrn: mrn,
    mrnLabel: formatMrnLabel(def.mrnPrefix, def.mrnWidth, mrn++),
    fullName: p.fullName,
    phone: p.phone,
    email: p.email,
    dateOfBirth: p.dob,
    gender: p.gender,
    address: p.address,
    reference: p.reference,
    dataConsent: chance(0.92),
    photoConsent: def.module === "derma" ? chance(0.6) : chance(0.3),
    createdAt: p.registeredAt!,
    updatedAt: p.registeredAt!,
  }));
  await chunked(patientRows, 400, (part) => db.insert(patients).values(part));
  await db.update(clinics).set({ nextMrn: mrn }).where(eq(clinics.id, clinicId));
  console.log(`${usedPatients.length} patients (MRN ${def.mrnPrefix}${def.mrnStart} → ${formatMrnLabel(def.mrnPrefix, def.mrnWidth, mrn - 1)})`);

  // ── medical history ──
  const ALLERGIES: Allergy[] = [
    { substance: "Penicillin", reaction: "Rash", severity: "moderate" },
    { substance: "Sulfa drugs", reaction: "Hives", severity: "mild" },
    { substance: "NSAIDs (ibuprofen)", reaction: "Wheezing", severity: "moderate" },
    { substance: "Latex", reaction: "Itching", severity: "mild" },
    { substance: "Lidocaine", reaction: "Palpitations", severity: "mild" },
  ];
  const CONDITIONS = ["Diabetes", "Hypertension", "Asthma / COPD", "Thyroid disorder", "PCOS", "Hepatitis B / C", "Heart disease / valve / stent"];
  const ONGOING: Medication[] = [
    { name: "Metformin 500 mg", form: "oral", frequency: "bd", instruction: "after_meal", durationValue: 3, durationUnit: "years", ongoing: true },
    { name: "Amlodipine 5 mg", form: "oral", frequency: "od", durationValue: 2, durationUnit: "years", ongoing: true },
    { name: "Levothyroxine 50 mcg", form: "oral", frequency: "od", instruction: "before_breakfast", durationValue: 4, durationUnit: "years", ongoing: true },
    { name: "Salbutamol inhaler", form: "inhaler", frequency: "prn", ongoing: true },
    { name: "Aspirin 75 mg", form: "oral", frequency: "od", instruction: "after_lunch", durationValue: 1, durationUnit: "years", ongoing: true },
    { name: "Oral contraceptive pill", form: "oral", frequency: "od", ongoing: true },
  ];
  const historyRows = usedPatients.filter(() => chance(0.45)).map((p) => {
    const conditions: string[] = [];
    const meds: Medication[] = [];
    if (p.age > 40 && chance(0.3)) { conditions.push("Diabetes"); meds.push(ONGOING[0]); }
    if (p.age > 40 && chance(0.3)) { conditions.push("Hypertension"); meds.push(ONGOING[1]); }
    if (chance(0.08)) { conditions.push("Thyroid disorder"); meds.push(ONGOING[2]); }
    if (chance(0.07)) { conditions.push("Asthma / COPD"); meds.push(ONGOING[3]); }
    if (p.gender === "female" && p.age < 40 && chance(0.1)) conditions.push("PCOS");
    if (p.age > 55 && chance(0.12)) { conditions.push("Heart disease / valve / stent"); meds.push(ONGOING[4]); }
    if (chance(0.03)) conditions.push(pick(CONDITIONS));
    const allergies = chance(0.15) ? [pick(ALLERGIES)] : [];
    return {
      clinicId, patientId: p.id!, allergies, conditions: [...new Set(conditions)], medications: meds,
      smoking: p.gender === "male" && chance(0.18) ? pick(["Smoker — 10/day", "Ex-smoker", "Naswar user"]) : null,
      alcohol: null,
      notes: chance(0.1) ? pick(["Anxious patient — explain each step", "Prefers evening appointments", "Pregnant — 2nd trimester (Aug 2026)"]) : null,
      updatedBy: front[0].id, updatedByName: front[0].name, createdAt: p.registeredAt!, updatedAt: p.registeredAt!,
    };
  });
  await chunked(historyRows, 400, (part) => db.insert(patientMedicalHistory).values(part));
  console.log(`${historyRows.length} medical histories`);

  // ── treatment plans ──
  for (const ep of episodes) {
    const plan = ep.spec.plan;
    if (!plan) continue;
    const doctor = docByKey.get(ep.spec.doctor)!;
    const done = ep.appts.filter((a) => a.status === "completed").length;
    const doneItems = new Set(ep.appts.filter((a) => a.status === "completed").flatMap((a) => a.lines.map((l) => l.planItemIdx)).filter((x) => x !== undefined));
    const status = doneItems.size >= plan.items.length && done >= ep.spec.visits.length ? "completed" : doneItems.size > 0 || ep.appts.some((a) => a.status !== "cancelled" && a.status !== "no_show") ? "active" : "proposed";
    const createdAt = ep.appts[0].createdAt;
    const [row] = await db
      .insert(treatmentPlans)
      .values({
        clinicId, patientId: ep.patient.id!, module: def.module, title: plan.title, status: status as never, note: plan.note ?? null, doctorId: docIds.get(doctor.key)!,
        discountType: (plan.discount?.type ?? "amount") as never, discountValue: plan.discount?.value ?? 0, discountBorneBy: "clinic" as never,
        createdBy: front[0].id, createdByName: front[0].name, createdAt, updatedAt: createdAt,
      })
      .returning({ id: treatmentPlans.id });
    ep.planId = row.id;
    ep.planItemIds = [];
    for (let i = 0; i < plan.items.length; i++) {
      const it = plan.items[i];
      const appt = ep.appts.find((a) => a.lines.some((l) => l.planItemIdx === i) && a.status !== "cancelled" && a.status !== "no_show");
      const itemStatus = appt ? (appt.status === "completed" ? "done" : "in_progress") : "planned";
      const [item] = await db
        .insert(treatmentPlanItems)
        .values({
          clinicId, planId: row.id, procedureId: procIds.get(it.proc)!, name: procByKey.get(it.proc)!.name, unitPrice: procByKey.get(it.proc)!.price,
          tooth: it.tooth ?? null, quantity: it.qty ?? 1, status: itemStatus as never, sort: i, createdAt, updatedAt: createdAt,
        })
        .returning({ id: treatmentPlanItems.id });
      ep.planItemIds.push(item.id);
    }
  }
  // A few PROPOSED plans nobody has started yet — the estimate the patient took home.
  for (const ep of episodes.filter((e) => !e.spec.plan && e.appts.some((a) => a.visit?.note.treatmentPlan?.length)).slice(0, 25)) {
    const a = ep.appts.find((x) => x.visit?.note.treatmentPlan?.length)!;
    const t = a.visit!.note.findings.find((f) => f.tooth)?.tooth ?? null;
    const items = def.module === "dental" ? (t && MOLARS.includes(t) ? ["rct_molar", "zirconia"] : ["composite"]) : ["peel", "peel"];
    const [row] = await db
      .insert(treatmentPlans)
      .values({ clinicId, patientId: ep.patient.id!, module: def.module, title: a.visit!.note.treatmentPlan![0], status: "proposed" as never, doctorId: docIds.get(a.doctor.key)!, createdBy: front[0].id, createdByName: front[0].name, createdAt: a.scheduledAt, updatedAt: a.scheduledAt })
      .returning({ id: treatmentPlans.id });
    let i = 0;
    for (const k of items) {
      await db.insert(treatmentPlanItems).values({ clinicId, planId: row.id, procedureId: procIds.get(k)!, name: procByKey.get(k)!.name, unitPrice: procByKey.get(k)!.price, tooth: def.module === "dental" ? t : null, sort: i++, createdAt: a.scheduledAt, updatedAt: a.scheduledAt });
    }
  }

  // ── appointments + lines ──
  appts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const apptRows = appts.map((a) => ({
    id: a.id!,
    clinicId,
    patientId: a.patient.id!,
    doctorId: docIds.get(a.doctor.key)!,
    module: def.module,
    scheduledAt: a.scheduledAt,
    durationMinutes: 30,
    status: a.status as never,
    arrivedAt: a.status === "arrived" || a.status === "in_progress" ? new Date(a.scheduledAt.getTime() - int(0, 15) * MIN) : null,
    reason: a.reason,
    chargeConsultation: a.consult,
    discountType: (a.disc?.type ?? "amount") as never,
    discountValue: a.disc?.value ?? 0,
    discountBorneBy: (a.disc?.bearer ?? "clinic") as never,
    discountSplitType: "percent" as never,
    discountSplitValue: a.disc?.split ?? 0,
    consultationDiscountType: (a.consultDisc?.type ?? "amount") as never,
    consultationDiscountValue: a.consultDisc?.value ?? 0,
    consultationBorneBy: (a.consultDisc?.bearer ?? "clinic") as never,
    discountFromPlan: false,
    bearingVersion: a.bearingV2 ? 2 : 1,
    source: a.source as never,
    createdBy: a.source === "whatsapp" ? null : front.find((f) => f.name === a.createdByName)?.id ?? null,
    createdByName: a.source === "whatsapp" ? null : a.createdByName,
    reminderSentAt: a.scheduledAt.getTime() - a.createdAt.getTime() > DAY && a.scheduledAt.getTime() - DAY < NOW.getTime() ? new Date(atTime(addDays(a.scheduledAt, -1), "10:00")) : null,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
  }));
  await chunked(apptRows, 300, (part) => db.insert(appointments).values(part));

  const lineRows: (typeof appointmentProcedures.$inferInsert)[] = [];
  for (const a of appts) {
    for (const l of a.lines) {
      const p = procByKey.get(l.proc)!;
      const offerOn = p.offer && ymd(a.scheduledAt) >= p.offer.starts && (!p.offer.ends || ymd(a.scheduledAt) <= p.offer.ends);
      lineRows.push({
        clinicId,
        appointmentId: a.id!,
        procedureId: procIds.get(l.proc)!,
        doctorId: docIds.get(a.doctor.key)!,
        name: p.name,
        unitPrice: l.price ?? p.price,
        listPrice: p.price,
        isService: !!p.service,
        quantity: l.qty ?? 1,
        discountType: (offerOn ? p.offer!.type : "amount") as never,
        discountValue: offerOn ? p.offer!.value : 0,
        offerBorneBy: (offerOn ? "clinic" : "proportional") as never,
        patientDiscountType: (l.pdisc?.type ?? "amount") as never,
        patientDiscountValue: l.pdisc?.value ?? 0,
        discountBorneBy: (l.pdisc?.bearer ?? "clinic") as never,
        discountSplitType: "percent" as never,
        discountSplitValue: l.pdisc?.split ?? 0,
        discountFromPlan: !!l.pdisc?.fromPlan,
        createdAt: a.createdAt,
      });
    }
  }
  await chunked(lineRows, 500, (part) => db.insert(appointmentProcedures).values(part));
  // Plan items point at the visit they were booked onto.
  for (const ep of episodes) {
    if (!ep.planItemIds) continue;
    for (const a of ep.appts) {
      for (const l of a.lines) {
        if (l.planItemIdx === undefined || a.status === "cancelled" || a.status === "no_show") continue;
        await db.update(treatmentPlanItems).set({ appointmentId: a.id! }).where(eq(treatmentPlanItems.id, ep.planItemIds[l.planItemIdx]));
      }
    }
  }
  console.log(`${appts.length} appointments, ${lineRows.length} bill lines`);

  // ── appointment numbers: per doctor per day, in booking order ──
  const byDoctorDay = new Map<string, ApptRec[]>();
  for (const a of appts) {
    const k = `${a.doctor.key}|${ymd(a.scheduledAt)}`;
    if (!byDoctorDay.has(k)) byDoctorDay.set(k, []);
    byDoctorDay.get(k)!.push(a);
  }
  const queueUpdates: { id: string; session: string; n: number }[] = [];
  for (const list of byDoctorDay.values()) {
    list.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    list.forEach((a, i) => queueUpdates.push({ id: a.id!, session: queueSessionKey(docIds.get(a.doctor.key)!, a.scheduledAt, a.doctor.windows, false), n: i + 1 }));
  }
  await chunked(queueUpdates, 500, (part) =>
    db.execute(sql`update appointments a set queue_session = v.s, queue_number = v.n::int
      from (values ${sql.join(part.map((u) => sql`(${u.id}::uuid, ${u.session}, ${u.n})`), sql`, `)}) as v(id, s, n)
      where a.id = v.id`),
  );

  // ── invoices: one per booking (sales feature), numbered in booking order ──
  let invNo = 100001;
  const invRows = appts.map((a) => ({
    clinicId,
    appointmentId: a.id!,
    patientId: a.patient.id!,
    invoiceNo: invNo++,
    invoiceYear: YEAR,
    issuedAt: a.source === "whatsapp" ? new Date(a.createdAt.getTime() + int(10, 120) * MIN) : a.createdAt,
    issuedByName: a.source === "whatsapp" ? "Automatic" : a.createdByName,
    issuedBy: a.source === "whatsapp" ? null : front.find((f) => f.name === a.createdByName)?.id ?? null,
    ...(a.status === "cancelled" || a.status === "no_show"
      ? { voidedAt: a.scheduledAt.getTime() < NOW.getTime() ? new Date(a.scheduledAt.getTime() + 60 * MIN) : NOW, voidReason: a.status === "no_show" ? "No-show" : "Cancelled" }
      : {}),
  }));
  await chunked(invRows, 500, (part) => db.insert(invoices).values(part));
  await db.update(clinics).set({ nextInvoiceNo: invNo, invoiceYear: YEAR }).where(eq(clinics.id, clinicId));
  console.log(`${invRows.length} invoices (INV-100001 → INV-${invNo - 1})`);

  // ── bills (from the app's own formula) ──
  for (const a of appts) {
    if (a.status === "cancelled" || a.status === "no_show") continue;
    a.bill = (await getAppointmentBill(clinicId, a.id!)).billTotal;
  }

  // ── payments ──
  type Pay = typeof patientPayments.$inferInsert;
  const pays: Pay[] = [];
  const method = (amount: number) =>
    weighted([["cash", amount > 60000 ? 2 : 6], ["bank", amount > 60000 ? 6 : 3], ["other", 1], ["cheque", amount > 60000 ? 1 : 0]] as const);
  const refFor = (m: string) => (m === "bank" ? `${pick(["JazzCash", "Easypaisa", "IBFT", "Raast"])} ${int(100000, 999999)}` : m === "cheque" ? `Chq ${int(100000, 999999)}` : m === "other" ? "Card" : null);
  const payRow = (a: ApptRec | null, patient: PatientRec, kind: "payment" | "advance" | "advance_applied" | "refund", amount: number, at: Date, m?: string, note?: string): Pay => {
    const mm = m ?? method(amount);
    const by = pick(front);
    return {
      clinicId, patientId: patient.id!, appointmentId: a?.id ?? null, kind: kind as never, amount, method: (kind === "advance_applied" ? "advance" : mm) as never,
      reference: kind === "advance_applied" ? null : refFor(mm), note: note ?? null, occurredAt: at, createdAt: at, updatedAt: at, createdBy: by.id, createdByName: by.name,
    };
  };
  const later = (d: Date, lo: number, hi: number) => {
    const x = atTime(addDays(d, int(lo, hi)), fromMin(int(11 * 60, 20 * 60)));
    return x < NOW ? x : null;
  };

  for (const ep of episodes) {
    let credit = 0;
    if (ep.spec.advance && ep.appts.some((a) => a.status === "completed" || a.status === "in_progress")) {
      const first = ep.appts.find((a) => a.status !== "cancelled" && a.status !== "no_show")!;
      const at = new Date(first.scheduledAt.getTime() - 10 * MIN);
      if (at < NOW) {
        credit = ep.spec.advance;
        pays.push(payRow(null, ep.patient, "advance", credit, at, undefined, ep.spec.plan ? `Advance for ${ep.spec.plan.title}` : "Advance"));
        ep.advanceAt = at;
      }
    }
    for (const a of ep.appts) {
      if (a.status !== "completed" || !a.bill) continue;
      const end = new Date(a.scheduledAt.getTime() + int(25, 45) * MIN);
      if (end > NOW) continue;
      let owed = a.bill;
      if (credit > 0) {
        const use = Math.min(credit, owed);
        pays.push(payRow(a, ep.patient, "advance_applied", use, end));
        credit -= use;
        owed -= use;
      }
      if (owed <= 0) continue;
      const isBraces = ep.spec.kind === "braces" && a === ep.appts[0];
      if (isBraces) continue; // paid in monthly instalments, below
      const roll = rnd();
      const age = (NOW.getTime() - a.scheduledAt.getTime()) / DAY;
      if (roll < 0.86) {
        pays.push(payRow(a, ep.patient, "payment", owed, end));
      } else if (roll < 0.95) {
        const part = round100(owed * (0.4 + rnd() * 0.3));
        pays.push(payRow(a, ep.patient, "payment", part, end));
        const rest = age > 25 || chance(0.4) ? later(a.scheduledAt, 3, 25) : null;
        if (rest) pays.push(payRow(a, ep.patient, "payment", owed - part, rest, undefined, "Balance"));
      } else {
        const rest = age > 45 && chance(0.75) ? later(a.scheduledAt, 7, 40) : null;
        if (rest) pays.push(payRow(a, ep.patient, "payment", owed, rest, undefined, "Paid later"));
      }
    }
    // Braces: the balance in monthly instalments taken at each adjustment.
    if (ep.spec.kind === "braces") {
      const main = ep.appts[0];
      if (main.status === "completed" && main.bill) {
        let remaining = main.bill - (ep.spec.advance ?? 0);
        const adjustments = ep.appts.slice(1).filter((a) => a.status === "completed" && a.scheduledAt < NOW);
        const per = round100(remaining / 12);
        for (const adj of adjustments) {
          if (remaining <= 0) break;
          const amt = Math.min(per, remaining);
          pays.push(payRow(main, ep.patient, "payment", amt, new Date(adj.scheduledAt.getTime() + 30 * MIN), undefined, "Monthly instalment"));
          remaining -= amt;
        }
      }
    }
  }
  // A deposit taken at booking for a visit later cancelled → refunded.
  const refundable = appts.filter((a) => a.status === "cancelled" && a.scheduledAt < NOW && a.lines.some((l) => procByKey.get(l.proc)!.price >= 15000)).slice(0, 8);
  for (const a of refundable) {
    const dep = 5000;
    pays.push(payRow(a, a.patient, "payment", dep, a.createdAt, "cash", "Deposit for booking"));
    const back = new Date(Math.max(a.createdAt.getTime() + 60 * MIN, a.scheduledAt.getTime() - 3 * 60 * MIN));
    pays.push(payRow(a, a.patient, "refund", dep, back, "cash", "Appointment cancelled — deposit returned"));
  }
  pays.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());
  await chunked(pays, 500, (part) => db.insert(patientPayments).values(part));

  // Collected cache + receipt numbers in order of each visit's first money-in.
  await db.execute(sql`
    update appointments a set amount_collected = greatest(0, coalesce((
      select sum(case when pp.kind_id = ${paymentKindId("refund")} then -pp.amount else pp.amount end)
      from patient_payments pp
      where pp.appointment_id = a.id and pp.deleted_at is null
        and pp.kind_id in (${paymentKindId("payment")}, ${paymentKindId("advance_applied")}, ${paymentKindId("refund")})
    ), 0))
    where a.clinic_id = ${clinicId}`);
  const firstMoney = await db.execute<{ id: string }>(sql`
    select pp.appointment_id as id, min(pp.occurred_at) as first_at
    from patient_payments pp
    where pp.clinic_id = ${clinicId} and pp.appointment_id is not null
      and pp.kind_id in (${paymentKindId("payment")}, ${paymentKindId("advance_applied")})
    group by pp.appointment_id order by first_at, pp.appointment_id`);
  let rcp = 100001;
  const rcpRows = (firstMoney.rows as { id: string }[]).map((r) => ({ id: r.id, n: rcp++ }));
  await chunked(rcpRows, 500, (part) =>
    db.execute(sql`update appointments a set receipt_no = v.n::int, receipt_year = ${YEAR}
      from (values ${sql.join(part.map((u) => sql`(${u.id}::uuid, ${u.n})`), sql`, `)}) as v(id, n) where a.id = v.id`),
  );
  await db.update(clinics).set({ nextReceiptNo: rcp, receiptYear: YEAR }).where(eq(clinics.id, clinicId));
  console.log(`${pays.length} payment rows, receipts RCP-100001 → RCP-${rcp - 1}`);

  // ── revenue, shares, settlements — the app's own derivation ──
  console.log("Deriving sales / doctor shares / settlements…");
  await backfillClinicSales(clinicId);

  // ── clinical notes ──
  const dictated = () => def.scribe && chance(0.65);
  let audioKey: string | null = null;
  if (def.scribe) audioKey = await demoAudio(clinicId);
  type VisitInsert = typeof visits.$inferInsert;
  const visitRows: { a: ApptRec; row: VisitInsert }[] = [];
  // The last two dictations of the most recent working day are still drafts waiting for
  // their doctor — what the scribe queue looks like on a real morning.
  const lastDone = appts.filter((a) => a.status === "completed").sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime());
  const lastDay = lastDone.length ? ymd(lastDone[lastDone.length - 1].scheduledAt) : "";
  const draftIds = new Set(def.scribe ? lastDone.filter((a) => ymd(a.scheduledAt) === lastDay).slice(-2).map((a) => a.id) : []);
  const recent = appts.filter((a) => a.status === "completed" && a.scheduledAt < TODAY_START && a.scheduledAt > addDays(TODAY_START, -5));
  const pendingIds = new Set(def.scribe ? recent.filter((a) => a.doctor.key !== DENTAL_DOCTOR_FOR_PENDING && !draftIds.has(a.id)).slice(0, 2).map((a) => a.id) : []);
  for (const a of appts) {
    if (a.status !== "completed" || !a.visit) continue;
    if (!draftIds.has(a.id) && chance(0.04)) continue; // not every visit gets written up
    const n = a.visit.note;
    const note: Record<string, unknown> = {
      chiefComplaint: n.chiefComplaint,
      diagnosis: n.diagnosis,
      findings: n.findings.map((f) => ({ tooth: f.tooth ?? null, finding: f.finding })),
      treatmentPerformed: n.treatmentPerformed,
      treatmentPlan: n.treatmentPlan ?? [],
      prescriptions: (n.rx ?? []).map((r) => ({ drug: r.drug, dosage: `${r.dose}, ${freqText(r.frequency)}`, duration: `${r.days} ${r.unit ?? "days"}` })),
      ...(n.nextVisit ? { nextVisit: n.nextVisit } : {}),
      flags: [],
    };
    const isDict = draftIds.has(a.id) || dictated();
    const isDraft = draftIds.has(a.id);
    const isPending = pendingIds.has(a.id);
    const author = isPending ? docIds.get(DENTAL_DOCTOR_FOR_PENDING)! : docIds.get(a.doctor.key)!;
    const writtenAt = new Date(a.scheduledAt.getTime() + int(20, 40) * MIN);
    a.noteWritten = isDraft ? "draft" : isPending ? "pending_approval" : "approved";
    visitRows.push({
      a,
      row: {
        clinicId, patientId: a.patient.id!, appointmentId: a.id!, doctorId: author, module: def.module,
        status: a.noteWritten as never, note,
        aiDraft: isDict ? aiVersion(note) : null,
        transcript: isDict ? transcriptFor(n) : null,
        audioKey: isDict ? audioKey : null,
        transcribeStartedAt: isDict ? new Date(writtenAt.getTime() - 2 * MIN) : null,
        scribeLanguage: null,
        visitDate: a.scheduledAt,
        approvedAt: a.noteWritten === "approved" ? writtenAt : null,
        approvedBy: a.noteWritten === "approved" ? author : null,
        treatingDoctorId: docIds.get(a.doctor.key)!,
        pendingChart: isPending && n.chart ? n.chart : null,
        createdAt: new Date(writtenAt.getTime() - 3 * MIN),
        updatedAt: writtenAt,
      },
    });
  }
  const visitIdByAppt = new Map<string, string>();
  await chunked(visitRows, 300, async (part) => {
    const ids = await db.insert(visits).values(part.map((p) => p.row)).returning({ id: visits.id, appointmentId: visits.appointmentId });
    for (const r of ids) visitIdByAppt.set(r.appointmentId!, r.id);
  });
  console.log(`${visitRows.length} clinical notes (${visitRows.filter((v) => v.row.audioKey).length} dictated, ${draftIds.size} drafts waiting, ${pendingIds.size} waiting for the treating doctor)`);

  // Prescriptions made from each approved note's medicines (0135), signed by the note's doctor.
  const rxRows: (typeof prescriptions.$inferInsert)[] = [];
  for (const { a, row } of visitRows) {
    if (row.status !== ("approved" as never) || !a.visit?.note.rx?.length) continue;
    rxRows.push({
      clinicId, patientId: a.patient.id!, appointmentId: a.id!, visitId: visitIdByAppt.get(a.id!)!, doctorId: docIds.get(a.doctor.key)!, doctorName: docName(a.doctor),
      prescribedOn: ymd(a.scheduledAt), items: a.visit.note.rx.map(rxItem), notes: rxAdvice(def.module), printDoctorName: true,
      createdBy: docIds.get(a.doctor.key)!, createdByName: docName(a.doctor), createdAt: row.approvedAt as Date, updatedAt: row.approvedAt as Date,
    });
  }
  // …and a few typed at the desk from a paper prescription (walk-in refills).
  for (const p of usedPatients.filter(() => chance(0.015))) {
    if (!p.lastVisitAt || p.lastVisitAt > NOW) continue;
    const d = pick(def.doctors);
    const items = def.module === "dental" ? [rxItem(RX_DENTAL.pcm), rxItem(RX_DENTAL.chx)] : [rxItem(RX_DERMA.sun), rxItem(pick([RX_DERMA.emoll, RX_DERMA.cet, RX_DERMA.adap]))];
    rxRows.push({ clinicId, patientId: p.id!, doctorId: docIds.get(d.key)!, doctorName: docName(d), prescribedOn: ymd(p.lastVisitAt), items, notes: "Refill as advised on phone", printDoctorName: true, createdBy: front[0].id, createdByName: front[0].name, createdAt: p.lastVisitAt, updatedAt: p.lastVisitAt });
  }
  await chunked(rxRows, 400, (part) => db.insert(prescriptions).values(part));
  console.log(`${rxRows.length} prescriptions`);

  // Dental: the per-visit chart record and the living chart (module tables).
  if (def.module === "dental") {
    const charts = new Map<string, ChartTeeth>();
    const recRows: (typeof dentalRecords.$inferInsert)[] = [];
    for (const { a, row } of [...visitRows].sort((x, y) => x.a.scheduledAt.getTime() - y.a.scheduledAt.getTime())) {
      if (row.status !== ("approved" as never)) continue;
      const pid = a.patient.id!;
      const chart = { ...(charts.get(pid) ?? {}) };
      for (const [t, tooth] of Object.entries(a.visit!.note.chart ?? {})) chart[t] = { ...tooth, updatedVisitId: visitIdByAppt.get(a.id!)! };
      charts.set(pid, chart);
      const n = a.visit!.note;
      recRows.push({
        clinicId, patientId: pid, visitId: visitIdByAppt.get(a.id!)!, chiefComplaint: n.chiefComplaint, diagnosis: n.diagnosis,
        findings: n.findings.map((f) => ({ tooth: f.tooth ?? null, condition: f.finding })),
        proceduresDone: n.treatmentPerformed.map((p) => ({ tooth: null, procedure: p })),
        chartAfter: chart, createdAt: row.approvedAt as Date, updatedAt: row.approvedAt as Date,
      });
    }
    await chunked(recRows, 300, (part) => db.insert(dentalRecords).values(part));
    for (const pid of charts.keys()) await db.transaction((tx) => recomputeChart(tx as never, clinicId, pid));
    console.log(`${recRows.length} tooth-chart records, ${charts.size} living charts`);

    // Lab work: crowns, dentures, implant crowns — sent at the prep visit, back in a week.
    const labRows: (typeof labCases.$inferInsert)[] = [];
    for (const a of appts) {
      const lab = a.visit?.lab;
      if (!lab || a.status !== "completed") continue;
      const sent = new Date(a.scheduledAt.getTime() + 2 * 60 * MIN);
      const due = addDays(sent, 7);
      const received = addDays(sent, int(5, 8));
      const fitted = a.episode.appts.find((x) => x.scheduledAt > a.scheduledAt && x.status === "completed");
      const status = fitted ? "fitted" : received < NOW ? "received" : chance(0.5) ? "in_lab" : "sent";
      const item = lab.item;
      labRows.push({
        clinicId, patientId: a.patient.id!, visitId: visitIdByAppt.get(a.id!) ?? null,
        planItemId: a.episode.planItemIds?.[a.lines.find((l) => l.planItemIdx !== undefined)?.planItemIdx ?? 0] ?? null,
        labName: lab.lab, labContactName: lab.lab.startsWith("Precision") ? "Mr. Shafiq" : "Ms. Anila", labContactPhone: lab.lab.startsWith("Precision") ? "+923002223344" : "+923335556677",
        item: item as never, tooth: lab.tooth, shade: lab.shade ?? null, status: (labRows.length % 41 === 7 && status === "fitted" ? "remake" : status) as never,
        sentAt: sent, dueAt: due, receivedAt: status === "sent" || status === "in_lab" ? null : received, cost: lab.cost,
        note: labRows.length % 41 === 7 ? "Shade mismatch — remake requested" : null, createdAt: sent, updatedAt: received < NOW ? received : sent,
      });
    }
    await chunked(labRows, 300, (part) => db.insert(labCases).values(part));
    console.log(`${labRows.length} lab cases`);
  }

  // ── recalls from each note's next-visit, plus the episode's long recall ──
  const recallRows: (typeof recalls.$inferInsert)[] = [];
  for (const { a, row } of visitRows) {
    if (row.status !== ("approved" as never)) continue;
    const nv = a.visit!.note.nextVisit;
    if (!nv) continue;
    // A long interval is a recall; a short follow-up is booked at the desk — and becomes
    // a recall only when the patient left without booking it.
    const nextInCourse = a.episode.appts.some((x) => x.scheduledAt > a.scheduledAt);
    if (nv.afterDays < 60 && nextInCourse) continue;
    const due = addDays(a.scheduledAt, nv.afterDays);
    if (due > addDays(YEAR_END, 120)) continue;
    const cameBack = appts.some((x) => x.patient === a.patient && x.scheduledAt > addDays(due, -30) && x.scheduledAt < addDays(due, 45) && x.status === "completed");
    const booked = appts.some((x) => x.patient === a.patient && x.scheduledAt > NOW && x.scheduledAt > addDays(due, -30));
    const status = cameBack ? "completed" : booked ? "booked" : due < NOW ? "sent" : due < addDays(NOW, 7) ? "sent" : "pending";
    recallRows.push({
      clinicId, patientId: a.patient.id!, sourceVisitId: visitIdByAppt.get(a.id!)!, module: def.module, reason: nv.reason, dueAt: atTime(due, "10:00"),
      status: status as never, sentAt: status === "sent" || status === "booked" || status === "completed" ? atTime(addDays(due, -3), "10:00") : null,
      createdAt: row.approvedAt as Date, updatedAt: row.approvedAt as Date,
    });
  }
  await chunked(recallRows, 500, (part) => db.insert(recalls).values(part));
  console.log(`${recallRows.length} recalls`);

  // ── WhatsApp traffic: confirmations, reminders, a few patient messages ──
  const waRows: (typeof whatsappMessages.$inferInsert)[] = [];
  for (const a of appts) {
    if (chance(0.15)) continue;
    const when = `${a.scheduledAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${a.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    if (a.source === "whatsapp") {
      waRows.push({ clinicId, patientId: a.patient.id!, direction: "inbound" as never, phone: a.patient.phone, status: "received" as never, body: pick(["Salam, I want an appointment", "Can I book for tomorrow evening?", "Appointment chahiye please", "Is the doctor available this week?"]), createdAt: new Date(a.createdAt.getTime() - 3 * MIN), updatedAt: a.createdAt });
    }
    waRows.push({ clinicId, patientId: a.patient.id!, direction: "outbound" as never, phone: a.patient.phone, status: (a.createdAt < addDays(NOW, -1) ? pick(["read", "read", "delivered"]) : "delivered") as never, templateName: "appointment_booked", body: `Your appointment at ${def.name.replace(" (Demo)", "")} with ${docName(a.doctor)} is booked for ${when}.`, createdAt: new Date(a.createdAt.getTime() + MIN), updatedAt: new Date(a.createdAt.getTime() + MIN) });
    const rem = atTime(addDays(a.scheduledAt, -1), "10:00");
    if (a.scheduledAt.getTime() - a.createdAt.getTime() > DAY && rem < NOW && a.status !== "cancelled") {
      waRows.push({ clinicId, patientId: a.patient.id!, direction: "outbound" as never, phone: a.patient.phone, status: pick(["read", "delivered"]) as never, templateName: "appointment_reminder", body: `Reminder: your appointment is tomorrow, ${when}. Reply 1 to confirm or 2 to reschedule.`, createdAt: rem, updatedAt: rem });
      if (chance(0.35)) waRows.push({ clinicId, patientId: a.patient.id!, direction: "inbound" as never, phone: a.patient.phone, status: "received" as never, body: pick(["1", "Confirmed, thank you", "Ji, I will come", "Can I come 30 minutes late?"]), createdAt: new Date(rem.getTime() + int(5, 180) * MIN), updatedAt: new Date(rem.getTime() + int(5, 180) * MIN) });
    }
    if (a.status === "cancelled" && a.scheduledAt > a.createdAt) {
      const c = a.scheduledAt < NOW ? new Date(a.scheduledAt.getTime() - 5 * 60 * MIN) : new Date(NOW.getTime() - 60 * MIN);
      waRows.push({ clinicId, patientId: a.patient.id!, direction: "outbound" as never, phone: a.patient.phone, status: "delivered" as never, templateName: "appointment_cancelled", body: `Your appointment on ${when} has been cancelled. Reply to book another time.`, createdAt: c, updatedAt: c });
    }
  }
  for (const r of recallRows) {
    if (!r.sentAt) continue;
    const at = r.sentAt as Date;
    const p = usedPatients.find((x) => x.id === r.patientId)!;
    waRows.push({ clinicId, patientId: r.patientId, direction: "outbound" as never, phone: p.phone, status: "read" as never, templateName: "recall_reminder", body: `It's time for your ${String(r.reason).toLowerCase()}. Reply to book a visit.`, createdAt: at, updatedAt: at });
  }
  await chunked(waRows, 500, (part) => db.insert(whatsappMessages).values(part));
  console.log(`${waRows.length} WhatsApp messages`);

  // ── expenses: monthly costs, recurring templates, small cash spends from the drawer ──
  const catIds = new Map<string, string>();
  const catNames = [...new Set(def.expenses(1, 0, 0).map((e) => e.cat).concat(["Equipment", "Maintenance", "Miscellaneous"]))];
  for (const c of catNames) {
    const [row] = await db.insert(expenseCategories).values({ clinicId, name: c, createdAt: new Date(YEAR - 1, 11, 22) }).returning({ id: expenseCategories.id });
    catIds.set(c, row.id);
  }
  const revenueByMonth = await db.execute<{ m: number; net: number }>(sql`
    select extract(month from occurred_at at time zone 'Asia/Karachi')::int as m, coalesce(sum(net_amount),0)::int as net
    from sales where clinic_id = ${clinicId} group by 1`);
  const rev = new Map((revenueByMonth.rows as { m: number; net: number }[]).map((r) => [r.m, Number(r.net)]));
  const labByMonth = new Map<number, number>();
  if (def.module === "dental") {
    const lr = await db.execute<{ m: number; c: number }>(sql`select extract(month from sent_at at time zone 'Asia/Karachi')::int as m, coalesce(sum(cost),0)::int as c from lab_cases where clinic_id = ${clinicId} group by 1`);
    for (const r of lr.rows as { m: number; c: number }[]) labByMonth.set(r.m, Number(r.c));
  }
  const expRows: (typeof expenses.$inferInsert)[] = [];
  for (let m = 0; m < 12; m++) {
    for (const e of def.expenses(m, rev.get(m + 1) ?? 0, labByMonth.get(m + 1) ?? 0)) {
      if (e.amount <= 0) continue;
      const day = new Date(YEAR, m, e.day, 13, int(0, 59));
      if (day > NOW) continue;
      const isTemplate = !!e.recurring && m === 0;
      expRows.push({
        clinicId, categoryId: catIds.get(e.cat)!, amount: e.amount, incurredOn: ymd(day), vendor: e.vendor, method: e.method as never,
        reference: e.method === "bank" ? `TRX-${int(10000000, 99999999)}` : e.method === "cheque" ? `Chq ${int(100000, 999999)}` : null,
        note: e.note ?? null, recurring: isTemplate, recurrence: isTemplate ? ("monthly" as never) : null,
        nextRunOn: isTemplate ? ymd(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1)) : null,
        createdBy: admin.id, createdByName: adminActor.name, createdAt: day, updatedAt: day,
      });
    }
  }
  // Petty spends from the drawer, a couple a week.
  for (let d = new Date(YEAR_START); d < NOW; d = addDays(d, int(2, 4))) {
    if (d.getDay() === 0) continue;
    const at = atTime(d, fromMin(int(12 * 60, 20 * 60)));
    if (at > NOW) break;
    const by = pick(front);
    expRows.push({ clinicId, categoryId: catIds.get("Miscellaneous")!, amount: pick([300, 450, 600, 800, 1200, 1500, 2200]), incurredOn: ymd(at), vendor: null, method: "cash" as never, note: pick(def.pettySpend), fromDrawer: true, createdBy: by.id, createdByName: by.name, createdAt: at, updatedAt: at });
  }
  await chunked(expRows, 500, (part) => db.insert(expenses).values(part));
  console.log(`${expRows.length} expenses`);

  // ── doctor payouts: last month's share, paid on the 5th ──
  const payoutRows: (typeof doctorPayouts.$inferInsert)[] = [];
  for (const d of def.doctors) {
    const did = docIds.get(d.key)!;
    const monthly = await db.execute<{ m: number; amt: number }>(sql`
      select m, sum(amt)::int as amt from (
        select extract(month from occurred_at at time zone 'Asia/Karachi')::int as m, share_amount as amt from sale_shares where clinic_id = ${clinicId} and doctor_id = ${did}
        union all
        select extract(month from occurred_at at time zone 'Asia/Karachi')::int as m, settlement_amount as amt from discount_settlements where clinic_id = ${clinicId} and doctor_id = ${did}
      ) x group by m order by m`);
    for (const r of monthly.rows as { m: number; amt: number }[]) {
      const amt = Number(r.amt);
      if (amt <= 0) continue;
      const paidOn = new Date(YEAR, r.m, 5, 18, int(0, 50));
      if (paidOn > NOW) continue;
      const cash = chance(0.2);
      payoutRows.push({
        clinicId, doctorId: did, doctorName: docName(d), amount: amt, method: (cash ? "cash" : "bank") as never,
        reference: cash ? null : `IBFT ${int(100000, 999999)}`, periodStart: ymd(new Date(YEAR, r.m - 1, 1)), periodEnd: ymd(new Date(YEAR, r.m, 0)),
        note: `Share for ${new Date(YEAR, r.m - 1, 1).toLocaleDateString("en-GB", { month: "long" })}`, createdBy: admin.id, createdByName: adminActor.name, createdAt: paidOn,
      });
    }
  }
  if (payoutRows.length) await db.insert(doctorPayouts).values(payoutRows);
  console.log(`${payoutRows.length} doctor payouts`);

  // ── petty cash: Saturday-night count, then the takings banked (float kept) ──
  const FLOAT = 25000;
  let prevAt: Date | null = null;
  let prevCounted = 0;
  let counts = 0;
  for (let d = new Date(YEAR, 0, 3); ; d = addDays(d, 7)) {
    const at = atTime(d, "21:45");
    if (at > NOW) break;
    const counter = pick(front);
    if (!prevAt) {
      await db.insert(cashCounts).values({ clinicId, countedAt: at, countedTotal: FLOAT, note: "Opening float", countedBy: counter.id, countedByName: counter.name, createdAt: at });
      prevAt = at;
      prevCounted = FLOAT;
      counts++;
      continue;
    }
    const mv = await cashBetween(clinicId, prevAt, at);
    const expected = prevCounted + mv;
    const variance = chance(0.85) ? 0 : pick([-500, -200, -1000, 100, 300]);
    const counted = expected + variance;
    await db.insert(cashCounts).values({
      clinicId, countedAt: at, countedTotal: counted, expectedTotal: expected, variance,
      note: variance === 0 ? null : variance < 0 ? pick(["Short — change given wrongly", "Short — checking with reception", "Rs 1,000 note missing, reported to manager"]) : "Extra — patient didn't wait for change",
      countedBy: counter.id, countedByName: counter.name, createdAt: at,
    });
    counts++;
    const bankAt = new Date(at.getTime() + 10 * MIN);
    if (counted > FLOAT && bankAt < NOW) {
      await db.insert(cashTransfers).values({ clinicId, kind: "bank_deposit" as never, amount: counted - FLOAT, occurredAt: bankAt, reference: `Deposit slip ${int(10000, 99999)}`, note: "Week's takings banked", createdBy: admin.id, createdByName: adminActor.name, createdAt: bankAt });
    } else if (counted < FLOAT && bankAt < NOW) {
      await db.insert(cashTransfers).values({ clinicId, kind: "float_topup" as never, amount: FLOAT - counted, occurredAt: bankAt, note: "Float topped up", createdBy: admin.id, createdByName: adminActor.name, createdAt: bankAt });
    }
    prevAt = bankAt;
    prevCounted = FLOAT;
  }
  console.log(`${counts} drawer counts`);

  // ── what the clinic pays FlexicaAI ──
  const [cs] = await db.select({ id: companySettings.id, next: companySettings.nextInvoiceNo }).from(companySettings).limit(1);
  let subNo = cs?.next ?? 0;
  let subs = 0;
  for (let m = 0; m < 12; m++) {
    const issued = new Date(YEAR, m, 1, 10, 0);
    if (issued > NOW) break;
    let invoiceId: string | null = null;
    if (cs) {
      const [inv] = await db
        .insert(clinicInvoices)
        .values({ clinicId, invoiceNo: subNo++, periodStart: ymd(issued), periodEnd: ymd(new Date(YEAR, m + 1, 0)), amount: def.price, dueOn: ymd(new Date(YEAR, m, 1 + 7)), issuedAt: issued, issuedByName: "Super Admin", createdAt: issued })
        .returning({ id: clinicInvoices.id });
      invoiceId = inv.id;
    }
    const late = def.subscriptionLateness(m);
    if (late === null) continue;
    const paidAt = new Date(YEAR, m, 1 + late, 15, 0);
    if (paidAt > NOW) continue;
    await db.insert(clinicPayments).values({ clinicId, amount: def.price, kind: "payment" as never, method: pick(["bank", "bank", "cash"]) as never, reference: `TXN-${int(100000, 999999)}`, monthsCovered: 1, invoiceId, occurredAt: paidAt, recordedByName: "Super Admin", createdAt: paidAt });
    subs++;
  }
  if (cs) await db.update(companySettings).set({ nextInvoiceNo: subNo }).where(eq(companySettings.id, cs.id));
  console.log(`${subs} subscription payments`);

  const summary = await db.execute<Record<string, number>>(sql`
    select
      (select coalesce(sum(net_amount),0) from sales where clinic_id = ${clinicId})::int as revenue,
      (select coalesce(sum(share_amount),0) from sale_shares where clinic_id = ${clinicId})::int as shares,
      (select coalesce(sum(amount),0) from expenses where clinic_id = ${clinicId} and deleted_at is null)::int as expenses`);
  const s = summary.rows[0] as Record<string, number>;
  console.log(`Revenue Rs ${Number(s.revenue).toLocaleString()}, doctor shares Rs ${Number(s.shares).toLocaleString()}, expenses Rs ${Number(s.expenses).toLocaleString()}`);
  return { clinicId, admin: def.admin.username, staff: def.staff.map((x) => x.username), doctors: def.doctors.map((x) => x.username), password: PASSWORD };
}

/** Cash through the drawer in (from, to] by created_at — the drawer's own rule. */
async function cashBetween(clinicId: string, from: Date, to: Date): Promise<number> {
  const r = await db.execute<{ v: number }>(sql`
    select (
      coalesce((select sum(case when kind_id in (${paymentKindId("payment")}, ${paymentKindId("advance")}, ${paymentKindId("opening")}) then amount
                                when kind_id = ${paymentKindId("refund")} then -amount else 0 end)
                from patient_payments where clinic_id = ${clinicId} and deleted_at is null and method_id = 1
                  and created_at > ${from} and created_at <= ${to}), 0)
      - coalesce((select sum(amount) from expenses where clinic_id = ${clinicId} and deleted_at is null and method_id = 1 and created_at > ${from} and created_at <= ${to}), 0)
      - coalesce((select sum(amount) from doctor_payouts where clinic_id = ${clinicId} and method_id = 1 and created_at > ${from} and created_at <= ${to}), 0)
      - coalesce((select sum(amount) from cash_transfers where clinic_id = ${clinicId} and deleted_at is null and kind_id in (1, 2) and created_at > ${from} and created_at <= ${to}), 0)
      + coalesce((select sum(amount) from cash_transfers where clinic_id = ${clinicId} and deleted_at is null and kind_id = 3 and created_at > ${from} and created_at <= ${to}), 0)
    )::int as v`);
  return Number((r.rows[0] as { v: number }).v);
}

// ─── note helpers ────────────────────────────────────────────────────────────
function freqText(f: Rx["frequency"]) {
  return ({ od: "once daily", bd: "twice daily", tds: "three times daily", qid: "four times daily", hs: "at night", prn: "when needed", weekly: "weekly", other: "as directed" } as Record<string, string>)[f ?? "other"];
}
function rxItem(r: Rx): PrescriptionItem {
  return {
    name: r.drug, dose: r.dose, form: r.form, frequency: r.frequency, ...(r.frequency === "other" ? { frequencyOther: "As directed" } : {}),
    instruction: r.instruction, durationValue: r.days, durationUnit: r.unit ?? "days", ...(r.note ? { note: r.note } : {}),
  };
}
function rxAdvice(module: string) {
  return module === "dental"
    ? pick(["Soft diet for 24 hours. Warm salt-water rinses from tomorrow.", "Avoid very hot and cold drinks for 2 days.", "Do not chew on the treated side until the next visit.", null])
    : pick(["Use sunscreen daily. Avoid picking spots.", "Patch-test new products on the arm first.", "Do not use other creams on the face while on this treatment.", null]);
}
function transcriptFor(n: NoteSpec) {
  const rx = (n.rx ?? []).map((r) => `${r.drug} ${freqText(r.frequency)} for ${r.days} ${r.unit ?? "days"}`).join(", ");
  return [
    `Patient came with ${n.chiefComplaint.toLowerCase()}.`,
    n.findings.length ? `On examination ${n.findings.map((f) => (f.tooth ? `tooth ${f.tooth} ${f.finding.toLowerCase()}` : f.finding.toLowerCase())).join(", ")}.` : "",
    `Diagnosis ${n.diagnosis.toLowerCase()}.`,
    n.treatmentPerformed.length ? `Today we did ${n.treatmentPerformed.join(", ").toLowerCase()}.` : "",
    rx ? `Prescribe ${rx}.` : "",
    n.nextVisit ? `Review for ${n.nextVisit.reason.toLowerCase()} after ${n.nextVisit.afterDays} days.` : "",
  ].filter(Boolean).join(" ");
}
/** What the AI first drafted — mostly the same; the doctor's edits are the flywheel. */
function aiVersion(note: Record<string, unknown>) {
  const draft = JSON.parse(JSON.stringify(note)) as Record<string, unknown>;
  if (chance(0.3)) draft.diagnosis = `${String(draft.diagnosis)} (?)`;
  if (chance(0.2)) draft.flags = ["Check medicine dose — audio unclear"];
  return draft;
}

/**
 * One short, silent WAV per clinic for the dictated notes. The real recordings are
 * not something a seed can make; what it can do is keep every "recorded" note honest
 * about having a recording (the scribe-usage figures read `audio_key`) and keep the
 * player working rather than showing an error.
 */
async function demoAudio(clinicId: string): Promise<string> {
  const { saveClinicFile } = await import("@/core/integrations/storage");
  const rate = 8000;
  const seconds = 2;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return saveClinicFile(clinicId, "audio", buf, "wav");
}

async function main() {
  if (new Date().getFullYear() !== YEAR) console.warn(`Note: today is not in ${YEAR}; the whole year will be history or future accordingly.`);
  const results = [];
  // A seed builds whole clinics, platform rows included — it is an admin job, said so
  // once here rather than by muting the guard.
  results.push(await unscoped("demo seed: build the dental demo clinic", () => seedClinic(dentalClinic, 20260101)));
  results.push(await unscoped("demo seed: build the derma demo clinic", () => seedClinic(dermaClinic, 20260202)));
  console.log("\n✅ Done. Logins (password for all: Demo@2026):");
  for (const r of results) {
    console.log(`  admin ${r.admin} · staff ${r.staff.join(", ")} · doctors ${r.doctors.join(", ")}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

