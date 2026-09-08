-- Replaces the free-text `clinics.city` with the structured `city_id` added in 0103.
--
-- The column is NULL on every row of the database this was written against, but a
-- migration must not assume that of every environment. So: back-fill what matches the
-- seeded list, then REFUSE to run if anything is left over. Dropping a column that
-- still holds a value nobody has looked at is how a clinic's city quietly disappears.
--
-- The match is case- and space-insensitive because free text is exactly where "lahore"
-- and "Lahore " come from — the reason this column is being replaced.
UPDATE "clinics" c
   SET "city_id" = ci."id"
  FROM "cities" ci
 WHERE c."city" IS NOT NULL
   AND lower(btrim(c."city")) = lower(ci."name")
   AND c."city_id" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  stuck text;
BEGIN
  SELECT string_agg(DISTINCT "city", ', ')
    INTO stuck
    FROM "clinics"
   WHERE btrim(coalesce("city", '')) <> ''
     AND "city_id" IS NULL;

  IF stuck IS NOT NULL THEN
    RAISE EXCEPTION
      'clinics.city holds values with no matching row in cities: %. Add them to core/db/city-seed.ts (or insert them into cities), re-run, and only then will this migration drop the column.',
      stuck;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "clinics" DROP COLUMN "city";
