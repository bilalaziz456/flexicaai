# WhatsApp with WeTarSeel — discussion notes

*Discussion with the owner, 2026-10-15/16. Saved to pick up later; nothing here is
built yet. Pricing figures are as researched on 2026-10-16 and should be re-checked
before quoting them to a clinic.*

---

## 1. How the app's WhatsApp works today

The app sends and receives through ONE provider at a time (`WHATSAPP_PROVIDER`). Two
are built; everything else in the app — confirmations, reminders, recalls, the
assistant, self-service reschedule/booking/cancel — sits on top and does not change
when the provider does.

### Option A — one shared FlexicaAI number (AiSensy, the code default)

- Every clinic's patients message **FlexicaAI's single number**.
- The incoming message only carries the patient's phone number, so the app searches
  **all clinics** for a patient with exactly that number:
  - exactly one match → that clinic and patient;
  - none, or several (a family sharing one mobile, or a person registered at two
    clinics) → it does **not guess**; the message is left unassigned in the WhatsApp
    queue for staff to place.
- Outgoing messages come **from FlexicaAI's number**, with the clinic's name in the text.

### Option B — each clinic's own number (Meta Cloud API) ← the owner's choice

- Each clinic's number is registered under FlexicaAI's WhatsApp Business account; the
  super admin enters it on the clinic page.
- Each incoming message says **which number received it**, so the clinic is known for
  certain, and the patient is matched only within that clinic (same one-match rule).
- Outgoing messages come **from the clinic's own number**, under the clinic's name.

### What happens to every incoming message (both options)

1. Recorded once — a redelivered message is not processed twice.
2. Matched to clinic and patient.
3. Self-service replies handled (confirming a reschedule, a booking, a cancellation).
4. The AI assistant answers simple questions (fees, timings, location) if the clinic
   has it on. It never books or cancels anything itself.
5. The front desk is notified; the message appears in the reception WhatsApp queue.

Messages the clinic STARTS (confirmations, reminders, recalls, prescription PDFs) are
Meta-approved **templates**, which WhatsApp requires. Assistant replies also travel in
a template.

### Status on 2026-10-16

**No provider is configured** — no AiSensy key and no Cloud token, on the owner's PC or
the test server. Every outgoing message is recorded in the app as "queued" but not
delivered, and nothing can arrive.

---

## 2. WeTarSeel — the provider the owner is using (for Option B)

WeTarSeel is a WhatsApp Business API provider: it connects numbers to Meta's official
API and gives a simpler API key and dashboard — the same kind of company as AiSensy.
The app does not speak WeTarSeel's format yet, so it needs a **third provider**
alongside AiSensy and the Cloud API.

### What their public documentation covers (sending — clear)

- Base: `https://app.wetarseel.ai/api/v1/`, header `Authorization: Bearer <key>`.
- `POST /send-message`
  - template, any time: `{ "to": "923451234567", "template_name": "...", "parameters": ["Ali", "INV-102"] }`
  - plain text, only within 24 h of the patient's last message: `{ "to": "...", "message": "..." }`
- `POST /send-media` — images/PDF/audio, within the 24 h window.
- `POST /send-message-with-file` — template with a file header (e.g. a PDF invoice).
- `POST /add-lead` — lead sync.

This matches how the app already sends (templates with values filled in), so sending
can be built straight away.

### What it does NOT cover (receiving — needed before building it)

- The shape of a "message received" webhook: sender's number, text, message id.
- **Which of our numbers a message arrived on** — essential for Option B.
- **How a webhook proves it came from WeTarSeel** (secret / signature). Without it,
  anyone could fake a patient message that books or cancels an appointment, so the app
  will not accept unsigned webhooks in production.
- Whether one account can hold several numbers.

### The two possible Option B setups with WeTarSeel

**Setup 1 — one WeTarSeel account (and API key) per clinic** (most likely)
- The super admin pastes each clinic's key on the clinic page (stored securely, only
  the last 4 characters ever shown).
