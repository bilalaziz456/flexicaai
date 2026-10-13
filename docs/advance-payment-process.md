# Advance payment (deposit) process — for discussion

> Status: **for discussion with the owner** (saved 2026-10-13). Describes how a deposit
> taken at admission flows through the system as built in migration `0125` / ADR-036
> (`.claude/architecture.md`). Open questions are at the end.

Example used throughout: a patient is admitted and pays **Rs 10,000**. The doctor then
decides on **RCT 8,000** (procedure) + **Room 2 days × 1,500 = 3,000** (service) +
**Medicines 1,000** (other charge) = **Rs 12,000**. The patient pays the remaining
**Rs 2,000** at discharge. The doctor's share is assumed to be 10% on procedures.

---

## Step 1 — Admission: patient pays 10,000

**Appointments → New appointment**
1. Pick the patient, the doctor, and today's date/time.
2. Leave the charges empty for now (not known yet).
3. In **Payment received**, type **10,000** (it is pre-filled with the bill so far —
   overwrite it), choose Cash, **Save**.

What happens:
- An invoice number is issued (e.g. INV-100350); the appointment becomes **Confirmed**.
- The full 10,000 is held on this visit. The badge reads **"Paid · Rs 10,000 extra"**
  (no charges yet).

| Screen | Shows on day 1 |
|---|---|
| Day book / Cash drawer | **+10,000 cash** today (real money in the drawer) |
| Payments | 10,000 against INV-100350 |
| Sales, P&L, dashboard revenue | **0** — no charges yet, so it is held money, not revenue |
| Doctor's share | 0 |
| Receivables | nothing |

## Step 2 — Doctor decides the treatment: bill becomes 12,000

Open the appointment → **Edit** (or Invoices → the invoice → Edit):
1. **Procedures:** tick **RCT**.
2. **Services & other charges:** tick **Room (per day)**, quantity **2**; then
   **+ Add other charge** → "Medicines", Rs 1,000.
3. **Save.** Charges can be added any time during the stay — each save updates the bill.

Now: Bill **12,000** · Collected **10,000** · Outstanding **2,000** — badge
**"Advance paid · Rs 2,000 left"**.

| Screen | Shows after the charges are added |
|---|---|
| Sales, P&L revenue | **10,000**, dated **day 1** (the day the money arrived) |
| Doctor's share | starts on the RCT only, in proportion to what has been paid (≈ 667 of the 800); room and medicines carry no share |
| Receivables / dashboard Outstanding | **2,000** (the admission time has passed) |
| Day book | unchanged — no cash moved |

> Note: day 1's revenue changes when the charges are added (0 → 10,000). That is the
> "revenue on the date received" rule (ADR-035): the money arrived on day 1, and it
> becomes revenue once there is a bill to count it against.

## Step 3 — Discharge: patient pays 2,000

Open the appointment or invoice → the payment box is pre-filled with **2,000** →
**Save & print invoice**. Optionally mark the visit **Completed** (queue only — it
changes no money figure).

| Screen | Shows on discharge day |
|---|---|
| Day book / Cash drawer | **+2,000 cash** today |
| Sales, P&L revenue | **+2,000**, dated today (total 12,000) |
| Doctor's share | the rest of the RCT share (total **800**) |
| Receivables | cleared to **0**; badge **Paid** |

**Printed invoice:** RCT, then **Other charges** (Room × 2, Medicines), Total 12,000,
payment history (10,000 on day 1, 2,000 today), Balance 0.

---

## If the final bill is LESS than the deposit (e.g. 7,500)

After Step 2 the badge reads **"Paid · Rs 2,500 extra"** and the payment panel shows
**Extra held 2,500** with two buttons:
- **Refund Rs 2,500** — cash out today (day book / drawer −2,500). Revenue stays 7,500.
- **Keep as credit** — the 2,500 moves to the patient's account for the next visit. No
  cash moves, so no cash or refund figure changes. Cancelling it puts the money back on
  the visit.

Revenue never counts more than the bill, so the extra was never revenue.

## Things to keep in mind

1. **Before charges use up the deposit**, the money is in the drawer and day book but
   not in revenue — it is the patient's money until something is charged.
2. **Add charges as they happen**, not all at discharge — receivables and revenue are
   only as current as the bill.
3. **Top-ups during a long stay** are simply more payments on the same appointment.
4. **Not marking Completed holds nothing back** — revenue, receivables and shares follow
   the money and the visit time.

---

## Open questions for discussion

- **Back-dated revenue.** Adding charges on day 3 moves revenue into day 1 (when the
  deposit arrived). A day's P&L can therefore change after the day is over. Acceptable,
  or should revenue land on the day the CHARGE was added instead?
- **Interim bill print.** Should there be a "bill so far — not final" print for the
  family during the stay, or is the normal invoice print enough?
- **Low-deposit warning.** Flag a visit (and list it on the dashboard) when charges pass
  the deposit, so the desk asks for a top-up before discharge?
- **"Admission" as its own visit type** — a label/filter, or keep it a normal
  appointment with a deposit?
- **Default at discharge when the bill is less** — Refund first, or Keep as credit first?
