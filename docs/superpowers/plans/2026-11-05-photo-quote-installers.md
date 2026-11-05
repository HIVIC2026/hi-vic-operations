# Photo-quote installers (No Gap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an installer set to "From photos" (No Gap) quote Home Insulation Victoria leads from the owner's photos/videos instead of a Ready Check, then carry on into the normal in-house PIESA → install flow.

**Architecture:** One business setting (`businesses.quote_method`) and one pure core (`photo-quote.core.ts`) hold every rule. The photo quote writes the SAME records a completed Mitti Ready Check writes (a complete `ceiling_measurements` row, `mitti_product_recorded`, the form-eligible event, the stage moves) and then calls the existing quote builder and auto-send, so quoting, holds, the $349 gate and everything after stay untouched. Ready Check touchpoints are swapped or skipped only where the job's installer is "From photos".

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, bun:test, PGlite, `bun run portal-qa`.

**Spec:** `docs/superpowers/specs/2026-11-05-photo-quote-installers-design.md`

## Global Constraints

- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` first; run `bun scripts/scan-retired-terms.ts` before and after.
- New SQL lives in `docs/pending-migrations/`, proven on PGlite, never run live without Jo's OK. Code treats a missing `quote_method` column as `'ready_check'`.
- Trade screens read only through `trade-view.server.ts`, business-scoped; labels in pure cores. Trades never see prices.
- Always "Home Insulation Victoria" in full; "Lead Installer" with capitals; never "fixes", "about", "HIV" in anything people read. Installer offices are emailed, never texted.
- Greyed-out buttons say what's needed and why.
- New owner/installer wording ships behind a `…_APPROVED = false` flag until Jo approves it (TEST jobs → test-send).
- Exact values: setting labels "Ready Check" / "From photos"; time limit **2 business days** from the job being given; form fields exactly: "Existing insulation under R2?" (Yes/No), "Sqm to remove", "Sqm to install", "Product", button "Send for quote"; grey-out reason "{Installer} quotes from photos. This owner hasn't sent any."; quote footnote "Your quote uses what {Installer} worked out from your photos."
- Price is firm: nothing in this build re-quotes after the PIESA or install.
- Photos/videos = `documents.kind = 'intake_media'` with a photo or video mime (website uploads and `/estimate/{token}/video` uploads share this kind).

## Review Focus

1. **A job whose installer is switched to/from "From photos" after jobs were given** → each job keeps the method it was given under. Pin: Task 1 stores `quote_method` on the give event; Task 5 reads the job's recorded method, not the business's current one.
2. **"Send for quote" pressed twice / two tabs** → one measurement, one quote. Pin: Task 5 test `submitPhotoQuote is idempotent on a repeat`.
3. **Photo quote sent, then the owner's photos are deleted or "Can't do this one" pressed after** → hand-back is refused once a quote exists; the sent quote stands. Pin: Task 5 test.
4. **Sqm to remove > Sqm to install, zero, negative, decimals like "84.5"** → remove ≤ install, both > 0 (remove may be 0), decimals kept to 1 place. Pin: Task 1 `photoQuoteProblems` tests.
5. **A photo job reaching the 15-minute Mitti backup or the Ready Check stall flag** → no Ready Check form is made and no Ready Check flag appears. Pin: Task 4 tests.

---

### Task 1: Setting + pure rules

**Files:**
- Create: `docs/pending-migrations/installer-quote-method.sql`, `…/installer-quote-method.rollback.sql` (copy the shape of `installer-business-settings.sql`: `alter table businesses add column if not exists quote_method text not null default 'ready_check'`, check `in ('ready_check','photos')`, trigger writing one `admin_config_events` `quote_method_changed` row on change)
- Create: `src/lib/photo-quote.core.ts`
- Modify: `src/integrations/supabase/types.ts` (add `quote_method` to `businesses` Row/Insert/Update)
- Modify: `src/lib/pilot.functions.ts` (`businessInput` gains `quote_method: z.enum(["ready_check","photos"]).optional()`, admin-only like `in_house`)
- Modify: `src/routes/_authenticated/admin.partners_.business.$businessId.tsx` (a "How they quote" choice: Ready Check / From photos, next to the in-house switch)
- Test: `tests/installer-quote-method.pglite.test.ts`, `tests/photo-quote.core.test.ts`

**Interfaces:**
- Produces (all in `photo-quote.core.ts`):
  - `type QuoteMethod = "ready_check" | "photos"`
  - `quoteMethodOf(b: { quote_method?: string | null } | null): QuoteMethod` — anything but `"photos"` → `"ready_check"`
  - `hasOwnerMedia(docs: { kind: string; mime_type: string | null; storage_path: string | null }[]): boolean`
  - `PHOTO_QUOTE_WORDS` (all copy from Global Constraints + Tasks 3/6/7)
  - `type PhotoQuoteInput = { underR2: boolean | null; removeM2: number | null; installM2: number | null; product: string | null }`
  - `photoQuoteProblems(i: PhotoQuoteInput): string[]`
  - `photoQuoteDueBy(givenAtIso: string): string` (Melbourne YMD, `addVicBusinessDays(…, 2)`)
  - `photoQuoteOverdue(givenAtIso: string, now: Date): boolean`

- [ ] **Step 1: Write failing tests** (`tests/photo-quote.core.test.ts`)

```ts
expect(quoteMethodOf({ quote_method: "photos" })).toBe("photos");
expect(quoteMethodOf({})).toBe("ready_check");
expect(quoteMethodOf(null)).toBe("ready_check");
expect(hasOwnerMedia([{ kind: "intake_media", mime_type: "image/jpeg", storage_path: "a.jpg" }])).toBe(true);
expect(hasOwnerMedia([{ kind: "intake_media", mime_type: "application/pdf", storage_path: "a.pdf" }])).toBe(false);
expect(hasOwnerMedia([{ kind: "signed_quote", mime_type: "image/jpeg", storage_path: "a.jpg" }])).toBe(false);
expect(photoQuoteProblems({ underR2: true, removeM2: 0, installM2: 84.5, product: "R5.0 batts" })).toEqual([]);
expect(photoQuoteProblems({ underR2: false, removeM2: 0, installM2: 80, product: "R5.0 batts" })).toContain("Over R2 isn't eligible. Use Can't do this one.");
expect(photoQuoteProblems({ underR2: null, removeM2: null, installM2: null, product: null })).toEqual(["Say if the existing insulation is under R2", "Enter the sqm to remove (0 if none)", "Enter the sqm to install", "Pick the product"]);
expect(photoQuoteProblems({ underR2: true, removeM2: 90, installM2: 80, product: "R5.0 batts" })).toContain("Sqm to remove can't be more than sqm to install");
expect(photoQuoteProblems({ underR2: true, removeM2: -1, installM2: 0, product: "R5.0 batts" }).length).toBe(2);
expect(photoQuoteDueBy("2026-11-06T01:00:00Z")).toBe("2026-11-10"); // Fri → Tue
```

- [ ] **Step 2:** `bun test tests/photo-quote.core.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `photo-quote.core.ts`. `product` must be one of `APPROVED_PRODUCTS[].option` (`insulation-product.core.ts`), else "Pick the product". Round sqm to 1 decimal place. Reuse `hasOwnerMedia`'s photo/video test from `group-b-media.core.ts` `mediaType` (export it if it isn't exported).
- [ ] **Step 4:** `bun test tests/photo-quote.core.test.ts` → PASS.
- [ ] **Step 5: PGlite proof.** `tests/installer-quote-method.pglite.test.ts`: default is `ready_check`; `'photos'` accepted; `'desk'` refused; a change writes exactly one `quote_method_changed` row; re-running the SQL is a no-op. Run `bun test tests/installer-quote-method.pglite.test.ts` → PASS.
- [ ] **Step 6: saveBusiness + Partners page.** Test (extend the existing saveBusiness source-reading test or add `tests/quote-method-save.test.ts`): a non-admin patch with `quote_method` drops it; the business page renders both choices. Run → PASS.
- [ ] **Step 7: Commit** `feat: installer quote method setting (Ready Check / From photos)`