- The app sends with that clinic's key → the message comes from the clinic's number.
- Each clinic's webhook points to an address unique to that clinic, so the clinic is
  always known.

**Setup 2 — one account holding every clinic's number**
- One key on the server; each send names which number to send from; each incoming
  message says which number received it. Only possible if WeTarSeel's API supports
  choosing the sending number.

### Questions to ask WeTarSeel

1. Can one account have several WhatsApp numbers? If so, how does an API call choose
   the sending number, and how does a webhook say which number received a message?
2. If not, can we have one account per clinic (each with its own key) under one billing?
3. A **sample "message received" webhook**, and a delivery-status one.
4. **How the webhook is secured** (secret key, signature header, …).
5. Do they support **WhatsApp Business app coexistence** (§4)? If so, are replies sent
   from the app forwarded to our webhook?

### Proposed build order

1. WeTarSeel as a third provider + a "WeTarSeel API key" field per clinic (sending:
   confirmations, reminders, recalls from the clinic's own number). Fits Setup 1; only
   the small sending part changes if the answer is Setup 2.
2. Receiving, once WeTarSeel answers questions 3 and 4.

---

## 3. What it costs — Meta's rules from 1 October 2026

- **Incoming messages from patients: free**, always.
- **Replies within 24 h of the patient's last message ("service messages")**: the
  first **1,000 per WhatsApp number per calendar month are free**; after that each
  costs **US $0.015 in Pakistan (≈ Rs 4.2)** — the "about Rs 4 after 1,000" quoted to
  the owner. WeTarSeel may add its own margin.
- **Utility/authentication templates** (confirmations, reminders): same rate,
  including inside the 24 h window (no longer free). Marketing templates: $0.0473.
- **AI or human makes no difference**: a reply typed by a receptionist costs exactly the
  same as one written by the AI. It is one sent message either way.
- With **Option B the 1,000 free are per number**, so each clinic gets its own 1,000.

### Keeping the bill down

- One complete reply instead of several short ones ("ok", "thanks", "👍" each cost the
  same as a full answer once past 1,000) — worth telling front-desk staff.
- Let the assistant handle simple questions in a single message.
- Combine information (the booking confirmation already carries date, time, doctor and
  fee).

### Possible app additions (offered, not built)

- A per-clinic counter: "WhatsApp this month: 846 of 1,000 free".
- Owner serving-cost figures using Rs 4.2 per message after the free 1,000, so the P&L
  reflects real WhatsApp cost (`platform_cost_rates.whatsapp_msg_cost`).

---

## 4. Making only AI/automatic messages cost — "coexistence"

The owner asked whether manual replies could be free while only AI messages cost.

**Yes — Meta's WhatsApp Business app coexistence.** The clinic's one number is used in
two places at once:

```
                         ┌── WhatsApp Business app (phone / desktop)
Clinic's own number ─────┤     staff reply by hand here   →  FREE
                         │
                         └── WeTarSeel API → FlexicaAI
                               AI replies, confirmations,
                               reminders, recalls          →  charged after 1,000/month
```

- **Messages sent from the WhatsApp Business app are free**, even on a number also
  connected to the API; only messages sent through the API are charged.
- Patients see one number either way.

### Conditions and catches

1. **WeTarSeel must support coexistence** — the deciding question (§2, question 5).
2. Some app features stop in one-to-one chats: disappearing messages, "view once",
   live location; broadcast lists become read-only. Normal chats, photos, voice notes
   and documents keep working. Up to 6 months of 1:1 history syncs.
3. **AI and staff could both answer the same patient.** Plan: when staff have replied
   recently, the AI stays quiet for that chat — or a clinic chooses "AI off, staff
   reply by hand". To be built once WeTarSeel's support and reporting are known.
4. Staff replies made on the phone may not appear in FlexicaAI's WhatsApp queue,
   depending on whether WeTarSeel forwards them.

### Not to do

Tools that automate WhatsApp Web or a normal WhatsApp account to avoid charges break
WhatsApp's rules and regularly get the **number banned** — far worse for a clinic than
Rs 4 a message.

---

## 4b. Other providers that support coexistence (researched 2026-10-16)

| Provider | Provider's own fee (Meta's per-message charges come on top) | Fit with FlexicaAI |
|---|---|---|
| **AiSensy** | Subscription plans — ask for Pakistan pricing | **Already integrated** (send + receive). Coexistence enabled via their support. Option B needs one AiSensy account/key per clinic (the code uses one key today). |
| **Dualhook** | ~$12/mo for 1 number, ~$45/mo up to 10; **no per-message markup** | Exposes Meta's **Cloud API**, which the app already supports — least new code. Webhooks go straight to our server. |
| **360dialog** | ~$59 per number per month | Close to Cloud API format, developer-focused. |
| **Wati / respond.io** | ~$59–$99+/mo | Team-inbox products; work, but pay for features FlexicaAI already has. |
| **Meta directly** | none | FlexicaAI must first become a Meta Tech Provider (Embedded Signup). Not practical yet. |
| **WeTarSeel** | — | Unknown — ask (§2, question 5). |

