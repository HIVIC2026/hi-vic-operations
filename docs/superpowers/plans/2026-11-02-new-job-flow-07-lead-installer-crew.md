# New job flow · Part 7 — Lead Installer and crew — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead Installers and crew work only from no-login text links: the approved "Install tomorrow" text links straight to the safety plan and the Mitti install form; the SWMS signing page follows the approved order, loads fast on a weak signal and gives the Lead Installer the crew's signing status, "Sign on my phone" and "Open install form"; the SWMS wording and PDF match the approved sample; the installer office gets one 9am email two days before ("Confirm or change your Lead Installer by 5pm today") and the Lead Installer then locks; the 6:30am jobs text goes to workers only; the replaced trade messages are removed.

**Architecture:** Wording and timing live in pure cores (`swms.core.ts`, `swms-house.core.ts`, `installer-texts.core.ts`, new `lead-installer-confirm.core.ts`, `visit-allocation.core.ts`); sends stay in the existing guarded senders with stable idempotency keys, called from the existing 15-minute allocation tick. The lock clock comes from Part 9 Task 9 (`leadInstallerLock`, `leadInstallerLocked`, `LEAD_LOCKED_MESSAGE` in `prestart.core.ts` — overview cross-part decision); this part adds the email and the server refusal on the Lead Installer / install-time writers, importing those names and never re-implementing the clock. The SWMS PDF is re-laid out on Part 1's shared website-look PDF renderer to match `swms-web.html`. No SQL.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, bun:test, Playwright (page speed + PDF render), existing SMS/email senders.

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` § "Lead Installer and crew" (+ "PDFs and official forms › SWMS", "What gets removed › Trade messages"). Wording: `docs/hiv-touchpoint-decisions.md` (#47, #48–50, "Lead Installer / ESC 24h rule", #26, "SWMS" in the electrician + SWMS chat section, "SWMS PDF layout fixed", "Changes during the job", GAP 2 downlight decision). Approved samples: `swms-sample.pdf` + `swms-web.html` (copy into `docs/approved-samples/2026-11-02/`), `ph-swms.png` (layout only — its tick/button words are superseded by the decisions file).

## Global Constraints

- Overview Global Constraints apply. Read the four `AGENTS.md` files; run `bun scripts/scan-retired-terms.ts` before and after.
- Lead Installers and crew never log in; the office picks the Lead Installer and crew. Always "Lead Installer" in full with capitals; crew are labelled "Crew".
- Install tomorrow text (verbatim, #47): `"Home Insulation Victoria: Install tomorrow {time}, {address} ({HV}). Safety plan: {link} Mitti form: {link}"`.
- SWMS signing page order (verbatim): "Specific to this house" → the 9 standard controls folded away → tick `"I am {name}. I have read the safety plan and will follow it."` → typed full name → button `"Sign the safety plan"`. Full PDF loads only when tapped. Lead Installer's view also shows who has signed, `"Sign on my phone"` for a crew member, and `"Open install form"`.
- Hazard 9 control (verbatim): `"AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps and exhaust fans; downlights are IC or IC‑4 rated and insulated as rated; cables over 400 mm in insulation as the PIESA directs"`.
- Downlight safety step (verbatim, GAP 2): `"Recessed downlights: every downlight is IC or IC‑4 rated (checked at the PIESA). Insulate over and around them as rated."` (the sample's wording, which carries Jo's "Every downlight is IC or IC‑4 rated (checked at the PIESA). Insulate over and around them as rated." under the existing "Recessed downlights:" lead-in).
- "Changes during the job" are recorded by the Lead Installer in the Mitti install form and printed on the SWMS PDF (Jo 2 Nov, answer 16; Part 8 Task 10 adds the Mitti items and the reader). Box (verbatim from the sample): heading `"Changes during the job"`, line `"If anything on site changes, or a control isn't working, stop work. Record the change and the new control here before work starts again."`, columns `"What changed"`, `"New control"`, `"Lead Installer, date and time"`, empty state `"None recorded"`.
- SWMS title `"Safe Work Method Statement"`, sub `"Ceiling insulation (VEU Activity 48)"`; no risk ratings, no separate PPE list; "How implemented" and "Responsible" shown once; no repeated hazard short names.
- Lead Installer email: ONE office email at 9am Melbourne two days before the install, `"Confirm or change your Lead Installer by 5pm today"` (+ pick the crew); locked from 5pm that day; a change after that means moving the install day. No approved body text exists → DRAFT behind `LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED = false`.
- 6:30am jobs text: workers only; no fallback to the business owner's mobile; no worker picked = no text.
- Install-day form done / not done texts and the 5pm not-done text: keep exactly as they are.
- Idempotency keys of messages that already exist are NOT versioned up (a job mid-flight must never get the same message twice).

## Review Focus

1. **Install booked after 9am but before 5pm two days before** (e.g. booked 11am Wed for Fri): the 9am email goes at once; **booked after the 5pm lock**: no email, the Lead Installer is locked from the moment of booking → Task 6 test.
2. **Install moved to another day** (outside the lock): the email and lock follow the new day; the old day's key never blocks the new email, and a second email for the same day never goes → Task 6 test.
3. **Lead Installer has no mobile on file**: no "Install tomorrow" text and no fallback to the boss's mobile; the job records "Lead Installer has no mobile" for the office → Task 5 test.
4. **A crew member removed after the Lead opened the page**: the Lead's view shows the new count ("2 of 2 signed"), and the removed person's own link says they're no longer on the crew → Task 4 test.
5. **Jobs in flight when this ships (overview Review Focus 1)**: an install tomorrow that already got the old "Install tomorrow" text gets no second one (same key `install-tomorrow:v1:…`); an install whose old 2pm in-house Lead email already went never gets the new 9am email for that day, and vice versa → Tasks 5 and 8 tests.

---

### Task 1: SWMS wording — Lead Installer, hazard 9, downlights, Crew, and the "on site the whole install" line

**Files:**
- Modify: `src/lib/swms.core.ts` (`SWMS_COMPLIANCE_MEASURES`, `SWMS_HOW_IMPLEMENTED`, `SWMS_REVIEW`, `SWMS_HOW_IN_PLACE`, hazard 9 `control`, `swmsStatus` missing line, `swmsRecordText` role labels, `swmsLeadPhoneBlocker` message), `src/lib/swms-house.core.ts` (`SWMS_HOUSE_STEPS.downlights`), `src/lib/template-hub.core.ts` (preview text follows)
- Test: `tests/swms-wording-2nov.test.ts`

**Interfaces:**
- Produces: `SWMS_LEAD_ON_SITE_LINE = "The Lead Installer is on site for the whole install."` (approved — overview "Decided from earlier approvals", rule 12); `swmsComplianceLines(plan): [label: string, value: string][]` (always includes the on-site line under Compliance); `SWMS_NOV2_WORDING_ON = false` — the new wording (and so the new plan fingerprint) is used only when this is true; while false the current wording and fingerprint stay, so no crew has to re-sign before Part 11 switches it on on a day with no real install in the next 48 hours (overview cross-part decision). Task 2 and Task 3 consume these.

- [ ] **Step 1: Write the failing test** `tests/swms-wording-2nov.test.ts`:
  ```ts
  expect(SWMS_COMPLIANCE_MEASURES).toBe("Direct supervision by the Lead Installer; every control checked before first entry and at the start of each day");
  expect(SWMS_REVIEW).toBe("The Lead Installer re-checks every control at the start of each day before work, and the plan is reviewed if anything on site changes");
  expect(SWMS_HOW_IMPLEMENTED).toBe("Lead Installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed");
  expect(SWMS_HAZARDS[8]!.control).toBe("AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps and exhaust fans; downlights are IC or IC‑4 rated and insulated as rated; cables over 400 mm in insulation as the PIESA directs");
  expect(SWMS_HOUSE_STEPS.downlights).toBe("Recessed downlights: every downlight is IC or IC‑4 rated (checked at the PIESA). Insulate over and around them as rated.");
  ```
  plus: every exported SWMS string and `swmsRecordText(plan, sigs)` output has no `/lead installer/` (lowercase) and labels people `"(Lead Installer)"` / `"(Crew)"`; control lines start with a capital (`SWMS_HAZARDS.every(h => /^[A-Z]/.test(h.control))`); `swmsComplianceLines` includes `SWMS_LEAD_ON_SITE_LINE`; with `SWMS_NOV2_WORDING_ON` false the plan text, `SWMS_RULE` and fingerprint are byte-identical to today; with it overridden true `SWMS_RULE` is `"swms-portal-2026-11-02"` and a signature given on the old wording no longer counts (`currentSignatures(oldSigs, swmsPlanSha(newPlan))` → `[]`, because `swmsPlanFingerprintText` hashes the hazard text) — this pins that crews re-sign after switch-on, which the existing #48 reminder text asks for.
- [ ] **Step 2: Run** `bun test tests/swms-wording-2nov.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the wording changes as a second constant set chosen by `SWMS_NOV2_WORDING_ON` (capitalise each hazard control's first letter in the constant, not at render).
- [ ] **Step 4: Run** `bun test tests/swms-wording-2nov.test.ts tests/swms` — Expected: PASS (update older SWMS tests that pinned the lowercase wording).
- [ ] **Step 5: Commit** `git commit -m "feat(swms): Lead Installer wording, hazard 9 and downlight step as approved"`

### Task 2: SWMS PDF in the website look with "Changes during the job"

**Files:**
- Modify: `src/lib/swms-pdf.server.ts` (replace the landscape table layout with the approved portrait website-look layout), `src/lib/swms.server.ts` (`fileSwms` unchanged apart from the new builder output)
- Create: `src/lib/swms-pdf-html.core.ts` (pure: plan + signatures → the HTML of `swms-web.html`)
- Test: `tests/swms-pdf-html.test.ts`, `tests/swms-pdf-render.test.ts`

**Interfaces:**
- Consumes: Part 1's shared website-look PDF renderer (the HTML → PDF function its plan names; page `600px × 849px`, margins `30px 40px 46px`, `@page:first` top 0, footer "Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program · Page N of M", never split a section); Task 1 `swmsComplianceLines`.
- Produces: `swmsPdfHtml(plan: SwmsPlan, sigs: SwmsSignature[], changes: SwmsChange[]): string`; `type SwmsChange = { what: string; control: string; by: string; at: string }`; `buildSwmsPdf(plan, sigs, opts)` keeps its signature and return type (`{ bytes, layout }`) and gains `opts.changes?: SwmsChange[]` (default `[]` → "None recorded"), so `fileSwms` and existing callers don't change. The source is the Lead Installer's entries in the Mitti install form (Jo 2 Nov, answer 16): Part 8 Task 10 builds the reader `installDaySwmsChanges` and re-files the SWMS PDF with them.

- [ ] **Step 1: Write the failing test** `tests/swms-pdf-html.test.ts` — plus: with `changes = [{ what: "Wasp nest in the back ceiling", control: "Area closed off, nest removed by owner's pest controller", by: "John Smith", at: "2026-11-13T02:10:00Z" }]` the box shows that row with `"John Smith, 13/11/2026 1:10pm"` and no `"None recorded"` — with the sample job (HV-1234, Rapid Insulation, John Smith Lead Installer, Sam Lee and Ali Khan Crew, install 13/11/2026, 12 Example St, Box Hill VIC 3128): the HTML contains in order `"DC Construction Solutions Pty Ltd"`, `"trading as Home Insulation Victoria"`, `"ABN 44 671 613 979 · Accredited Person A003654"`, `"SAFETY PLAN · JOB HV-1234"`, `"Safe Work Method Statement"`, `"Ceiling insulation (VEU Activity 48)"`, rows `Direct employer`, `Principal contractor` (`"Home Insulation Victoria (DC Construction Solutions Pty Ltd)"`), `Work supervisor`, `Install date`, `Site location/address`, `Work activity`, `High-risk construction work`, the Compliance block, `"Specific to this house"`, `"Hazards and control measures"`, `"For every hazard below"`, `"Responsible: John Smith (Lead Installer)"`, hazards numbered 1–9 with each `name` once, `"Changes during the job"` + its line + the three column heads + `"None recorded"`, `"Worker sign-off"`, `"I have read the safety plan and will follow it."`, rows `"John Smith (Lead Installer)"`, `"Sam Lee (Crew)"` with `✓ signed — typed "Sam Lee"` and `12/11/2026 7:05pm`; uses `#3c51c4`, `#22376b`, `#eef0fc`, `Open Sans`; each `section` has `break-inside: avoid`; no `"lead installer"` lowercase, no `"Risk"` column, no `"PPE"`. Logo `<img>` points at `public/email-preview/hi-vic-logo.png` (inlined data URL).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `swmsPdfHtml` by porting `swms-web.html`'s structure and CSS (wording from `swms.core.ts`, never re-typed); switch `buildSwmsPdf` to render it through Part 1's renderer.
- [ ] **Step 4: Write the failing render test** `tests/swms-pdf-render.test.ts` (Playwright, skipped with a NOT_RUN note when the browser isn't installed): the 3-signer sample renders to 3 pages like `swms-sample.pdf`; no page starts with a continued half-section (each `h2` box's top is on the same page as its last row); footer "Page N of M" on every page.
- [ ] **Step 5: Run** both tests — Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(swms): SWMS PDF in the website look with Changes during the job"`

### Task 3: SWMS signing page — approved order, folded controls, PDF on tap, fast on a weak signal

**Files:**
- Modify: `src/routes/sp.$token.tsx`, `src/lib/swms-link.server.ts` (`swmsLinkView` returns `installStart`; add `swmsLinkPdf`), `src/lib/swms-link.functions.ts` (`getSwmsLinkPdf`)
- Test: `tests/swms-sign-page.test.ts`, `tests/swms-sign-page-speed.test.ts`

**Interfaces:**
- Consumes: Task 1 constants; Task 2 `buildSwmsPdf`; existing `swmsLinkView`, `swmsLinkSign`, `verifySwmsLinkToken`.
- Produces: `swmsLinkPdf(token: string): Promise<{ filename: string; base64: string }>` (built on demand, same token checks as the view); view adds `installStart: string | null`.

- [ ] **Step 1: Write the failing page test** `tests/swms-sign-page.test.ts` (source-reading + `renderToStaticMarkup` of the body with a fixture view):
  - header `"Home Insulation Victoria · no login needed"`, title `"Safety plan for tomorrow"` when the install is tomorrow (DRAFT `"Safety plan"` otherwise), line `"Fri 13 Nov, 7:30am · 12 Example St, Box Hill"`.
  - DOM order: `"Specific to this house"` block → a `<details>` whose `<summary>` is DRAFT `"The 9 standard controls"` containing the hazards and `SWMS_HOW_IN_PLACE` (closed by default) → `"Read the full safety plan (PDF)"` button → tick label `"I am Sam Lee. I have read the safety plan and will follow it."` → name input (placeholder DRAFT `"Type your full name"`) → button `"Sign the safety plan"` disabled until ticked and ≥ 2 characters typed (with a visible reason).
  - the PDF is only requested inside the button's click handler (`getSwmsLinkPdf` not referenced in any `useQuery`).
  - website look: `font-family` Open Sans via the shared no-login page class, green `#07bf61` button, `#eef0fc` boxes; no "High-risk work" block outside the fold.
- [ ] **Step 2: Write the failing speed test** `tests/swms-sign-page-speed.test.ts` (Playwright against `bun run dev` with a TEST job; NOT_RUN when no browser): with network throttled to 400 kbps down / 400 ms RTT, the tick box is visible within 4 s; the page makes exactly one server-function call before interaction; no request to a PDF happens before tapping the button.
- [ ] **Step 3: Run** both — Expected: FAIL.
- [ ] **Step 4: Implement**: rewrite the page body; keep the route lean (no `lucide-react`, no chart or editor imports; `ssr: false` stays); `swmsLinkPdf` re-uses `buildSwmsPdf(plan, signatures, { recordRef: null })`.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(swms): signing page in the approved order, PDF on tap, fast on weak signal"`

### Task 4: The Lead Installer's view on the same link

**Files:**
- Modify: `src/lib/swms-link.server.ts` (`swmsLinkView` adds `lead` block when the signer is the Lead Installer; add `swmsLinkLeadPhone`), `src/lib/swms-link.functions.ts` (`openCrewSignOnLeadPhone`), `src/routes/sp.$token.tsx`, `src/lib/daily-mitti-text.server.ts` (export `bookingFormAuditId`)
- Test: `tests/swms-lead-view.test.ts`

**Interfaces:**
- Consumes: `swmsLeadPhoneBlocker`, `swmsUnsignedSigners`, `latestSignatures` (`swms.core.ts`); `swmsSignLink(jobId, key, nowMs, "lead")` (`swms-link.server.ts`); `bookingFormAuditId(jobId, "installation")` (now exported) + `mittiFormUrl`.
- Produces: view field `lead: { signers: { key: string; name: string; role: "lead" | "crew"; signed: boolean }[]; signedCount: number; total: number; installFormUrl: string | null } | null`; `swmsLinkLeadPhone(token: string, crewKey: string): Promise<{ url: string }>`.

- [ ] **Step 1: Write the failing test** `tests/swms-lead-view.test.ts`:
  - Lead's token → `lead.signers` lists every signer with `signed` from the current plan fingerprint, `signedCount`/`total` (e.g. `1`/`3`); crew token → `lead: null`.
  - Page shows DRAFT `"Signed: 1 of 3"`, each crew row with `"Sign on my phone"` while unsigned, and `"Open install form"` linking to the Mitti install form url (hidden with DRAFT `"Install form not ready yet"` when `null`).
  - `swmsLinkLeadPhone(leadToken, crewKey)` returns that crew member's own link made with `via: "lead"` (signing through it records method `"lead_phone"`); with a crew token → throws `"Only the Lead Installer can open someone's sign link on their phone."`; for a removed crew key → throws the existing "no longer on this job's crew" message.
  - Crew member removed → `total` drops and the removed person's own link view throws `"You're no longer on this job's crew. Ask your business owner."`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (reads stay one round trip: plan, signatures, audit id in `Promise.all`).
- [ ] **Step 4: Run** `bun test tests/swms-lead-view.test.ts tests/swms-link` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(swms): Lead Installer view — who has signed, Sign on my phone, Open install form"`

### Task 5: "Install tomorrow" text to the Lead Installer with the approved wording

**Files:**
- Modify: `src/lib/installer-texts.core.ts` (`installTomorrowText`), `src/lib/installer-texts.server.ts` (`textInstallerInstallTomorrow`), `src/lib/sms.core.ts` (`install_tomorrow` label notes #47)
- Test: `tests/install-tomorrow-text.test.ts`

**Interfaces:**
- Consumes: `allocatedPersonFor(jobId, "install")` (the picked Lead Installer); `swmsSignLink(jobId, leadKey, nowMs)`; `bookingFormAuditId(jobId, "installation")` (Task 4) + `mittiFormUrl`; `brandSmsBody` (adds `"Home Insulation Victoria: "`).
- Produces: `installTomorrowText(f: { startIso: string; address: string | null; jobNumber: string; safetyPlanLink: string; mittiLink: string }): string` (no brand prefix — the sender adds it); `textInstallerInstallTomorrow` returns `"no lead installer"` / `"lead installer has no mobile"` / `"install form not ready"` when it can't send.

- [ ] **Step 1: Write the failing test** `tests/install-tomorrow-text.test.ts`:
  ```ts
  const body = brandSmsBody(installTomorrowText({ startIso: "2026-11-12T20:30:00Z", address: "12 Example St, Box Hill", jobNumber: "HV-1234", safetyPlanLink: "https://p/sp/abc", mittiLink: "https://app.au.safetyculture.com/inspection/A5" }));
  expect(body).toBe("Home Insulation Victoria: Install tomorrow 7:30am, 12 Example St, Box Hill (HV-1234). Safety plan: https://p/sp/abc Mitti form: https://app.au.safetyculture.com/inspection/A5");
  ```
  plus (memory PostgREST): sent to the Lead Installer's own mobile; Lead with no mobile → returns `"lead installer has no mobile"`, nothing sent, an internal event `install_tomorrow_held { reason }` written once; no Lead picked → `"no lead installer"`, nothing sent, never the boss's `signer_mobile`/`phone`; install form missing → `"install form not ready"` and held (the text needs both links); the key is still `installTomorrowKey(jobId, bookingId, startIso)` (`install-tomorrow:v1:…`) so an install that already got yesterday's old text is not texted again; the text no longer lists other crew members' links (each crew member gets their own sign text, #48, unchanged).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (drop `withSafetyPlanLinks` / `dailyTextRecipient` from this sender; `INSTALL_TOMORROW_FROM_HM` stays `"16:00"`).
- [ ] **Step 4: Run** `bun test tests/install-tomorrow-text.test.ts tests/installer-texts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(trades): Install tomorrow text to the Lead Installer with safety plan and Mitti links"`

### Task 6: 9am two-days-before Lead Installer email and the 5pm lock on the writers

**Files:**
- Create: `src/lib/lead-installer-confirm.core.ts`, `src/lib/lead-installer-confirm.server.ts`
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (call `sweepLeadInstallerConfirm`), `src/lib/trade-view.functions.ts` (`changeInHouseLeadInstaller` refuses when locked), `src/lib/visit-allocation.server.ts` (`saveCrewWithLead` refuses a Lead change when locked; crew-only changes still allowed), the install "Change time" path used by Part 5's Next step box (`inHouseBookVisit` for an existing install booking) refuses when locked, `src/lib/template-hub.core.ts` (Templates page entry, DRAFT)
- Test: `tests/lead-installer-confirm.test.ts`

**Interfaces:**
- Consumes: Part 9 Task 9 `leadInstallerLock(startIso): { emailAt; lockAt; lockLabel }`, `leadInstallerLocked(startIso, now)`, `LEAD_LOCKED_MESSAGE` (= `"Locked: ESC has been told. Email us to move this install."`, the approved line, reused as the server refusal) from `prestart.core.ts`; `partnerEmailLayout`; `sendOfficeEmail` (existing guarded partner email); `tradeMessagesPausedNow`; `qaDeliveryHeld`.
- Produces:
  - `LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED = false`.
  - `leadConfirmKey(jobId: string, installYmd: string) => \`lead-confirm:v1:${jobId}:${installYmd}\``.
  - `leadConfirmDue(f: { startIso: string; bookedAt: string; now: Date }): "send" | "wait" | "too_late"` — `send` from `emailAt` (or from `bookedAt` if booked after `emailAt`) until `lockAt`; `too_late` at/after `lockAt`.
  - `renderLeadInstallerConfirm(i: { jobNumber: string; owner: string; startIso: string; address: string; lead: string | null; crew: string[]; jobUrl: string; lockLabel: string; test?: boolean }): { subject: string; html: string; text: string }` — subject DRAFT `"{HV}: Confirm or change your Lead Installer by 5pm today"`; heading `"Confirm or change your Lead Installer by 5pm today"`; rows Install / Address / Lead Installer / Crew; button DRAFT `"Confirm on the job"`; line DRAFT `"After 5pm the Lead Installer is locked because the ESC is told. To change it after that, the install day has to move."`.
  - `sweepLeadInstallerConfirm(now?: Date): Promise<{ checked: number; sent: number; held: number }>` — every confirmed `installation` booking starting within 3 days, ALL installers (not only in-house), one email per job + install date to the installer business email.

- [ ] **Step 1: Write the failing test** `tests/lead-installer-confirm.test.ts` (install Fri 13 Nov 7:30am = `"2026-11-12T20:30:00Z"`, booked Mon 9 Nov):
  - `leadConfirmDue` at Wed 11 Nov 8:59am → `"wait"`; 9:00am → `"send"`; 4:59pm → `"send"`; 5:00pm → `"too_late"`.
  - Booked Wed 11 Nov 11:00am → `"send"` straight away; booked Wed 11 Nov 6:00pm → `"too_late"` (no email; `leadInstallerLocked` already true).
  - Moved to Mon 16 Nov → new key `lead-confirm:v1:{job}:2026-11-16`, due Sat 14 Nov 9am; the 13 Nov key doesn't block it; a second sweep the same day sends nothing new.
  - DST: install Tue 6 Oct 2026 8am → due Sun 4 Oct 9:00 AEDT (`2026-10-03T22:00:00Z`).
  - Flag false → held (`held: 1`, nothing sent), TEST job → test-send; `trade_messages_paused` → held.
  - Rendered email contains the heading, `"Fri 13 Nov, 7:30am"`, `"Lead Installer"`, `"John Smith"`, `"Crew"`, `"Sam Lee, Ali Khan"`, button url `/field/{jobId}`; never `"lead installer"` lowercase.
  - Writers: after `lockAt`, `changeInHouseLeadInstaller` throws `LEAD_LOCKED_MESSAGE`; `saveCrewWithLead` with a different lead throws it, with the same lead and new crew succeeds; moving the install start throws it; before `lockAt` all three succeed exactly as today (the existing `recordLeadChange` ESC-update path still runs).
- [ ] **Step 2: Run** `bun test tests/lead-installer-confirm.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** core + server sweep (paged 200, read failure → log, send nothing) + tick call + the three writer refusals (check `leadInstallerLocked` against the CURRENT booking start read inside the writer, never the page's copy).
- [ ] **Step 4: Run** the test + `bun test tests/in-house-task7 tests/visit-allocation` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(trades): 9am two-days-before Lead Installer email and the 5pm lock"`

### Task 7: 6:30am jobs text — workers only

**Files:**
- Modify: `src/lib/visit-allocation.core.ts` (add `workerOnlyTextRecipient`), `src/lib/daily-mitti-text.server.ts` (use it; skip bookings with no recipient), `tests/visit-allocation.test.ts` (the owner-fallback expectations move to the two senders that keep it)
- Test: `tests/daily-text-workers-only.test.ts`

**Interfaces:**
- Produces: `workerOnlyTextRecipient(allocated: { workerId: string; name: string; mobile: string | null } | null): TextRecipient | null` — `null` when no one is allocated or they have no mobile. `dailyTextRecipient` stays (still used by `install-day-confirm.server.ts`; Task 5 stops using it for Install tomorrow).

- [ ] **Step 1: Write the failing test** `tests/daily-text-workers-only.test.ts`: `workerOnlyTextRecipient(null)` → `null`; with no mobile → `null`; with mobile → `{ key: "w:w1", who: "allocated", phone: "+61400000001" }`; daily text grouping (memory PostgREST): a business with one allocated install (worker mobile) and one unallocated Ready Check → ONE text to the worker listing only the install; nothing to `signer_mobile`; a business where nobody is allocated → no `trade_text_log` row at all; PIESA bookings → no 6:30am text (electricians get their job link, Part 6). The send key for a worker group stays `dailySendKey("daily", biz, date, "w:{id}")` (unchanged).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/daily-text-workers-only.test.ts tests/daily-mitti-text tests/visit-allocation.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(trades): 6:30am jobs text goes to workers only"`

### Task 8: Remove the replaced trade messages

**Files:**
- Delete: `src/lib/usual-electrician-reminder.server.ts`, `src/lib/crew-reminder.core.ts`, `src/lib/crew-reminder.server.ts`
- Modify: `src/lib/installer-quote.server.ts` (drop the `maybeRemindUsualElectrician` call), `src/lib/sms.core.ts` (`usual_electrician_missing` marked retired: kept for history labels, `wordingApproved: false`, never sent), `src/lib/template-hub.core.ts` (remove the "Add your usual electrician (text)" and crew-reminder entries), `src/lib/needs.server.ts` / `src/lib/allocation.core.ts` (`installer_usual_electrician_missing` no longer raised; old rows ignored), `src/lib/in-house-booking-notices.server.ts` (delete `sweepInHouseInstallOfficeEmails`), `src/lib/in-house-booking.core.ts` (delete `tomorrowInstallDigest`), `src/routes/api/public/hooks/allocation-tick.ts` (drop the two sweep calls), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` (retired: "2pm day-before Lead Installer email", "Pick the crew for tomorrow", "We need your usual electrician")
- Test: `tests/trade-messages-removed.test.ts`

- [ ] **Step 1: Write the failing test**: the three files don't exist; `grep` over `src/` finds no `sweepCrewReminders`, `maybeRemindUsualElectrician`, `sweepInHouseInstallOfficeEmails`, `tomorrowInstallDigest`, `"Tomorrow’s installs — Lead Installer"`; allocation-tick source calls `sweepLeadInstallerConfirm` and not the removed sweeps; `retired` list in `workflow-decisions.ts` contains the three phrases; for a job whose old key `in-house-install-office:v1:{biz}:{day}` exists for an install day, `sweepLeadInstallerConfirm` sends nothing for that day (no double message), and a job with a `lead-confirm:v1` key can never trigger the old path (it no longer exists).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Remove;** in `sweepLeadInstallerConfirm` skip an install day that already has the old `in-house-install-office:v1` claim event (read once, batched); update the two workflow docs in the same commit; `bun scripts/scan-retired-terms.ts` → 0.
- [ ] **Step 4: Run** `bun test tests/trade-messages-removed.test.ts` and `bun run test` — Expected: PASS (delete tests that only covered removed senders; keep `tests/in-house-task7*.test.ts` cases that pin booking guards).
- [ ] **Step 5: Commit** `git commit -m "chore(trades): remove usual-electrician text, crew reminder and 2pm Lead Installer email"`

### Task 9: Remove the old Ready Check run and offer trade messages (#35, #40–43, #47, #50 — overview cross-part decision)

Under "installer calls and books" (Part 3 Task 18) no job is offered to installers or run in batches with owner-picked times, so these trade messages go. Task 8 already removes "We need your usual electrician" (#28 / #54).

**Files:**
- Modify: `scripts/old-flow-inflight-count.ts` (Part 3 Task 16; add `OLD_FLOW_STEPS_P7`: pending `partner_offers`, open A48 runs, owner-suggested days waiting for the installer)
- Remove/retire: `src/lib/run-route.core.ts` "You've got a run" text (`run_offered`, #35); `src/lib/run-portal.core.ts` "Owner cancelled in a run" text (`run_slot_cancelled`, #40); `src/lib/ready-check-offer-email.core.ts` (#41) and its sender; `src/lib/ready-check-times.core.ts` `job_offer` text (#42) and `sweepJobOfferTexts`; `src/routes/_authenticated/field.offer.$offerId.tsx` (#43; old links redirect to `/field`); `src/lib/installer-texts.core.ts` `ready_check_days_suggested` (#47) and `ready_check_booked_installer` (#50) builders and their senders; `src/lib/sms.core.ts` (those five types kept for history with `wordingApproved: false` and label prefix `Retired 2 Nov 2026 —`); `src/lib/template-hub.core.ts`; Part 5's My work "Job offer" card (`my-work.core.ts`); retired-terms list
- Test: `tests/trade-offer-messages-removed.test.ts`

- [ ] **Step 1: Run** `bun scripts/old-flow-inflight-count.ts` (read-only). If ANY real job has a pending offer, an open run or owner-suggested days waiting, STOP and ask Jo (Part 3 Open question 1) before removing that path. Paste the table in the PR.
- [ ] **Step 2: Write the failing test** — the five SMS types exist only as retired history (`wordingApproved: false`, label starts `Retired 2 Nov 2026 —`), so `smsBlocker` refuses them; no sweep or route imports the removed builders/senders (source scan over `src/`); the offer route file is gone and `/field/offer/x` redirects to `/field`; template-hub has no entries for #35, #40–43, #47, #50; `myWorkCards` never produces a `"Job offer"` card.
- [ ] **Step 3: Run** `bun test tests/trade-offer-messages-removed.test.ts` — Expected: FAIL.
- [ ] **Step 4: Remove;** update `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` (retired: runs and Ready Check job offers) in the same commit; `bun scripts/scan-retired-terms.ts` → 0.
- [ ] **Step 5: Run** `bun test tests/trade-offer-messages-removed.test.ts` and `bun run test` — Expected: PASS (delete tests that only covered removed senders; keep every test that pins a booking guard).
- [ ] **Step 6: Commit** `git commit -m "chore(trades): remove Ready Check run and job offer messages"`

### Task 10: Full checks and Jo's sign-off pack

- [ ] **Step 1:** `bun run test` — all green; `bun scripts/scan-retired-terms.ts` — 0.
- [ ] **Step 2:** On a TEST installer (journey TEST personas; the real runs with INSolation are Part 11): book an install for the day after tomorrow, watch the 9am email (test inbox), the 5pm lock on the Job page, the Install tomorrow text (test phone), the crew sign texts, and both `/sp/` views (crew and Lead Installer) on a throttled phone profile; render the SWMS PDF and compare page by page with `swms-sample.pdf`.
- [ ] **Step 3:** Phone-width pictures + one text paste of every DRAFT line (Lead Installer email, signing page fold label/placeholder/"Signed: X of Y"/"Install form not ready yet", "Safety plan" title variant), plus the SWMS PDF with a "Changes during the job" row. The email flag stays off until Jo approves; `SWMS_NOV2_WORDING_ON` is turned on only by Part 11 Task 6 (no real install within 48 hours).

## Open questions for Jo

None left for this part. Draft lines are approved from the Task 10 pictures at build time.

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **SWMS on-site line:** "The Lead Installer is on site for the whole install." goes under Compliance (decided from rule 12; Task 1).
- **"Changes during the job" (answer 16):** recorded by the Lead Installer in the Mitti install form and printed on the SWMS PDF (Task 2 + Part 8 Task 10).
- **Lead Installer lock:** Part 9's rule, imported here (Task 6).
- **Old trade messages #28, #35, #40–43, #47, #50, #54:** removed here (Tasks 8, 9).
- **SWMS go-live:** behind `SWMS_NOV2_WORDING_ON`, switched on by Part 11 only when no real install is within 48 hours.

## Assumptions

- "Two days before" is two calendar days (install Monday → email Saturday 9am, lock Saturday 5pm), Melbourne time, DST-safe.
- Crew can still be changed after the 5pm lock (only the Lead Installer and the install day/time lock); a crew change re-asks SWMS signatures as today.
- The 9am email is one email per install (not a daily digest), to the installer business email, for every installer, and only bookings that exist at 9am or are made before 5pm get one.
- Part 9 owns the lock clock and `LEAD_LOCKED_MESSAGE`; Part 5 shows the "Locked: …" box line; this part refuses the Lead/crew/time writers. Part 9 owns ESC notice update/withdraw when a Lead or day changes and the GO check's "Lead Installer ESC-registered". Part 8 owns the Mitti install form changes (Lead Installer's VEEC Part B at the end, day-2+ re-check, Lead Installer whole install confirmation). Part 1 owns the shared PDF renderer this part's SWMS PDF uses.
- The page-speed target (tick box visible within 4 s at 400 kbps / 400 ms) is the build's test for "loads fast on a weak phone signal".
- The new SWMS wording changes every plan's fingerprint, so anyone who signed before Task 1 ships must sign again (the existing #48 reminder text asks them). That is why the new wording sits behind `SWMS_NOV2_WORDING_ON`: Part 11 turns it on only when no real install is within the next 48 hours, otherwise the GO check would show "DON'T START: SWMS signatures" until the crew re-sign.
