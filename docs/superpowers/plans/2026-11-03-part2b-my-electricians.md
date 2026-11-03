# Part 2b — Installers add their own electricians — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installer boss adds an electrician in My business › My electricians, with their details and documents. Our office checks and approves. The electrician is then linked to that installer and can be picked on that installer's jobs. The electrician fills nothing in.

**Architecture:** A light "installer-added electrician" path, separate from the public electrician sign-up:
- It creates a pending `rec` business, a pending electrician `partner_workers` row, pending `business_credentials` (licence, REC, public liability, and WorkCover or a no-staff declaration) and an INACTIVE `partner_relationships` row to the installer.
- The office approves with its own checklist. It needs no HIV agreement and no service areas, because these electricians only work on that installer's jobs and the installer is HIV's subcontractor.
- Approval verifies the credentials, approves the business and the person (`approvePartnerWorker`, which also triggers the existing Mitti hook), activates the link and sends a welcome text.
- If an approved electrician already matches (licence or email), the installer's link is simply turned on. Nothing new is created.

**Tech Stack:** TypeScript, TanStack routes, Supabase admin client, storage bucket `job-files`, Bun test + PGlite, pending-migration SQL.

**Spec:** `docs/superpowers/specs/2026-11-03-deep-first-job-design.md` (Part 2b)

## Global Constraints

- **Boss only:** only an installer boss can use these functions (`bossOrThrow` + `kind === "installer"`). The installer business id comes from the session, never from the client.
- **Required fields:**
  - name, email, mobile, REC number;
  - licence: number, expiry (must be in the future) and a photo or PDF;
  - public liability: certificate file, cover amount (≥ $5,000,000) and expiry (must be in the future);
  - WorkCover: answer "Does this electrician employ anyone, including themselves through a company?" Yes → WorkCover certificate and expiry (in the future) required. No → the tick "Sole trader with no staff — no WorkCover needed" is required.
- **Hard block:** a missing or expired licence or insurance blocks approval, and the office cannot override it.
- **What approval means:** an installer-added electrician is approved for that installer's own jobs only. They are never offered HIV leads.
- **Matching:** a match on an existing APPROVED electrician (`normaliseLicence` on any worker licence, or `sameWorkerEmail`) just activates the installer link, with no re-upload. A match on a pending or rejected one is refused: "This electrician is already waiting for approval".
- **Welcome text:** a new SMS type, held (`wordingApproved:false`) until Jo approves the wording.
- **Messages:** trade messages pass `{ businessId: recipient, jobId }` to the pause check. Installer offices are emailed, never texted.
- **Database:** new columns ship as pending SQL plus undo. Code fails closed until it's applied. Ask Jo before applying.

## Review Focus

