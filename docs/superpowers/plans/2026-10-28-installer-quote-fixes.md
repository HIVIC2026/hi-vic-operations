# Installer Quotes Always Right Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installer's owner-quote preview always matches the latest price and rules. Electricians must be onboarded before they can be chosen. Jobs stuck on a not-onboarded electrician get a clear note plus an installer-only switch.

**Architecture:** Keep the saved INSTALLER_A1 draft and refresh it (approach A). The quote pipeline is `draftInstallerQuoteFromReadyCheck` in src/lib/installer-quote.server.ts with the shared `writeHeldInstallerDraft`. Electrician choice stays the append-only `electrician_choice_set` event (src/lib/electrician-choice.*). Onboarding status comes from `loadApprovedRecCandidates` / `approvedRecFor` (src/lib/rec-onboarded.*).

**Tech Stack:** TypeScript, TanStack Start server functions, React Query, Supabase, bun:test, PGlite DB tests.

**Spec:** docs/superpowers/specs/2026-10-28-installer-quote-fixes-design.md

**Branch state:** `fix-held-quote-latest-price` already holds draft commits 78d9586…6170a65 from 27 Oct. Tasks marked **verify** start from that code. The implementer confirms every listed test exists and passes, adds the missing ones test-first, and fixes any gap. Tasks marked **build** are new work.

## Global Constraints

- A quote that has been sent or accepted is never changed.
- Nothing here sends a text or email, except the approved repair-price link text (switch off until turned on).
- Office Adjust stays available and is not locked.
- Exact installer note: "We can't send the owner's quote yet. [Name] hasn't finished signing up with us. Ask them to finish, or use our electrician ($349) instead."
- Exact installer button: "Use Home Insulation Victoria's electrician ($349) instead". The confirm asks "Are you sure?". The switch is final, with no switch back.
- Exact Add a job greyed text: "[Name] — not signed up with us yet. They need to finish before you can choose them."
- Exact office alert: "The quote your office edited was rebuilt with new figures. Check it before sending."
- Generic hold reason when none is listed: "Quote held for office review".
- The office cannot change a job's electrician. Only that job's installer business can.
- Bulk upload is not used. Do not change it.
- Run every test file on its own (`bun test <file>`), because module mocks are process-wide. The full `tsc` runs out of memory here, so type-check touched files and their imports and say so.
- Follow AGENTS.md, src/AGENTS.md and src/lib/AGENTS.md. Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains.
- Commits use `git -c user.name="Claude" -c user.email="noreply@anthropic.com"`. Each message ends with the Co-Authored-By and Claude-Session lines. Never rebase or force-push.

## Review Focus

1. The installer switches to our electrician while a quote is already sent or accepted. Expect: refused, and the quote is unchanged (Task 3 test).
2. An electrician is approved, then later removed or no longer approved, on an open job. Expect: treated as not onboarded, with the note and button shown (Task 2 test).
3. A worker (not the business owner) or another installer business taps the switch. Expect: refused (Task 3 test).
4. The switch is double-tapped. Expect: one `electrician_choice_set` event and one rebuilt draft (Task 3 test).
5. "My usual electrician" is posted to Add a job from an old page while the electrician is not onboarded. Expect: the server refuses it with the greyed text's reason (Task 4 test).

---

### Task 1 (verify): Owner quote rebuild rules and wording

**Files:**
- Modify (already drafted): src/lib/installer-quote.server.ts, src/lib/installer-price.server.ts, src/lib/installer-led.core.ts, src/lib/mitti-forms.core.ts, src/components/trade/InstallerPriceCard.tsx
- Test: tests/installer-quote-held-rebuild-db.test.ts, tests/installer-quote.test.ts, tests/installer-quote-card-access-fee-db.test.ts, tests/installer-price-card-refresh.test.tsx, tests/installer-price.test.ts

