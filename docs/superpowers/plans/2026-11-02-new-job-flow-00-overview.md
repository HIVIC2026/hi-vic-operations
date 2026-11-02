# New job flow + installer portal — Implementation Plan (overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file is the index; each part is its own plan file with its own tasks.

**Goal:** Build the approved 2 Nov 2026 spec: every job moves to the new flow (installer calls and books, installer's own electrician does the PIESA), every owner/trade message, page, screen and PDF matches the approved wording and look, and every VEU/ESC rule is enforced at the right time.

**Architecture:** The spec spans ten independent subsystems, so it is built as ten part-plans plus a final check. Each part follows the repo's existing pattern — wording and rules in pure `*.core.ts` modules with bun tests, side effects in `*.server.ts`, screens in `src/routes` reading through the existing view servers — and ships behind the existing switches (`customer_comms_enabled`, per-message approval flags) so nothing goes live until Jo approves that part.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase (Postgres + RLS), bun:test, PGlite practice DB for SQL, Playwright for PDFs/screens, Mitti (external forms, changed through template prompts), Stripe, Xero.

**Spec:** Claude Doc "Spec: Home Insulation Victoria new job flow + installer portal", rev 31, approved by Jo 2 Nov 2026 — https://claude.ai/artifact/RQM2wsxK4h33cKD5bqqsDm (export with Claude_Docs `export`, container project `c59dc7d9-c3ce-4532-b4dc-de6851f89cac`, file `9ea2ee83-7732`, format markdown; copy into `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` as the first commit). Exact approved wording: `hiv-touchpoint-decisions.md` (copy into `docs/` in the same commit). Approved PDF samples: `customer-agreement-v1.3-final.pdf` (lawyer-approved 2 Nov; load v1.3), `acceptance-sample.pdf`, `receipt-deposit.pdf`, `receipt-balance.pdf`, `tax-invoice-sample.pdf`, `esc-consent-final.pdf`, `veec-form-sample.pdf`, `swms-sample.pdf` and their HTML sources (`*-web.html`, `pdf1.js`) — copy into `docs/approved-samples/2026-11-02/`.

## Global Constraints

- Source of truth: `hiv-touchpoint-decisions.md` (2 Nov 2026). Where it and the spec differ, the latest dated decision wins; the "Decisions from the electrician + SWMS chat" section wins over anything earlier. `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` are updated in the same commit as any rule they state.
- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` before edits; run `bun scripts/scan-retired-terms.ts` before workflow work.
- Always write "Home Insulation Victoria" in full on screens and messages, never "HIV". Trades see PIESA, SWMS, PIISA without explanation. Owners see "electrical safety check (PIESA)", "rebate" (never "VEU discount"), "electrical upgrades" (never "fixes").
- Phone numbers shown to owners are always the installer's or electrician's OFFICE phone, never a worker's mobile.
- Business details on every document: DC Construction Solutions Pty Ltd trading as Home Insulation Victoria · ABN 44 671 613 979 · Accredited Person A003654 · 1/33 Altree Court, Phillip ACT 2606 · info@homeinsulationvictoria.com.au. AP signer: Chris Lowe, Director, 0416 252 406.
- PDF look: Open Sans, blue #3c51c4, navy #22376b, green #07bf61, light boxes #eef0fc, logo `public/email-preview/hi-vic-logo.png`, page `600px × 849px`, margins `30px 40px 46px` (`@page:first` top 0), footer "Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program · Page N of M". Never split a section across pages.
- Official forms (ESC consent V1, VEEC assignment V1.1, DEECA PIESA/PIISA March 2026, Statement of rights, VEU factsheet) keep their official wording exactly.
- Nothing new that isn't in the spec or the decisions file. Anything found during the build that needs a choice goes to Jo as a question first.
- Payment timing: $349 at acceptance; 10% deposit = 10% of the price after the $349 (e.g. $183.90 on $2,188), paid on the ONE confirm-and-pay page that opens straight after the PIESA result — also when upgrades are still to come; the install day is booked only after the deposit is paid; booking before the upgrades day is a warning; the GO check still needs the Part C + certificate; no "deposit by 2pm" rule; the rest on install day (Jo 2 Nov, answers 1, 11, 21 — 21 supersedes 3 and 5). Two separate fees on every job: $349 Home Insulation Victoria (AP) fee and $349 PIESA. Own customers: the electrician is paid their own rate; Home Insulation Victoria keeps the difference (answer 2).
- Build method (answer 20): checked step by step — fresh builder per task, reviewer before the next (superpowers:subagent-driven-development).
- New SQL goes in `docs/pending-migrations/`, proven on PGlite, never run live without Jo's go-ahead. No force pushes (Lovable sync).
- Every send uses the existing guarded senders and approval flags; TEST jobs (`source='qa_test'`) go to test-send. Nothing goes live until Jo approves that part from phone-width pictures with the wording pasted as text.

## Review Focus

1. **Jobs already in flight on the old flow.** A job past acceptance when its part ships must keep working and never get both old and new messages. Each part that replaces a message adds a test that a job at each existing stage gets exactly one of old/new (owned by Parts 3, 4, 7).
2. **Install day moves after the ESC notice is sent.** Inside 5 days → update (same ID); further out, address change, "Owner cancelled", "Can't do this one" → withdraw. Part 9 tests each case and that the GO check re-runs after the move.
3. **Owner never pays the balance.** Warranty, instructions, VEEC copy, dispute info and contact details still go out on completion; installer pay still waits. Part 4 test: completion with unpaid balance sends the All done pack and records `warranty_copy_provided`.
4. **"Do not contact" set mid-job** (office button, or the owner replying STOP to any text). Every automatic owner reminder stops, but compliance sends the owner must legally get (consent copy, PIESA copy, VEEC copy, completion documents) still go. Part 3 test lists both sets explicitly.
5. **Installer's own customer with no logo uploaded / waiting more than 3 months.** Co-branded documents fall back to our logo only; consent re-ask applies to website leads only (own customers consent at Add a job). Part 10 and Part 3 tests.

## Parts (build in this order)

| # | Plan file | Builds (spec sections / rules) | Depends on |
|---|---|---|---|
| 1 | `…-01-documents-pdfs.md` | PDFs and official forms: shared website-look PDF renderer; Customer Agreement v1.2/v1.3 as approved compliance template; signed acceptance (typed name + Chris Lowe counter-signature, scope lines); receipt PDFs; tax invoice PDF (every ESC field, GST on full price); full Statement of rights; VEEC form page layout; PIESA/PIISA 3 fixes; warranties (Bradford AU 70-year, ECOWOOL removed); manufacturer's instructions | — |
| 2 | `…-02-owner-wording-payments.md` | Global owner wording rules; payment timing "on install day" everywhere; payment-terms text; "You're in!" next steps; contact block; VEU box; complaint line; automatic replies (O76); removed owner pages | 1 |
| 3 | `…-03-owner-flow-to-acceptance.md` | Job flow steps 1–6; contact consent naming the installer + record (website consent line approved; Tom changes the website — checklist item); 3-month consent re-ask in "It's your turn"; rental questions in the quick taps (rented? tenant name/mobile/email, who lets us in → `rentalAnswersFor`, `accessPersonFor`); consent to documents by link; "Do not contact" flag (office button + owner STOP reply; legal copies still go, also to unsubscribed owners); quote page (two ticks, typed name, timing line); quote reminders/expiry; Rapid "will call" #23; removed messages before acceptance; moving installers onto "installer calls and books" | 1, 2 |
| 4 | `…-04-owner-flow-piesa-to-done.md` | Job flow steps 7–11; PIESA "You're booked" with electrician details; clear to install; upgrades needed (leads to confirm-and-pay); confirm-and-pay page opening straight after the PIESA result (signed consent copy sent at signing); deposit received; install "You're booked"; rentals: access-person booked + day-before texts, tenant notice by text + email (answers from the owner's quick taps); "can't go ahead" owner email; CoES copy to owner; All done email (AP/installer/electrician contacts, dispute info, warranty + instructions on completion, VEEC copy ≤10 business days); sign-and-pay page; reminders; "didn't comply" notice from an office button; removed messages after acceptance | 1, 2 (+ Part 9 Task 2 early) |
| 5 | `…-05-installer-screens.md` | My work, Job page (Owner row shows the access person; no Manhole/Pets rows), Add a job (how got customer, consent tick naming the installer), Money (no Download statement), My business (who-books, logo upload), Team; roles; Next step box rules (book-by dates per Jo's answer 11; deposit before booking; booking before the upgrades day with a warning); removed "How it works" tab and old booking card | 2 (+ Part 9 Tasks 2, 9, 10 early) |
| 6 | `…-06-electricians.md` | Electrician job link (no login), who-books, PIESA booked email, upgrades steps, CoES upload, nudges, 30-day red flag (installer office + info@ + Needs me), "Can't do this one", access person on the link and email; remove electrician sign-in | 5 |
| 7 | `…-07-lead-installer-crew.md` | Install tomorrow text, SWMS signing page + PDF changes (hazard 9, downlight step, "Changes during the job" from the Mitti install form, Lead Installer on site whole install; new wording behind a switch), Lead Installer 9am two-days-before email + 5pm lock (Part 9's rule), 6:30am jobs text, removed trade messages (#28, #35, #40–43, #47, #50, #54) | 5 (+ Part 9 Task 9 early) |
| 8 | `…-08-mitti-forms.md` | Mitti template changes: Ready Check photo-ID tick (no rental questions — they moved to Part 3's quick taps); PIESA adult present + life support attachment; install form Lead Installer VEEC Part B at end, SWMS changes during the job, day-2+ PIISA re-check, adult present, Lead Installer whole install, premises type, records checklist; ECOWOOL option removed; signature lands on official VEEC PDF | 1 |
| 9 | `…-09-compliance-gates.md` | Gates table + all timing rules: insurance/licence (+ reminders to business email, copy info@), required on file, GO/DON'T START (adds PIESA copy ≥24h, electrician at install, consent ≥24h, adult/life support, Part C + certificate when upgrades were needed), booking before the upgrades day = warning (deposit still before booking), ESC notice send/update/withdraw, PIISA timing, Lead Installer lock (one rule), 30-day rule, downlights, product on VEU Register at creation, $200 co-payment never refunded after creation, per-job "no ESC" marker for real runs, audit fixes, complaints 5/20 business days, 6-year records | 4, 6, 7, 8 |
| 10 | `…-10-own-customers.md` | Installers' own customers: Add a job path, VEU info on first email, "Enter your price" step + email, price lines ($349 + $349 − rebate), electrician paid own rate, co-branded quote/page/invoice, labels, pay rule | 3, 5 |
| 11 | `…-11-final-check.md` | Spec vs VEU Specifications Part 48 + VEET Regulations (files from Jo, read; regression task); end-to-end TEST runs; every message/PDF/gate check; Jo's phone sign-off per part; switch-on list; then REAL runs (Jo/Tom as owner, INSolation, Tom's Electrical, Stripe test mode, "no ESC" marker, no trade pay, Xero invoices voided after); then move the other installers | all |

Each part ends with: tests green (`bun run test`), `bun run portal-qa` for the screens it touched, phone-width pictures + wording to Jo, and her approval before its switches turn on.

## Cross-part decisions (main session, after all parts were written)

- **Lead Installer lock:** Part 9 owns the rule — `leadInstallerLock(startIso): { emailAt; lockAt; lockLabel }`, `leadInstallerLocked(startIso, now)`, `LEAD_LOCKED_MESSAGE` in `prestart.core.ts` (locked from 5pm two days before). Part 5 shows it ("Lead Installer locks {day 5pm}", "Locked: ESC has been told…"), Part 7 sends the 9am email and refuses changes by importing Part 9's names. Neither re-implements the clock.
- **Built early (applied 2 Nov evening):** Part 9 Tasks 2, 9, 10 (`requireEscWithdrawal`, the lock, the before-upgrades warning) before Parts 4, 5, 7 use them; Part 4 Task 8 (`queueVisitCancelledOwnerEmail`) before Parts 5 and 6 call it. Otherwise the consumer stubs behind its import. Rental answers (`AccessPerson`, `accessPersonFor`, `rentalAnswersFor`) come from Part 3 Task 19, which builds before Parts 4–6.
- **Logo:** Part 5 stores the uploaded installer logo in the existing `businesses.branding.logo_url` (no new column); Part 10 reads it only through `businessLogoUrl(businessId)`.
- **ESC notice on trade actions:** Part 5's "Can't do this one" and "Owner cancelled" call Part 9's `requireEscWithdrawal`; Part 9 Task order puts that function before Part 5 uses it (build Part 9 Task for `requireEscWithdrawal` early, or Part 5 stubs the call behind its import).
- **VEEC Part B signature:** Part 1's VEEC PDF renderer takes a Part B signature image (the Lead Installer's drawn Mitti signature) with the typed name beside it; Part 8 supplies the image. (Decision: "the Mitti signature must land on the official VEEC PDF".)
- **ESC owner consent PDF in the website look:** added to Part 1 as Task 15 (render `esc-consent-final.pdf` layout from `consent-web.html` via the Part 1 layout kit; ESC template V1 wording verbatim; replaces the current consent copy attachment behind its own flag, off).
- **Moving every installer onto "installer calls and books":** owned by Part 3 (it replaces the old pick-a-time flow and runs the in-flight count script first).
- **`P2.tick2Sub`:** Part 3 deletes it; Part 2 skips it.
- **Old trade-side Ready Check / usual-electrician messages (#28, #35, #40–43, #47, #50, #54):** owned by Part 7 as removals ("removed trade messages").
- **Trade emails inside owner steps** (I23 "Owner accepted", #27 "Nearly there" → Part 3; #41 signed PIESA copy, #45 "Deposit paid" → Part 4).
- **Decided from earlier approvals (not re-asked):** overdue stays 7 days after install day (lawyer-approved agreement); Add a job tick names the installer (VEU rule 1, approved) — "The owner has agreed to Home Insulation Victoria and {installer} contacting them about this job."; SWMS states the Lead Installer is on site for the whole install (rule 12, approved); the drawn Mitti signature goes on Part B; own-customer installer pay = once the owner has paid in full AND the "no pay without the green light" paperwork gate passes; public liability amount is typed by the office when approving the certificate; legal copies (consent, PIESA, VEEC, completion documents) still go to owners who unsubscribed or are marked Do not contact.
- **Wording approvals:** every draft message in Parts 3–10 stays behind its own approval flag (off). Jo approves each draft from phone-width pictures with the wording pasted as text, in that part's build, before its flag turns on.
- **SWMS go-live timing:** new SWMS wording voids existing signatures — Part 11 switches it on only when no real install is within 48 hours.

## Jo's answers (2 Nov evening, `JO-ANSWERS-2026-11-02.md`) — where each landed

| # | Answer | Parts / tasks |
|---|---|---|
| 1 | Deposit = 10% after the $349 | P1 T3/T5/T6 (+ samples re-rendered), P2 T1 |
| 2 | Own customers: electrician paid own rate | P10 T10 |
| 3, 5, 11, 21 | Deposit on the confirm-and-pay page straight after the PIESA result; book only after the deposit; booking before the upgrades day = warning; GO needs Part C + certificate; book-by dates (21 supersedes 3, 5) | P4 T2/T4/T5/T6, P9 T10, P5 T2/T3, P2 |
| 4 | "Can't go ahead" owner email | P4 T8, called from P5 T6, P6 T6 |
| 6, 7, 22, 24 | Rentals: owner answers in the quick taps (not Mitti; own customers get them by text after Add a job); access person texts; tenant notice by text + email | P3 T19, P10 T8, P4 T15/T16, P5 T3/T5, P6 T9 |
| 8 | STOP reply → Do not contact | P3 T17 |
| 9 | "Didn't comply" office button | P4 T13 |
| 10 | Consent copy at signing | P4 T5/T6 |
| 12 | No Manhole/Pets rows | P5 T5 |
| 13 | 30-day red flag | P6 T7 |
| 14 | No Download statement | P5 T8 |
| 15 | Website consent line (Tom) | P3 T3, P11 T3 checklist |
| 16 | SWMS changes in Mitti | P8 T10, P7 T2 |
| 17 | Insurance reminders + info@ | P9 T8 |
| 18, 19, 23 | Real runs, "no ESC" marker, Stripe test, no trade pay, Xero voided after | P9 T14, P11 T6/T8/T9 |
| 20 | Checked step-by-step build | Global Constraints |

Still open (asked in the parts): old-flow jobs in flight if the count isn't zero (P3 Q1); own-customer VEU voluntary/complaints line (P10 Q1); ESC/Bradford documents if download fails (P1 Q1).

## Regulations + Specifications check (2 Nov 2026, from Jo's uploaded files)

Read in full: VEET Amendment (Ceiling Insulation) Regulations 2026 (S.R. 19/2026) and VEU Specifications v25 Part 48. Every rule maps to the spec/plan or to existing portal checks:
- Reg 23A(1)(a)–(k) (PIESA by applicable electrician, hazards rectified, conditions met, owner consent in time, ESC notice in time, consent confirmation on request, PIESA copy to installer + owner, PIISA after PIESA and in time, worksite safe, installer meets ESC training/competency) → Parts 4, 8, 9 (all already in the spec).
- Reg 10(9)–(10) eligibility (Class 1 / Class 2 sole-occupancy unit; ceiling not built in the last 5 years; EVERY luminaire IC/IC-4; existing insulation none, foil only, or average < R2.0) and Sch 4 cl 15 (no certificate if a Part 48 product was already installed there since 14 Apr 2026) → existing portal checks (`eligibility.core.ts`, `readycheck.core.ts`, PIESA Q17). Part 11 adds a regression task: each of these still blocks after Parts 1–10.
- Spec Table 48.3: R5.0 minimum total; CodeMark thermal + fire (AS/NZS 1530.3 from 1 Oct 2026); no metallic/loose-fill/cellulose; PIESA copy ≥24h before; consent ≥24h; ESC notice ≥24h; PIISA within 30 days of PIESA; install starts within 30 days of PIESA; all eligible and practical ceiling spaces insulated; unsuitable/metallic existing insulation removed; if not removed, owner advised (already in the VEEC form v1.1 declaration); waste removed per EPA; $200 co-payment; ≥5-year warranty with Australian contact → all in spec/plan or existing portal (product register, VEEC form, SWMS, warranty map).
- Result: no new rules beyond the spec. One regression task added to Part 11.
