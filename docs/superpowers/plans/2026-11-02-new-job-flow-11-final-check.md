# Part 11 — Final check and go-live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before anything from Parts 1–10 touches a customer's job: record the spec check against the VEU Specifications (Part 48) and the VEET Regulations, run one Home Insulation Victoria lead and one installer's own customer end to end on TEST jobs, get Jo's phone-width yes for each part, turn the switches on in a set order with only INSolation on the new flow, then do REAL runs (Jo or Tom as the owner, INSolation, Tom's Electrical, real texts/emails/Mitti forms, Stripe test mode, ESC stopped by a per-job "no ESC" marker), and only then move the other installers.

**Architecture:** Almost all of this part is checking, not building. The small amount of code is (1) a pure wording checker that compares what the test runs actually sent with the approved wording, (2) an own-customer path for the existing journey runner, and (3) a pure go-live checklist with a test that fails if any approval switch is on without Jo's recorded sign-off for its part. Switches stay code constants / `workflow_settings` rows exactly as each part made them; this part only records who said yes and flips them in order.

**Tech Stack:** TypeScript, bun:test, existing QA scripts (`bun run journey`, `bun run portal-qa`, `bun run installer-test`), Playwright (via those scripts), WebFetch for the regulations.

**Spec:** Claude Doc "Spec: Home Insulation Victoria new job flow + installer portal", rev 31 (`docs/superpowers/specs/2026-11-02-new-job-flow-design.md`) — sections "Testing and Jo's sign-off", "VEU and ESC timing rules", "More VEU Code of Conduct rules", "Compliance gates and checks". Decisions file last line: "VEU Specifications Part 48 + VEET Regulations to be checked against the spec during the build, before anything goes live. Customer Agreement v1.3 (timing line) awaiting lawyer OK." Overview: `2026-11-02-new-job-flow-00-overview.md`.

## Global Constraints

- Two kinds of run. (1) TEST runs (Tasks 2, 7): `source='qa_test'` jobs, TEST partners, TEST logins on the reserved domains (`@hivic.test`, `@hivic-test.example`); nothing reaches a real inbox. (2) REAL runs (Jo 2 Nov, answers 18–19; Task 9): owner = Jo or Tom (own email/mobile, real address), installer INSolation, electrician Tom's Electrical; all texts, emails and Mitti forms real; card payments in Stripe test mode; every real-run job is marked with `markRealRun` (Task 8: Part 9's "no ESC" marker + Stripe test mode) before it can reach any ESC or payment step, so no ESC installation notice, Registry submission or certificate (VEEC) creation ever happens for it. No real customer's job is part of a real run.
- QA scripts report gaps as NOT_RUN, never PASS (`AGENTS.md`). A step that can't run is written down as NOT_RUN with the reason.
- Jo sees: pictures at phone width (390px wide, tall pages split), the wording pasted as text, one question at a time in boxes. Nothing goes live until she says so for that part.
- Exact wording source: `docs/hiv-touchpoint-decisions.md` (latest dated decision wins; the "Decisions from the electrician + SWMS chat" section wins over earlier).
- Pending SQL is applied live only with Jo's go-ahead, one file at a time, through the journaled `drizzle/migrations/` path (`AGENTS.md`), never a force push.
- Customer Agreement: v1.3 is the approved template (lawyer OK 2 Nov; Part 1 Task 2).
- Build method (Jo 2 Nov, answer 20): checked step by step — a fresh builder per task and a reviewer before the next task (superpowers:subagent-driven-development), for every part.
- Always "Home Insulation Victoria" in full; owners never see "VEU discount", "fixes", "Thousands of Victorians have registered", "7 days after your install", "Wrong time?".

## Review Focus

