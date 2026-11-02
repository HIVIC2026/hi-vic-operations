# Obvious Yes, Tick to Send, Free Ready Check Email, Normal-Case Names — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Make an owner's "yes" obvious and actionable in Choose installer and on the job page; ONE installer-office email per in-house Give; tick saved spots to text them; all-caps names shown in normal case.

**Architecture:** New rules in pure cores (`display-name.core.ts`, `in-house-give-email.core.ts`, additions to `in-house-batch.core.ts`, `area-batch.core.ts`, `installer-waiting-columns.core.ts`); servers read extra facts and call existing guarded senders. Installer email = `partnerEmailLayout` → `deliverOnce` (export from `in-house-booking-notices.server.ts`) → `sendOfficeEmail`, gated by code constant `IN_HOUSE_GIVE_EMAIL_APPROVED = false` + a Templates hub "waiting" entry (same pattern as `CREW_REMINDER_EMAIL_APPROVED`).

**Tech Stack:** TanStack Start, Supabase, React Query, Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-02-obvious-yes-tick-to-send-design.md`

## Global Constraints
- Read AGENTS.md, src/AGENTS.md, src/lib/AGENTS.md; run `bun scripts/scan-retired-terms.ts` first.
- Literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; no `@tanstack/react-start/server` in `*.functions.ts`.
- Nothing goes to an owner or installer without Jo's tap. `sendInHousePartnerCall` (owner email) unchanged.
- Copy (verbatim): label `{Owner name} said yes · free Ready Check`; job page `{Owner} said yes · free Ready Check. Give to {Installer}`; button `Give {n} jobs to {Installer}` (existing); To release `Waiting for owner (sent for {Installer})`.
- Installer email: subject `New free Ready Check jobs from Home Insulation Victoria`; closing `Call each owner to book their free Ready Check.`; one line per job: job number · owner name · owner mobile · address. ONE email per Give; key `in-house-give:v1:${batchId}`.
- `export const IN_HOUSE_GIVE_EMAIL_APPROVED: boolean = false;` (exact form; hub test regex). TEST partners always test-send. Check `tradeMessagesPausedNow({ businessId })` before claiming.
- To release Send: max 10 homes (`AREA_BATCH_MAX_HOMES = 10`); owners get the existing quick-taps confirm text/email.
- Names: only entirely-capitals names change; keep mixed case (INSolation) and PTY, LTD, VIC, ACT, NSW, QLD, EEC, REC, HVAC, AC, ABN. Display only — never stored; never in `official-forms.*`, `signed-pdf.server.ts`, `esc.server.ts`, `veec-assignment-form.core.ts`, `owner-gates.core.ts`.
- Targeted `bun test tests/<file>`; unresolved imports = NOT RUN, never PASS.
- Not in this plan: Rapid's in-house switch (needs an approved electrician first).

## Review Focus
1. Blank owner name → `Owner said yes · free Ready Check`; email line says `Owner` (Tasks 3, 4, 7).
2. No mobile / no address → `no mobile on file` / `address not recorded`, never null/undefined (Task 4).
3. Double tap / retry of the same Give → one installer email per batch id (Tasks 4, 5).
4. Some ticked jobs refused → email lists only given jobs; none given → no email (Task 5).
5. More than 10 ticked → `Up to 10 homes per Send.`, nothing sent; texted/said-yes rows not tickable (Task 6).

---

### Task 1: Display-name helper
Files: create `src/lib/display-name.core.ts`; export existing `capWord` from `src/lib/name-address-tidy.core.ts`; test `tests/display-name.test.ts`.
Produces: `displayName(raw: string | null | undefined): string`, `DISPLAY_NAME_KEEP_UPPER: ReadonlySet<string>`.
- [ ] Failing tests: "RAPID INSULATION"→"Rapid Insulation"; "WAYNE WILSON"→"Wayne Wilson"; "O'BRIEN MCDONALD"→"O'Brien McDonald"; extra spaces collapsed; "INSolation" and "Wayne wilson" unchanged; "RAPID INSULATION PTY LTD"→"Rapid Insulation PTY LTD"; "ABN HVAC AC SERVICES VIC"→"ABN HVAC AC Services VIC"; keep-set equals the 11 words; null/""→""; "J & K INSULATION"→"J & K Insulation"; "3D INSULATION"→"3D Insulation".
- [ ] Run → FAIL. Implement (any lowercase or no letters → return collapsed; else per word keep-set/symbol or `capWord`). Run with `tests/name-address-tidy.test.ts` → PASS. Commit.

### Task 2: Apply display names at central points
Files: greetings `worker-links.core.ts` (`firstName`), `installer-screens.core.ts` (`firstName`), `area-batch.core.ts` (`hiName`); owner email partner name in `in-house-batch-email.server.ts`; loaders `installer-waiting.server.ts`, `area-batch.server.ts` (returned names only; stored `installer_name` stays raw), `in-house-batch.server.ts`, `offer-dispatch.functions.ts`, `office-job-page.server.ts`, `office-lists.server.ts`. Tests `tests/display-name-points.test.ts`, add case to `tests/in-house-batch-email.test.ts` ("all-caps partner name is shown in normal case in the owner email" → subject "Rapid Insulation will call you"), add `./display-name.core` to `tests/in-house-batch-server.test.ts` dependencies.
- [ ] Failing tests: greetings give "Wayne" for "WAYNE WILSON", `quickTapsText("WAYNE WILSON", ...)` starts "Hi Wayne,", "INSolation" unchanged; the listed loaders contain `displayName(`; official-paperwork files do NOT import `display-name.core`.
- [ ] Run → FAIL. Wrap values. Run with in-house-batch-server, a48-b2-send, installer-waiting-columns → PASS. Add AGENTS line (display-only names). Commit.

### Task 3: "Said yes" label in the In-house box
Files: `in-house-batch.core.ts` (`BatchJob.ownerName?`, `ownerPhone?`, `saidYesLabel`), `in-house-batch.server.ts` (select `owners(full_name,phone)`), `in-house-handoff.tsx` (second line in each row label). Tests: `tests/in-house-batch.core.test.ts`, `tests/in-house-batch-server.test.ts`.
Produces: `saidYesLabel(job: Pick<BatchJob,"ownerName"|"quickTapsYes"|"channel">): string | null`.
- [ ] Failing tests: "WAYNE WILSON"+yes → "Wayne Wilson said yes · free Ready Check"; blank → "Owner said yes · free Ready Check"; not yes → null. Server: maps owner name/phone; yes shows before batch closes; select contains `owners(full_name,phone)`.
- [ ] Run → FAIL. Implement + render. Run → PASS. Commit.

### Task 4: One installer email per Give (builder, sender, Templates entry)
Files: create `in-house-give-email.core.ts`, `in-house-give-email.server.ts`; export `deliverOnce`; hub entry `waiting:in-house-give` in `template-hub.core.ts` (gate code_off `IN_HOUSE_GIVE_EMAIL_APPROVED`, who "Installer office", when "Jo taps Give on ticked jobs — one email per tap"). Tests: `tests/in-house-give-email.core.test.ts`, `tests/in-house-give-email.test.ts`, `tests/templates-hub.test.ts`.
Produces: `IN_HOUSE_GIVE_EMAIL_APPROVED`, `IN_HOUSE_GIVE_EMAIL_SUBJECT`, `IN_HOUSE_GIVE_CALL_LINE`, `type GiveEmailJob = { jobId; jobNumber; ownerName; ownerMobile: string|null; address }`, `giveEmailLine(j): string`, `renderInHouseGiveEmail({ jobs, test? }): { subject; html; text }`, `inHouseGiveEmailKey(batchId)`, `type GiveEmailOutcome = { status: "sent"|"test_sent"|"not_approved"|"no_email"|"held"|"not_sent"; detail? }`, `installerEmailWords(o, partner)`, server `sendInHouseGiveEmail({ batchId, businessId, jobs, actorId, approved? }): Promise<GiveEmailOutcome>`.
- [ ] Core tests: exact subject + call line, html doctype, switch false; `giveEmailLine` → "HV-2730 · Wayne Wilson · 0412 000 000 · 1 Example St, Clayton 3168" and "HV-2731 · Owner · no mobile on file · address not recorded"; no null/undefined; key "in-house-give:v1:B1"; notice words for each status (e.g. not_approved → "No email to Rapid Insulation yet — the email is waiting for your OK in Templates.").
- [ ] Server tests: 3 jobs → ONE office email (recipient partner, office email, exact subject, key, record businessId, all 3 job numbers); same Give twice → one; not approved → nothing; paused → held, no claim; TEST partner → test-send only; no email → no_email.
- [ ] Run → FAIL. Implement (order: business → TEST test-send → approval → email → pause → `deliverOnce` + `sendOfficeEmail`). Run → PASS (templates-hub NOT RUN if imports fail). Commit.

### Task 5: Wire the email into Give
Files: `in-house-batch.server.ts` (`sendInHouseBatch` returns `installerEmail?` when any sent), `in-house-batch.core.ts` (`giveNotice` appends `installerEmailWords`), AGENTS line. Tests: `tests/in-house-batch-server.test.ts`, `tests/in-house-batch.core.test.ts`.
- [ ] Failing tests: 3 ticked → ONE installer email listing HV-1..3 with the Give's batch id, owner emails still 3; refused job excluded; none given → no email; email failure → Give kept, `installerEmail: { status: "not_sent" }`; `giveNotice(...)` → "3 jobs given to Rapid Insulation. No email to Rapid Insulation yet — the email is waiting for your OK in Templates."
- [ ] Run → FAIL. Implement (try/catch; never undo allocation). Run → PASS. Commit.

### Task 6: To release shows batch status; tick to Send
Files: `area-batch.core.ts` (`AREA_BATCH_MAX_HOMES`, `BatchRowState`, `batchRowState`, `batchRowLine`, `tickSendBlocker`), `area-batch.server.ts` (`installersForHomes`), `area-batch.functions.ts` (`getInstallersForHomesFn`, jobIds 1..10), `installer-waiting-columns.core.ts` (`batch?`, `tickableForSend`), `installer-waiting.server.ts` (read batch + answer events), `choose-installer.tsx` (export `SendResultList`), `InstallerWaitingScreen.tsx` (To release: tick column, status line, bar with count, installer select, Send via `sendAreaBatchFn`, results, clear + invalidate). Tests: `tests/a48-b2-area-batch-core.test.ts`, `tests/installer-waiting-columns.test.ts`, `tests/a48-b2-send.test.ts`.
- [ ] Failing tests: texted/no answer → `{ kind: "waiting", installerName }` and "Waiting for owner (sent for Rapid Insulation)"; pass before/after close → said_yes, line "Wayne Wilson said yes · free Ready Check" / "Owner said yes…"; decline or never texted → null; `tickSendBlocker(0)` "Tick at least one saved spot.", 10 ok, 11 "Up to 10 homes per Send."; `tickableForSend` false for waiting/said_yes/not releasable; server: 3 ticked → each owner texted once, repeat refused; `installersForHomes` only covering installers, names normal case; source test that the screen uses the new pieces.
- [ ] Run → FAIL. Implement. Run → PASS. Commit.

### Task 7: Job page "said yes · Give to {Installer}"
Files: `in-house-batch.core.ts` (`jobGiveOffer`), `in-house-batch.server.ts` (`loadInHouseBatches({ jobIds? })`, `inHouseGiveForJob`), `in-house-batch.functions.ts` (`getInHouseGiveForJob`, admin only), `choose-installer.tsx` (`ChooseInstallerPanel` shows label + "Give to {partner}" → `allocateInHouseBatch({ businessId, jobIds: [jobId] })`, then `giveNotice`).
- [ ] Failing tests: offer `{ businessId: "p", partnerName: "Rapid Insulation", label: "Wayne Wilson said yes · free Ready Check. Give to Rapid Insulation" }`; null when no nominated installer, switch off, or not yes; blank owner → "Owner said yes…"; job-scoped loader filters by id; source test for the panel.
- [ ] Run → FAIL. Implement. Run → PASS. Commit.

### Final verification
- [ ] Run all the test files above; record unresolved as NOT RUN. Retired-terms scan clean. In-house Give can't run on TEST jobs (`batchJobEligible` excludes qa_test) — covered by fixture tests.

## Open choices (asked of Jo)
- To release rows also show "said yes" (beyond spec §3 wording, in line with its purpose).
- Gives made before Jo approves the email wording are not emailed later; the notice says so.
