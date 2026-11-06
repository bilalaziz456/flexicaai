-- "Change price on a bill" (`bill_price:edit`, owner's call 2026-11-07): who may change
-- a procedure's or service's price on one bill is now the clinic admin's decision.
--
-- Tier 2 — per-user permissions: NOT backfilled, deliberately. The owner chose "clinic
-- admin only" by default, so a manager, receptionist or doctor — on role defaults or
-- customised — gets it only when their clinic admin ticks it. (Unlike 0110/0132, where
-- a new resource was granted to keep what people already did: here taking it away
-- from the desk IS the point.)
--
-- Tier 1 — clinic capabilities (ADR-033): a clinic the super admin has narrowed to a
-- whitelist would otherwise lose the slug for EVERYONE, its clinic admin included, so
-- nobody could change a price there. Add it wherever booking is allowed; the super
-- admin can still take it away per clinic.
UPDATE "clinics" c SET "capabilities" = c."capabilities" || ARRAY['bill_price:edit']
WHERE c."capabilities" IS NOT NULL AND NOT ('*' = ANY(c."capabilities"))
  AND ('appointments:create' = ANY(c."capabilities") OR 'appointments:edit' = ANY(c."capabilities"))
  AND NOT ('bill_price:edit' = ANY(c."capabilities"));