**Applies to all of them:**
- **Message echoes:** replies sent from the WhatsApp Business app are mirrored to the API,
  so FlexicaAI can show staff replies in the queue and keep the AI quiet for that chat.
- **~14-day rule:** coexistence disconnects if the WhatsApp Business app is not opened for
  about 14 days. A clinic must open the app on its phone at least once a fortnight.

**Recommendation:** ask WeTarSeel first. If they don't support coexistence: **Dualhook**
(cheapest, no markup, matches our Cloud API code) or **AiSensy** (most established,
already integrated; needs per-clinic keys). Confirm prices with each provider — figures
are from a comparison article and change often.

Sources: [Dualhook comparison](https://dualhook.com/best-whatsapp-coexistence-providers) ·
[AiSensy co-existence](https://wiki.aisensy.com/en/articles/11939127-whatsapp-co-existence-everything-you-need-to-know) ·
[Chakra coexistence 2026](https://chakrahq.com/article/whatsapp-business-app-api-coexistence-2026/) ·
[respond.io](https://respond.io/blog/how-to-use-whatsapp-business-app-and-api-at-the-same-time)

## 5. Next step

Ask WeTarSeel the five questions in §2. With the answers:
- build WeTarSeel sending (can start now, Setup 1);
- build receiving (needs the webhook sample and security);
- if coexistence is supported, set up "staff reply free by hand, AI and automatic
  messages through the API" with the AI staying quiet when staff are answering.

---

## Sources

- [WeTarSeel Developer Documentation](https://wetarseel.ai/?p=10445)
- [WhatsApp Service Message Pricing from October 1, 2026 (ChatMaxima)](https://chatmaxima.com/blog/whatsapp-service-message-pricing-october-2026/)
- [WhatsApp API Pricing Update: Effective October 1, 2026 (YCloud)](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [New WhatsApp pricing from Meta starting October 1, 2026 (Superchat)](https://help.superchat.com/en/articles/769350-new-whatsapp-pricing-from-meta-starting-october-1-2026)
- [WhatsApp Service Message Pricing Changes Explained (Wati)](https://www.wati.io/en/blog/whatsapp-service-message-pricing/)
- [WhatsApp Business API Pricing 2026: Rates & Oct 1 Changes (EngageLab)](https://www.engagelab.com/blog/whatsapp-business-api-pricing)
- [Introducing WhatsApp Coexistence (Wati)](https://support.wati.io/en/articles/11822402-introducing-whatsapp-coexistence)
- [Best WhatsApp Coexistence Providers in 2026 (Dualhook)](https://dualhook.com/best-whatsapp-coexistence-providers)

In the code: `src/core/integrations/whatsapp/` (`index.ts` provider switch, `cloud.ts`,
`inbound.ts` routing — Strategy A across clinics, Strategy B per clinic) and
`docs/whatsapp-cloud-plan.md`.
