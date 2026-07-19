# Dental clinical depth — plan

> **Status: PLANNED (2026-07-17; revised 2026-07-20).** Turns the dental module
> from a thin shell (scribe + recalls + formulary + procedure templates) into a real
> clinical record: **tooth chart / odontogram**, **periodontal charting**, **medical
> & dental history + allergies**, **clinical imaging**, **multi-visit treatment
> plans**, and **lab-case tracking**. Owner decisions (2026-07-17): build the **full
> arc**; imaging + the treatment-plan engine are **core** (derma/hair reuse them),
> tooth chart + perio + lab stay **module**; the tooth chart is a **living per-patient
> odontogram + per-visit change history**.
>
> **2026-07-20 revision** — closed the review gaps: added **periodontal charting**
> (Phase 2), **medical/dental history + allergies** (Phase 3, core, gates the
> formulary), **baseline/intake charting** (Phase 1), an enumerated **tooth-status
> vocabulary** (§3), a **re-fold-on-edit** invariant (§7), **treatment-consent**
> capture (Phase 4), and **booking-from-plan** (Phase 5). Migration numbers rebased
> to **0044+** (0043 = recurring-expenses, already shipped).
>
> Companion of `docs/overview-report-plan.md` / `docs/discount-bearing-plan.md`.
> Same bar per phase: DB-tested reconciliation, `tsc` clean, unit + e2e green.

---

## 0. Where the module is today (the shell)

- **Module contract** (`core/types/module.ts` `ModuleDefinition`): `scribePrompt`,
  `recallRules`, `drugFormulary`, `navItems`, `procedureTemplates` — plus a
  deliberately **empty `components` slot** (deferred until the panel needed it).
- **Clinical data is unstructured.** The dental scribe (`modules/dental/prompts/
  scribe.ts`) emits generic JSON (incl. a `findings[].tooth` FDI string) that lands
  in **`visits.note` JSONB**, edited by the *generic* introspecting `NoteEditor`
  (`core/ui/note-editor.tsx`). No `dental_records`, odontogram, perio, plan, lab,
  imaging, or structured medical history.
- **No clinical history view.** `patients/[id]` shows appointments + a finance card only.
- **Storage** (`core/integrations/storage`) already does clinic-namespaced save/serve
  (avatars, audio) — imaging rides on it; served via an authorized route like
  `/api/me/avatar`.
- **Drizzle** reads a **single** schema file (`drizzle.config.ts →
  src/core/db/schema.ts`; db client `import * as schema`). Module-owned tables need a
  one-line config change (drizzle-kit `schema` accepts an array of paths).

---

## 1. The core-vs-module split (the governing decision)

§5 ("specialty data in related tables") vs §12 ("don't over-abstract for derma yet").
Resolved split — keeps the 70–80% core ratio honest, makes adding derma touch only
`/modules` + the registry:

| Capability | Home | Rationale |
|---|---|---|
| Tooth chart / odontogram + `dental_records` | **Dental module** | FDI teeth, specialty UI |
| Periodontal charting (`perio_exams`) | **Dental module** | Pocket depths/BOP are dental |
| Lab cases (crowns/dentures) | **Dental module** | Dental workflow |
| Medical & dental history + allergies | **Core** | Every specialty needs it; gates the formulary |
| Imaging / photo attachments + photo consent | **Core** | Derma/hair need before/after photos too |
| Treatment-plan **engine** (multi-visit, priced) | **Core** | Mirrors `procedures` (core) + `procedureTemplates` (module); derma/hair plan courses |
| Treatment-plan **templates** (RCT+crown, …) | **Dental module** | The clinical content is dental |

**Build concretely, don't gold-plate for derma.** Core here means "specialty-agnostic
table + engine," not a speculative plugin framework — the same way `procedures`/`sales`
are core today without knowing about dental.

## 2. Architecture decisions

