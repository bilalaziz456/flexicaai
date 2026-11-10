# WhatsApp — build order

> **Owner-facing summary of ALL WhatsApp work:**
> https://claude.ai/artifact/Q4b91Wyj73DF9J4YcLGXSt — keep its "Build order" in step
> with this file.

> Owner, 2026-11-10: "make the plan so we start building". This file is the ORDER; each
> step's detail lives in its own plan:
>
> | Plan | What |
> |---|---|
> | `docs/whatsapp-wetarseel-sending-plan.md` | Sending through WeTarSeel |
> | `docs/whatsapp-automations-plan.md` | On/off switch per automation, "To send by hand" |
> | `docs/whatsapp-allowance-plan.md` | Message credits per clinic |
> | `docs/whatsapp-wetarseel-notes.md` §4e | Fixes before going live |
> | (to write) | Receiving through WeTarSeel |

## The order, and why

Sending comes first because nothing else can be seen working without it. The switches
come before the credits because the credits reuse them: a clinic at zero credits behaves
exactly like one whose automations are off (`whatsapp-automations-plan.md` §7), so the
"To send by hand" list has to exist first. Receiving is last only because it is
blocked on WeTarSeel; it moves up the moment they answer.

Meta's template approval takes days and needs nothing from the code once the wording is
final, so the templates are submitted early (step 3) and approved while steps 4–5 are
built.

| # | Step | Needs from the owner | Blocked by | Done when |
|---|---|---|---|---|
| 1 | **Sending through WeTarSeel — code** (sending plan phases 1–2): encrypted key per clinic, the WeTarSeel sender, "no key = no send", the 1,024-character guard, tests against a fake WeTarSeel | Nothing | — | Tests pass; a clinic's key can be saved and replaced on its admin page |
| 2 | **Small fixes that need nothing** (§4e): daily jobs on Pakistan time (`CRON_TZ=Asia/Karachi` in `deploy/install-cron.sh`); booking and reschedule replies laid out so they need no line breaks inside a blank | Nothing | — | The cron file carries Pakistan time; the two templates' final wording is in the doc |
| 3 | **Templates submitted** in one test WeTarSeel account: the nine, with the final wording from step 2 | A WeTarSeel account and number to test with, and submitting the templates (or giving us access) | Step 2's wording | Meta has approved all nine |
| 4 | **Automation switches** (automations plan phases 1–2): the catalog, the main "WhatsApp API" switch, the per-clinic card for super admin / account manager | Nothing | — | A switched-off automation sends nothing; tests pass |
| 5 | **"To send by hand"** (automations plan phases 3–4): the list, Open in WhatsApp / Mark sent / Skip, prescription and invoice by hand | Nothing | — | A notice that is off appears in the list, ready to send from the phone |
| 6 | **First real messages** (sending plan phases 3–4): the test site on `WHATSAPP_PROVIDER=wetarseel` with the test account's key; a real confirmation, reminder, prescription PDF and invoice; the "Send a test message" button | The test account's API key | Step 3 (approved templates) | Each of the nine has arrived on a real phone from the clinic's number |
| 7 | **Message credits** (credits plan phases 1–4): packs, paid / unpaid, stop at zero, the screens | Nothing (answered 2026-11-11) | Step 5 | A clinic at zero sends nothing automatic and its notices wait in "To send by hand" |
| 8 | **Receiving through WeTarSeel**: incoming messages, delivery status, which clinic a message is for; the AI and self-service working from real messages | — | WeTarSeel's answers 1, 3, 4 (and whether app replies reach us) | A patient's reply books, reschedules or cancels on the test site |
| 9 | **Going live, clinic by clinic**: production settings, the daily jobs switched on (`install-cron.sh all`, held as delta D-19 until there are live clinics), each clinic's account + templates + key (sending plan §6), credits added | Production go-ahead; who sets the cancellation cut-off (§4e) | Steps 6 and 8 | The first clinic's patients get their messages from its own number |

Steps 1, 2, 4 and 5 need nothing from anyone and can start now. Step 3 runs in parallel
with them once a test account exists.

## What the owner can do now, so nothing waits later

1. **A WeTarSeel account for testing** — ideally a spare number, connected with
   coexistence, so step 3 can start as soon as the wording is final.
2. **Chase WeTarSeel** for questions 1, 3, 4 and whether app replies reach us — step 8
   is the only step blocked from outside.
3. ~~Decide the credits questions~~ — answered 2026-11-11: the rate is set per pack by
   us; the limit starts with a clinic's first pack; warnings at 20% left and at zero.

## Rules for every step

- Each step is its own commit (or a few), tested, with its plan file and the WhatsApp
  doc updated in the same commit, and `.claude/architecture.md` where a step changes a
  layer or a decision (a new provider does not; the credits ledger may).
- Built on the test site first; production only on the owner's word.
- Nothing is switched on for a real clinic until step 9.