**Interfaces:**
- Produces: `heldFiguresBuildable(draft, { measuredM2, wholeVeec })`, `heldDraftHoldReason(blockers: string[]): string`, `electricianPriceKnown(...)`, `entriesAndPriceSource(...)` (throws on read error)

- [ ] **Step 1: Confirm these tests exist and pass. Add any that are missing, test-first.**
  - HV-3197 shape. The price card is $3,000, the electrician is ours, and the Mitti access fee is $200. The rebuilt draft has an INSTALLER_PRICE of 3000, a description containing "Ceiling insulation - supply & install" and no "R5.0" and no "difficult access", a PIESA of 349, an AP_FEE of 349, and a discount > 0.
  - An old "R5.0 supply and install" label displays as "Ceiling insulation - supply & install". Validation of the canonical key still passes.
  - A held job with a known electrician price rebuilds the held draft with the new price. A second identical run inserts nothing and refreshes `release_hold_reason`.
  - A missing m² or "VEU discount can't be worked out" means the open draft is superseded and no new draft is made.
  - A price-card read error leaves the existing draft untouched and adds no access fee.
  - A held draft with no blockers gets `release_hold_reason` starting "Quote held for office review".
  - After Save price succeeds, the price card refreshes the owner-quote preview, and the preview never reads a superseded draft.
  - Issued and accepted quotes are untouched.
- [ ] **Step 2: Run each file on its own.** Expected: all pass. Name any failure that also fails on origin/main.
- [ ] **Step 3: Commit any added tests or fixes.**

### Task 2 (build): Not-onboarded electrician on an existing job

**Files:**
- Modify: src/lib/rec-onboarded.core.ts (`INSTALLER_NOT_ONBOARDED_LINE` → `installerNotOnboardedNote(name: string): string`), src/lib/installer-quote-status.core.ts (`QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE` usage), src/lib/installer-quote-status.server.ts, the trade job page price/quote card that renders the status line (find it from `installerQuoteLine`/`QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE` call sites)
- Test: tests/installer-quote-status.test.ts (create if absent), tests/installer-quote-held-rebuild-db.test.ts

**Interfaces:**
- Produces: `installerNotOnboardedNote(name: string): string` returns the exact Global Constraints note with [Name] filled in. `InstallerQuote.electricianNotOnboarded` carries `{ name: string } | null` (not a boolean), so the card can show the name and the Task 3 button.

- [ ] **Step 1: Write failing tests.**
  - `installerNotOnboardedNote("TEST Sparky")` equals the exact note with "TEST Sparky".
  - HV-3129 shape (choice "different" or "usual", the electrician is not in approved candidates, old draft 4201.25):
    - the open draft is superseded and there is no new draft;
    - `loadInstallerQuote(jobId).electricianNotOnboarded` equals `{ name: "TEST Sparky" }`;
    - the status line equals the exact note.
  - An electrician who was approved and is now not approved, on an open job, gives the same result.
  - Once that electrician appears in the approved candidates with a rate of 300, the next rebuild makes a held draft
    with a PIESA line of 300, and `electricianNotOnboarded` is null.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `notOnboardedReason(name)` as the internal hold reason. Only installer-facing text changes.
- [ ] **Step 4: Run them.** Expected: PASS. Rerun the Task 1 test files.
- [ ] **Step 5: Commit.**

### Task 3 (build): Installer switch to our electrician

**Files:**
- Modify: src/lib/electrician-choice.core.ts (add `"installer_switch"` to `ElectricianChoiceRecord["source"]`), src/lib/electrician-choice.server.ts
- Create: `switchToHivicElectrician` server function in src/lib/electrician-choice.functions.ts (create the file if absent, following project chain rules)
- Modify: the trade card from Task 2, to show the button and the "Are you sure?" confirm under the note
- Test: tests/electrician-switch-db.test.ts, and a component test for the button