1. **Module-owned schema.** Dental tables live in **`src/modules/dental/db/schema.ts`**,
   NOT core `schema.ts`. Wire-up:
   - `drizzle.config.ts`: `schema: ["./src/core/db/schema.ts", "./src/modules/**/db/schema.ts"]`.
   - `core/db/index.ts`: merge module schema into the drizzle client
     (`{ ...coreSchema, ...dentalSchema }`) — the client is core-owned but the *table
     defs* are module-owned, so **core never imports a specialty table by name**;
     module code imports its own. Core stays agnostic; adding derma is a new file the
     glob already covers.
   - Core tables (`clinical_attachments`, `treatment_plans*`, `patient_medical_history`,
     `patients.photo_consent`) stay in core `schema.ts`.
2. **`ModuleDefinition.clinicalRecord`** — the deferred `components` slot, finally added:
   an optional `{ VisitEditor, PatientChart, seedFromNote }` bundle. The scribe/visit
   screen renders `module.clinicalRecord?.VisitEditor` (the tooth + perio chart) when the
   enabled module supplies one, falling back to the generic `NoteEditor`. Core renders it
   by the contract, never knowing it's a tooth chart.
3. **Living chart + history.** One **current per-patient odontogram** (always-visible
   "today's mouth"); each visit records the **tooth-level changes** that produced it
   (audit + timeline). Current state is the reduction of the change log — stored
   materialised for fast reads, rebuildable from history. **Genesis = an intake
   baseline** (§4): the first `dental_record` (flagged `is_baseline`) captures the
   patient's *existing* restorations/missing teeth without inventing a treatment event,
   so the living chart starts from reality, not empty.
4. **`visits` stays the core clinical event** (transcript, audio, approval, narrative);
   the structured dental payload moves into `dental_records` (1:1 with a visit).
   `visits.note` keeps the free narrative; no specialty columns on core tables (§12).
5. **Perio is periodic, not folded.** Unlike the restorative chart, periodontal status is
   re-measured wholesale at each exam, so `perio_exams` stores a **full snapshot per
   exam** and "current perio" = the latest exam (no living-reduction table needed).

---

## 3. Data model

### Dental module tables (`src/modules/dental/db/schema.ts`)

**`dental_records`** — 1:1 with a `visit` (the structured dental note for that visit).
- `id`, `clinic_id`→clinics, `patient_id`→patients, `visit_id`→visits (**unique**,
  cascade), `is_baseline` bool (default false — the intake snapshot has no `visit`
  treatment semantics), `chief_complaint`, `diagnosis`, `findings` jsonb (`{tooth,
  surfaces[], condition, note}[]` — FDI), `procedures_done` jsonb (`{tooth, procedure,
  note}[]`), `chart_after` jsonb (per-tooth status snapshot AFTER this visit — the
  history frame), soft-delete, timestamps. Migration seeds from the scribe's structured
  output.

**`dental_charts`** — the living per-patient odontogram (1 row/patient).
- `id`, `clinic_id`, `patient_id` (**unique**), `teeth` jsonb (FDI → `{status,
  surfaces, note, updatedVisitId}`), `updated_at`. The materialised current state;
  each approved `dental_record` folds its changes in.
- **Tooth-status vocabulary** (fixed enum, so the chart is consistent — module-owned
  in `modules/dental/tooth-status.ts`): `sound`, `caries`, `filled`, `crown`,
  `bridge_pontic`, `bridge_abutment`, `veneer`, `sealant`, `root_canal`, `implant`,
  `fractured`, `to_extract`, `missing`, `unerupted`, `watch`. Surfaces use FDI
  M/D/O(I)/B(F)/L(P).

**`perio_exams`** — a full periodontal chart per examination (Phase 2).
- `id`, `clinic_id`, `patient_id`, `visit_id`→visits (`set null`; a perio exam may be
  standalone), `exam_date`, `teeth` jsonb (FDI → `{pockets:[6], recession:[6],
  bleeding:[6 bool], suppuration:[6 bool], mobility:0-3, furcation:0-3, plaque:bool}`;
  6 sites = MB, B, DB, ML, L, DL), `bop_percent` int (derived summary), `note`,
  `charted_by(+name)` snapshot, soft-delete, timestamps. Current perio = the most
  recent exam; the timeline shows pocket-depth trend per tooth.