---

### Task 2: Giving jobs — photo leads only

**Files:**
- Modify: `src/lib/in-house-batch.core.ts` (`BatchJob` gains `hasOwnerMedia: boolean`; `InHousePartner` gains `quote_method: QuoteMethod`)
- Modify: `src/lib/in-house-batch.server.ts` (read `intake_media` docs for the screened jobs in 200-id pages; refuse in the give loop; record `quote_method` in the allocation's event details)
- Modify: `src/components/portal/in-house-handoff.tsx` (greyed tick box + reason)
- Test: `tests/in-house-batch.core.test.ts`

**Interfaces:**
- Consumes: `quoteMethodOf`, `hasOwnerMedia`, `PHOTO_QUOTE_WORDS.noPhotos(installer)` (Task 1)
- Produces: `photoLeadBlocked(job: BatchJob, partner: InHousePartner): string | null` (reason or null); give event details carry `quote_method: "photos" | "ready_check"`; `suggestBatches` never suggests a blocked job.

- [ ] **Step 1: Failing tests:** `photoLeadBlocked({ ...job, hasOwnerMedia: false }, { ...p, quote_method: "photos", name: "No Gap Insulation" })` → `"No Gap Insulation quotes from photos. This owner hasn't sent any."`; with media → `null`; Ready Check partner without media → `null`; `suggestBatches` with a photos-only partner skips the no-media job.
- [ ] **Step 2:** Run `bun test tests/in-house-batch.core.test.ts` → FAIL.
- [ ] **Step 3:** Implement; in `sendInHouseBatch` push `{ jobId, reason }` from `photoLeadBlocked` before allocation; media-read failure refuses the whole give ("Couldn't check the owner's photos. Try again.") — never gives on a failed read.
- [ ] **Step 4:** Run → PASS. Also run the existing in-house batch tests → PASS.
- [ ] **Step 5:** Handoff UI: blocked rows show a disabled tick box with the reason under the address. Check with `bun run portal-qa` screen run on a TEST photos partner.
- [ ] **Step 6: Commit** `feat: photo-quote installers only get leads with photos`

---

### Task 3: Messages when the job is given

**Files:**
- Create: `src/lib/owner-photo-quote-notice.core.ts`
- Modify: `src/lib/in-house-batch-email.server.ts` (owner: photos → this notice instead of `ownerWillCallEmail`/`ownerWillCallText`; no text)
- Modify: `src/lib/in-house-give-email.core.ts` (photo version)
- Test: `tests/owner-photo-quote-notice.test.ts`, `tests/in-house-give-email.test.ts`

**Interfaces:**
- Consumes: `TradeContact`, `installerName` (`owner-will-call.core.ts`); give event `quote_method` (Task 2)
- Produces: `OWNER_PHOTO_QUOTE_NOTICE_APPROVED = false`; `ownerPhotoQuoteEmail(i: OwnerWillCallInput): { subject; html; text } | Held` (same holds as will-call: missing office phone → held); `renderInHouseGiveEmail` takes `method: QuoteMethod`.

- [ ] **Step 1: Failing tests** — exact copy:
  - subject `"Good news: no visit needed"`
  - body lines in order: `"Hi {first},"`, `"Good news: {Installer} can quote from the photos you sent, so you don't need a Ready Check visit."`, `"Your quote is on its way."`, `"{Installer} · {office phone} · {business email}"`, `"Rebate certificates created by Home Insulation Victoria (Accredited Person A003654)."`
  - no "Ready Check booking", no "will call"; never contains "HIV" or "about"
  - give email, photos: subject `"New photo quote jobs from Home Insulation Victoria"`, heading `"New photo quote jobs"`, call line replaced by `"Quote each one from the owner's photos within 2 business days."`, button `"Open the job"` per job; Ready Check version unchanged (snapshot).
  - a photos job never calls `ownerWillCallText` (spy test on the sender).
- [ ] **Step 2:** Run both tests → FAIL.
- [ ] **Step 3:** Implement; key `owner-photo-quote-notice:v1:{jobId}:{batchId}`; one `customer_email_sends` attempt; flag off → `owner_photo_quote_notice_held` event once; TEST → test-send.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: owner 'no visit needed' email and photo give email (held for approval)`

---

### Task 4: No Ready Check machinery on photo jobs

**Files:**
- Create: `src/lib/photo-quote.server.ts` with `jobQuoteMethod(jobId): Promise<QuoteMethod>` (reads the latest active-installer give event's `quote_method`; none → `"ready_check"`)
- Modify: `src/lib/in-house-forms.server.ts` (`ensureInHouseForms`: photo jobs skip the Ready Check form and the "Ready Check booked" requirement; new `ensurePhotoJobForms(jobId, actorId, call?)` makes the PIESA + upgrades forms only)
- Modify: the 15-minute missing-Ready-Check-form backup (`mitti-create.server.ts` sweep that calls `readyCheckFormFacts`) → skip photo jobs
- Modify: `src/lib/office-needs.core.ts` + `office-needs.server.ts` (`inHouseNeedsFacts` adds `quoteMethod`; photos → no `in_house_ready_check_not_booked`; new kind `in_house_photo_quote_overdue`, line `"Photo quote not sent after 2 business days"`, rank 91, group "week", until a photo quote is submitted or the job is handed back); `needs-cards.core.ts` maps it to `"other"`
- Modify: `src/lib/ready-check-chase.core.ts` callers → no chase for photo jobs
- Test: `tests/photo-job-no-ready-check.test.ts`, extend `tests/office-needs*.test.ts`

**Interfaces:**
- Consumes: `photoQuoteOverdue` (Task 1), give event `quote_method` (Task 2)
- Produces: `jobQuoteMethod`, `ensurePhotoJobForms(jobId: string, actorId: string | null, call?: MittiCall): Promise<{ piesa: string | null; fixes: string | null }>`, needs kind `in_house_photo_quote_overdue`

- [ ] **Step 1: Failing tests:** photos job given Fri 6 Nov 10:00 → no flag Tue 10 Nov, flag Wed 11 Nov; no `in_house_ready_check_not_booked` ever; flag clears once `photo_quote_submitted` exists; backup sweep with a photos job creates no form (mock `MittiCall`, zero create calls); `ensurePhotoJobForms` on a TEST job creates exactly a PIESA and an upgrades form via the simulator.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; run the existing office-needs and in-house-forms tests → PASS.
- [ ] **Step 5: Commit** `feat: photo jobs skip Ready Check forms, chase and flags; 2-day photo quote flag`

---

### Task 5: Submit the photo quote

**Files:**
- Modify: `src/lib/photo-quote.server.ts` (add `submitPhotoQuote`, `photoQuoteHandBack`)
- Modify: `src/lib/trade-view.functions.ts` (`tradeSubmitPhotoQuote` server fn, literal createServerFn chain, zod input matching `PhotoQuoteInput`)
- Modify: `src/lib/trade-view.server.ts` (`handBackJob`: refuse once a photo quote has a quote drafted or sent: "The quote has gone. Email us if something's wrong.")
- Test: `tests/photo-quote.server.test.ts` (PGlite helpers)

**Interfaces:**
- Consumes: `photoQuoteProblems` (Task 1), `jobQuoteMethod`, `ensurePhotoJobForms` (Task 4), existing `generateInstallerQuotes(jobId, actorId, { mittiDraft: true })`, `maybeAutoSendInstallerQuote(jobId, { formCompleted: true, formModifiedAt, entries: [] })`, `stageEntryBlockers`, `transition`, `logEvent`, `FORM_ELIGIBLE_EVENT`
- Produces: `submitPhotoQuote(jobId: string, userId: string, i: PhotoQuoteInput): Promise<{ ok: true; sent: boolean; held: string[] } | { ok: false; message: string }>`

- [ ] **Step 1: Failing tests:**
  - not this business's job / not a photos job / stage not `ready_check_ready_to_schedule` → `ok:false` with a message, nothing written
  - `photoQuoteProblems` non-empty → `ok:false`, message = problems joined " • "
  - valid → one current `ceiling_measurements` row: `status 'complete'`, `external_source 'photo_quote'`, `measured_area_m2 = installM2`, `removal_required = removeM2 > 0`, `removal_m2 = removeM2`, `insulation_present = removeM2 > 0`, `source_role 'installer'`, `raw_snapshot` = the inputs; one `mitti_product_recorded` with `{ ready: true, product, source: "photo_quote" }`; one `FORM_ELIGIBLE_EVENT` with `basis: "photo_quote"`; one `photo_quote_submitted`; stage ends `measured_estimate_ready`; `generateInstallerQuotes` called once; `maybeAutoSendInstallerQuote` called with `formCompleted: true`
  - **idempotent on a repeat**: second identical submit → `ok:true`, no new rows, no second quote
  - a different submit after a quote is drafted → `ok:false` "The quote has gone. Email us if something's wrong."
  - hand-back after a drafted quote → refused
  - `stageEntryBlockers` returning blockers → `ok:false` with them, the measurement row kept for the office (matches `finishMittiReadyCheck`'s hold)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement, mirroring `finishMittiReadyCheck` steps 1–3; call `ensurePhotoJobForms` after the stage move (a form failure logs and never blocks the quote). If a `stageEntryBlockers` check for `ready_check_complete` needs a Ready Check booking, add a photo-quote allowance there keyed on `photo_quote_submitted` (one line, with a test) — never remove the check for other jobs.
- [ ] **Step 4:** Run → PASS. Run `tests/mitti-complete*.test.ts` and `tests/auto-quote-send*.test.ts` → PASS (unchanged).
- [ ] **Step 5: Commit** `feat: installer photo quote creates the measurement and quote through the normal path`

---

### Task 6: Installer job page — "Quote from photos"

**Files:**
- Modify: `src/lib/next-step-box.core.ts` (new kind `quote_from_photos`; `NextStepFacts` gains `quoteMethod: QuoteMethod`; photos jobs before a photo quote → this box; `book_ready_check`, `ready_check_booked`, `ready_check_missing` never for photos)
- Modify: `src/lib/trade-view.server.ts` (`photoQuoteMedia(jobId, userId)`: business-scoped, signed URLs (1 hour) for the job's `intake_media` photos/videos + the owner's intake answers rows already used by the give email's `ownerSaid`)
- Create: `src/components/portal/PhotoQuoteForm.tsx`
- Modify: `src/lib/job-page-rows.core.ts` (`paperworkRows` gains `photoQuote: boolean`; photos jobs show `"Photo quote"` instead of `"Ready Check report (Mitti, with photos)"`); progress bar step label `"Photo quote"`
- Test: `tests/next-step-box.test.ts`, `tests/job-page-rows.test.ts`

**Interfaces:**
- Consumes: `tradeSubmitPhotoQuote`, `tradeHandBack` (Task 5), `PHOTO_QUOTE_WORDS`
- Produces: `NextStepKind` adds `"quote_from_photos"`; `NEXT_STEP_WORDS.quoteFromPhotosTitle = "Quote from photos"`, `quoteFromPhotosSub = (by: string) => \`Look at the owner's photos, fill this in and send it. Due by ${by}.\`` (DRAFT); overdue after `photoQuoteDueBy`

- [ ] **Step 1: Failing tests:** photos job, no quote → `kind "quote_from_photos"`, `bookBy` = due date, `overdue` true on Wed 11 Nov for a Fri 6 Nov give; after `photo_quote_submitted` → the existing `waiting_quote` box; Ready Check job unchanged (snapshot); paperwork rows for photos list "Photo quote" first.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the core, `photoQuoteMedia`, and the form (photos grid + tap to open full size, videos play inline; the four fields; "Send for quote" disabled until `photoQuoteProblems` is empty, with the first problem shown under it; "Can't do this one" opens the existing hand-back dialog with reasons "Photos not clear enough" / "Looks over R2" / "Other").
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `bun run portal-qa` screen step on a TEST photos job at 390 px and desktop; trade view shows no prices.
- [ ] **Step 6: Commit** `feat: Quote from photos step on the installer job page`

---

### Task 7: Owner wording after the quote

**Files:**
- Modify: `src/lib/quote-changes.core.ts` (`quoteChangesFootnote(o: { installer: string | null; photoQuote: boolean }): string`; keep `QUOTE_CHANGES_FOOTNOTE` as the Ready Check text)
- Modify: `src/lib/owner-quote-email.core.ts`, `src/routes/my-job.$token.tsx` (use it; facts from `photo_quote_submitted` + installer trading name via `loadOwnerQuoteFacts`)
- Modify: `src/lib/ai-answers.core.ts` + where answers are picked (`ai-answers.server.ts`): when the job's installer is "From photos" and the job is with them, Ready Check answers are replaced by: `"{Installer} is preparing your quote from the photos you sent, so there's no Ready Check visit."`
- Test: `tests/quote-changes.test.ts`, `tests/ai-answers.test.ts`

**Interfaces:**
- Consumes: `jobQuoteMethod` (Task 4)
- Produces: `quoteChangesFootnote`

- [ ] **Step 1: Failing tests:** `quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: true })` → `"Your quote uses what No Gap Insulation worked out from your photos."`; `photoQuote: false` → existing text; photos job answers contain no "Ready Check visit" promise; Ready Check jobs unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: photo-quote wording on the quote and in AI replies`

---

### Task 8: Bring back the owner's photo/video upload (reverses #13)

**Files:**
- Modify: `src/routes/estimate_.$token.video.tsx` (optional box under the 3 questions: heading `"Got photos or a video? (optional)"`, buttons `"Add photos"` / `"Add a video"`, using the existing `CaptureUploads`)
- Modify: `src/lib/owner-capture.server.ts` (`startCapture`/`finishCapture` allow optional uploads on an open job whose original media isn't excluded, up to `CAPTURE_MAX_FILES`; the existing excluded/requested rule stays as is)
- Test: `tests/owner-capture.test.ts`

**Interfaces:**
- Produces: `captureStatus` adds `optionalUploadAllowed: boolean`

- [ ] **Step 1: Failing tests:** open job, no media → `optionalUploadAllowed true`; cancelled job → false; job at max files → false; excluded original media without a request → false (unchanged); uploaded file lands as `documents.kind 'intake_media'` so `hasOwnerMedia` sees it.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: optional owner photos/video on the quick questions page again`

---

### Task 10: From photos installers' own jobs (spec Part 2)

**Files:**
- Create: `src/lib/own-photo-quote.core.ts`
- Modify: `src/lib/add-installer-job.core.ts`, `src/lib/add-installer-job.server.ts` (accept the photo-quote fields for "From photos" businesses; save job + measurement + product + `installer_price_set` in one guarded call, then release through `maybeAutoSendInstallerQuote` with the own-customer send-on-press rule)
- Modify: the Add a job screen component (find it from `add-installer-job` callers) — extra fields + live quote box, shown only when the business's `quote_method` is `photos`
- Modify: `src/lib/trade-view.server.ts` + installer job page — read-only quote breakdown for price-seeing people on own customers (Jo 16:50: no quote PDF)
- Test: `tests/own-photo-quote.core.test.ts`, `tests/add-installer-job-photo.test.ts`

**Interfaces:**
- Consumes: `photoQuoteProblems`, `quoteMethodOf` (Task 1); `buildOwnCustomerQuoteDraft(input, piesaIncGst)` (`mitti-installer-quote.core.ts`); installer PIESA price via `safety-check-price.core.ts`; `canEnterPrice`
- Produces: `ownPhotoQuotePreview(i: { priceIncGst: number; installM2: number; piesaIncGst: number | null; postcode: string | null; product: string }): { lines: { label: string; amount: number }[]; ownerPays: number } | { held: string }` built ONLY by calling `buildOwnCustomerQuoteDraft` (no second pricing formula); `OWN_PHOTO_QUOTE_WORDS.feesLine = "We add our $349 AP management fee and the $349 PIESA fee to your price."` (DRAFT; the $349 figures come from the actual amounts, not literals); button `"Add the job and send the quote"`; job page: read-only breakdown (Jo 16:50, no PDF).

- [ ] **Step 1: Failing tests:** preview for price 2400, 80 m², PIESA 349 → lines "Your price $2,400", "PIESA fee $349", "Home Insulation Victoria AP management fee $349", "Rebate −$Y", owner pays = the total `buildOwnCustomerQuoteDraft` returns for the same input; **match test**: for 20 random valid inputs the preview total equals the issued draft quote's `subtotal_inc_gst − veec_discount_inc_gst`; no PIESA price on file → `{ held: "Set this installer's PIESA price first" }`; Add a job for a photos business with `underR2: false` → refused; valid → one job, one current measurement (`external_source 'photo_quote'`), one `installer_price_set`, one draft quote, no Mitti Ready Check form, no will-call send; Ready Check business → old Add a job unchanged (snapshot); the job page breakdown hidden for Crew/Office without Money, shown for the boss (Jo 16:50: no PDF, no two-logo header).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus existing add-installer-job and installer-price tests → PASS.
- [ ] **Step 5: Commit** `feat: From photos installers add their own job with the quote in one step`

**Change round (Jo 5 Nov 16:44 — replaces the 16:10 split-row layout):**
- [ ] **Step 6: Failing tests:** Add a job for a From photos business carries the "Your price" card's ticks (`INCLUDED_OPTIONS`, base tick required, "Other" needs words) and product; sqm to remove > 0 without the removal tick is refused, 0 sqm with it is refused; the ticks reach `installer_price_set` through `validateInstallerPrice` exactly as the card saves them. The live box, the owner's quote and the job page breakdown show the `ownCustomerRows` rows only (Insulation — {what it includes} · Home Insulation Victoria fee · Electrical safety check (PIESA) — charged by Home Insulation Victoria · Rebate · Your price); no split sqm rows. The INSTALLER_PRICE wording is the Ready Check path's (`applyMittiProduct` + `applyMittiRemoval`). The preview-vs-issued match test still runs both real paths on one in-memory database. The PIESA label change applies to `OWN_CUSTOMER_LABELS.piesa` (every own-customer quote); the tax invoice keeps its own label.
- [ ] **Step 7 (Jo 16:49/16:50/16:51):** No quote PDF and no two-logo header: remove "View quote (PDF)", `ownQuotePdfFor`, `getOwnQuotePdf`, `ownQuotePdfBlocks` and their tests; `pdf-look.{core,server}.ts` back to exactly pre-f32be7ed. The installer job page shows the read-only breakdown (`ownCustomerRows`) for the business's own customers to price-seeing people only (`installerJobPageParts` leaves it out otherwise; test: HIV lead → none, only the installer's own pay line may carry a "$").
- [ ] **Step 7b (re-review):** the own photo claim gets a "finished" marker when finishOwnPhotoQuote completes, and any installation quote in any status (or an installer_quote_drafted/held event) counts as finished for older claims — a declined/expired quote is never re-drafted; the tick skips claims under 10 minutes old; the Ready Check form sweep skips a job only when it has an own photo claim (not every job of a From photos business).
- [ ] **Step 8: Commit** per part.

---

### Task 9: Whole-flow check

- [ ] **Step 1:** `bun scripts/scan-retired-terms.ts` → no new hits.
- [ ] **Step 2:** `bun test` → no new failures against the baseline taken before Task 1.
- [ ] **Step 3:** Test Centre TEST run with a TEST "From photos" installer: give a TEST lead with photos → owner notice (test-send) → photo quote → quote drafted (sent if the auto-send switch is on) → $349 → PIESA booked as in-house → Mitti PIESA form exists, no Ready Check form or Ready Check message at any point. A TEST lead without photos is refused with the reason.
- [ ] **Step 4:** `bun run portal-qa` → every gap shown as NOT_RUN, never PASS.
- [ ] **Step 5:** Render the two new emails for Jo to approve (`OWNER_PHOTO_QUOTE_NOTICE_APPROVED`, the photo give email); leave both flags off.
- [ ] **Step 6:** Open the pull request; don't merge. Live SQL (`installer-quote-method.sql`) and setting No Gap to "From photos" wait for Jo.
