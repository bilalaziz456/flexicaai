-- Changing a procedure's price on one bill (docs/line-price-plan.md): the price-list
-- amount the line was booked at, beside unit_price (what was charged). Old rows stay
-- NULL = "same as unit_price", so no existing line reads as a changed price.
ALTER TABLE "appointment_procedures" ADD COLUMN "list_price" integer;