**`lab_cases`** — crowns/dentures/appliances (Phase 6).
- `id`, `clinic_id`, `patient_id`, `visit_id`→visits (`set null`), `plan_item_id`→
  treatment_plan_items (`set null`), `lab_name`, `item` (crown/bridge/denture…),
  `tooth` (FDI, nullable), `shade`, `status` (`sent|in_lab|received|fitted|remake`),
  `sent_at`, `due_at`, `received_at`, `cost` int (PKR), `note`, soft-delete, timestamps.
  Status changes fire the "your crown is ready" WhatsApp via existing notifications.

### Core tables (`src/core/db/schema.ts`)

**`patient_medical_history`** (Phase 3) — 1:1 with a patient, specialty-agnostic.
- `id`, `clinic_id`, `patient_id` (**unique**, cascade), `allergies` jsonb
  (`{substance, reaction, severity}[]` — drug + material, e.g. penicillin, latex,
  LA), `conditions` jsonb (flags + notes: diabetes, hypertension, cardiac /
  endocarditis-prophylaxis, bleeding disorder / anticoagulants, bisphosphonates,
  asthma, epilepsy, hepatitis, pregnancy, immunocompromised…), `current_medications`
  jsonb (`{name, dose, note}[]`), `smoking` / `alcohol` (free-text), `notes`,
  `updated_by(+name)` snapshot, `updated_at`. **Gates the drug formulary**: prescribing
  a drug whose class matches a recorded allergy raises a hard warning (doctor must
  override with a reason); an **allergy banner** shows on every clinical screen for the
  patient. Read-only allergy view is safety-relevant, so it's visible to reception (see
  §6). Simple structured payload, no versioning v1 (the `updated_by`/`updated_at`
  snapshot + the audit log cover "who changed what").

**`clinical_attachments`** (Phase 4) — imaging/photos/docs/consent, specialty-agnostic.
- `id`, `clinic_id`, `patient_id`, `visit_id`→visits (`set null`), `kind`
  (`xray|photo|document|consent`), `storage_key`, `mime`, `caption`, `taken_at`,
  `is_photo` bool (drives consent gate), `uploaded_by(+name)` snapshot, soft-delete,
  timestamps. Bytes via `saveClinicFile(clinicId, "clinical", …)`; served by a new
  authorized route `GET /api/clinical/attachment/[id]` (clinic-scoped, permission-checked).
  A `kind=consent` row is how a signed **treatment-consent** form is captured (upload a
  scan/photo of the signed form; the visit/plan references it).

**`patients.photo_consent`** bool (default false) — gates uploading/showing `is_photo`
attachments (CLAUDE.md §10 consent). Separate from the existing `data_consent`.

**`treatment_plans`** (Phase 5) — a multi-visit course, specialty-agnostic.
- `id`, `clinic_id`, `patient_id`, `module` (free-text tag), `title`, `status`
  (`proposed|active|completed|cancelled`), `note`, `created_by(+name)`, soft-delete,
  timestamps.

**`treatment_plan_items`** — the planned procedures.
- `id`, `clinic_id`, `plan_id`→treatment_plans (cascade), `procedure_id`→procedures
  (`set null`; priced catalog link), `name` + `unit_price` (**snapshots**, like
  `appointment_procedures`), `tooth` (FDI, nullable — dental fills this; derma/hair
  leave null), `quantity`, `status` (`planned|in_progress|done|cancelled`),
  `appointment_id`→appointments (`set null`; set when scheduled/done), `sort`, timestamps.
  A scheduled item mints an `appointment_procedures` line so plans feed **Sales** exactly
  like ad-hoc procedures (one money path, no new billing logic).

