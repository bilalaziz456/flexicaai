ALTER TABLE "prescriptions" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_visit_unique" ON "prescriptions" USING btree ("visit_id") WHERE "prescriptions"."visit_id" is not null;--> statement-breakpoint
-- Notes approved BEFORE this existed get their prescription now, by the same rule as
-- core/lib/prescription-items.ts#noteDrugToItem: name = drug, dose = dosage, and
-- "5 days" / "1 week" fill the duration (any other duration wording goes to the note).
-- APPROVED, live visits only; one per visit; a note with no medicine gets none.
INSERT INTO "prescriptions"
  ("clinic_id", "patient_id", "appointment_id", "visit_id", "doctor_id", "doctor_name",
   "prescribed_on", "items", "created_by", "created_by_name", "created_at", "updated_at")
SELECT v."clinic_id", v."patient_id", v."appointment_id", v."id", v."doctor_id",
       coalesce(d."full_name", d."username"),
       coalesce(v."visit_date", v."created_at")::date,
       items.list,
       v."approved_by", coalesce(a."full_name", a."username"),
       coalesce(v."approved_at", v."updated_at"), now()
FROM "visits" v
LEFT JOIN "users" d ON d."id" = v."doctor_id"
LEFT JOIN "users" a ON a."id" = v."approved_by"
CROSS JOIN LATERAL (
  SELECT jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'name', left(btrim(p->>'drug'), 120),
             'dose', nullif(left(btrim(coalesce(p->>'dosage', '')), 120), ''),
             'durationValue', (regexp_match(btrim(coalesce(p->>'duration', '')), '^(\d{1,3})\s*(day|week|month|year)s?$', 'i'))[1]::int,
             'durationUnit', lower((regexp_match(btrim(coalesce(p->>'duration', '')), '^(\d{1,3})\s*(day|week|month|year)s?$', 'i'))[2]) || 's',
             'note', CASE
                       WHEN btrim(coalesce(p->>'duration', '')) = '' THEN NULL
                       WHEN btrim(p->>'duration') ~* '^\d{1,3}\s*(day|week|month|year)s?$' THEN NULL
                       ELSE left(btrim(p->>'duration'), 200)
                     END
           ))
         ) AS list
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(v."note"->'prescriptions') = 'array' THEN v."note"->'prescriptions' ELSE '[]'::jsonb END
       ) AS p
  WHERE coalesce(btrim(p->>'drug'), '') <> ''
) items
WHERE v."deleted_at" IS NULL
  AND v."status" = (SELECT "id" FROM "visit_statuses" WHERE "code" = 'approved')
  AND items.list IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "prescriptions" x WHERE x."visit_id" = v."id");
