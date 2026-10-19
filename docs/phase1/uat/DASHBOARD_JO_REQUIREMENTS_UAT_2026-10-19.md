# Dashboard — Jo's Requirements UAT (2026-10-19)

**Prepared:** 19 Oct 2026 · **Tester:** browser UAT (CDP, authenticated admin@hivic.test)
**Scope assessed:** Phase 1 Office Dashboard usability + outstanding-enquiry email readiness.
**Production:** NOT touched. No emails sent, no records modified, no SQL executed, no publish.

---

## A. Executive summary

The live Preview is **not running the latest code**. Lovable reports **"Build unsuccessful / Preview is out of date"** for every recent GitHub push (`2926b634`, `43efe0ed`, `68ce8bb5`, `f2fa4ca8`, and my `a7499192`). The Preview still renders the older **"JOB PIPELINE"** screen — no section title, no `More views` fold, no per-enquiry `Status:` pill.

What I could measure on the live Preview is enough to confirm Jo's two complaints:
- **It is slow:** 8.2–8.6 s cold, ~4.9 s warm to first usable content; slowest server calls 3.9 s, 3.3 s, 2.2 s. Target ≤ 3 s.
- **It is confusing:** the three desired sections exist, but the page is still titled "JOB PIPELINE" and is surrounded by the legacy *In progress / Needs review / Exceptions / More records* controls and 5 tabs.
- **It has no single clear status:** rows show several competing pills, not one `Enquiry → Spot offered → Spot saved`.

I fixed the in-scope defects and pushed them (`a7499192`, fast-forwarded to `lovable-sync` as `34bd3a33`). The app code **builds successfully locally** (`✓ built in 4.01s`); only Nitro's public-asset copy is blocked by this sandbox (pre-existing `CODEBUDDY_BROKER_DENY`, unrelated to the code). The remaining blocker is **Lovable's own build/sync**, not the application code.

**Verdict: NOT READY** for tomorrow morning *on the currently deployed Preview* — because the live build is stale, slow and still confusing. The fixes are ready and committed but have not yet been proven in a rebuilt Preview.

---

## B. Tested URL and build/commit