Migrations start at **0044** (0043 = recurring-expenses, already shipped). Each phase =
its own additive migration; every new table gets `clinic_id`, soft-delete (where
deletable), and clinic-scoped indexes.

---

## 4. Tooth chart + scribe integration

- **Component** `modules/dental/components/tooth-chart.tsx` — FDI odontogram (permanent
  + primary), per-tooth status/surfaces from the §3 vocabulary, click-to-edit; pure
  client, theme-aware, reuses app UI. A sibling `perio-chart.tsx` renders the 6-site
  periodontal grid. Exposed via `dentalModule.clinicalRecord.VisitEditor` / `.PatientChart`.
- **Baseline / intake charting** — on a patient's first dental encounter, the doctor can
  chart **existing** conditions directly into a `dental_record` flagged `is_baseline`
  (no procedures, just current state). This seeds the living `dental_chart`; every later
  visit records *changes* against it. Without a baseline the chart would pretend a new
  patient has a virgin mouth.
- **Scribe upgrade** — dental prompt emits structured per-tooth findings/procedures
  (already near this with `findings[].tooth`); `seedFromNote(note)` maps the draft into
  the chart editor so the doctor reviews a **pre-filled chart**, not raw JSON. Still a
  **draft until approved** (§7) — approving writes `dental_records` + folds changes into
  `dental_charts`, in the same transaction as the visit approval.
- **Patient clinical history** — a new tab on `patients/[id]`: the allergy/medical
  banner, the current odontogram + latest perio, and a visit timeline (each visit's
  findings/procedures, note, attachments, Rx). This is the "clinical record" the app
  currently lacks.

## 5. Phases

**Phase 0 — Foundations.** Module-schema wiring (drizzle glob + merged client),
`ModuleDefinition.clinicalRecord` slot, patient **clinical-history tab** scaffold
(reads existing visits/notes). No new clinical tables yet — proves the plumbing.

**Phase 1 — Tooth chart / odontogram.** `dental_records` (+ `is_baseline`) +
`dental_charts` (module schema, migration 0044); tooth-chart component + status
vocabulary; **intake baseline** flow; scribe `seedFromNote`; approval writes records +
folds the living chart; history timeline shows per-visit tooth changes.

**Phase 2 — Periodontal charting.** `perio_exams` (module, 0045); 6-site perio grid
(pocket depths, BOP, recession, mobility, furcation), BOP% summary, pocket-depth trend
per tooth on the timeline. Same `clinical` gate as the odontogram.

**Phase 3 — Medical & dental history + allergies (core).** `patient_medical_history`
(core, 0046); an intake/edit form on the patient; the **allergy banner** on every
clinical screen; the **formulary allergy gate** (prescribing warns + requires override
on an allergy-class match). Independent of the charts — could be pulled **earlier** if
the owner wants the formulary safety-gate sooner.

**Phase 4 — Clinical imaging (core).** `clinical_attachments` (+ `kind=consent`) +
`patients.photo_consent` (0047); upload (drag/drop, clinic-scoped storage) + authorized
serve route; gallery on patient + per-visit; photo-consent gate; signed **treatment-
consent** captured as a `consent` attachment. Inherited by derma/hair for free.

**Phase 5 — Treatment plans (core engine + dental templates).** `treatment_plans` +
`treatment_plan_items` (0048); `ModuleDefinition.treatmentTemplates` +
`modules/dental/treatment-templates.ts`; plan builder on the patient (from template or
scratch, priced from `procedures`, tooth-tagged); **booking-from-plan** — the
new-appointment form can pull the patient's unscheduled plan items and attach them as
`appointment_procedures` (mints the sale line); status tracking across visits.

**Phase 6 — Lab work.** `lab_cases` (0049); lab tracker (list + status), link from a
plan item / visit; "crown ready" WhatsApp via `core/notifications`; optional `cost` into
the appointment/patient bill path.

## 6. ACL / permissions