1. **A switch turned on before its part was signed off** (e.g. a later part's commit flips a flag "to test"). Expect the go-live test to fail the build. (Task 3 test.)
2. **A message the test run sent that no part pinned** (an old-flow email still firing). Expect the wording check to list it as "not in the approved list", not skip it. (Task 1 test.)
3. **Regulation stricter than the spec** (a Part 48 clause the spec doesn't cover). Expect it written down as a gap and asked to Jo, not silently built or ignored. (Task 4 checklist test.)
4. **A real-run job without its "no ESC" marker, or a real customer's job marked by mistake.** Expect the real-run preflight to refuse a job that isn't marked (and refuse to mark a job whose owner isn't Jo or Tom), and every ESC boundary to refuse a marked job. (Tasks 8, 9 tests; Part 9 Task 14.)
5. **Old-flow job in flight on switch-on day.** Expect each switch's first real job to be watched and old/new messages never both sent (Parts 3, 4, 7 own the tests; Task 6 checks they exist and pass before flipping). (Task 6 step.)

---

### Task 1: Wording check of everything the test runs sent

**Files:**
- Create: `src/lib/approved-wording-check.core.ts`
- Create: `scripts/approved-wording-check.ts` (reads the test-send log rows for one or more TEST job ids and prints a report)
- Test: `tests/approved-wording-check.test.ts`

**Interfaces:**
- Consumes: each part's exported approved-wording constants and renderers (import them — never retype wording); the test-send records the journey already reads (`scripts/journey-email-evidence.core.ts acceptedTestEmail`).
- Produces:
  - `GLOBAL_BANNED: readonly RegExp[]` = `[/\bHIV\b/, /VEU discount/i, /\bfixes\b/i, /Thousands of Victorians have registered/i, /7 days after your install/i, /Wrong time\?/i, /lower power bills/i, /See where you're up to/i]`
  - `type ApprovedMessage = { key: string; audience: "owner" | "trade"; subject?: string; mustContain: string[] }`
  - `checkSentMessage(sent: { key: string | null; subject: string; text: string; audience: "owner" | "trade" }, approved: ApprovedMessage[]): { ok: boolean; problems: string[] }` — problems: `"not in the approved list: <subject>"`, `"subject differs: …"`, `"missing: <phrase>"`, `"banned: <pattern>"` (the `\bfixes\b` and `VEU discount` bans apply to owner messages only; trades may see PIESA/SWMS/PIISA).

- [ ] **Step 1: Write the failing tests**

```ts
test("approved message passes", () => expect(checkSentMessage({ key: "enter_price", audience: "trade", subject: "HV-1234: Ready Check done. Time to price it.", text: renderEnterPriceEmail(sample).text }, LIST).ok).toBe(true));
test("unknown message is flagged, not skipped", () => expect(checkSentMessage({ key: null, audience: "owner", subject: "Just checking you got your estimate", text: "…" }, LIST).problems).toEqual(["not in the approved list: Just checking you got your estimate"]));
test("owner text with 'VEU discount' fails", ...);
test("'HV-1234' is not caught by the HIV ban", () => expect(GLOBAL_BANNED[0]!.test("HV-1234")).toBe(false));
test("trade message may say PIESA, SWMS and fixes", ...);
```

- [ ] **Step 2: Run** `bun test tests/approved-wording-check.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the core; build `APPROVED_MESSAGES` in `scripts/approved-wording-check.ts` by importing every part's renderer/constants (one entry per touchpoint in `docs/hiv-touchpoints.md` that the decisions file keeps; removed touchpoints are not in the list, so they show up as "not in the approved list"). Script usage: `bun scripts/approved-wording-check.ts <jobId> [<jobId>…]` → writes `/mnt/documents/final-check/wording-<time>.md`.
- [ ] **Step 4: Run** `bun test tests/approved-wording-check.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "test(final check): compare sent test messages with approved wording"`

---

### Task 2: End-to-end TEST runs — one Home Insulation Victoria lead, one own customer

**Files:**
- Modify: `scripts/journey.ts` (new `--path own-customer`; `--installer-email` / `--electrician-email` options), `src/lib/journey.server.ts` (persona emails come from options, default `TEST_INSTALLER_EMAIL` / `TEST_ELECTRICIAN_EMAIL`; own-customer start step reuses the Add one job server step from `scripts/installer-test.ts` step C instead of `s1_calculator`/`s2_owner_links`/`s3_office_offer`)
- Test: `tests/journey-personas.test.ts`

**Interfaces:**
- Consumes: `runServerJourney`, `storeJourneyRun(mode, ctx, result, { path, runGroup, status })` (existing optional `path`), the Add one job server step used by `installer-test` C, every part's updated journey steps (each part updates the steps it changed as part of its own QA).
- Produces: `journeyPersonas(args: string[]): { installerEmail: string; electricianEmail: string }` — refuses (throws `"Journey personas must be TEST logins (@hivic.test or @hivic-test.example)"`) for any other domain; `bun run journey --path own-customer --installer-email <x> --electrician-email <y>`.

- [ ] **Step 1: Pick the TEST personas.** Use the journey's TEST installer and electrician (reserved TEST domains, `[TEST PARTNER]`). These are safety runs before the real runs with INSolation and Tom's Electrical (Task 9); never point this task at a real business.
- [ ] **Step 2: Write the failing test** — `journeyPersonas(["--installer-email","qa.installer.tom@hivic-test.example"])` returns it; `"info@houseinsulationcanberra.com.au"` throws the message above; no args → today's defaults.
- [ ] **Step 3: Run** `bun test tests/journey-personas.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement** `journeyPersonas` and the `own-customer` path (stores `path: "own-customer"`).
- [ ] **Step 5: Run** `bun test tests/journey-personas.test.ts` — Expected: PASS.
- [ ] **Step 6: Run the two journeys** with every part's switches in TEST mode only:
  - `bun run journey --keep --installer-email <TEST installer> --electrician-email <TEST electrician>` (Home Insulation Victoria lead)
  - `bun run journey --keep --path own-customer --installer-email <…> --electrician-email <…>`
  - `bun run installer-test --runs 1` and `bun run portal-qa --label release`
  Expected: each prints its report path; journey prints OK TO PUBLISH. Any FAIL/BLOCKED → back to the owning part.
- [ ] **Step 7: Wording, PDFs and gates on those two jobs**
  - `bun scripts/approved-wording-check.ts <lead job id> <own job id>` — Expected: 0 problems.
  - PDFs: download every document the two jobs produced (acceptance, receipts ×3, tax invoice, ESC consent, VEEC form, SWMS, filled DEECA PIESA + PIISA, warranty, instructions); compare page by page with `docs/approved-samples/2026-11-02/` — same sections, no section split across pages, every DEECA tick visible. Record each as PASS/FAIL in `/mnt/documents/final-check/pdfs.md`.
  - Gates: one fresh TEST job per break — expired insurance, late Lead Installer change (inside 5pm two days before), missing SWMS signature, PIESA older than 30 days, consent signed <24h before install, PIESA copy <24h, life support with no plan — using Part 9's journey branches (names from Part 9's Interfaces). Expected: each blocks with Part 9's message; a gate with no branch is NOT_RUN and goes back to Part 9.
  - Speed: SWMS signing page on a throttled phone profile (Playwright "Slow 3G", 390px) — Expected: first screen usable before the full PDF loads (Part 7's target).
- [ ] **Step 8: Commit** `git commit -m "test(final check): own-customer journey path and TEST-only personas"`

---

### Task 3: Go-live checklist — every approval switch, and a test that guards it

**Files:**
- Create: `src/lib/go-live-checklist.core.ts`
- Create: `docs/approvals/2026-11-02-new-job-flow-signoff.json` (starts as `[]`)
- Test: `tests/go-live-checklist.test.ts`

**Interfaces:**
- Consumes: every switch constant the parts export (imported, so a renamed switch breaks the build).
- Produces:
  - `type GoLiveSwitch = { part: number; name: string; where: string; value: () => boolean | "db" }` (`"db"` for `workflow_settings` rows such as `sms_message_switches.<type>`, `esc_registry_robot_enabled`, which are checked live in Task 6, not in the test)
  - `GO_LIVE_SWITCHES: readonly GoLiveSwitch[]`
  - `type SignOff = { part: number; approvedBy: "Jo"; on: string; what: string }`
  - `switchesOnWithoutSignOff(switches, signoffs): string[]` — names of code switches that are `true` while their part has no sign-off row.

- [ ] **Step 1: Build the list.** Run `grep -noE "[A-Z][A-Z_]+_(APPROVED|ENABLED)\b|sms_message_switches\.[a-z_]+|[a-z_]+_enabled" /home/claude/plans/2026-11-02-new-job-flow-*.md docs/superpowers/plans/2026-11-02-new-job-flow-*.md | sort -u` and add one `GoLiveSwitch` per switch a part ADDED (not existing switches it merely reads). At the time this plan was written only Parts 3 and 10 existed; the expected list by part (from the overview) is below — confirm every row against the part plans and add any extra:

| Part | Switches it adds (expected) | Also check before flipping |
|---|---|---|
| 1 Documents/PDFs | new-PDF switches for acceptance, receipts, tax invoice, statement of rights, VEEC layout, filled DEECA PIESA/PIISA copies, warranty/instructions | `compliance_templates` "customer_agreement" v1.3 loaded (pending SQL `customer-agreement-v1-3.sql`, lawyer-approved 2 Nov); receipts/invoice/acceptance samples re-rendered with the $183.90 deposit (Part 1 Task 5) |
| 2 Owner wording/payments | switches for reworded estimate emails (VEU box), "You're in!", payment terms, O76 auto replies | existing `ESTIMATE_FOLLOWUP_APPROVED`, `OWNER_EMAIL_AUTO_REPLY_APPROVED`, `ACCEPTANCE_EMAIL_APPROVED` stay as they are |
| 3 Owner flow to acceptance | `OWNER_WILL_CALL_APPROVED` + SMS type `owner_will_call`, `OWNER_QUOTE_EMAIL_V4_APPROVED` (confirmed in the Part 3 plan); "{Installer} will call you" (email + text), Rapid #23, consent record/re-ask, "Do not contact", quote page ticks + typed name, quote reminders | old `in_house_partner_will_call` template stays unapproved; `AUTO_QUOTE_SEND_ENABLED` (existing, false) |
| 4 PIESA to done | PIESA "You're booked", clear to install, upgrades needed, confirm-and-pay, deposit received, install "You're booked", tenant notice, date-can't-be-kept, CoES copy, All done, sign-and-pay, reminders, faulty work notice | existing `COMPLETION_EMAILS_APPROVED`, `VEEC_COPY_EMAIL_APPROVED`, `WARRANTY_FOLLOWUP_APPROVED` |
| 5 Installer screens | new screens switch(es), Office role, who-books, logo upload | — |
| 6 Electricians | electrician job link, "PIESA booked" email, nudges, 30-day red flag | electrician sign-in removal |
| 7 Lead Installer + crew | install tomorrow text, SWMS page, 9am Lead Installer email + 5pm lock, 6:30am text | `sms_message_switches` types (DB, guarded by `trg_guard_sms_message_switches` — one switch per write) |
| 8 Mitti forms | template changes (no code switch) — Mitti template versions in `workflow_settings` | done in Mitti by template prompt; record template ids |
| 9 Compliance gates | gate switches (GO/DON'T START emails, ESC notice update/withdraw, product-on-register, $200 rule) | `esc_registry_robot_enabled` + env `ESC_REGISTRY_ROBOT_ENABLED` / `ESC_REGISTRY_ROBOT_MODE` |
| 10 Own customers | `ENTER_PRICE_EMAIL_APPROVED`, `OWN_CUSTOMER_SEND_ON_PRESS_ENABLED`, `OWN_CUSTOMER_COBRAND_APPROVED` | delete the `boss_price_link` text fallback after the email is on |
| all | master `customer_comms_enabled` (existing) | never toggled by this part's code |
| — (not code) | "Website consent line changed by Tom" (Part 3 Task 3, Jo answer 15); "Mitti templates pasted" (Part 8 Task 11) | checklist rows Jo ticks; listed in the go-live report, not tested |

- [ ] **Step 2: Write the failing test**

```ts
test("no switch is on without Jo's sign-off for its part", () => {
  const signoffs = JSON.parse(readFileSync("docs/approvals/2026-11-02-new-job-flow-signoff.json", "utf8"));
  expect(switchesOnWithoutSignOff(GO_LIVE_SWITCHES, signoffs)).toEqual([]);
});
test("detects a switch flipped early", () => expect(switchesOnWithoutSignOff([{ part: 10, name: "X", where: "x", value: () => true }], [])).toEqual(["X"]));
test("a sign-off for another part doesn't count", ...);
test("every part 1–10 has at least one row", () => expect(new Set(GO_LIVE_SWITCHES.map((s) => s.part))).toEqual(new Set([1,2,3,4,5,6,7,8,9,10])));
```

- [ ] **Step 3: Run** `bun test tests/go-live-checklist.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `go-live-checklist.core.ts` with the confirmed list.
- [ ] **Step 5: Run** `bun test tests/go-live-checklist.test.ts && bun run test` — Expected: PASS (all new switches are still false).
- [ ] **Step 6: Commit** `git commit -m "test(final check): go-live switch list guarded by Jo's sign-off"`

---

### Task 4: Check the spec against VEU Specifications v25 Part 48 and the VEET Regulations 2018

**Files:**
- Create: `docs/esc-forms/veu-specifications-2018-v25.pdf`, `docs/esc-forms/veet-regulations-2018.pdf` (and the 2026 ceiling insulation amendment regulations if separate)
- Create: `docs/superpowers/specs/2026-11-02-veu-spec-check.md`
- Test: `tests/veu-spec-check.test.ts`

**Interfaces:**
- Consumes: the spec; the gates and rules each part built.
- Produces: a table, one row per Part 48 clause and per relevant regulation, columns `Rule (quoted) | Source (clause) | Where the spec covers it | Status`, Status one of `Matches`, `Spec is stricter`, `Gap — asked Jo <date>`, `Not relevant (why)`.

- [ ] **Step 1: Get the documents.** Jo has supplied the VEET Amendment (Ceiling Insulation) Regulations 2026 and VEU Specifications v25 Part 48, and the main session has read them (overview "Regulations + Specifications check": no new rules beyond the spec; Task 7 added). Save those files under `docs/esc-forms/` and record the overview's mapping in the table below. Only if a file is missing, fetch with WebFetch (the build container's `curl` is blocked by the proxy):
  - VEU Specifications 2018 Version 25 (in effect 21 July 2026; Part 48 added in v23, p.138): `https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf` (Word: `…/word_doc/0040/795487/Victorian-Energy-Upgrades-Specifications-2018-Version-25.docx`)
  - Victorian Energy Efficiency Target Regulations 2018 (in force version) and the Victorian Energy Efficiency Target Amendment (Ceiling Insulation) Regulations 2026: `https://www.legislation.vic.gov.au/as-made/statutory-rules/victorian-energy-efficiency-target-amendment-ceiling-insulation-regulations-2026` and the in-force consolidation on legislation.vic.gov.au.
  If WebFetch is blocked or only returns summaries (not the full Part 48 text), STOP and ask Jo in a box: "Can you send me the VEU Specifications (version 25) and the VEET Regulations 2018 as files? I need the full text to check the spec." Save what she sends under `docs/esc-forms/`.
- [ ] **Step 2: Write the failing test** — reads `docs/superpowers/specs/2026-11-02-veu-spec-check.md`; every table row has a Status from the allowed list; there is at least one row for each Part 48 heading ("Activity description", "Specified Minimum Energy Efficiency", "Other Specified Matters", "Method for Determining GHG Equivalent Reduction"); no row says `Gap` without "asked Jo".
- [ ] **Step 3: Run** `bun test tests/veu-spec-check.test.ts` — Expected: FAIL (file missing).
- [ ] **Step 4: Do the read-through.** Quote each rule, find the spec line and the part that built it. Specifically check: product requirements and R-values vs the insulation product list / VEU Register check (Part 9); installer/electrician qualifications (CII/EEC, licence + REC) vs "Required on file"; PIESA/PIISA timing (30 days, 24h after the ESC notice); downlights IC/IC-4; minimum co-payment $200 and no refunds after certificates; record keeping (6 years, photos/videos list); what the VEEC form must hold (premises type). Anything stricter in the regulations than the spec → `Gap`, one question to Jo per gap (in a box, plain words), no code change in this part.
- [ ] **Step 5: Run** `bun test tests/veu-spec-check.test.ts` — Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "docs(final check): spec checked against VEU Specifications v25 Part 48 and VEET Regulations"`

---

### Task 5: Jo's phone-width sign-off, one part at a time

**Files:**
- Create: `/mnt/documents/final-check/part-<N>/` (pictures + `wording.md`) for N = 1…10
- Modify: `docs/approvals/2026-11-02-new-job-flow-signoff.json` (one row per yes)

**Interfaces:**
- Consumes: the screenshots the Task 2 runs saved (journey shots are 390px), the PDFs from Task 2 Step 7, the wording report from Task 1.
- Produces: a `SignOff` row per part (Task 3 type).

- [ ] **Step 1: Make each part's pack** — pictures at 390px wide (split anything taller than about two phone screens), every message's wording pasted as plain text under its picture, the PDF pages as pictures. Own customers (Part 10): with AND without an installer logo.
- [ ] **Step 2: Show Jo part by part, in build order 1→10.** One question per box: "Part N — <one line>. Happy for this to go live?" with choices "Yes, switch it on" / "Not yet — change something". A change goes back to the owning part; re-shoot only what changed.
- [ ] **Step 3: Record each yes** as `{ "part": N, "approvedBy": "Jo", "on": "<ISO date>", "what": "<what she saw>" }`, run `bun test tests/go-live-checklist.test.ts` (still PASS — no switch flipped yet), commit `git commit -m "docs(final check): Jo signed off part N"`.

---

### Task 6: Switch on, in order

**Files:**
- Modify: the switch constants / settings each part named (one part per commit)

**Interfaces:**
- Consumes: Task 3's `GO_LIVE_SWITCHES`, Task 5's sign-offs.

- [ ] **Step 1: Before the first switch** — `bun run test` green; `bun scripts/scan-retired-terms.ts` clean; every pending migration the parts added is listed with its PGlite proof file; ask Jo (box) to OK applying them, one at a time, through `drizzle/migrations/` (journaled, archived in `docs/applied-migrations/`).
- [ ] **Step 2: For each signed-off part, in build order** — flip only that part's switches; for DB switches (`sms_message_switches`, `esc_registry_robot_enabled`) change ONE per write (the DB trigger refuses more without `hivic.bulk_switch_change=approved`, which this plan never sets); run `bun test tests/go-live-checklist.test.ts && bun run test`; commit `git commit -m "chore: switch on part N (Jo approved <date>)"`; push normally (no force push — Lovable sync).
- [ ] **Step 3: Jobs in flight** — before flipping Parts 3, 4 and 7, run their "old vs new, exactly one" tests (overview Review Focus 1) and list the real jobs at each stage (read-only query on `jobs.stage`, `source <> 'qa_test'`). After flipping, watch the first real job at each stage: the outbox shows one message, the approved one.
- [ ] **Step 4: After Part 10's email is on** — delete the `boss_price_link` text fallback (Part 10 Task 3) in its own commit.
- [ ] **Step 5: SWMS wording (Part 7 `SWMS_NOV2_WORDING_ON`)** — read the real installation bookings for the next 48 hours (read-only); turn it on only when there are none (new wording voids existing SWMS signatures — overview cross-part decision); otherwise wait and check again the next day.
- [ ] **Step 6: Only INSolation on the new flow first** — move INSolation with Part 3 Task 18 (`moveInstallerToNewFlow`); every other installer stays where it is until Jo OKs the real runs (Task 9 Step 6).
- [ ] **Step 7: Report to Jo** — short plain list: what's on, what's waiting (real runs next), anything NOT_RUN.

#### Join fix waves J3/J4 (4 Nov 2026) — added go-live items

Data the new flow needs before the first real in-house job (ruling G6; read-only check first, then one office action per business):
- [ ] **Every in-house business: `businesses.rectification_billed_by = 'partner'`** (decisions 34/36: the installer's electrician quotes, books and invoices the upgrades with the owner; `hivic` keeps the retired HIV fixes-quote path alive) — query `select id, name from businesses where in_house and rectification_billed_by <> 'partner'`; set through the office partner settings (saveBusiness), one per business.
- [ ] **Every in-house business has at least one verified Team electrician** — `partner_workers` row with `trade_role = 'electrician'`, `approval_status = 'approved'`, licence number + REC number + `licence_expires_on` in the future and `licence_verified_at` set (office verification RPC). Without one the business cannot Add a job (Team electrician required), book a PIESA (`commit_in_house_visit` refuses "Electrician not verified") or get an own-customer quote out. The live TEST business needs one too before `scripts/installer-test.ts` C13/C15.
- [ ] **`workflow_settings.trade_messages_paused` off** (Jo 30 Oct "Pause all trade messages" ships ON) — until it is off, every partner text/email (electrician PIESA booked, Lead Installer confirm, SWMS links, 6:30 texts) is a recorded hold.
- [ ] **`UPGRADES_NEEDED_EMAIL_APPROVED`** (Part 4) — since J4 G3 a PIESA result that found upgrades still to come HOLDS the owner's and installer's PIESA copies (event `piesa_copy_email_not_sent`, reason `upgrades_needed_wording_unapproved`) until this flag is on; the owner gets the item-44 copy after Part C either way. Flip it with Part 4's switches or those owners get no PIESA copy until the upgrades are done.

Pending SQL the join added or changed — apply in this order, each after its PGlite proof:
1. `2026-11-01_in_house_electrician.sql` → 2. `2026-11-01_in_house_saved_work.sql` → 3. `2026-11-03_allocate_team_electrician_v2.sql` (no-login electricians; Part 6 fix wave) → 4. `2026-11-04_commit_in_house_visit_v2.sql` (no-login electricians on the atomic booking + **J4 G2: the owner-contact release row on a booked PIESA / upgrades visit**; proof tests/journey-a1-complete-route-db step 5) → 5. `add-installer-job-atomic.sql` (re-apply: changed 75c8d516, Team-worker electrician choice; proof tests/installer-own-job-e2e-db) → 6. `installer-business-settings.sql` (Part 5, `piesa_booked_by`) → 7. the rest in their parts' order (Part 2's `2026-11-03_electrician_job_links.sql` / `installer_added_electricians.sql` only if Jo keeps main's Part 2 minting until it is retired).
Until 4 is live, the TS fallback (`in-house-inline-save.server`) writes the same release row; until 5 is live, Add a job's step-by-step save runs (J3 (1): it never throws a saved job away).

---

## Self-review notes

- Spec "Testing and Jo's sign-off": test jobs only (Task 2), every message word for word (Task 1 + Task 2 Step 7), every PDF vs sample incl. page breaks (Task 2 Step 7), PIESA/PIISA ticks (Task 2 Step 7), every gate broken (Task 2 Step 7), SWMS speed (Task 2 Step 7), Jo's phone pictures + one question at a time (Task 5), nothing live until she says (Tasks 3, 6).
- Decisions file "VEU Specifications Part 48 + VEET Regulations to be checked … before anything goes live" → Task 4, ordered before Task 6.

### Task 7: Eligibility regression (Regulations 10(9)–(10), Sch 4 cl 15)

**Files:**
- Test: create `tests/part48-eligibility-regression.test.ts`

**Interfaces:**
- Consumes: existing `eligibility.core.ts` and `readycheck.core.ts` exports (read them; use their current names).

- [ ] **Step 1: Write the test** — one case each that must BLOCK: Class 2 building that is not a sole-occupancy unit; ceiling built within the last 5 years; any non-IC/IC-4 luminaire; existing insulation average ≥ R2.0; a previous Part 48 install at the address since 14 Apr 2026; installed total below R5.0. One case that passes (Class 1, older ceiling, all IC/IC-4, no insulation, R5.0).
- [ ] **Step 2: Run** `bun test tests/part48-eligibility-regression.test.ts` after Parts 1–10 are merged. Expected: PASS. Any FAIL = a part broke an existing eligibility gate: stop and report.
- [ ] **Step 3: Commit** `git commit -m "test: Part 48 eligibility regression"`

### Task 8: Real-run setup — one marker for "no ESC" and Stripe test mode (Jo 2 Nov, answer 19)

**Files:**
- Create: `src/lib/real-run.core.ts`, `src/lib/real-run.server.ts`, `src/lib/real-run.functions.ts`
- Modify: `src/lib/stripe.server.ts` (`stripeKeyFor(jobSource, refs?)` → `STRIPE_TEST_SECRET_KEY` (must start `sk_test_`) when `external_refs.stripe_test === true`), the Stripe webhook writer (accepts `livemode=false` events through the existing `STRIPE_TEST_WEBHOOK_SECRET` path only for jobs with `stripe_test`; a `livemode=true` event for such a job is refused and logged), `src/lib/AGENTS.md` (Stripe key rule gains the real-run line), office job page ("Real run" badge next to Part 9's "no ESC")
- Test: `tests/real-run.test.ts`

**Interfaces:**
- Consumes: Part 9 Task 14 `setNoEscMarker(jobId, actorId, reason)`, `noEscMarked(refs)`; `stripeKeyFor`.
- Produces:
  - `REAL_RUN_OWNERS: readonly string[]` — Jo's and Tom's own email addresses, typed in from Jo's answer in the build (never guessed); `realRunOwnerOk(ownerEmail: string | null): boolean`.
  - `markRealRun(jobId: string, actorId: string): Promise<void>` — admin only; refuses unless the owner's email is in `REAL_RUN_OWNERS`; refuses when any live (non-test) payment or ESC notice already exists; sets `external_refs.stripe_test = true` and calls `setNoEscMarker(jobId, actorId, "Real run (Jo 2 Nov)")`; one-way; event `real_run_marked`.
  - `realRunPreflight(jobId: string): Promise<string[]>` — `[]` only when both markers are set and the owner is Jo or Tom.

- [ ] **Step 1: Write the failing test** — owner not Jo/Tom → refused; marked job → `stripeKeyFor("website", refs)` returns the test key and `noEscMarked(refs)` is true; unmarked real job → live key (byte-identical); `qa_test` → unchanged; webhook `livemode=false` for a marked job → recorded, for an unmarked job → refused; `livemode=true` for a marked job → refused; a live payment already on the job → `markRealRun` refused; `realRunPreflight` lists each missing piece.
- [ ] **Step 2: Run** `bun test tests/real-run.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/real-run.test.ts tests/stripe*.test.ts tests/new-flow-09-no-esc.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(real runs): mark a job as a real run — no ESC, Stripe test mode"`

### Task 9: Real runs with INSolation and Tom's Electrical (Jo 2 Nov, answers 18–19)

Runs after Task 6 (switches on, only INSolation on the new flow).

- [ ] **Step 1: Before starting** — INSolation is on the new flow with Tom's Electrical in its Team (who-books set the way INSolation works); `ESC_REGISTRY_ROBOT_MODE` is whatever is live — the marker, not the mode, keeps these jobs out of the Registry.
- [ ] **Step 2: Home Insulation Victoria lead** — Jo or Tom fills the real homeowner website form with their own email, mobile and real address; the office runs `markRealRun` on the new job straight away (before the job is given to INSolation) and `realRunPreflight` → `[]`; then the job goes to INSolation and runs the whole flow: will call, Ready Check (real Mitti form), quote, accept and pay $349 by Stripe test card, PIESA (real Mitti form), clear to install, confirm-and-pay, install booking, GO check emails, SWMS, install form, All done, sign-and-pay.
- [ ] **Step 3: Own customer** — INSolation adds Jo or Tom with Add a job; the office runs `markRealRun` straight away; same flow from the price step.
- [ ] **Step 4: Check** — every message arrived where it should (owner, INSolation office, Tom's Electrical, and — if the run uses a rental — the access person and the tenant's text + email; rental answers come from the owner's quick taps) and passes `bun scripts/approved-wording-check.ts <jobId>`; every PDF compared with its sample; Mitti forms read back correctly; GO / DON'T START email received; ESC: the robot's log lists both jobs as skipped, no `submission_reference` and no VEEC submission exists for either job (read-only query).
- [ ] **Step 5: Close the jobs** — no trade pay: the run stops before any installer or electrician pay is approved (Jo 2 Nov, answer 23) — the office never presses Approve on these jobs' install or PIESA paperwork, and the payout records stay unpaid. Xero: the invoices go into Xero as normal during the run and are voided in Xero after it (answer 23), recorded on the job. Then "Owner cancelled" on both (no ESC notice exists, so no withdrawal task); Stripe test payments stay in test mode.
- [ ] **Step 6: Report to Jo**, then on her OK move the other installers one at a time with Part 3 Task 18 (each move refuses while that installer has real jobs at an old step).

## Open questions for Jo

None left for this part.

## Decided (Jo, 2 Nov evening)

- **Real runs, pay and Xero (answer 23):** no trade pay (the run stops before any installer/electrician pay is approved); invoices go into Xero as normal and are voided after the run (Task 9 Step 5).
- **Real runs (answers 18–19):** owner = Jo or Tom; INSolation + Tom's Electrical; all texts/emails/Mitti forms real; Stripe test mode; ESC notice and VEEC/certificate creation stopped by Part 9's per-job "no ESC" marker (Tasks 8, 9).
- **Regulations files:** supplied by Jo and read (overview); no new rules beyond the spec; Task 7 regression kept.
- **Build method (answer 20):** checked step by step, fresh builder per task + reviewer before the next.
- **Website consent line (answer 15):** Tom changes the website form — a checklist item in Task 3, not code.

## Assumptions

- Task 3 Step 1 builds the real switch list from the finished plans (grep) before the test is written; added since the table was drafted: Part 3 `IT_IS_YOUR_TURN_V2_APPROVED`, `OWNER_BOOKED_V2_APPROVED`, `INSTALLER_ACCEPTED_V2_APPROVED`, `READY_CHECK_CHASE_EMAIL_APPROVED`; Part 4 `VISIT_CANCELLED_OWNER_APPROVED`, `ACCESS_PERSON_TEXTS_APPROVED`, `BOOKED_BEFORE_DEPOSIT_APPROVED`, `TENANT_NOTICE_APPROVED`, `NON_COMPLIANCE_NOTICE_APPROVED`; Part 6 `ELECTRICIAN_ACCESS_ROWS_APPROVED`; Part 7 `SWMS_NOV2_WORDING_ON` (Task 6 Step 5 rule); Part 9 `GO_EMAIL_APPROVED`, `INSURANCE_REMINDER_APPROVED`. Non-code checklist items: "Website consent line changed by Tom" (Part 3 Task 3) and "Mitti templates pasted" (Part 8 Task 11).
- Any gap a regulation re-check finds goes to Jo one question at a time in boxes before go-live.
- Each part keeps the journey steps it changed working (part of its own QA); this part only adds the own-customer path and runs both.
- Gate "break" runs use Part 9's journey branches; anything Part 9 didn't give a branch is NOT_RUN and goes back to Part 9, not built here.
- Sign-off is recorded in a JSON file in the repo so the go-live test can read it; Jo's yes in chat is copied there by the person running the build.
- Switch-on order = build order (1→10).
