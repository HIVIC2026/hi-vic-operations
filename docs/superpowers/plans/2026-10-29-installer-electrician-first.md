# Installer's Electrician First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the electrician an installer names at sign-up (save it, invite it once), and offer HIV-lead safety checks to the Ready Check installer's signed-up electrician first.

**Architecture:** Pure rules in `*.core.ts` (tested with bun:test), thin server wiring in `*.server.ts`. Reuses the existing usual-electrician record (`installer_usual_electrician_saved`), the existing nomination/invite sender (`sendElectricianInvite`), and the existing automatic-offer step (`autoOfferStep`). `autoLinkApprovedRec` already links the electrician once it is approved — no change there.

**Tech Stack:** TypeScript, TanStack server functions, Supabase (Postgres), bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-installer-electrician-first-design.md`

## Global Constraints
- Owner safety-check line on HIV leads stays $349; electrician paid their own `electrician_rates` PIESA rate; `electricianSourceForOurLead()` stays `"ours"`.
- Installers' own jobs (`channel === "installer_sourced"`) keep decision 426 exactly (miss or decline → office).
- Never overwrite an installer's saved usual electrician. Never send an invite twice. Comms master switch off → no send (retry next tick).
- No live-database writes without Jo's yes (Task 5).
- Tests: `bun scripts/test-isolated.ts 8 tests/<file>.test.ts`; full: `bun scripts/test-isolated.ts 8`. Typecheck: `NODE_OPTIONS=--max-old-space-size=8192 bunx tsc --noEmit`. Lint: `bun run lint` (touched files). Never commit `bun.lock`/`package.json`.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CfFAPESH2VkMFWn2vSXhBG`.

## Review Focus
1. Preferred electrician lapses AND a later nearest electrician exists → must still go to office (lapse ≠ decline). Test in Task 1.
2. Preferred declined, then nearest also declines → 2 misses → office (normal limit). Test in Task 1.
3. Ready Check installer's usual electrician exists but is not an approved REC (Viking today) → nearest first, never `preferred_blocked` on A2. Test in Task 1 + Task 2.
4. Application lists electricians but none marked main → first one used; empty list or `electrician_choice !== "have"` → nothing saved. Test in Task 3.
5. Sign-up nomination already sent / already linked to a business / installer not approved yet → no send. Test in Task 4.

---

### Task 1: Offer rule for HIV leads (pure)

**Files:**
- Modify: `src/lib/auto-offer.core.ts` (`autoOfferPreferredElectrician`, `autoOfferStep`, header comment lines 1–9, doc comments ~102–117)
- Modify: `src/lib/our-lead-piesa-electrician.core.ts` (comment block only: add "29 Oct 2026 replaces decision 374 for routing: Ready Check installer's approved usual electrician gets the first offer; money unchanged")
- Test: `tests/auto-offer.core.test.ts`