- Chart/records/perio/plans/medical-history **authoring** → the existing **`clinical`**
  resource (create/edit/view), same gate as the scribe; a receptionist without
  `clinical:view` never sees clinical tabs (§10 role-based access).
- **Allergy read-out is a safety exception** — the allergy banner (not the full medical
  history) is visible to reception even without `clinical:view`, so front-desk can flag
  it at check-in. Implemented as a narrow read, not the `clinical` grant.
- **`attachments`** — new resource (view/create/delete); photo-consent enforced server-side.
- **`lab`** — new resource (view/manage) for the lab tracker.
- Add the new slugs to `core/auth/permissions.ts` catalog + role defaults (clinic_admin +
  doctor get clinical/attachments/lab; receptionist gets lab view for handoffs + the
  allergy read, no clinical).

## 7. Invariants & testing bar (per phase)

- **Living chart == reduction of history**: rebuilding `dental_charts.teeth` from the
  ordered `dental_records.chart_after` (baseline first) equals the stored materialised
  state (DB test).
- **Re-fold on edit**: editing an approved `dental_record` **re-folds** the living chart
  (mirrors the Sales re-snapshot pattern), and voiding/soft-deleting a record reverts its
  contribution — the chart can never drift from the record history.
- **Draft-then-approved**: nothing writes `dental_records`/chart/perio before the doctor
  approves; discard leaves no clinical trace.
- **Allergy gate**: prescribing a drug whose class matches a recorded allergy is blocked
  without an explicit override + reason (logged); the allergy banner shows wherever the
  patient's clinical data does.
- **Plans reconcile with Sales**: a scheduled plan item's `appointment_procedures` line
  equals the plan item's snapshot price → the sale/ledger is unchanged money logic.
- **Tenant scoping**: every new read filters `clinic_id` + `notDeleted()`; the attachments
  serve route re-checks clinic + permission before streaming bytes.
- **Consent**: a photo attachment cannot be uploaded/shown when `photo_consent` is false.
- `tsc` clean; `npm run test:unit` + e2e green; new e2e for chart save/approve, perio
  save, medical-history + allergy gate, attachment upload/serve, plan→sale, lab
  status→WhatsApp.

## 8. Deferred / adjacent (not in this arc unless asked)

- **Standalone prescription history** page (todo §D) — clinically adjacent; fold in during
  Phase 1's history tab if cheap, else separate.
- **Odontogram / perio print** (chart on the visit/plan printout) — after Phase 1/2.
- **Medical-history versioning** (full change history beyond the audit log) — v1 keeps the
  latest snapshot only.
- **Structured e-consent** (in-app signature capture) — v1 uploads a scanned/photographed
  signed form as a `consent` attachment.
- **Derma/hair** clinical records — the core pieces (medical history, attachments, plan
  engine) are built to be reused; the specialty tables/UI are NOT built here (§11/§12
  unchanged).

## 9. Open questions (confirm before/along the way)

1. **FDI vs Universal numbering** — plan uses **FDI** (matches the scribe prompt + PK/GCC
   norm). Confirm; add a display toggle later if needed.
2. **Primary (baby) teeth** — include the primary dentition in the chart from Phase 1
   (paediatric dental is common), or permanent-only first? *(Recommend include.)*
3. **Perio depth of charting** — 6-site (MB/B/DB/ML/L/DL) from the start, or a lighter
   4-site/whole-tooth first pass? Include mobility + furcation in v1? *(Recommend full
   6-site incl. mobility/furcation — half a perio chart isn't a perio chart.)*
4. **Medical-history phase position** — build it at Phase 3 as written, or pull it to the
   front (before the charts) so the formulary allergy-gate lands first? *(Recommend keep
   the chart as the headline but be ready to reprioritise; medical history has no
   dependency on the charts.)*
5. **Plan item → sale timing** — mint the `appointment_procedures` line when an item is
   **scheduled** onto an appointment, or only when **marked done**? *(Recommend on schedule,
   so it shows on the appointment bill; status `done` just completes it.)*
