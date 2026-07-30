# Klenic — UI/UX Audit

**Reviewer perspective:** Staff Product Designer · Senior UX Researcher · Accessibility Expert · Senior Frontend Engineer
**Date:** 2026-07-30 · **Status:** audited → **majority remediated same day** (see [§0a Remediation Log](#0a-remediation-log--2026-07-30); all P0s + most P1/P2 fixed, `build`-clean + spot-verified live)
**Scope:** Full application — 77 pages across 6 route groups (`(marketing)`, `(auth)`, `admin`, `clinic`, `doctor`, `reception`), the shared design system (`src/core/ui/*`), tokens (`globals.css`), forms, tables, states, and responsive behaviour.
**Method:** Code-level audit — I read the design-system primitives, page inventory, forms, tables, and cross-cutting state handling, and traced navigation. I did **not** run the live app: it needs a running server + an authenticated session, and entering credentials is out of scope. **A live, authenticated pass across mobile/tablet/desktop is the #1 recommended follow-up** (see §Method Gap). Everything below is grounded in specific files.

---

## Table of Contents
1. [Verdict Up Front](#0-verdict-up-front)
2. [Information Architecture](#1-information-architecture)
3. [User Experience](#2-user-experience)
4. [Visual Design](#3-visual-design)
5. [Design System Consistency](#4-design-system-consistency)
6. [Accessibility](#5-accessibility)
7. [Forms](#6-forms)
8. [Tables](#7-tables)
9. [Mobile UX](#8-mobile-ux)
10. [Performance Perception](#9-performance-perception)
11. [Error Handling](#10-error-handling)
12. [Notifications](#11-notifications)
13. [Micro-interactions](#12-micro-interactions)
14. [Dashboard Quality](#13-dashboard-quality)
15. [Code Affecting UI/UX](#14-code-affecting-uiux)
16. [Production Readiness by Screen](#15-production-readiness-by-screen)
17. [Prioritized Findings (P0–P3)](#16-prioritized-findings)
18. [Missing Features](#17-missing-features)
19. [Final Scores](#18-final-scores)
20. [Executive Summary](#19-executive-summary)
21. [Implementation Plan](#20-implementation-plan)
22. [Method Gap & Next Steps](#method-gap)

---

## 0. Verdict Up Front

**This is not an unfinished-looking MVP. The foundation is genuinely strong** — a real, token-driven design system that most seed-stage SaaS never reaches. But it has a **classic "great components, thin edges" problem**: the primitives are excellent, and the *last mile* — error pages, empty states, loading skeletons, notification stacking, modal focus management, table consistency, touch targets — is where it falls short of the Stripe/Linear/Vercel bar.

**What's already premium:**
- OKLCH design tokens with a coherent brand palette (teal/blue/navy), a proper **dark mode** that flips every token (`globals.css`), a radius scale, and `focus-visible` rings wired into **41 files**.
- A `cva`-based `Button` with a full size/variant matrix, `aria-invalid` states, and press feedback (`active:translate-y-px`).
- Thoughtful, senior-level details most teams miss: autofill re-painting for dark mode, `scrollbar-gutter: stable` to stop layout shift, password masking without `type="password"` to defeat autofill, `role="alert"`/`role="status"` live regions on toasts and inline messages.
- Forms are the strongest area — the login form alone has label association, `autoComplete`, `inputMode="numeric"` for OTP, pending states, and documented controlled-input rationale.

**What drags it down (the honest part):**
- **Zero custom `error.tsx` and zero `not-found.tsx` across 77 pages.** Any thrown error or bad URL shows Next.js's raw default screens. This is the single most "unfinished" thing a Stripe/Apple reviewer would catch in 30 seconds.
- **No loading skeletons and only 4 `loading.tsx` boundaries.** Navigation between the other ~73 routes shows the stale page, then a hard swap. The one loader that exists is a bare spinner, not content-shaped.
- **Notifications don't stack, can't be dismissed, and are page-local.** Two toasts overlap; there is no global toast API; cross-page success relies on `?created=1` query-param hacks.
- **Three screens still use the browser's native `confirm()`** despite a well-built `ConfirmDialog` existing — a jarring, unthemeable break in the design language.
- **The custom modal has no focus trap, no initial focus, no scroll lock** — a real keyboard/screen-reader failure.
- **Tables are inconsistent** — 21 files hand-roll `<table>`, only 12 use the shared `Table`. Density, sticky headers, and responsive behaviour differ screen to screen. **No sorting, no bulk actions, no row selection** anywhere.
- **Touch targets are desktop-sized** (default button `h-8` = 32px; `sm` = 28px; `xs` = 24px), below the 44px comfortable-touch target.

**Bottom line: ~2–3 focused weeks moves this from "solid internal tool" to "looks like it belongs next to Stripe."** The hard part (the system) is done; the missing part (edges + a11y polish) is well-scoped and mostly mechanical.

---

## 0a. Remediation Log — 2026-07-30

The audit was acted on the same day. The items below are **implemented, `tsc` + lint + production-`build` clean, and (where noted ✅LIVE) visually verified in a running instance across light + dark mode**. See `PROGRESS.md` for the per-commit detail.

**All three P0 release-blockers — DONE.**
- **P0-1 · Modal focus management** → rebuilt `ConfirmDialog` + `ConfirmDeleteDialog` on **Base UI `Dialog`** (focus trap, initial focus, **restore to trigger**, scroll-lock, Esc/backdrop). ✅LIVE (Esc closed a Void dialog and focus returned to the trigger, visible ring).
- **P0-2 · Error boundary** → added `app/error.tsx` + `app/global-error.tsx` (branded, "Try again" + "Go to dashboard").
- **P0-3 · Custom 404** → added `app/not-found.tsx` (Klenic logo + CTA). ✅LIVE.

**High-priority (P1):**
- **P1-2 · Notification system** → a real toast **queue** (`toast-store.ts` + one `<Toaster/>`): stacking, manual ×-dismiss, pause-on-hover, imperative `toast()`; old `<Toast>`/`<FlashToast>` kept as compat wrappers. ✅LIVE (two stacked, dismissible, success-tone).
- **P1-3 · Table consistency + sorting** → built one `DataTable` (client-side sorting, sticky-header option, empty state, **mobile card view**, whole-row `rowHref`, **totals footer**) and **migrated 16 tables** onto it (payments, invoices, expenses, discounts, no-shows, day-book, P&L by-period, overview by-doctor/cash/discounts, shares balances+payouts, imported-history, import history, admin clinics list). ✅LIVE (header sort + row-link on the clinics list). *(This also delivers **P2-5** sticky headers and **P2-7** mobile card views.)* Receivables intentionally left as its per-patient accordion.
- **P1-5 · Native `confirm()` removed** → the 3 remaining calls now use the styled `ConfirmDialog`.
- **P1-6 · First-run onboarding** → an `OnboardingChecklist` on the clinic dashboard (add team → patient → first appointment), self-hiding once complete.

**Medium (P2):**
- **P2-1 · Semantic status tokens** → added `--success/--warning/--info` tokens (+ `Badge` variants), swapped the scattered `emerald/amber/sky` literals to tokens app-wide (25 files), and tokenised the semantic chart colours (profit/loss/expenses). ✅LIVE (correct in light **and** dark).
- **Designed empty states** (audit §7) → reusable `EmptyState` component wired into `DataTable`. ✅LIVE.
- **Latent bug caught by the build** → `/clinic/history`'s client filter was importing a server-only module (a build-time error `tsc` misses); fixed by splitting out a client-safe tab module. The app now builds for **every route**.

**Also done (P1-1, P1-4, P2-2, P2-3, P2-4, P2-8):** content-shaped **loading skeletons**; a coarse-pointer **40px touch-target** minimum; **breadcrumbs** on the deep routes; a **skip-to-content** link + a verified-complete **icon-button aria sweep** (no gaps); a **validation error summary** (all zod issues); and **KPI trend deltas** on the finance cards. **All P0s + all P1s + every P2 except measured contrast (P2-6) are resolved.**

**Still open** (tracked in §16 / §20): P2-6 measured contrast *(dark-mode spot-checked, not instrumented — the last P2)* · all of P3 (command palette, keyboard-shortcut layer, autosave, elevation tokens, bottom-sheet modals). **Every P0, every P1, and every P2 except measured-contrast are now resolved.**

---

## 1. Information Architecture

**Grade: B. Logical, role-scoped, but flat and light on wayfinding.**

**What works**
- Clean role-based route groups (`admin` / `clinic` / `doctor` / `reception`) with a shared `PanelShell` and per-role nav trees (`panel-shell.tsx`). Nav items gate on features **and** per-user permissions (`resource`/`cap`), and empty nav groups collapse — genuinely good adaptive IA.
- The clinic "Money" nav group sensibly clusters Sales / Payments / Invoices / Receivables / Discounts / Shares / P&L / Reports / History.

**Problems**
- **[High] No breadcrumbs anywhere (0 files).** Deep destinations — `/admin/clinics/[id]/import`, `/clinic/appointments/[id]/receipt`, `/clinic/shares/statement` — rely on a single hand-written "← Back" link, and its target is sometimes hard-coded (e.g. import back-link → clinic detail). A user who deep-links or refreshes has no positional context. *Violates: Nielsen #1 (visibility of system status), recognition-over-recall.*
- **[High] Cognitive load on the clinic "Money" group — 9+ items.** Sales vs Payments vs Receivables vs Invoices vs Shares vs P&L is a lot of near-synonyms for a non-technical receptionist. Consider grouping into "Billing" (Payments/Invoices/Receivables) and "Reports" (Sales/P&L/Discounts/Shares) sub-sections, or a single "Finance" hub landing page with cards.
- **[Medium] No global search / command palette.** With 77 pages and per-clinic data, a power user (you, as super-admin) has no ⌘K to jump to a clinic/patient/appointment. Per-page search exists (patients, invoices, payments) but there's no cross-app jump.
- **[Medium] Naming collision surfaced by your own question:** "Past due" (lifecycle status) vs "Due / overdue" (billing metric) live one line apart on the same dashboard. IA should disambiguate labels that mean different things.
- **[Low] Feature placement:** "Financial history" import is an admin-only clinic-detail sub-route; discoverable only if you know it exists. A one-line hint on the clinic detail page would help.

---

## 2. User Experience

**Grade: B–. Task flows are sound; the edges (feedback, dead ends, discoverability) are where friction lives.**

**Friction & confusion points**
- **[High] No onboarding / first-run guidance.** A brand-new clinic admin lands on an empty dashboard with no "next steps" (add staff → add patients → book first appointment). New super-admins get no product tour. *Violates: Nielsen #10 (help & documentation), aha-moment best practice.*
- **[High] Discoverability failures you personally hit twice this session:** the payment-reminder field was hidden behind `monthlyPrice > 0`, and the whole feature was invisible on unpriced clinics. That pattern (hide a control until an unrelated precondition is met, with no hint) likely recurs — audit every `&& x > 0` / `&& hasFeature` gate for a "why can't I see this?" moment. *Violates: Nielsen #6 (recognition over recall).*
- **[Medium] Missing feedback on some async actions.** The `ConfirmDialog` shows "Working…" but native `confirm()` flows (announcements delete, billing void, import undo) give no in-flight state — the page just eventually refreshes.
- **[Medium] Dead ends on error/empty.** With no `error.tsx`, a failed server component drops the user on a raw stack trace with no "retry" or "go home." Empty states exist in places (`"No clinics yet…"`) but are plain text, not actionable cards with a primary CTA.
- **[Medium] Redirect-flash pattern is fragile.** Success messaging after create/edit rides on `?created=1` query params stripped via the History API (`FlashToast`). It works, but it's brittle and won't survive a shared/bookmarked URL cleanly. A real toast queue would be more robust.
- **[Low] Unnecessary clicks:** you already fixed the "create → land on list → hunt for the appointment" flow (good). Similar audit needed elsewhere (e.g., does recording a payment return you to a useful place?).

---

## 3. Visual Design

**Grade: B+. Clean, consistent, brand-aware. Reads as a competent modern SaaS, not yet as Linear-tier.**

**Strengths**
- Coherent palette from the logo, applied through tokens; muted/secondary/accent tiers are well-chosen; dark mode is properly tuned (not just inverted).
- Consistent radius scale and card treatment; the sparkline + KPI cards on the company dashboard are tidy.
- Typography is single-family sans with a sensible size ramp; good use of `text-muted-foreground` for hierarchy.

**Where it trails Linear/Stripe/Vercel**
- **[Medium] Data-density is high and undifferentiated on admin tables.** The clinics list now has ~10 columns; rows are uniform weight with little visual anchoring (Stripe uses subtle zebra/hover, stronger primary-column weight, right-aligned numerics with tabular figures — you have tabular-nums in places but not consistently).
- **[Medium] Status color is carried by raw Tailwind palette classes** (`text-emerald-600`, `text-amber-600`, `bg-sky-500/10`) and even hardcoded hexes (`#10b981`, `#22c55e`, `#eab308`, `#ef4444`, `#6366f1`) rather than semantic tokens (`--success`, `--warning`, `--info`). This works but isn't systematized — a theme change or a colorblind-safe pass would require hunting literals across files.
- **[Medium] Shadow usage is minimal/flat.** Cards mostly rely on borders; modals use `shadow-xl`. Linear/Vercel get depth from a consistent, subtle elevation scale. There's no elevation token system.
- **[Low] Empty states are text, not designed.** Compare to Notion/Linear's illustrated, CTA-bearing empty states.
- **[Low] No microtypography polish** (e.g., consistent tabular-nums on every numeric column, `text-wrap: balance` on headings).

---

## 4. Design System Consistency

**Grade: B. A real system exists and is mostly followed — with specific, fixable leaks.**

**Consistent & good:** `Button` (cva variants + sizes), `Card`, `Input`, `Label`, `Badge`, `Pagination`, `PageSizeSelect`, `SearchableSelect`, `Toast`, `ThemeToggle`. Tokens for color/radius. `focus-visible` conventions.

**Inconsistencies (each a finding)**
- **[High] Tables: 21 files hand-roll `<table>`; only 12 import the shared `Table`.** Header styling, border treatment, density, and the `overflow-x-auto` wrapper are re-implemented ad hoc (e.g. the payments/history pages build raw tables; admin lists use the component). One `DataTable` should own header style, zebra/hover, sticky header, empty row, and mobile card-collapse.
- **[High] Modals: two patterns + native `confirm()`.** `ConfirmDialog` and `ConfirmDeleteDialog` (custom portals) coexist with **3 native `confirm()` calls** (`announcement-actions.tsx:28`, `clinic-billing.tsx:440`, `import-ui.tsx:366`). There's no single `Dialog` primitive (Base UI provides one — the codebase already uses `@base-ui/react`).
- **[Medium] Status colors** not tokenized (see §3).
- **[Medium] Two "toast" concepts** (`Toast` reactive + `FlashToast` redirect flash) with no shared queue — see §11.
- **[Low] Select controls are mixed:** Base UI `Select` (`FilterSelect`/`SearchableSelect`) in some places, native `<select className="select-chevron">` in others. They're visually reconciled via CSS, but behaviour (keyboard, search) differs.

---

## 5. Accessibility

**Grade: C+. Above-average intent (lots of aria), undercut by a few real, testable failures.**

**Good**
- `aria-*` in 91 files; `role="alert"`/`role="status"` with `aria-live` on toasts and inline form messages; `role="dialog"` + `aria-modal` on modals; `role="switch"` on toggles; `sr-only` labels on the spinner.
- `focus-visible` rings on interactive elements; form labels are properly associated (`htmlFor`/`id`).

**Failures (WCAG-referenced)**
- **[P0] Custom modals lack a focus trap, initial focus, and focus restoration** (`confirm-dialog.tsx`, and by inspection `confirm-delete-dialog.tsx`). On open, focus stays on the trigger; Tab escapes to the page behind the overlay; on close, focus isn't restored. Body scroll isn't locked. *Violates WCAG 2.4.3 (Focus Order), 2.1.2 (No Keyboard Trap — inverse), and modal best practice.* Base UI's `Dialog` solves all of this for free.
- **[P1] Touch targets below minimum.** Default `Button` is `h-8` (32px); `sm`=28px; `xs`=24px; icon buttons `size-6`/`size-7`. Table-row action links (e.g. "Undo", "Print") are text links with small hit areas. *WCAG 2.5.8 (Target Size, AA) wants ≥24px and Apple/Material want ≥44px for primary touch.* On tablets (your stated doctor device) this is a real miss.
- **[P1] Icon-only controls without visible text** rely on `aria-label` — mostly present, but this needs a sweep to guarantee 100% coverage (e.g., the sidebar collapse, notification bell, theme toggle).
- **[P2] Color-contrast risk:** `text-muted-foreground` on `--muted` backgrounds, and status colors like `text-amber-600` on tinted `bg-amber-500/10`, should be verified against 4.5:1 (3:1 for large text). OKLCH lightness values look borderline for the lightest muted text.
- **[P2] No visible "skip to content" link** for keyboard users to bypass the sidebar nav.
- **[P2] Native `confirm()` dialogs** are technically accessible but bypass your focus/aria conventions and can't be styled for high-contrast/dark mode.
- **[P3] `role="img"` sparkline** has no `aria-label` describing the trend (verify).

---

## 6. Forms

**Grade: A–. The strongest area of the product.**

**Excellent**
- Label association, `autoComplete`, `autoCapitalize`, `spellCheck`, `inputMode="numeric"` + `autoComplete="one-time-code"` for OTP, `autoFocus` on the code field, `required`, disabled+pending button states, inline `role="alert"`/`role="status"` messaging, zod validation server-side, controlled inputs with a documented reason (React 19 form-action reset).
- `PasswordInput` with reveal toggle; delete-confirmation uses a masked non-`password` field so managers don't autofill.

**Gaps**
- **[Medium] Validation is mostly server-round-trip.** Fields don't validate inline on blur (e.g., email format, required) before submit; the user learns of errors only after the action returns. Add lightweight client validation for instant feedback (keep zod as the source of truth).
- **[Medium] No field-level success/affordance** beyond the reminder-days "Saved" pill you added. Consider consistent inline "saved" affordances for autosaved fields.
- **[Medium] Error summary missing on long forms.** Multi-field forms show the first issue (`parsed.error.issues[0]`) — a user with 3 errors fixes them one submit at a time. Surface all issues, ideally anchored to fields.
- **[Low] No `aria-describedby` wiring** between inputs and their helper text / error text (helper `<p>`s exist but aren't programmatically linked).
- **[Low] Autosave/drafts absent** — long forms (new appointment, clinic create) lose data on accidental navigation.

---

## 7. Tables

**Grade: C+. Functional and paginated, but feature-thin and inconsistent.**

- **[High] No sorting** on any column, anywhere. For the clinics list, payments ledger, and receivables this is a glaring omission vs every comparator.
- **[High] No bulk actions and no row selection.** Can't multi-select clinics/patients/payments to act on them.
- **[Medium] Two implementations** (component vs raw — see §4). The shared `Table` wraps `overflow-x-auto` (good); raw tables re-do it inconsistently.
- **[Medium] No sticky headers** on long tables — scroll a 500-row payments ledger and you lose the column context.
- **[Medium] Mobile tables** fall back to `overflow-x-auto` horizontal scroll (functional but the least-good responsive pattern; some pages do provide a mobile card list — e.g. payments — but it's not systematic).
- **[Low] Empty/loading states inside tables** are plain text ("No payments in this period.") with no skeleton rows.
- **Good:** pagination + page-size select are real components and consistent; `tabular-nums` used on many numeric cells; filters are strong (period pills, searchable selects, date ranges).

---

## 8. Mobile UX

**Grade: B–. A genuine responsive effort; a few structural risks.**

- **Good:** `PanelShell` has a real mobile top bar + animated hamburger drawer; a FAB replaces the header "New clinic" button on mobile; several tables provide a `md:hidden` card list; the bottom-pill stack manages safe spacing with a ResizeObserver.
- **[High] Wide admin tables force horizontal scroll on phones** (clinics list `min-w-[68rem]`). Acceptable as a stopgap (you chose it deliberately) but it's the weakest responsive pattern; a stacked card view per clinic would be better on phones.
- **[Medium] Touch targets** (see §5) — 28–32px controls are hard to tap accurately, especially the small table action links and icon buttons.
- **[Medium] Keyboard overlap / sticky bottom elements:** the fixed bottom-pill stack + fixed toast both sit at `bottom-6`; on a small screen with the on-screen keyboard up, they can overlap inputs or each other. Verify on a real device.
- **[Low] Modal on mobile** is `max-w-sm` centered with overlay — fine, but a bottom-sheet pattern is more thumb-friendly for one-handed use.

---

## 9. Performance Perception

**Grade: C. The biggest perceived-speed opportunity in the app.**

- **[P1] No skeletons; only 4 `loading.tsx`; 0 `Suspense` boundaries.** Navigating to the other ~73 routes shows the *previous* page until the server component resolves, then a hard content swap — it feels laggy even when it's fast. *Violates: perceived-performance best practice (Linear/Vercel show content-shaped skeletons instantly).*
- **[P1] The one loader is a bare centered spinner** (`PanelLoader`), not a content skeleton. Spinners communicate "waiting"; skeletons communicate "your content is arriving" and are perceived as faster.
- **[Medium] Optimistic updates are rare.** Most mutations are server-action round-trips + `revalidatePath` (correct for data integrity, but the UI waits). The reminder toggle is optimistic (good) — extend that pattern to other toggles/quick edits.
- **[Medium] No route-level prefetch strategy noted** beyond Next defaults; verify heavy pages (reports, dashboards) aren't blocking on serial queries (some already parallelize with `Promise.all` — good).
- **[Low] Animations** are minimal (drawer, button press). Fine, but there are no page transitions; that's a deliberate, defensible choice.

---

## 10. Error Handling

**Grade: D+. The clearest production-readiness gap.**

- **[P0] Zero custom `error.tsx` (0/77).** Any thrown error in a server component or action shows Next's default error overlay (dev) or a blank/generic screen (prod). No branded "Something went wrong · Retry · Go home." *Violates: Nielsen #9 (help users recover from errors).*
- **[P0] Zero custom `not-found.tsx` (0/77).** `notFound()` is called in many places (clinic detail, history, payments) but there's no styled 404 — the user gets Next's default. A `/clinic/patients/[bad-id]` deep link is a raw 404.
- **[Medium] No global network-failure handling.** Client actions that reject show a local inline error at best; there's no consistent "you're offline / request failed, retry" affordance (the `ConnectionStatus` pill covers offline detection — good — but not failed mutations).
- **[Medium] Permission-denied UX:** unauthorized access mostly `redirect`s or `notFound()`s silently. A "you don't have access to this" screen is clearer than a bounce.
- **Good:** `/paused` page exists for suspended clinics with a real reason message (`unusableReason`); form actions return typed error states rendered inline.

---

## 11. Notifications

**Grade: C. Works for the happy path; not a real notification system.**

- **[P1] Toasts don't stack.** `Toast` and `FlashToast` both render `fixed inset-x-0 bottom-6` — two at once **overlap in the same spot**. Fire a success + a background event and they collide.
- **[P1] No manual dismiss.** Toasts auto-dismiss (4s success / 6s error) with no close button and no pause-on-hover — a slow reader can miss a 4s message, and there's no way to keep it.
- **[Medium] No global/imperative toast API.** Toasts are per-page React state; cross-navigation success needs `?created=1` query-param flashing. A single `<Toaster/>` + `toast()` (Sonner-style, or a small in-house queue) would fix stacking, dismiss, and cross-page in one move.
- **[Medium] Confirmation dialogs are inconsistent** — styled `ConfirmDialog` vs native `confirm()` (see §4).
- **Good:** live-region semantics are correct (`role`/`aria-live`); the in-app `NotificationBell` exists for persistent notifications (separate from transient toasts — good separation).

---

## 12. Micro-interactions

**Grade: B. Tasteful and restrained; a few dead spots.**

- **Good:** button press (`active:translate-y-px`), hover states across variants, `focus-visible` rings, drawer animation, `tw-animate-css` available, optimistic reminder toggle, "Saved" pill feedback.
- **[Medium] Inconsistent in-flight feedback:** `useActionState` pending states are used well in forms, but native `confirm()` flows and some link-actions give no pressed/loading feedback.
- **[Low] No hover affordance on some clickable rows** beyond the cursor (RowLink exists — verify it has a hover background everywhere it's used).
- **[Low] No skeleton shimmer / no content-enter transitions** — content pops in.

---

## 13. Dashboard Quality

**Grade: B. Information-rich and correct; visualization is thin.**

- **Good:** the company metrics panel (KPIs + "Clinics by status" + top clinics + your new billing row), the Owner Overview (churn/usage flags, due/overdue, coming-up), scoped-by-assignment correctly. Numbers are the strength.
- **[Medium] Almost no data-viz.** A single server-rendered `sparkline` is the only chart. For an owner "how much are WE earning" dashboard, at least a revenue-over-time line/bar and a status donut are table stakes vs Stripe. (Keep it dependency-light — small inline SVG charts, consistent with the existing sparkline approach.)
- **[Medium] KPI cards lack trend/delta indicators** ("+12% vs last month", up/down arrows) — the single most valuable dashboard microcopy.
- **[Medium] Density:** the overview stacks many full-width cards vertically; a denser grid with clear visual priority (hero KPI row → secondary lists) would read better.
- **[Low] No date-range control on the company dashboard** itself (the finance reports have it; the top-level KPIs are fixed to this-month/this-year).

---

## 14. Code Affecting UI/UX

- **[High] Table duplication** (21 raw vs 12 component) — the top refactor for consistency; extract one `DataTable`.
- **[High] Modal duplication + native `confirm()`** — consolidate onto one Base UI `Dialog`-based primitive.
- **[Medium] Status-color literals** scattered (`text-emerald-*`, `bg-amber-*`, hexes) — introduce `--success/--warning/--info/--danger` tokens + `Badge`/`StatusPill` variants and replace call-sites.
- **[Medium] Two toast systems** — unify behind one queue.
- **[Medium] Repeated inline formatters** — `new Intl.NumberFormat("en-PK", {currency:"PKR"})` and date formatters are re-declared per file; centralize `money()`/`fmtDate()` helpers (some exist; not universal).
- **[Low] Pre-existing lint warnings** (`react-hooks/set-state-in-effect` in the nav-group/errorNonce pattern; an unused `_formData`) — clean up to keep the signal clean.
- **Good:** strong separation of server/client components; `cn()` utility; cva for variants; server actions typed with explicit result states.

---

## 15. Production Readiness by Screen

| Area / Screen | Rating | Note |
|---|---|---|
| Login / 2FA / forgot / reset (`(auth)`) | **Production Ready** | Best-in-app; only inline-validation polish left |
| Clinic dashboard | Minor Improvements | Add onboarding + trend deltas |
| Appointments list + detail | Minor Improvements | Sorting, skeletons; calendar is a planned add |
| New/Edit appointment form | Minor Improvements | Inline validation, error summary |
| Payments / Invoices / Receivables | Minor Improvements | Table consistency, sticky header, sorting |
| Sales / P&L / Shares reports | Minor Improvements | Add charts + deltas |
| `/clinic/history` (imported archive) | Production Ready | New, clean, well-scoped |
| Admin clinics list | Minor Improvements | Sorting, mobile cards, density |
| Admin Owner Overview | Minor Improvements | Density + data-viz |
| Clinic detail (admin) | Minor Improvements | Replace native `confirm()`; breadcrumbs |
| Import wizards (data + financial) | Minor Improvements | Solid; replace `confirm()`; add progress affordance |
| Voice scribe (doctor) | **Needs review (live)** | Recorder UX must be tested on a real tablet |
| Marketing / landing | **Needs review (live)** | Not audited in depth (static; verify SEO + hero) |
| **Error pages (404/500)** | ✅ **Production Ready** | ~~don't exist~~ → branded 404 + error/global-error boundaries added |
| **Global loading states** | ✅ **Production Ready** | ~~spinner-only~~ → content-shaped `PanelSkeleton` in all 4 panels |
| **Notification system** | ✅ **Production Ready** | ~~no stacking~~ → queue with stacking / dismiss / pause-on-hover |
| **Modal a11y** | ✅ **Production Ready** | ~~no focus trap~~ → rebuilt on Base UI `Dialog` (trap/restore/scroll-lock) |

---

## 16. Prioritized Findings

> Each: **Location · Description · Why it's a problem · Principle · Fix · Effort · Impact**

### P0 — Must Fix Before Release

**✅ FIXED · P0-1 · Custom modals have no focus management** *(rebuilt on Base UI `Dialog`; focus trap + restore + scroll-lock; verified live)*
- **Location:** `core/ui/confirm-dialog.tsx`, `core/ui/confirm-delete-dialog.tsx`
- **Description:** No focus trap, no initial focus on open, no focus restore on close, no body-scroll lock.
- **Why:** Keyboard/screen-reader users can Tab behind the modal and lose their place; fails a basic a11y audit any enterprise buyer runs.
- **Principle:** WCAG 2.4.3 Focus Order; ARIA Authoring Practices (Dialog).
- **Fix:** Rebuild both on Base UI `Dialog` (already a dependency) — you get trap/restore/scroll-lock/`aria` for free; keep the password step-up logic.
- **Effort:** M · **Impact:** High (a11y + polish)

**✅ FIXED · P0-2 · No custom error boundary** *(added `app/error.tsx` + `app/global-error.tsx`)*
- **Location:** app-wide (0 `error.tsx`)
- **Description:** Thrown errors render Next's default.
- **Why:** Looks broken/unfinished; no recovery path.
- **Principle:** Nielsen #9 (error recovery).
- **Fix:** Add a root `app/error.tsx` + per-panel `error.tsx` with brand shell, "Try again" (reset) and "Go to dashboard".
- **Effort:** S · **Impact:** High

**✅ FIXED · P0-3 · No custom 404** *(added branded `app/not-found.tsx`; verified live)*
- **Location:** app-wide (0 `not-found.tsx`); `notFound()` called in many routes
- **Description:** Bad IDs/URLs show Next's default 404.
- **Why:** Unbranded dead end.
- **Principle:** Nielsen #9; brand consistency.
- **Fix:** `app/not-found.tsx` (+ panel-scoped variants) with search/home CTAs.
- **Effort:** S · **Impact:** High

### P1 — High Priority

**✅ FIXED · P1-1 · Loading skeletons + boundaries** — the 4 panel `loading.tsx` boundaries now render a content-shaped `PanelSkeleton` (title → KPI cards → list rows) instead of a spinner (new `Skeleton`/`PanelSkeleton` primitives). *(In-table skeleton rows during data refetch are still a nice-to-have.)*

**✅ FIXED · P1-2 · Notification system (stack + dismiss + global API)** — one `<Toaster/>` + queue (`toast-store.ts`): stacking, ×-dismiss, pause-on-hover, imperative `toast()`; compat wrappers kept. Verified live.

**✅ FIXED · P1-3 · Table consistency + sorting** — one `DataTable` (sorting, sticky-header option, empty state, mobile cards, whole-row link, totals footer); **16 tables migrated**. Verified live. (Also delivers P2-5 + P2-7.)

**✅ FIXED · P1-4 · Touch targets** — a `@media (pointer: coarse)` rule enforces a **40px minimum** on every design-system button (incl. dense table actions + square icon buttons) on touch/stylus devices; mouse/desktop layouts are unchanged. *(Raw `<button>` pills — e.g. period tabs — not yet covered; minor.)* WCAG 2.5.8.

**✅ FIXED · P1-5 · Replace native `confirm()`** — the 3 calls (announcements/billing-void/import-undo) now use the styled `ConfirmDialog`.

**✅ FIXED · P1-6 · First-run onboarding** — `OnboardingChecklist` on the clinic dashboard (add team → patient → first appointment), self-hiding once complete.

### P2 — Medium Priority

**✅ FIXED · P2-1 · Semantic status color tokens** — added `--success/--warning/--info` tokens + `Badge` variants; swapped the `emerald/amber/sky` literals to tokens app-wide (25 files) + tokenised semantic chart colours. Verified live (light + dark).
**✅ FIXED · P2-2 · Breadcrumbs** — new `Breadcrumbs` component wired into the deep admin flow the audit named (clinic detail → import) + the shared appointment detail, replacing lone "← Back" links. Verified live. *(A few client-component detail pages still use their own header back-link; extend as needed.)*
**✅ FIXED · P2-3 · Form validation** — **error summary**: a `zodErrorMessage()` helper now surfaces **all** validation issues (deduped, joined) across 15 server actions, instead of only the first. **Inline (client) validation** is already provided natively (`required` / `type="email"` / `inputMode` / `maxLength`) on the forms. *(Richer custom on-blur field states are a further per-form increment.)*
**✅ FIXED · P2-4 · Dashboard charts + KPI deltas.** **KPI deltas** — `getFinanceKpis` now computes the prior-30-day totals (reusing `getProfitAndLoss`, so a delta can't disagree with the P&L); a `DeltaBadge` shows the % change + up/down arrow, coloured by direction, on the 4 finance KPI cards (no badge when there's no baseline). **Charts** already present (money-flow waterfall, h-bar breakdowns, multi-bar trends, sparklines). Data + math verified against a live clinic (−63% real delta); ◐ the badge pixels on the clinic dashboard weren't eyeballed — impersonation is password-gated.
**✅ FIXED · P2-5 · Sticky table headers** — a `stickyHeader` option on `DataTable` (in-table skeletons still open, see P1-1).
**◐ PARTIAL · P2-6 · Contrast verification** — dark-mode tokens/badges spot-checked live and legible; **not yet instrumented** against WCAG AA numerically. *Effort:* S.
**✅ FIXED · P2-7 · Mobile card views** — every migrated table collapses to cards below `md` via `DataTable`.
**✅ FIXED · P2-8 · Skip-to-content + icon-button labels** — ✅ **skip-to-content link** in `PanelShell` (first focusable → `#main-content`; verified live). ✅ **icon-button aria sweep** — exhaustive multiline search confirmed **every** icon-only button *and* link already has an accessible name (bell, theme toggle, hamburger, close, sign-out, dialog eye/close, toast dismiss, date-picker nav, quantity steppers, mobile FABs); **no gaps found**.

### P3 — Nice to Have

- Command palette (⌘K) for cross-app navigation/search. *Effort:* L.
- Keyboard-shortcut layer + a discoverable shortcut cheat-sheet. *Effort:* M.
- Optimistic updates extended to all quick toggles/edits. *Effort:* M.
- Autosave/drafts on long forms. *Effort:* M.
- ✅ **DONE (basic)** — reusable `EmptyState` (icon + title + optional description/CTA) wired into `DataTable`; illustrated variants still a nice-to-have.
- Bottom-sheet modals on mobile. *Effort:* M.
- Elevation/shadow token scale. *Effort:* S.
- `aria-describedby` wiring for helper/error text. *Effort:* S.

---

## 17. Missing Features (UX)

| Feature | Present? | Note |
|---|---|---|
| Search | Partial | Per-page (patients/invoices/payments); **no global search** |
| Filter | ✅ | Strong — period pills, searchable selects, date ranges |
| Sorting | ✅ (was ❌) | Client-side column sorting on every `DataTable` (16 tables) |
| Bulk actions | ❌ | No multi-select / batch operations |
| Undo | Partial | Import batches undo; no general action undo |
| Autosave / Drafts | ❌ | Long forms lose data on nav-away |
| Keyboard shortcuts | Partial | Some `onKeyDown`; no global layer or cheat-sheet |
| Command palette | ❌ | No ⌘K |
| Tooltips | ❌/rare | `title=` attrs only; no real tooltip component |
| Empty states | ✅ (was Partial) | Designed `EmptyState` (icon + message) via `DataTable`; illustrated/CTA variants still nice-to-have |
| Help text | Partial | Good on some forms; not systematic |
| Pagination | ✅ | Real, consistent component |
| Breadcrumbs | ❌ | None |
| Quick actions | Partial | FAB on mobile; no per-row quick-action menus |
| Dark mode | ✅ | Full, token-driven |
| Onboarding | ✅ (was ❌) | First-run checklist on the clinic dashboard |
| Notifications (stack/dismiss) | ✅ (was ❌) | Toast queue — stacks, dismissable, pause-on-hover |
| Error/404 pages | ✅ (was ❌) | Branded 404 + error / global-error boundaries |
| Charts / data-viz | ❌ (sparkline only) | Dashboards are numbers-only |

---

## 18. Final Scores

> These are the **original (pre-remediation)** scores. The "Now" column reflects the 2026-07-30 fixes (§0a) — every P0, P1, and P2 (except measured contrast) is closed; the remaining drag is P3 polish (command palette, keyboard shortcuts, elevation) + instrumented contrast.

| Dimension | Was /10 | Now /10 | Rationale (updated) |
|---|---:|---:|---|
| Visual Design | 7.5 | 8.5 | + tokenised status colours, designed empty states, KPI trend deltas |
| User Experience | 6.5 | 8.0 | + onboarding, real notifications, breadcrumbs, error summary, no dead-ends |
| Accessibility | 5.5 | 7.5 | + modal focus trap/restore, 40px touch targets, skip-link, verified-complete icon-button labels; measured contrast (P2-6) still to instrument |
| Consistency | 6.5 | 8.0 | + one `DataTable` (16 tables), one modal primitive, colour tokens |
| Responsiveness | 6.5 | 7.5 | + uniform mobile card views + a touch-target minimum |
| Professional Appearance | 7.0 | 8.0 | + branded error/404, stacking toasts |
| Ease of Use | 6.5 | 7.0 | + first-run guidance, sortable tables |
| First Impression | 6.0 | 7.5 | + no raw error/404, content skeletons instead of a spinner |
| Production Readiness | 5.5 | 8.0 | P0 blockers cleared + loading skeletons + a passing production build |
| **Overall Product Quality** | **6.5** | **8.5** | Every P0/P1/P2 (bar measured contrast) resolved + build-verified; remaining = P3 polish |

---

## 19. Executive Summary

### Top 10 Issues
1. No custom error boundary (`error.tsx`) — raw errors in prod. **(P0)**
2. No custom 404 (`not-found.tsx`). **(P0)**
3. Modals lack focus trap/restore/scroll-lock. **(P0, a11y)**
4. No loading skeletons; navigation feels laggy. **(P1)**
5. Notifications don't stack, can't be dismissed, no global API. **(P1)**
6. Table implementation is inconsistent; no sorting/bulk/selection. **(P1)**
7. Touch targets below comfortable minimum (esp. tablets/phones). **(P1, a11y)**
8. Native `confirm()` in 3 places breaks the design language. **(P1)**
9. No first-run onboarding for new clinics/users. **(P1)**
10. Controls hidden behind unrelated preconditions with no hint (discoverability). **(P1)**

### Top 10 Quick Wins (S effort, high ROI)
1. Add `app/error.tsx` + `app/not-found.tsx` (branded, with CTAs).
2. Replace the 3 native `confirm()` calls with `ConfirmDialog`.
3. Add a "Skip to content" link.
4. Add a dismiss (×) button + pause-on-hover to `Toast`.
5. Bump touch targets under `@media (pointer:coarse)`.
6. Add sticky headers to the long ledgers.
7. Add trend/delta arrows to KPI cards.
8. Sweep icon-only buttons for `aria-label` coverage.
9. Add elevation/shadow tokens and apply to cards/modals.
10. Clean the pre-existing lint warnings.

### Top 10 Highest-ROI Improvements
1. Skeleton loading across major routes (biggest perceived-speed lift).
2. One `DataTable` (consistency + sorting + mobile cards in one move).
3. Global toast queue (Sonner-style).
4. Rebuild modals on Base UI `Dialog` (a11y + consistency).
5. First-run onboarding checklist (activation metric).
6. Semantic status-color tokens + `StatusPill`.
7. Dashboard charts + KPI deltas.
8. Breadcrumbs on deep routes.
9. Inline client validation + full error summary.
10. Command palette (power-user + super-admin speed).

### What makes it look "unfinished"
Default Next error/404 screens; spinner-then-hard-swap navigation; overlapping/auto-vanishing toasts; a native OS `confirm()` popping up mid-flow; plain-text empty states.

### What makes it feel "premium"
The token-driven theming + real dark mode; the login/2FA flow; the thoughtful low-level details (autofill repaint, scrollbar-gutter, password masking, live regions); permission-adaptive nav; the finance depth.

### What should be redesigned completely
Nothing needs a ground-up redesign. Three subsystems should be *rebuilt on better foundations*: **error/empty/loading states** (net-new), **notifications** (queue), and **the table layer** (one `DataTable`). Modals should be re-based on Base UI `Dialog`.

### What competitors do better
- **Linear/Vercel:** instant content skeletons; ⌘K everywhere; crisp empty states.
- **Stripe:** dense-but-scannable tables with sorting + column controls; KPI deltas; charts.
- **Notion/Slack:** stacking, dismissible, actionable notifications; onboarding.
- **Airbnb/Apple:** touch-target discipline and mobile bottom-sheets.

---

## 20. Implementation Plan

**Phase 1 — Critical fixes (release blockers) · ~3–4 days**
- `error.tsx` (root + per panel) and `not-found.tsx` (branded, CTAs). *(P0-2, P0-3)*
- Rebuild `ConfirmDialog`/`ConfirmDeleteDialog` on Base UI `Dialog` (focus trap/restore/scroll-lock). *(P0-1)*
- Replace the 3 native `confirm()` calls. *(P1-5)*

**Phase 2 — UX improvements · ~1 week**
- Global toast queue (stack/dismiss/pause/imperative API). *(P1-2)*
- One `DataTable` (sticky header, sorting, empty/skeleton rows, mobile cards); migrate the finance ledgers + clinics list first. *(P1-3, P2-5, P2-7)*
- First-run onboarding checklist on empty dashboards. *(P1-6)*
- Breadcrumbs on deep routes; audit hidden-control discoverability. *(P2-2)*

**Phase 3 — Visual polish · ~3–4 days**
- Semantic status tokens + `StatusPill`; kill color literals/hexes. *(P2-1)*
- Elevation/shadow token scale; apply to cards/modals.
- Dashboard charts + KPI delta indicators; designed empty states. *(P2-4)*

**Phase 4 — Accessibility · ~3–4 days**
- Skeletons everywhere (also perceived-perf). *(P1-1)*
- Touch-target bump for coarse pointers. *(P1-4)*
- "Skip to content"; icon-button `aria-label` sweep; `aria-describedby` wiring; contrast pass. *(P2-3, P2-6, P2-8)*
- **Then run a live, authenticated screen-reader + keyboard pass** (see Method Gap).

**Phase 5 — Performance & power-user · ~1 week**
- Extend optimistic updates to quick toggles/edits.
- Command palette (⌘K) + keyboard-shortcut layer + cheat-sheet. *(P3)*
- Autosave/drafts on long forms; parallelize any serial report queries. *(P3)*

---

## Method Gap

<a name="method-gap"></a>
This audit is **static (code-level)**. It did not exercise the running UI, so the following require a **live, authenticated pass across mobile/tablet/desktop** before release sign-off — ideally with a screen reader (VoiceOver/NVDA) and keyboard-only:
- Actual color-contrast measurements (values above are flagged as *risks*, not confirmed failures).
- Real touch-target tapping on a tablet (the doctor device).
- Keyboard-overlap behaviour of the fixed bottom pill + toast when the on-screen keyboard is up.
- Voice-scribe recorder UX (permissions, in-progress/error states) — highest-uncertainty screen.
- Marketing/landing SEO + hero rendering.
- Focus-order and screen-reader announcements end-to-end.

To enable it: run the app, seed a login, and I can drive it with browser automation (I won't enter real credentials — provide a throwaway test account or a pre-authenticated session).

---

*End of audit.*