**Interfaces:**
- Produces: `autoOfferPreferredElectrician(i: { channel: string | null | undefined; a1PreferredBusinessId: string | null | undefined; ourLeadUsualBusinessId?: string | null }): string | null` — A1 → `a1PreferredBusinessId`; otherwise → `ourLeadUsualBusinessId ?? null`.
- Produces: `autoOfferStep(f: AutoOfferFacts & { candidates; usualBusinessId?: string | null; preferredRule?: "installer_job" | "our_lead" })` — default `"installer_job"` (today's behaviour).

- [ ] **Step 1: Write failing tests** (add to `tests/auto-offer.core.test.ts`, using existing `cand`, `base`, `miss`)

```ts
const lead = (rows: AutoOfferRow[], usual: string | null, cands = [cand("viking", { distanceKm: 40 }), cand("near", { distanceKm: 5 })]) =>
  autoOfferStep({ ...base("piesa", rows), candidates: cands, usualBusinessId: usual, preferredRule: "our_lead" });

test("our lead: installer's electrician first even when further away", () => {
  expect(lead([], "viking")).toMatchObject({ action: "offer", businessId: "viking", basis: "usual_electrician" });
});
test("our lead: their electrician lets it lapse → office", () => {
  expect(lead([miss("viking", "expired")], "viking")).toMatchObject({ action: "return_to_office", reason: "preferred_missed" });
});
test("our lead: their electrician says Not for me → nearest next", () => {
  expect(lead([miss("viking", "declined")], "viking")).toMatchObject({ action: "offer", businessId: "near", basis: "coverage" });
});
test("our lead: declined then nearest declines → 2 misses → office", () => {
  expect(lead([miss("viking", "declined"), miss("near", "declined")], "viking")).toMatchObject({ action: "return_to_office", reason: "two_misses" });
});
test("our lead: their electrician can't be offered → nearest, never preferred_blocked", () => {
  expect(lead([], "viking", [cand("viking", { coversPostcode: false }), cand("near")])).toMatchObject({ action: "offer", businessId: "near" });
  expect(lead([], "ghost")).toMatchObject({ action: "offer", businessId: "near" });
});
test("our lead with no usual electrician = today's nearest first", () => {
  expect(lead([], null)).toMatchObject({ action: "offer", businessId: "near" });
});
test("preferred picks per channel", () => {
  expect(autoOfferPreferredElectrician({ channel: "hivic_sourced", a1PreferredBusinessId: "x", ourLeadUsualBusinessId: "v" })).toBe("v");
  expect(autoOfferPreferredElectrician({ channel: "installer_sourced", a1PreferredBusinessId: "x", ourLeadUsualBusinessId: "v" })).toBe("x");
});
```
Update the existing test that asserts our leads get `null` from `autoOfferPreferredElectrician` to pass `ourLeadUsualBusinessId: undefined`. Existing A1 tests (`preferred_missed`, `preferred_blocked`) must stay green unchanged.

- [ ] **Step 2: Run, expect FAIL** — `bun scripts/test-isolated.ts 8 tests/auto-offer.core.test.ts`
- [ ] **Step 3: Implement.** In `autoOfferStep`, when `preferredRule === "our_lead"`: if `usualBusinessId` was tried and its latest row status is `"expired"` → `return_to_office` `preferred_missed`; if it can't be offered (absent or `autoOfferExclusion`) → rank with `usualBusinessId = null`; otherwise fall through to normal ranking (tried set excludes it after a decline). Keep the A1 branches exactly as they are for `"installer_job"`.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit** — `feat(offers): installer's electrician first on HIV leads (lapse → office, decline → nearest)`

### Task 2: Wire the Ready Check installer's electrician into offers (server)

**Files:**
- Modify: `src/lib/auto-offer.server.ts` (`electricianCandidates` ~75–100; `autoOfferForJob` call at ~138 passes `preferredRule`)
- Modify: `src/lib/our-lead-piesa-electrician.core.ts` — add pure helper
- Test: `tests/auto-offer.core.test.ts` (helper) + `tests/our-lead-usual-electrician.test.ts` (new)

**Interfaces:**
- Consumes: `quotedInstaller(jobId): Promise<string | null>` (`src/lib/install-holds.server.ts`), `readUsualElectrician(businessId)` (`usual-electrician.server.ts`), `matchUsualElectrician` (same core file).
- Produces: `ourLeadUsualRecId(usual: UsualElectrician | null, candidates: UsualMatchCandidate[]): string | null` in `our-lead-piesa-electrician.core.ts` — matched approved REC's `business_id`, else null.

- [ ] **Step 1: Failing tests** (`tests/our-lead-usual-electrician.test.ts`)

```ts
test("matches by licence then name; none → null", () => {
  const c = [{ business_id: "v", name: "Viking Electrical Services Aus PTY LTD", rec_number: "38603" }];
  expect(ourLeadUsualRecId({ name: "Will Casdorff", licence: "38603" }, c)).toBe("v");
  expect(ourLeadUsualRecId({ name: "Viking Electrical Services Aus", licence: "ZZZ" }, c)).toBe("v");
  expect(ourLeadUsualRecId(null, c)).toBeNull();
  expect(ourLeadUsualRecId({ name: "Tudor", licence: "1" }, c)).toBeNull();
});
test("server passes our_lead rule and Ready Check installer for HIV leads", () => {
  const src = readFileSync("src/lib/auto-offer.server.ts", "utf8");
  expect(src).toContain("quotedInstaller");
  expect(src).toContain('preferredRule: job.channel === "installer_sourced" ? "installer_job" : "our_lead"');
});
```
- [ ] **Step 2: Run, expect FAIL** — `bun scripts/test-isolated.ts 8 tests/our-lead-usual-electrician.test.ts`
- [ ] **Step 3: Implement.** `ourLeadUsualRecId` = `matchUsualElectrician(usual, candidates)?.business_id ?? null`. In `electricianCandidates`, when `channel !== "installer_sourced"`: `quotedInstaller(jobId)` → `readUsualElectrician` → `ourLeadUsualRecId` against `candidates` (approved RECs covering the job, from `recCandidatesFor`); pass as `ourLeadUsualBusinessId`. Any read error → null (today's behaviour). Pass `preferredRule` into `autoOfferStep`.
- [ ] **Step 4: Run both test files, expect PASS.**
- [ ] **Step 5: Commit** — `feat(offers): HIV leads use the Ready Check installer's approved electrician first`

### Task 3: Save the electrician from installer sign-up on approval

**Files:**
- Create: `src/lib/signup-electrician.core.ts`, `src/lib/signup-electrician.server.ts`
- Modify: `src/lib/pilot.functions.ts` `setOnboardingStatus` (after the `autoLinkApprovedRec` line ~101): best-effort call for installer businesses
- Test: `tests/signup-electrician.test.ts`

**Interfaces:**
- Produces: `signupMainElectrician(data: unknown): UsualElectrician | null` — only when `data.electrician_choice === "have"`; picks `is_primary` else first of `preferred_electricians`; `name` = `business_name || name`, `licence` = `rec_number || licence_number`, `email`, `phone` = `mobile` with spaces removed; null if no name or licence.
- Produces: `carrySignupElectrician(businessId: string, actorId: string | null): Promise<{ saved: boolean; reason?: "no_application" | "no_electrician" | "already_saved" }>` — application via `partner_activations.application_id`; skip if `readUsualElectrician(businessId).electrician` exists; else insert `admin_config_events` `{ event_type: USUAL_ELECTRICIAN_EVENT, details: { business_id, electrician, source: "installer_signup" } }`; and set `nominating_business_id = businessId` on that application's `electrician_nominations` rows where it is null.

- [ ] **Step 1: Failing tests**

```ts
const viking = { name: "Will Casdorff", email: "jesse@vikingelec.com.au", mobile: "0 4 6 6 6 5 1 9 0 8", is_primary: true, rec_number: "38603", business_name: "Viking Electrical Services Aus PTY LTD", licence_number: "A81638" };
test("main electrician from sign-up", () => {
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [viking] }))
    .toEqual({ name: "Viking Electrical Services Aus PTY LTD", licence: "38603", email: "jesse@vikingelec.com.au", phone: "0466651908" });
});
test("first one when none marked main; nothing when not 'have' or empty", () => {
  const a = { ...viking, is_primary: false, business_name: "A" }, b = { ...viking, is_primary: false, business_name: "B" };
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [a, b] })?.name).toBe("A");
  expect(signupMainElectrician({ electrician_choice: "hivic", preferred_electricians: [viking] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [] })).toBeNull();
  expect(signupMainElectrician({ electrician_choice: "have", preferred_electricians: [{ name: "", business_name: "" }] })).toBeNull();
});
test("approval calls it, never fails approval", () => {
  const src = readFileSync("src/lib/pilot.functions.ts", "utf8");
  expect(src).toMatch(/carrySignupElectrician\(data\.businessId, context\.userId\)\)?\.catch/);
});
```
- [ ] **Step 2: Run, expect FAIL** — `bun scripts/test-isolated.ts 8 tests/signup-electrician.test.ts`
- [ ] **Step 3: Implement** the two functions and the approval call (installer business types only; `.catch(console.error)`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `fix(onboarding): keep the electrician an installer names at sign-up`

### Task 4: Send stuck sign-up electrician invites once

**Files:**
- Modify: `src/lib/signup-electrician.core.ts`, `src/lib/signup-electrician.server.ts`
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (~299, next to `sweepRecOnboardingInvites`)
- Test: `tests/signup-electrician.test.ts`

**Interfaces:**
- Produces: `signupInviteDue(n: { status: string; invite_sent_at: string | null; business_id: string | null; email: string | null; installerApproved: boolean; commsEnabled: boolean; electricianAlreadyApproved: boolean }): "send" | "wait" | "skip"` — `"wait"` when comms off; `"skip"` unless status `invite_pending_comms`, not sent, no `business_id`, has email, installer approved, electrician not already an approved REC.
- Produces: `sweepSignupNominationInvites(now?: Date): Promise<{ checked: number; sent: number; skipped: number; failed: number }>` — rows with `installer_application_id` not null and `job_id` null; fresh token on the SAME row (`invite_token_hash`, `invite_link_issued_at`, `invite_expires_at` +14 days, as `rec-onboarding-invite.server.ts` does), then `sendElectricianInvite({ actorId: null, nominationId, installerBusinessId, inviteToken, to, name })`; one `REC_ONBOARDING_INVITE_EVENT` per row.

- [ ] **Step 1: Failing tests** — one `expect(signupInviteDue(...)).toBe(...)` per rule: send (all good); wait (comms off); skip for each of: sent already, `business_id` set, no email, installer not approved, electrician already approved, status `"invited"`. Plus a source check that `allocation-tick.ts` contains `sweepSignupNominationInvites`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the decision, the sweep (approved installer = `partner_activations` → `businesses.onboarding_status = "approved"`; already-approved electrician = `loadApprovedRecCandidates` + `matchUsualElectrician` on name/licence), and the tick line with the same `timed(...)` wrapper.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `fix(onboarding): send stuck sign-up electrician invites once`

### Task 5: One-off fix for Rapid and Matthews (live — needs Jo's yes)

**Files:**
- Create: `scripts/carry-signup-electricians.ts` — calls `carrySignupElectrician` for every approved installer business with an activation; `--dry-run` prints what it would save; never sends (the Task 4 sweep sends on its next tick).
- Create: `docs/pending-migrations/2026-10-29-carry-signup-electricians.md` — what it changes (expected: Rapid → Viking, Matthews → Tudor Electrical) and how to undo (delete the two `installer_signup` config events).

- [ ] **Step 1:** Run `--dry-run` in the Lovable sandbox; confirm output lists only Rapid and Matthews.
- [ ] **Step 2:** STOP. Show Jo the dry-run list and ask (question box) before running for real.
- [ ] **Step 3:** After yes: run for real; verify with SQL that the two usual-electrician events exist and both nominations have `nominating_business_id` set.
- [ ] **Step 4: Commit** — `chore: one-off carry of sign-up electricians (Rapid, Matthews)`

### Task 6: Final checks and pull request
- [ ] Full suite `bun scripts/test-isolated.ts 8` (compare against main's known-failing list), typecheck, lint on touched files.
- [ ] Open the pull request (base `main`, branch `feat/installer-electrician-first`). Do NOT merge — the coordinating chat merges.
- [ ] After merge + publish: Task 5, then confirm on the next tick that Viking's and Tudor's invites went (`electrician_nominations.invite_sent_at`).