| Item | Value |
|---|---|
| App | `https://preview--hi-vic-operations.lovable.app` |
| Tested pages | `/admin`, `/admin/templates`, `/admin?tab=enquiries` |
| Account | `admin@hivic.test` (authorised admin session) |
| Repository | `jetzhang123/hi-vic-operations` |
| `origin/main` at test | `a7499192` (then merged with `lovable-sync` → **`34bd3a33`**) |
| `origin/lovable-sync` | `34bd3a33` (Lovable's build branch) |
| **Preview actually running** | **Stale** — pre-`2926b634`; Lovable says "Build unsuccessful / Preview is out of date" on every recent push |

Evidence the Preview is stale: it still prints `JOB PIPELINE`; `Status:` is absent; `More views` is absent. Those strings are added by `a7499192`.

---

## C. Requirement-by-requirement

Status values: **PASS / PARTIAL / FAIL / BLOCKED / OUT OF CURRENT SCOPE**. A PASS requires browser evidence on a build that contains the change; where the build is stale the item is marked BLOCKED or PARTIAL and the code-level state is noted.

| # | Requirement | Status | Evidence | Gap | Action |
|---|---|---|---|---|---|
| R01 | Customer card information (9 fields) | **PARTIAL** | Rows show address, job no., owner, ceiling/insulation/media facts, stage, next action, waiting-on, coverage, last activity. | No **Office staff assignee** — only installer/electrician assignment exists. Jo needs Lorraine as responsible person. | Add an Office owner field (Phase 2 / workflow) — do not fake it from trade assignment. |
| R02 | Lane counts accurate, not misrepresented | **PARTIAL** | Section counts render (`Enquiries 667 / Active jobs 0 / Closed jobs 22`) but **show 0 while the pipeline loads** (>8 s). | Counts are correct after load but the transient 0 is misleading. | Fixed in code: title/counts load together; verify after rebuild. |
| R03 | Ageing / overdue | **PARTIAL** | Lane header shows `oldest 25d`; rows show `Last activity`. | No explicit 14+/30+ overdue badges; no deadline exists, so "overdue" is not implemented. | Add 14/30-day badges to the status pill (in scope, not yet done). |
| R04 | Search (name/address/email/phone) | **PARTIAL** | Search box filters over **already-loaded** rows (`jobs`), not the whole DB. | Only loaded records are searched; a record outside the loaded page set is not found. | Documented limitation; server-side search is a larger change (Phase 2). |
| R05 | Filters (source/stage/insulation/media/sort) | **PARTIAL** | All five controls exist and combine; Reset exists. Board view does **not** apply text filters. | Client-side filtering; board text-filter gap confirmed. | In-scope note added; board filter parity is a UI fix for a later pass. |
| R06 | Bulk actions | **PARTIAL** | Select-all, selection count, confirm dialog, reason, skipped feedback; actions: hold / cancel / mark test / delete. No bulk communications. | Jo's bulk *communication* capability is not present. | Already scoped out of Phase 1 UI; report only. |
| R07 | Email history at a glance | **PARTIAL** | Per-record `RecordDetail` shows last email, failed attempt and full history — but only after opening the record. | Not visible on the row. | Fixed in code: `Status:` pill on every row (see E). Verify after rebuild. |
| R08 | One-click next actions | **PARTIAL** | Rows link straight to the job record; next action text is shown. | Actions themselves live on the job page, not the row. | Acceptable for Phase 1; note as PARTIAL. |
| R09 | Duplicate records | **PASS (observed)** | 667-row enquiry list rendered without duplicate job numbers in the visible rows. | Not exhaustively proven across all 1,702 records. | Keep an eye after rebuild. |
| R10 | Central email templates | **PARTIAL** | `/admin/templates` loads: "Every email, Mitti form and compliance wording in one place" — Email 27, Mitti 4, Compliance 17; Jo's approved homeowner emails listed. | Competing surfaces remain (`/admin/communications`, campaign emails, enquiry email groups). | Consolidation is a separate cleanup; do not delete templates. |
| R11 | Dashboard performance | **FAIL** | 8.2–8.6 s cold, 4.9 s warm; slowest server fns 3.9 s / 3.3 s / 2.2 s; 118–119 requests, ~300 KB. Target ≤ 3 s. | Live build far above target. Root cause identified (below). | Perf fix committed (`a7499192`); must be measured on a rebuilt Preview. |
| R12 | Outstanding enquiry emails (read-only) | **BLOCKED** | Dashboard: **Awaiting 542 · Sent 458 · Failed 1 · Manual review 0 · No email 0 · Ready to send 0**. | Cannot read service-role tables (`customer_email_sends`, `customer_estimate_links`) from the browser; the "Ready to send 0" bug is diagnosed from code. | Fix committed (`f2fa4ca8`); delivery evidence requires service-role SQL (provided). |
| S1 | 3 top-level sections (Enquiries / Active jobs / Closed jobs) | **PARTIAL** | Section nav exists and counts render; **but** the page is still titled `JOB PIPELINE` and the legacy view row is still visible. | Fix committed: section title + collapsed `More views`. | Verify after rebuild. |
| S2 | One clear status per enquiry (Enquiry → Spot offered → Spot saved) | **FAIL (current build)** | Rows show multiple pills, no single status. | Canonical `enquiryStatus()` exists but was only used on the Enquiry-groups page. | Fix committed: `Status:` pill on every row. Verify after rebuild. |
| S3 | Full workflow restructure (Ready Check/install stages, Office-to-Confirm actions) | **OUT OF CURRENT SCOPE** | Existing stages remain; no restructuring attempted. | Requires workflow/DB redevelopment. | Phase 2. |

---

## D. Performance results (live Preview, stale build)

| Metric | Value | Observation |
|---|---|---|
| Cold load → usable content | **8.2 – 8.6 s** | 2 cold runs (first visit / hard reload) |
| Warm load → usable content | **~4.9 s** | Best observed |
| Slowest server function | **3.9 s** (137 KB) | `getAdminPipeline` (all `job_overview` rows + enrichment) |
| 2nd / 3rd slowest | **3.3 s / 2.2 s** (144 KB) | Dashboard data calls |
| Duplicate auth calls | 1.9 s + 1.5 s | `/auth/v1/user` fetched twice |
| Network requests | 118 – 119 (22 server functions) | ~293–302 KB |
| Console errors | none (only Lovable `postMessage` origin warnings) | — |
| Target | ≤ 3 s usable, ≤ 1 s search/filter | **FAIL on live build** |

**Data volume driving the load:** `job_overview` **1,702 rows**; current `indicative_estimates` **1,323**; active `job_assignments` **274**; confirmed `bookings` **98**; intake `documents` **368**; open enquiries **1,253**; Save-my-spot candidates **264** (263 with a current estimate).

**Root cause of slowness (measured + code):** `getAdminPipeline` performs ~11 bulk reads per load, including **every `messages` row** (only needed for jobs with an active trade assignment) plus all bookings, assignments, documents, evidence files and estimates. `job_overview` is fetched in full on every load.

**Fix applied (not yet measurable):** messages are now fetched only for jobs that have an active trade assignment (the only ones `commsStatus` reads). `job_overview` payload is already column-trimmed. Server-side pagination of the list is the next step if still > 3 s after rebuild.

---

## E. Bugs found and fixed (committed; awaiting a successful Preview build)

1. **Backlog sends permanently blocked — "Ready to send 0"** (`f2fa4ca8`)
   `sendableFrom()` and `sendOne()` both required an **already-active** `customer_estimate_links` row, but only `syncStep3` (Gate 1 / intake) creates one and the link TTL is **30 days**. Historical links expire and are never renewed → all 264 candidates unsendable. Fixed by adding `ensureEstimateLinks()` (calls `syncStep3`, never sends) and calling it in `dispatchEnquiryBacklog()` and `retryFailedEnquirySend()` immediately before sending. `sendableFrom()` no longer demands a pre-existing link.
2. **No single status per enquiry** (`a7499192`)
   `getAdminPipeline` now derives Jo's canonical `office_status` (`enquiryStatus`) from existing send + campaign-response records; `StaffJobRow` renders it as the first, bold `Status:` pill.
3. **Dashboard still read as "JOB PIPELINE"** (`a7499192`)
   The page title now names the section (`ENQUIRIES` / `ACTIVE JOBS` / `CLOSED JOBS`); the legacy *In progress / Needs review / Exceptions / More records* row is folded into a collapsed **More views** block.
4. **Every message row loaded on the dashboard** (`a7499192`)
   `messages` are fetched only for jobs with an active trade assignment.

**Automated checks:** `tests/enquiry-dispatch-link-renewal.test.ts` (8 pass) + `tests/portal-presentation.test.ts` + `tests/estimatelink.test.ts` (21 pass) = **29 pass, 0 fail**. Local production build compiles (`✓ built in 4.01s`); only Nitro public-asset copy fails in this sandbox (`CODEBUDDY_BROKER_DENY`, pre-existing).

---

## F. Unresolved in-scope defects

1. **Lovable build is failing for every recent push** → Preview is out of date. This is the gating blocker; it is **not** an application-code error (local build compiles). Likely the active Lovable editor session / sync-branch review.
2. **Live Preview performance not yet re-measured** after the messages-scoping fix (needs a successful rebuild).
3. **Overdue (14+/30-day) badges** are still not shown (ageing "oldest Nd" exists).
4. **Board view does not apply text filters** (confirmed).

---

## G. Out-of-scope workflow requirements

- Full stage restructure to Jo's Enquiries/Active-jobs/Closed-jobs lifecycle with Ready Check / Quote / PIESA / Install sub-stages.
- Office "responsible person" assignment.
- Office-to-Confirm actions (Eligible → Offer Spot / Need more info / Ineligible + reason) as a single workflow.
- Server-side search across all enquiries.
- These require workflow/backend redesign and were not authorised in the Dashboard UI task.

---

## H. Outstanding-enquiry email readiness (read-only)

| Bucket | Count | Meaning |
|---|---|---|
| Sent | 458 | A confirmed send exists (`customer_email_sends.status ∈ sent/delivered_unrecorded`) |
| Awaiting | 542 | Open, has email, no confirmed send, not suppressed/in-flight |
| Failed | 1 | A failed send recorded, no later success |
| Manual review | 0 | Review-required enquiries in the actionable queue |
| No email | 0 | No owner email on record |
| Ready to send (now) | **0** | **Bug** — expired links; fixed by `f2fa4ca8` |

- **Do not read "Sent 458" as "458 correct initial responses"** — it counts any confirmed send for the job, not necessarily the purpose-specific initial reply.
- **Automatic routing is configured** for *new* enquiries (`lead-email-routing` → `syncStep3` → `sendInitialEstimateEmail`).
- **Duplicate protection exists** (per-home idempotency key + atomic re-reserve on retry).
- Delivery evidence was **not** readable from the browser (service-role tables). Use `P1_EMAIL_DIAGNOSTIC.sql` for the authoritative answer.

---

## I. Final GitHub commit

- `main`: **`34bd3a33`** (merge of `a7499192` + `lovable-sync` head)
- `lovable-sync`: **`34bd3a33`**

---

## J. Final verdict

**NOT READY** — on the currently deployed Preview.

Rationale (per the agreed rule: do not mark Phase 1 ready if critical Dashboard functions are broken or unusably slow):
- The live Preview is **slow** (8 s cold / 4.9 s warm vs 3 s target) and **still confusing** (JOB PIPELINE title, legacy views, no single status).
- The latest fixes are committed but **not deployed**, because Lovable's build is failing for every recent push.

**Exactly what is needed to finish:** in Lovable, open the project → **"Review sync"** and resolve the failing build so the Preview rebuilds `34bd3a33`. Then re-run the three performance measurements and confirm the `Status:` pill and three-section title. I can do that verification immediately once the Preview serves the new build.

Phase 2 workflow restructuring is explicitly **out of scope** and is not the reason for this verdict.
