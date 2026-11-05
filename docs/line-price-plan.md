# Changing a procedure's price on one bill — plan

> Owner's request, 2026-11-06: "the procedure and service amount when creating the
> invoice and appointment is editable — e.g. the cost is 5000, we can make it 6000 or
> 4000 for only that invoice or appointment. Not on the consultation, and a lower
> amount is not a discount."
>
> Status: **BUILT 2026-11-06** (all three phases). Migration `0140`; server
> `procedures.ts#saveAppointmentProcedures` (returns the changes for the activity log);
> form price box + "list Rs …" hint; appointment page hint; `core/sales/price-changes-report.ts`
> on the Discounts page + CSV (`type=price-changes`). Tests: `scripts/test-line-prices.ts`
> (14 checks); `test-services-deposit.ts` updated — it asserted the old rule that a
> procedure ignores a typed price.

## 1. What exists today

- **Services** can already be priced at the counter: the form has a price box per
  service and `saveAppointmentProcedures` keeps the typed price.
- **Procedures** cannot. The form sends no price, and the server deliberately bills
  the price-list amount (`procedures.ts#saveAppointmentProcedures`: "a procedure always
  bills its list price").
- `appointment_procedures.unit_price` is already a SNAPSHOT, so a changed price needs
  no new place to live — it simply becomes what is stored there.
- **A side bug this fixes:** editing an appointment today re-reads the price list, so a
  visit booked at Rs 5,000 becomes Rs 5,500 when the list price has since risen and
  someone edits the visit. After this, an edit keeps the price the line was booked at.

## 2. Decisions (owner, 2026-11-06)

1. **Lowering needs no approval — for now.** Saved as typed. It stays visible: staff
   see the price-list amount beside the charged one, a report lists every changed
   price, and the activity log records it. *Admin approval for a lowered price may be
   wanted later* — see §5, the design keeps that a small addition.
2. **The doctor's share is on the CHARGED price.** At 40%: Rs 2,400 when charged
   Rs 6,000, Rs 1,600 when charged Rs 4,000. This is what the bill math already does
   with `unit_price`; nothing in the share code changes.
3. **The patient's invoice shows only the charged price.** The price-list amount is
   for staff only.
4. ~~A clinic offer applies to the charged price.~~ **Changed 2026-11-06 (owner):** a
   price typed by hand is FINAL — the clinic offer does not come off it. A room listed
   at Rs 1,500 with a 10% offer, typed at Rs 1,000, printed "10% discount −Rs 100" and
   billed Rs 900; it should simply be Rs 1,000. The offer applies only while the line
   is at its list price. A discount on top of a changed price is one the desk adds
   with "+ Discount", and only that shows as a discount.
5. **Not the consultation fee** — it stays the doctor's set fee (its discount is how it
   is reduced).
6. **A lower price is not a discount.** It does not appear in the Discounts report,
   does not ask for approval, and does not create a discount settlement.

## 3. Changes

**Schema** — migration `0140`: `appointment_procedures.list_price int` (nullable) —
the price-list amount when the line was booked. Old rows stay NULL, read as "same as
`unit_price`", so nothing old shows as changed. (`.claude/database.md` updated.)

**Server** (`saveAppointmentProcedures`):
- A procedure accepts a typed price too: `unitPrice = typed ?? booked ?? list price`,
  clamped by `clampPrice` (0 allowed, the same bounds as a service).
- `list_price` is written from the catalog at the time the line is first booked, and
  kept on edit.
- On edit, a line that was not changed keeps its booked `unit_price` (the §1 bug).
- The booking action's procedure encoding gains the price:
  `"<id>:<qty>:<price>:<offer>:<patient discount>"`.
- Activity log: "Changed Root canal price Rs 5,000 → Rs 4,000 (appointment …)".

**Booking form / invoice editor** (`new-appointment-form.tsx`):
- Each procedure row gets the same `PriceInput` services already use, seeded with the
  booked or list price.
- A changed price shows the list price faintly beside it ("list Rs 5,000") — staff
  only. Not on the consultation row.

**Plan bookings** — a line booked from a treatment plan takes the plan item's price
(already its own snapshot), with `list_price` = the catalog price; editable afterwards
like any line.

**Appointment page (staff)** — a changed line reads "Root canal · Rs 4,000 (list
Rs 5,000)".

**Invoice (patient)** — unchanged: the charged price only.

**Report** — "Price changes" on the Sales or Discounts page: each line whose charged
price differs from its list price, with who booked it, the doctor, both prices and the
difference; totals for raised and lowered. CSV too.

## 4. Tests

- Charged price drives the bill, the doctor's share and the offer (TS and SQL —
  `test-bill-parity` already covers `unit_price`, so it needs only a case or two).
- An edit keeps the booked price after the list price changes.
- A consultation fee cannot be priced from the form.
- `list_price` NULL on old rows shows nothing as changed; `test-old-visits-unchanged`
  still 822/822.
- A changed price creates no discount row and asks no approval.

## 5. Later: approval for a lowered price

When wanted, a lowered price becomes one more PIECE for the approval flow of ADR-037:
hold the line at its list price until the clinic approves (a `price_held` flag beside
`patient_discount_held`, read the same way by the bill). The stored `list_price` is
what makes that possible, which is why it is added now even though nothing gates on it.

## 6. Phasing

1. Migration + server path + edit keeps the booked price + tests.
2. Form price box on procedure rows + "list Rs …" hints + appointment page.
3. Price-changes report + activity log + docs.
