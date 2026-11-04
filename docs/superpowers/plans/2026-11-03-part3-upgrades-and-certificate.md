# Part 3 — Upgrades billed by the electrician; certificate can come later — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every job, electrical upgrades are quoted, booked and billed by the electrician directly with the owner. Home Insulation Victoria only needs the Part C and a checked Certificate of Electrical Safety before the install day. The certificate may come later than the upgrades. The Mitti PIESA form gets Jo's new wording.

**Architecture:** Generalise the existing in-house "partner bills rectification" mode to every job (one pure predicate, `hivBillsUpgrades(job) === false` always). The upgrades-day booking moves to the electrician's no-login link (Part 2's `/e/` step model) and the installer office card. The certificate becomes optional on both Mitti forms; a new "Waiting for certificate" state, an electrician link step to add it, and a chase sweep follow the certificate-later spec. The install gate on the certificate moves from "can't book the install" to the pre-start checks.

**Tech Stack:** TypeScript, TanStack routes, Supabase admin client, Mitti API read, Bun test + PGlite, pending SQL.

**Specs:** `docs/superpowers/specs/2026-11-03-deep-first-job-design.md` (Part 3) and `docs/superpowers/specs/2026-11-03-certificate-later-design.md`

## Global Constraints

- **HIV never quotes, invoices or marks up upgrades on any job.** No rectification quote is generated, sent or invoiced; the $100 markup is dead code. Existing rectification quotes on live jobs are left alone (none exist on real jobs; TEST only).
- **HIV needs before the install day:** Part C recorded AND a certificate on the job AND the certificate ticked (AI or office). Booking the install is NOT blocked by these; starting it is (DON'T START).
- **New PIESA wording (portal first, then Jo pastes into Mitti):** q20 "Are electrical upgrades needed?"; q30 "Are you doing the electrical upgrades today?" The old labels stay as aliases. Owner/trade wording: "electrical upgrades", never "fixes" or "repair work".
- **Certificate optional** on the A3 PIESA (q45) and the A4 upgrades form (number, date, file). Part C counts as recorded without it.
- **Upgrades day with no date:** 1 business day → text the electrician; 2 business days → email the installer office; 7 days left on the 30-day clock → red office flag. Entering a day stops all three.
- **Certificate chase:** 2 business days after upgrades done → text the electrician; 4 business days → office flag. Both stop when a file arrives.
- Business days = Victorian (`addMelbourneBusinessDays`). Trade texts pass `{ businessId: recipient, jobId }`; office emails via `sendOfficeEmail` + `pauseJobId`. New wording held (`wordingApproved:false` / APPROVED=false) until Jo approves each message.
- Fail closed; HIV leads with HIV-arranged electricians (legacy) keep working but also stop getting upgrades quotes.

## Review Focus

1. A job where the PIESA says upgrades needed but the electrician never comes back → the no-date chase fires on day 1 and 2, then the 7-days-left flag; nothing is sent twice. Task 5.
2. The certificate arrives via Mitti (A3 q45 or A4) AND via the link upload → one certificate check, one owner copy, no duplicate Needs items. Task 4.
3. An old PIESA form with the old q20/q30 labels syncs after deploy → reads identically. Task 2.
4. Same-day upgrades on the A3 with no certificate → Part C recorded, PIESA approvable, installer paid, job "Waiting for certificate". Task 3.
5. The install is booked, the certificate is still missing at 2pm the day before → the pre-start fails with "Certificate of Electrical Safety not in yet" (DON'T START wording comes in Part 5; here it is the existing prestart_failed Needs row). Task 4.

---

### Task 1: HIV stops quoting upgrades

**Files:**
- Create: `src/lib/upgrades-billing.core.ts`
- Modify: `src/lib/in-house.core.ts` (`partnerBillsRectification` → delegates to the new predicate, always true), `src/lib/quotes.server.ts` (`generateRectificationQuote` returns `{skipped:"electrician_bills"}` for every job), `src/lib/auto-fixes-quote-send.server.ts` (`maybeAutoSendFixesQuote` no-op with reason), `src/lib/allocation.core.ts` (`electricalClearance` no longer needs an approved fixes quote; `rectificationSendBlocker` returns "Electricians bill upgrades directly"), `src/lib/booking.server.ts` + `src/lib/workflow.server.ts` (the fixes payment gate is bypassed for every job), `src/lib/fixes-times-link.server.ts` (`textFixesTimesLink` no longer sent), `src/lib/office-needs.core.ts`/`.server.ts` (drop `fixes_times_missing`, `rectification_quote_unanswered`, `AUTO_FIXES_QUOTE_HELD_EVENT` rows for jobs with no existing quote), owner fixes page (`owner-fixes.server.ts` returns a plain "Your electrician quotes and arranges the electrical upgrades with you directly" state when no quote exists)
- Test: `tests/upgrades-billing.core.test.ts`, `tests/upgrades-billing.pglite.test.ts`

**Interfaces:**
- Produces: `electricianBillsUpgrades(job?: unknown): true` (pure, always true, documented as the 2 Nov rule so a future reversal is one line); `UPGRADES_BILLED_BY_ELECTRICIAN = "Your electrician quotes and arranges the electrical upgrades with you directly."`

- [ ] Step 1: Failing tests: PIESA complete with upgrades on an HIV lead → no rectification quote row, no O29 email, clearance not blocked by a missing quote; an installer's own job → same; a TEST job with an existing rectification quote keeps its quote (untouched).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement. Keep the in-house `rectification_billed_by` column reads harmless.
- [ ] Step 4: Run → PASS; also run singly `tests/fixes-price.core.test.ts`, `tests/auto-fixes-quote-send.test.ts`, `tests/owner-fixes-flow.test.ts`, `tests/phase3-fixes-before-deposit.test.ts`, `tests/install-clearance.test.ts`, updating assertions that encoded the old rule (say which).
- [ ] Step 5: Commit `feat(upgrades): electricians bill electrical upgrades on every job`

### Task 2: New PIESA wording, certificate optional, A3 price questions dropped

**Files:**
- Modify: `src/lib/official-short.core.ts` (q20 label → "Are electrical upgrades needed?" with the old label as alias; q30 label → "Are you doing the electrical upgrades today?" with the old label as alias; `isLiveA3Snapshot` accepts either q20 wording; `fixesPriceIncGst` → `required:false` / legacy), `src/lib/piesa-evidence.core.ts` (`ces_file` never required to complete; absence → `certificateToCome: true`), `src/lib/fixes-day.core.ts` (`FIXES_DAY_QUESTIONS` coesNumber/certDate/coesFile `required:false` with help text "Don't have it yet? Leave this blank — we'll text you a link to add it."; `fixesCompletionPlan` returns `kind:"done"` with `certificate: null` when they're blank), `src/lib/mitti-forms.core.ts` (`validateTemplate("piesa")` tolerates the dropped price questions)
- Docs: `docs/MITTI_PIESA_FORM_SPEC.md`, `docs/MITTI_PIESA_CHATGPT_PROMPT.md`, `docs/MITTI_PIESA_BUILD_PROMPT.md`, `docs/MITTI_FIXES_FORM_PROMPT.md`, and a new `docs/MITTI_PART3_EDIT_PROMPT.md` (the paste-ready ChatGPT prompt for Jo: the exact edits to both templates)
- Test: existing drift tests (`tests/fixes-day.test.ts`, `tests/fixes-price.core.test.ts`, `tests/a4-repair-one-list.test.ts`, `tests/piesa-evidence.test.ts`) updated; new `tests/piesa-wording-part3.test.ts`

**Interfaces:**
- Produces: `shortAnswersFromEntries("piesa", …)` yields the same `rectificationNeeded` / `rectificationComplete` ids from old OR new labels; `piesaEvidenceBlockers` never lists the certificate; `fixesCompletionPlan` `done` carries `certificate: { number, date, files } | null`.

- [ ] Step 1: Failing tests: old-label snapshot and new-label snapshot give identical short answers (Review Focus 3); A3 with same-day upgrades and no q45 → evidence blockers empty and `certificateToCome` true; A4 with Q9 Yes, work photo, signature, no certificate → `done` with `certificate: null`; `validateTemplate("piesa")` passes a template without q22; the drift tests match the updated prompt docs.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement + update the docs.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(piesa): upgrades wording, optional certificate, no price questions`

### Task 3: "Waiting for certificate" state and the electrician link steps

**Files:**
- Create: `src/lib/certificate-later.core.ts`, `src/lib/certificate-later.server.ts`
- Modify: `src/lib/electrician-link.core.ts` (`ElectricianStep` gains `"enter_upgrades_day" | "do_upgrades_in_mitti" | "add_certificate"`; `electricianStep(f)` ordering: book_piesa → do_piesa_in_mitti → (upgrades needed, not today, no day) enter_upgrades_day → (day set, form not done) do_upgrades_in_mitti → (Part C recorded, no certificate) add_certificate → done), `src/lib/electrician-link.server.ts` (`electricianLinkView` computes the facts; new `linkEnterUpgradesDay(token, startIso)` → `confirmBooking(jobId,"rectification",…)` (which already creates the A4 form) + owner "You're booked" via `notifyOwnerBooked(jobId,"upgrades"…)`; new `linkAddCertificate(token, { number, date, filePath })` → reuses `recordPiesa` kind `post_rectification` internals / `applyPiesaRecord` so the certificate lands where `coes-check.server` reads it), `src/routes/e.$token.tsx` (the three new screens, one action each), `src/lib/own-job-piesa-notices.server.ts` (reuse `textElectrician` for a "certificate" text with the link; new SMS type `electrician_certificate_link`, held), installer job page + office job page (status line "Waiting for {electrician}'s Certificate of Electrical Safety" / "Upgrades day not set yet")
- Test: `tests/certificate-later.core.test.ts`, `tests/certificate-later.pglite.test.ts`, `tests/electrician-link.core.test.ts` (step table extended)

**Interfaces:**
- Produces (pure): `certificateState(f: { upgradesNeeded; upgradesDoneAt: string|null; partCRecorded: boolean; certificateFileAt: string|null; certificateTicked: boolean }): "none_needed" | "upgrades_pending" | "waiting_for_certificate" | "certificate_in" | "clear"`.
- Produces: `jobCertificateFacts(jobId): Promise<CertificateFacts>` built from the PIESA snapshot (Task 2 ids), the A4 completion events, `coes-check.server currentCoes`, and `coesState`.
- Upload for the certificate: a signed upload URL under `jobs/{jobId}/electrician-uploads/…` in `job-files`, minted only for the active electrician's valid token; the add step verifies the stored upload.

- [ ] Step 1: Failing tests: `certificateState` table (Review Focus 4 among them); `electricianStep` extended table; PGlite: enter upgrades day → rectification booking + A4 form creation call + owner notice; add certificate → `piesa_records` post_rectification row with the file, `coes-check` sees it (Review Focus 2: a later Mitti q45 with the same job → `currentCoes` picks one current certificate, one check event); token/revocation rules still hold on the new actions.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS. Run singly `tests/electrician-link.pglite.test.ts`, `tests/coes*.test.ts`, `tests/fixes-day.test.ts`.
- [ ] Step 5: Commit `feat(certificate-later): waiting-for-certificate state and electrician link steps`

### Task 4: Install gate moves to pre-start; certificate check unchanged

**Files:**
- Modify: `src/lib/workflow.server.ts` (~:344 remove the `coesBlockerFor` block on `installation_booked`), `src/lib/prestart.core.ts` (`PrestartFacts` gains `certificate: "not_needed" | "missing" | "unchecked" | "ticked"`; `prestartFailures` adds "Certificate of Electrical Safety not in yet" / "Check electrical certificate — {why}"), `src/lib/prestart.server.ts` (`prestartFacts` fills it from `certificateState` + `coesState`), `src/lib/allocation.core.ts` (`electricalClearance` requires Part C recorded when upgrades were needed, not the certificate), install-booking paths (`install-days`, `inHouseBookVisit` for installation, Part 2's office booking) — install booking allowed while the certificate is outstanding, with a warning line "Certificate of Electrical Safety still to come — the install can't start without it"
- Test: `tests/prestart.core.test.ts` (extended), `tests/certificate-prestart.pglite.test.ts`

- [ ] Step 1: Failing tests: booking the install with the certificate missing succeeds and records the warning; pre-start with certificate missing → failure reason listed (Review Focus 5); with a file but unchecked → "Check electrical certificate"; ticked → passes; no upgrades → not_needed.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS. Run singly `tests/install-clearance.test.ts`, `tests/prestart*.test.ts`, `tests/a48-b1-coes.test.ts`, `tests/task5-coes-send.test.ts`.
- [ ] Step 5: Commit `feat(certificate-later): install can be booked, not started, without the certificate`

### Task 4b: Complete PIESA under the new rules; same-day Part C writes the record; own jobs complete themselves

Added 4 Nov after the Task 4 review found it: plan line 29 promised "PIESA approvable" for the same-day A3, and nothing delivers it. With the Mitti price questions gone, `completePiesaAssessment` refuses every "upgrades needed" A3 ("Add the electrical fixes items for today's quote…"), still asks for fixes times when items exist, and the same-day A3 never writes the post_rectification record, so the job sits at `piesa_complete` with outcome `fail` and `installEntryElectricalBlockers` keeps it out of `installation_scheduling`. Installer-added electricians have no login, so nobody presses Complete PIESA on an own job.

**Files:**
- Modify: `src/lib/piesa-complete.server.ts` — when `electricianBillsUpgrades()`: a live A3 with q20 = Yes completes with no items, no price and no fixes times (the electrician quotes and books with the owner directly; the "Add the electrical fixes items…" refusal and the `rectPlanBlockers` requirement are skipped — items that DO exist stay listed, unpriced "other" items no longer block); after the `initial` record and the `piesa_complete` transition, if `piesaRectificationDone(short)` (q30 = Yes + Part C) → `applyPiesaRecord({ kind: "post_rectification", outcome: "pass", completedDate: <Part C date from the answers, else assessed_on>, sectionCSignedDate: same, source: { kind: "mitti_a3_same_day", auditId } })` so items complete, the deposit is requested, compliance checks pass and the job moves to `installation_scheduling`; the certificate state then reads waiting_for_certificate / certificate_in exactly as the A4 path does.
- Modify: `src/lib/piesa-record.server.ts` — `source.kind` gains `"mitti_a3_same_day"` with the same once-per-audit dedupe as `mitti_fixes_form` (the `piesa_recorded` event with `{ source, audit_id }`); the `installation_scheduling` transition still runs on a duplicate at the listed stages.
- Modify: `src/lib/mitti.server.ts` (the A3 sync, after `checkCurrentCoes` / the Task 3 notice) — **own jobs only** (`isInstallerOwnJob`, channel `installer_sourced`, not in-house): a Complete A3 (`completed`) at `piesa_scheduled` auto-runs `completePiesaAssessment({ jobId }, actorId ?? electricianUserId)` once per audit (claim/dedupe on a `piesa_auto_completed` event). A refusal records ONE office Needs row (`piesa_rules_failed`-style, reuse the existing kind if its shape fits, else `own_job_piesa_complete_held`) with the reason, never a loop. HIV-lead and in-house jobs: the electrician/office still presses Complete PIESA (unchanged).
- Modify: `src/lib/electrician-link.server.ts` — `piesaDone` stays stage-based (so the link moves to the next step once the auto-complete has run).
- Test: `tests/piesa-complete-upgrades.pglite.test.ts` (new), `tests/piesa-complete*.test.ts` singly, `tests/certificate-later.pglite.test.ts`, `tests/electrician-link.pglite.test.ts`, `tests/install-clearance.test.ts`.

- [ ] Step 1: Failing tests (PGlite): (a) live A3, q20 Yes, q30 No, no items, no price → Complete PIESA succeeds (outcome fail, `piesa_complete`, no fixes times asked); (b) same-day A3 (q20 Yes, q30 Yes, Part C, certificate No) → Complete PIESA → one `post_rectification` pass record, items completed, stage `installation_scheduling`, `certificateState` = waiting_for_certificate, deposit request called; a second Complete / re-sync writes no second record; (c) same-day with the certificate attached (q45) → certificate_in; (d) own job: Mitti sync of a Complete A3 at `piesa_scheduled` auto-completes once; a refused auto-complete leaves ONE office row and the stage unchanged; (e) HIV-lead job: the sync does NOT auto-complete; (f) legacy A3 with a price still completes as before.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS, one file at a time; `bunx tsc --noEmit -p .`.
- [ ] Step 5: Commit `feat(certificate-later): Complete PIESA without a fixes quote; same-day Part C records; own jobs complete themselves`

### Task 5: Chasing sweeps and office flags

**Files:**
- Create: `sweepUpgradesDayChase(now)` and `sweepCertificateChase(now)` in `src/lib/certificate-later.server.ts`; pure `upgradesDayChaseAction(f)` / `certificateChaseAction(f)` in `certificate-later.core.ts`; register both in `src/routes/api/public/hooks/allocation-tick.ts`
- Modify: `src/lib/office-needs.core.ts` / `.server.ts` / `needs-cards.core.ts`: items "Upgrades day not set — {electrician} on {address}" (after 2 business days), red "Upgrades day not set — 7 days left on the 30-day clock", "Certificate not in — call {electrician} ({phone})" (after 4 business days)
- Test: `tests/certificate-chase.core.test.ts`, `tests/certificate-chase.pglite.test.ts`

**Interfaces:**
- `upgradesDayChaseAction(f: { upgradesNeededAt: string; dayEntered: boolean; piesaAt: string; now: Date; sent: { text1: boolean; email2: boolean; flag7: boolean } }): ("text_electrician" | "email_office" | "red_flag")[]`, business days from `upgradesNeededAt`, the red flag when `piesaAt + 30 days − now ≤ 7 days`.
- `certificateChaseAction(f: { upgradesDoneAt: string; fileAt: string|null; now; sent: { text2: boolean; flag4: boolean } })`.
- Each send keyed by a stable id per job/round; texts via `textElectrician` with the link, type `electrician_certificate_link` (held); office email via `sendOfficeEmail` (held wording).

- [ ] Step 1: Failing tests: the action tables across a weekend and Melbourne Cup day; PGlite: no day entered → day 1 text, day 2 email, then the red flag at 7 days left; nothing twice (Review Focus 1); entering a day stops it; certificate: 2 days text, 4 days flag, a file stops it.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(certificate-later): chase the upgrades day and the certificate`

### Task 6: Wording, Mitti prompt, TEST journey, PR

- [ ] Step 1: `docs/wording/2026-11-03-part3-messages.md`: every new text/email/Needs line with exact wording and flags (held).
- [ ] Step 2: `docs/MITTI_PART3_EDIT_PROMPT.md` final check: the exact labels in the prompt match `official-short.core.ts` and `fixes-day.core.ts` (drift test).
- [ ] Step 3: Add a TEST journey run "own job, upgrades another day, certificate later" to `journey-branches.server.ts`.
- [ ] Step 4: tsc; every new/touched test file singly; note any that fail on origin/main too.
- [ ] Step 5: Push `part3-upgrades-and-certificate`, open the PR. After merge: Jo approves the wording one at a time; Claude gives Jo the Mitti prompt to paste; no SQL expected (confirm).