1. An installer uploads a file then abandons the form → no business is created (files sit under the installer's own folder only). Test in Task 2.
2. The same electrician is added twice by the same installer → the second call refuses: "Already on your list". Test in Task 2.
3. The licence expires after approval → the existing expiry checks block the electrician on new jobs (`workerOfferBlocker`). Add the licence to the business-doc blocking list if it isn't there yet. Test in Task 4.
4. Two installers add the same new electrician → the second gets "already waiting for approval", and after approval the office can link the second installer too (existing office `setPartnerRelationship`). Test in Task 2.
5. The office rejects → the installer's list shows "Not approved: {reason}", and the installer can fix it and resubmit. Test in Task 4.

---

### Task 1: Pending SQL + pure rules

**Files:**
- Create: `docs/pending-migrations/2026-11-03_installer_added_electricians.sql` (+ `.undo.sql`):
  - `businesses.added_by_installer_business_id uuid null references businesses(id)`
  - `businesses.workcover_exempt_declared_at timestamptz null`
  - `businesses.installer_added_rejected_reason text null`
- Create: `src/lib/my-electricians.core.ts`
- Test: `tests/my-electricians.core.test.ts`

**Interfaces:**
- Produces:
  - `type AddElectricianInput = { name; email; mobile; recNumber; licenceNumber; licenceExpiry: string /*YYYY-MM-DD*/; licenceFilePath; plFilePath; plAmount: number; plExpiry; employsAnyone: boolean; workcoverFilePath?: string|null; workcoverExpiry?: string|null; soleTraderTick?: boolean }`
  - `addElectricianProblems(i: AddElectricianInput, today: string): string[]`. Plain messages, one per problem:
    - "Add their name", "Add their email", "Add their mobile", "Add their REC number"
    - "Add their licence number", "Licence expiry must be in the future", "Add a photo of their licence"
    - "Add the public liability certificate", "Public liability must be at least $5 million", "Public liability expiry must be in the future"
    - "Add the WorkCover certificate", "WorkCover expiry must be in the future"
    - "Tick that they're a sole trader with no staff"
  - `type MyElectricianStatus = "waiting" | "approved" | "expired" | "not_approved"` and `myElectricianStatus(f: { onboardingStatus; workerApproval; rejectedReason; licenceExpiry; plExpiry; workcoverExpiry; workcoverExempt; today }): MyElectricianStatus`
  - `approveChecklist(f): string[]` for the office. Each credential must be present and unexpired, the PL ≥ $5m, the REC number set, and WorkCover present or declared exempt.

- [ ] Step 1: Failing tests. One case per problem message in `addElectricianProblems`; employsAnyone=false with no tick → the tick message; employsAnyone=true with no file → the WorkCover message; a status table; `approveChecklist` with an expired PL → "Public liability has expired".
- [ ] Step 2: Run `bun test tests/my-electricians.core.test.ts` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(my-electricians): rules for installer-added electricians`

### Task 2: Installer adds an electrician

**Files:**
- Create: `src/lib/my-electricians.server.ts`, `src/lib/my-electricians.functions.ts`
- Test: `tests/my-electricians.pglite.test.ts`

**Interfaces:**
- Consumes: Task 1; `bossOrThrow` (trade-view.server.ts:92); `normaliseLicence`, `sameWorkerEmail`.
- Produces:
  - `myElectricianUploadUrl(userId, kind: "licence"|"pl"|"workcover", fileName): Promise<{ path; signedUrl }>`. The path is `partners/{installerBusinessId}/electrician-uploads/{uuid}-{safeName}` in `job-files`.
  - `installerAddElectrician(userId, input: AddElectricianInput): Promise<{ result: "added" | "linked" ; businessId: string }>`:
    - Validates with `addElectricianProblems`.
    - Every file path must start with the caller's own `partners/{installerBusinessId}/electrician-uploads/` prefix.
    - Matches approved electricians first; a match → upsert `partner_relationships` active=true → "linked".
    - Otherwise it inserts, in one RPC-free sequence with clean-up on failure:
      - `businesses` (business_type 'rec', capabilities ['electrician'], name, email, phone, rec_number, onboarding_status 'submitted', is_active false, added_by_installer_business_id, workcover_exempt_declared_at)
      - `partner_workers` (trade_role electrician, full_legal_name, email, mobile, licence_number, licence_expires_on, approval_status 'pending')
      - `business_credentials` pending: `electrical_licence` (number, expiry, file), `rec_registration` (number), `public_liability_insurance` (amount, expiry, file), `workers_comp_insurance` if employsAnyone
      - `partner_relationships` (installer, electrician, active=false, source 'installer_added')
    - Logs one `installer_added_electrician` admin_config_event.
- Refusals:
  - "Already on your list" (same installer, same electrician)
  - "This electrician is already waiting for approval" (pending match)
  - non-boss → forbidden

- [ ] Step 1: Failing PGlite tests:
  - an add creates the 4 kinds of row with pending states and an inactive link;
  - a match on an approved electrician → "linked", the link is active, no new business;
  - a duplicate from the same installer is refused;
  - a second installer adding the same pending electrician is refused;
  - a file path outside the caller's prefix is refused;
  - non-boss is refused;
  - an abandoned upload creates no rows (Review Focus 1, 2, 4).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS. Also run `bunx tsc --noEmit -p .`.
- [ ] Step 5: Commit `feat(my-electricians): installer adds an electrician`

### Task 3: My electricians screen

**Files:**
- Create: `src/routes/_authenticated/field.business_.electricians.tsx`, `src/components/trade/my-electricians.tsx`
- Modify: `src/routes/_authenticated/field.business.tsx` (a "My electricians" FileRow for installers, under "My usual electrician"), `src/lib/my-electricians.server.ts` (`installerMyElectricians(userId)`)
- Test: `tests/my-electricians-list.pglite.test.ts`

**Interfaces:**
- Produces: `installerMyElectricians(userId): Promise<{ id; name; status: MyElectricianStatus; reason: string|null; licenceExpiry; plExpiry }[]>`. Every active-or-pending link for the caller's installer, both added and linked.
- Screen:
  - A list with status chips: "Waiting for approval" / "Approved" / "Expired — update their documents" / "Not approved: {reason}".
  - An "Add an electrician" form: the fields from Task 1; file pickers that use `myElectricianUploadUrl`; the WorkCover question with conditional fields or the tick.
  - Errors are shown inline from `addElectricianProblems`.
  - Plain words: "Home Insulation Victoria" in full.
  - Computer-friendly (the boss uses a computer) and still works on a phone.

- [ ] Step 1: Failing test: the list shows waiting, approved and not-approved rows with the right status and reason, and none from other installers.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement the server list and the UI.
- [ ] Step 4: Run → PASS. tsc.
- [ ] Step 5: Commit `feat(my-electricians): My electricians list and add form`

### Task 4: Office approves or rejects

**Files:**
- Modify: `src/lib/office-needs.core.ts` / `.server.ts` / `needs-cards.core.ts` (item: "Approve electrician {name} — added by {installer}"), `src/lib/my-electricians.server.ts`
- Create: an office server function in `src/lib/my-electricians.functions.ts` (admin only)
- Modify: `src/lib/trade-expiry.core.ts`, adding `electrical_licence` to `BLOCKING_BUSINESS_DOCS` if it's missing (Review Focus 3)
- Create: SMS type `installer_added_electrician_welcome` in `src/lib/sms.core.ts` (`audience:"partner"`, `wordingApproved:false`, quietHours true). Draft wording: "Hi {first name}, {installer} has added you as their electrician with Home Insulation Victoria. They'll send you jobs to book. Cheers, the Home Insulation Victoria team"
- Test: `tests/my-electricians-approve.pglite.test.ts`

**Interfaces:**
- Produces:
  - `officeApproveInstallerElectrician(actorId, businessId): Promise<void>`:
    - Runs `approveChecklist`. Any problem → throw with the list; there is no override.
    - Sets all the credentials to verification 'verified' (verified_by/at).
    - Sets the business onboarding_status 'approved', is_active true, approved_by/at.
    - Calls `approvePartnerWorker(workerId, actorId, {kind:"office"})`.
    - Sets the `partner_relationships` row to active=true.
    - Sends the welcome text once (stable key), passing `{ businessId: electrician, jobId:null }` to the pause check.
  - `officeRejectInstallerElectrician(actorId, businessId, reason: string)`. Sets onboarding_status 'rejected' and installer_added_rejected_reason, keeps the link inactive, and emails the installer office (held wording: "{name} wasn't approved: {reason}. Fix it in My electricians.").
  - `installerResubmitElectrician(userId, businessId, input)`. Updates the details and documents, puts it back to 'submitted' and clears the reason.
- The office "Open" goes to the existing partner business page, with an Approve/Reject card for installer-added electricians.
- Installer-added electricians never get HIV leads: exclude `added_by_installer_business_id is not null` from HIV electrician offer candidates.

- [ ] Step 1: Failing tests:
  - approve → the business is approved and active, the worker is approved, the link is active, the credentials are verified, one welcome text is recorded;
  - approve with an expired PL → refused, nothing changed;
  - reject → status and reason set, one installer email, the link inactive; resubmit → back to waiting;
  - an approved installer-added electrician is NOT in the HIV-lead offer candidates;
  - a licence expired after approval → blocked by the expiry check.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(my-electricians): office approves or rejects installer-added electricians`

### Task 5: Pickable on the installer's jobs

**Files:**
- Modify: wherever Add a job / the job-page swap list the installer's electricians (`swapOptions` in electrician-swap.server.ts; the Add a job electrician choice, electrician-choice.core / onsite-ready-check.server.ts)
- Test: `tests/my-electricians-pickable.pglite.test.ts`

- [ ] Step 1: Failing tests: an approved, linked, installer-added electrician appears in the swap options and can be chosen at Add a job, with `rateNotNeeded` because the installer pays its own electricians; a waiting one does not appear.
- [ ] Step 2: Run → FAIL (or PASS if it already works; then keep the test as the guarantee).
- [ ] Step 3: Make the smallest change needed.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(my-electricians): approved electricians pickable on the installer's jobs`

### Task 6: Wording, PR

- [ ] Step 1: Add the welcome text and the rejection email to `docs/wording/2026-11-03-part2b-messages.md` for Jo (held).
- [ ] Step 2: tsc, plus every new and touched test file, one at a time.
- [ ] Step 3: Push the branch and open a PR. After merging, ask Jo before applying the SQL. Show her the 2 messages one at a time.