**Interfaces:**
- Consumes: `recordElectricianChoice(jobId, businessId, actorId, "hivic", "installer_switch")`, `draftInstallerQuoteFromReadyCheck`
- Produces: `switchToHivicElectrician({ jobId }) → { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write failing tests.**
  - The job's installer business owner on a held not-onboarded job: one `electrician_choice_set` with `{ choice: "hivic", source: "installer_switch" }`. The draft is rebuilt with PIESA 349, and nothing is sent.
  - A second call: `ok: false`, with no second event and no second draft.
  - An office or admin user: refused.
  - A worker in that business who is not the owner: refused.
  - Another installer business: refused.
  - A job whose quote is sent or accepted: refused, and the quote is unchanged.
  - A job whose electrician is onboarded or already ours: refused.
  - The button shows only when `electricianNotOnboarded` is set. Confirming calls the function once. Cancelling calls nothing.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use the same business-owner check the price card's save uses (`installer-price.set.server.ts` or similar; reuse it, don't copy it). Rebuild the quote in the same request, so the preview appears straight away.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4 (build): Add a job only offers an onboarded usual electrician

**Files:**
- Modify: src/lib/onsite-ready-check.functions.ts (the options loader, ~lines 29-30), src/lib/electrician-choice.core.ts (`electricianChoiceOptions`, `electricianChoiceProblem`, `defaultElectricianChoice`), src/lib/onsite-ready-check.server.ts (server-side validation, ~line 28), src/components/trade/add-job-flow.tsx (~lines 42-100)
- Test: tests/electrician-choice.test.ts (create or extend it), tests/add-job-electrician-onboarded.test.tsx

**Interfaces:**
- Produces: `usualElectrician: { name: string; onboarded: boolean } | null` from the options loader. `electricianChoiceOptions(usual)` returns `{ value, label, disabled?: boolean, note?: string }[]`. `defaultElectricianChoice(usual)` returns "usual" only when `usual?.onboarded`. `electricianChoiceProblem("usual", usual)` returns the greyed reason when it is not onboarded.

- [ ] **Step 1: Write failing tests.**
  - Not onboarded:
    - the options are [usual (disabled, note = exact greyed text with name), hivic];
    - the default is "hivic";
    - posting "usual" is refused server-side.
  - Onboarded:
    - the usual option is enabled;
    - the default is "usual";
    - posting "usual" is accepted.
  - The UI renders the greyed option and the exact text, and it can't be selected.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Onboarded means `approvedRecFor({ name, licence }, await loadApprovedRecCandidates())` finds a match with a rate.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5 (verify + change wording): Office alert when an edited draft is rebuilt

**Files:**
- Modify: src/lib/quote-edit-replaced.core.ts (`QUOTE_EDIT_REPLACED_NOTICE`)
- Test: tests/quote-edit-replaced.test.ts, tests/installer-quote-held-rebuild-db.test.ts

- [ ] **Step 1: Change the test expectation to the exact office alert text from Global Constraints.** Run it. Expected: FAIL.
- [ ] **Step 2: Update `QUOTE_EDIT_REPLACED_NOTICE`.** Run the tests. Expected: PASS.
- [ ] **Step 3: Confirm these tests exist and pass.**
  - The alert fires once for each replaced edited draft, on both the held and the ready path.
  - It does not fire for an unedited draft.
  - It does not block Send.
  - It does not show on any installer screen.
- [ ] **Step 4: Commit.**

### Task 7 (build): Electrician staff add fix items without a price

**Files:**
- Modify: the electrician job page "Other" fixes item form and its server function (find via `other_unit_price_inc_gst`),
  and where those items are shown to electrician logins
- Test: tests/electrician-staff-fix-items.test.ts

**Interfaces:**
- Consumes: `ownsJobBusiness(jobId, userId, "electrician")` from src/lib/crew-no-price.server.ts

- [ ] **Step 1: Write failing tests.**
  - An electrician staff member (not the owner of the job's electrician business):
    - can add an "Other" item with a description;
    - the price field is not shown to them and is refused if sent;
    - no `other_unit_price_inc_gst` or any amount appears in their page data.
  - The electrician owner can still see and enter the price.
  - Office can still see and enter the price.
  - An item a staff member adds with no price is held for the owner or office to price, using the existing
    `needs_office_pricing` flow. Check whether that flow exists before relying on it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use the server-side owner check. Keep existing pricing rules.
- [ ] **Step 4: Run them.** Expected: PASS. Rerun the crew-no-price test files.
- [ ] **Step 5: Commit.**

### Task 8 (build): Staff finish the PIESA while an item waits for a price

**Files:**
- Modify: the PIESA completion gate (`completeAssessment` and its blocker for `needs_office_pricing` items, see
  src/lib/AGENTS.md "Mitti bridge"); the fixes quote send/release check; the electrician job page (staff hint)
- Test: tests/electrician-staff-complete-unpriced.test.ts

- [ ] **Step 1: Write failing tests.**
  - Staff complete the PIESA with one unpriced "Other" item: completion succeeds.
  - The fixes quote is not released or sent while any item is unpriced. Once the owner or office prices it, the
    normal flow continues.
  - Staff see exactly "Your business owner or the office will add the price." under their unpriced item.
  - Staff page data has no price.
  - Owner and office behaviour is unchanged.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Move the "unpriced item" block from PIESA completion to fixes-quote release. Do not
  change any safety or regulatory gate on the PIESA itself.
- [ ] **Step 4: Run them.** Expected: PASS. Rerun Task 7's tests and the rectification and fixes tests.
- [ ] **Step 5: Commit.**

### Task 9 (build): Electrician owner prices the repair work in the portal

**Files:**
- Model on the installer setup: src/lib/installer-price*.ts, src/components/trade/InstallerPriceCard.tsx and
  src/lib/boss-price-link.server.ts (decisions 278/289: the business owner gets one `/field/{jobId}#price` link text;
  SMS type and event recorded before send; TEST jobs use the test sender).
