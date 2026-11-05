-- Per-line discounts (docs/per-line-discount-plan.md §6): each patient discount waits
-- only for its OWN bearer's approval, so "held" (pending or declined → counts as 0) is
-- stored where the discount is — per line, and for the consultation — and the SQL bill
-- can gate it from that row alone. Default false: nothing is held today, and the
-- visit-level discount keeps its existing gate (appointments.discount_status).
ALTER TABLE "appointment_procedures" ADD COLUMN "patient_discount_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_discount_held" boolean DEFAULT false NOT NULL;