- Read: src/lib/fixes-price.core.ts (`fixesPriceSource`, today it reads `fixesPriceIncGst` from the A3 form),
  src/lib/official-short.core.ts (`FIXES_PRICE_LABEL`).
- Test: tests/electrician-repair-price.test.ts

**Interfaces:**
- Consumes: `ownsJobBusiness(jobId, userId, "electrician")`.
- Produces: an electrician price record (event, latest wins) that `fixesPriceSource` reads FIRST; the A3 form price
  is only a fallback for old forms.

- [ ] **Step 1: Write failing tests.**
  - A3 completed with repair work and no price: the electrician business owner gets exactly one text with the
    job's #price link (event before send, TEST uses the test sender). There is no second text on later syncs.
  - The owner opens the job and sees a "Your price" card: the ticked work list read-only, and a total inc GST input.
    Saving the price builds the held fixes quote from it.
  - Staff: no card, no price in page data, and saving is refused server-side.
  - The office can enter the same price from the office job page.
  - The fixes quote is never sent while there is no price. This reuses the existing $0/unpriced send blocker.
  - Old forms that still carry a price keep working (used as the fallback).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the installer pieces where they fit; don't copy them. The comms master switch,
  per-type text switch, quiet hours and STOP rules all apply.
- [ ] **Step 4: Run them.** Expected: PASS. Rerun the Task 7/8 tests and the fixes-quote tests.
- [ ] **Step 5: Commit.**

### Task 6: Bring in main and check the whole branch

- [ ] **Step 1: Merge main.** Run `git fetch origin main && git merge origin/main`, keeping both sides on conflict. Check `git diff origin/main..HEAD --stat` lists only this branch's files.
- [ ] **Step 2: Rerun every test file from Tasks 1–5, each on its own.** Expected: all pass. Name any failure that also fails on main.
- [ ] **Step 3: Push.**
- [ ] **Step 4: After Jo publishes (not part of this build): run the spec's "Done when" checks on TEST jobs HV-3129
  and HV-3197, and on Add a job with a not-onboarded usual electrician.**
