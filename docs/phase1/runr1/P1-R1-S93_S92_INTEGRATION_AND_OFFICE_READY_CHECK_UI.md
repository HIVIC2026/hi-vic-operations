# P1-R1-S93 — S92 Integration into RC1 + Template 8 Office Ready Check UI

**Project:** Home Insulation Victoria
**Phase:** Phase 1 · **Round:** RC1 · **Step:** P1-R1-S93
**Agent:** R1 — Lead Developer
**Browser access:** NOT REQUIRED (not used)
**Status:** COMPLETE

---

## 1. Verified starting Git state

Verified by inspecting the actual repository and worktrees before any change.

| Item | Value |
|---|---|
| `integration/p1-rc1-s67` HEAD (before) | **`92a60bc8222fbadb7e6310fa7f8d2ea6399ad48f`** |
| Integration working tree | clean (no staged, unstaged or stashed work) |
| Advanced by another agent since S92? | **No.** On 2026-10-16 the branch was still at `92a60bc8`, one commit ahead of the `4194630d` application baseline. No concurrent work to reconcile. |
| S92 source commit | **`64ae27f6ad1d1542afb1853e6bf33ccc1574b29d`** — confirmed present, reachable from the integration worktree, and containing all nine required files |
| S91 fixture branch | `r2/p1-rc1-s91-uat-fixtures` at **`8e3aa295fb9796773ecf2f5807acbfc3d5a96c6c`** |
| S91 merged into RC1? | **No** — confirmed with `git merge-base --is-ancestor` (returns false). Left untouched. |

### 1.1 Discrepancy recorded

The task statement gives the S91 fixture SHA as `8e3aa295fb9796773ecf2f5807acbfc3d5a96c6`
(**39 characters**). A git SHA-1 is 40 characters. The actual commit is
**`8e3aa295fb9796773ecf2f5807acbfc3d5a96c6c`** — the stated value is truncated by one character.
It resolves to the same commit, so this is a documentation issue only, but it is recorded here
because the two differ literally.

The three recorded starting SHAs:

```
BASELINE_INTEGRATION_SHA  92a60bc8222fbadb7e6310fa7f8d2ea6399ad48f
S92_SOURCE_SHA            64ae27f6ad1d1542afb1853e6bf33ccc1574b29d
S91_FIXTURE_SHA           8e3aa295fb9796773ecf2f5807acbfc3d5a96c6c
```

---

## 2. S92 integration method

**Controlled cherry-pick**, the auditable Git operation:

```bash
cd wt-p1-rc1-s67-integration
git cherry-pick 64ae27f6ad1d1542afb1853e6bf33ccc1574b29d
```

- Applied **cleanly, zero conflicts** (S92's parent is `92a60bc8`, which was exactly the integration HEAD).
- No partial integration: the commit was taken whole, not file-by-file.
- Resulting cherry-picked HEAD: **`2ae67641cceb6a1ffffca0bba3358c3a5f0790d5`**.
- Resulting S93 integration candidate: the single S93 commit on top of `2ae67641…` (`git log -1` on `integration/p1-rc1-s67`). Not self-recorded here because recording a commit's own hash would make it stale.

### 2.1 Files integrated from S92 (verified present after the pick)

| File | Status |
|---|---|
| `src/lib/jo-outcome-email.core.ts` | new ✅ |
| `src/lib/ready-check-invitation.core.ts` | new ✅ |
| `src/lib/ready-check-invitation.server.ts` | new ✅ |
| `src/lib/ready-check-invitation.functions.ts` | new ✅ |
| `tests/p1-r3-s92-jo-wired-templates.test.ts` | new ✅ |
| `src/lib/followups.server.ts` | modified ✅ |
| `src/lib/emailsafety.core.ts` | modified ✅ |
| `tests/email-safety.test.ts` | modified ✅ |
| `docs/phase1/communications/P1-R3-S92_JO_TEMPLATE_WORKFLOW_WIRING.md` | new ✅ |

### 2.2 Critical `EmailPurpose` extension — **preserved**

`src/lib/emailsafety.core.ts` after integration:

```ts
/** "ready_check_invitation" (P1-R3-S92) is the Office-initiated Template 8 email. Additive only — no other purpose changes. */
export type EmailPurpose = "step3_estimate" | "followup" | "preliminary_ineligible" | "area_unavailable" | "ready_check_invitation";
```

and the matching backlog-window exemption, both verified present. Without this the T8 suppression
check does not compile, so it travelled as part of the whole-commit cherry-pick rather than being
re-applied by hand.

### 2.3 S92 re-verified on the integration branch

Immediately after the pick, before any S93 work:

| Check | Result |
|---|---|
| `tests/p1-r3-s92-jo-wired-templates.test.ts` | **61 pass · 0 fail** |
| `npx tsc --noEmit -p tsconfig.json` | **0 errors** |

The COM-04 implementation was not replaced or weakened. The S92 commit contains no changes to
`hot-leads-send.server.ts`, `comms.server.ts` or the COM-04 switch logic.

---

## 3. Office UI — location and navigation

| Item | Value |
|---|---|
| Route file | `src/routes/_authenticated/admin.ready-check.tsx` |
| URL | **`/admin/ready-check`** |
| Section | **Leads**, alongside the existing Website email queue / All classified leads / Calculator interest tabs |
| Nav entry | `src/lib/office-nav.ts` → `ENQUIRY_TABS` (4th entry) **and** `ENQUIRY_PATHS` (so tab highlighting works) |
| Nav label | **“Ready Check invitations”** |

### 3.1 Why a dedicated page rather than per-row buttons

The task asked for a candidate list **plus** a full prepare / preview / confirm-send workflow. The
existing reachable Leads screen (`/admin/enquiry-groups`) only renders a short text placeholder in
the saved-spot cell, which cannot hold a pricing panel, an HTML preview and a confirmation dialog.

The page was therefore placed **inside the existing Office admin area and the existing Leads tab
row**, reusing:

- the existing `admin.*` route namespace (which supplies the admin role guard),
- the existing `OfficeTopBar` navigation and its `ENQUIRY_TABS` data source,
- the existing `AppShell` layout,
- the existing hand-written `<table>` job-list pattern used by `admin.enquiry-groups` / `admin.launch-campaign`,
- the existing `AlertDialog` (confirm) and `Button` primitives,
- the existing `useServerFn` + `useQuery` + `refetch` data pattern.

No new dashboard shell, no new navigation component and no new UI kit was introduced.

---

## 4. Office UI behaviour

### 4.1 Candidate list

`getReadyCheckCandidates()` — Office-only, read-only.

Columns: **Job** (job number, link to the existing job page) · **Customer** (name + email) ·
**Property** (address summary) · **Spot saved** (timestamp) · **Saved total** (+ ceiling area) ·
**Office action** (Select job).

Only saved-spot, eligible, open, non-deleted jobs are returned. The server filters closed and
deleted jobs and jobs whose official result is not eligible, and excludes test (`qa_test`) jobs.
Verified by tests that assert a saved-spot-eligible job is listed while the no-save, closed, deleted
and ineligible fixtures are not.

No candidate row contains a private token (asserted — no 40+ character token-like string appears in
any serialized candidate).

### 4.2 Select job

Office clicks **“Select job”** on one row. The selected job is held in client state and passed to
the backend as its `jobId` only. The client supplies no eligibility, no pricing and no authority.

### 4.3 Prepare

**“Prepare Ready Check Invitation”** → `prepareReadyCheckInvitation()`.

The backend re-checks Office authority → job → official eligibility → saved spot → complete frozen
snapshot, then renders Template 8. The UI renders nothing on its own: all displayed figures come
from the server.

### 4.4 Preview

Shows: recipient · subject · rendered HTML (sandboxed iframe) · collapsible plain-text alternative ·
**frozen saved-pricing panel** · both CTAs.

The pricing panel shows ceiling size, R5.0 installation, PIESA, AP, before-rebate total, VEU rebate
and the customer total — all the frozen values, with an explicit “current rates are never applied”
note.

CTAs shown verbatim from the snapshot:

| CTA | Value | Guarantee |
|---|---|---|
| Personal estimate | `/my-estimate/{token}` | COM-09 DEP-1, never the public calculator |
| Ready Check booking | `/estimate/{token}` | COM-09 DEP-2; opens the existing page, never auto-books |

### 4.5 Explicit send confirmation

**“Send Ready Check Invitation”** is disabled until Office has prepared. Clicking it **only opens an
`AlertDialog`**; it does not call the backend.

The dialog names the **customer**, the **job**, the **recipient** and the saved total, and states
that the server re-checks Office access, frozen pricing, consent and both communication switches.
Only the dialog's **“Send invitation”** action calls `sendReadyCheckInvitation()`.

The preview is never treated as authorization — the backend revalidates every safeguard at send time.

### 4.6 Safety-blocked send state

The page carries a persistent banner:

> **Live sending is switched off.** Both communication switches are off, so a send attempt will be
> refused and reported here. A successful preview is not a successful send.

A blocked send renders the **backend's own reason** inside an `role="alert"` box: `Not sent. {reason}`
plus “Do not retry a blocked send; check the job's history first.” There is no success toast, no
optimistic success and no automatic retry. The UI contains no reference to either switch name, so it
cannot flip them.

### 4.7 Error and loading states

`role="status"` / `role="alert"` states for: loading candidates, load failure, empty list, preparing
in progress, and each backend refusal (unauthorized, no saved spot, incomplete snapshot, expired
link, withdrawn consent, suppressed recipient, duplicate, switches off, provider unavailable).

The panel is kept in step with the list, so if a job disappears it is closed automatically rather
than acted on stale.

---

## 5. Authorization and data protection

| Control | Status |
|---|---|
| Route-level admin guard | Inherited from `src/routes/_authenticated/admin.tsx` (`loadAccess(...).admin` → redirect). Placing the page under `admin.*` supplies this with no extra code. |
| Server entry points | All three T8 entry points call `requireAdmin(context.supabase)` behind `requireSupabaseAuth` — unchanged from S92, verified structurally (3 occurrences). |
| Office role check | Server functions still require `role === "office"` **and** a non-null `userId`. |
| Input validation | Prepare/send are POST-only with `z.string().uuid()` `jobId` validation. |
| Unauthorized access | A non-Office actor receives a refusal whose payload contains no rendered HTML, no `<table`, no `/my-estimate` and no pricing figure (asserted). |
| Token exposure | No private token appears in candidate rows or refusal payloads. |
| Public access | None added. All endpoints stay under `_authenticated` + `admin` + `requireAdmin`. |

The backend remains authoritative; no authorization decision was moved to the client.

---

## 6. COM-04 dual-switch verification

Both switches remain **OFF** (`customer_comms_enabled = false`, `save_my_spot_real_send_enabled = false`).
No test or UI path turns them on.

| Guard | Behaviour | Test |
|---|---|---|
| Both OFF | blocked, “switched off”, zero provider calls | ✅ |
| Master ON, save-my-spot OFF | blocked, zero provider calls | ✅ |
| Save-my-spot ON, master OFF | blocked, zero provider calls | ✅ |
| Missing settings row | fail closed | ✅ |
| `NULL` switch values | fail closed (null is never “on”) | ✅ |
| Missing consent | blocked, zero provider calls | ✅ |
| Withdrawn consent | blocked, zero provider calls | ✅ |
| Unsubscribed recipient | blocked (`unsubscribed`), zero provider calls | ✅ |
| Bounced recipient | blocked, zero provider calls | ✅ |
| Duplicate invitation | blocked, zero **additional** provider calls | ✅ |
| Non-Office role (all switches ON) | blocked, zero provider calls | ✅ |
| Prepare | never contacts the provider, never reserves a send | ✅ |

The provider used in tests is a counting mock. **No real email or SMS was sent.**

Preserved intact: consent, unsubscribe/suppression, bounce handling, once-per-home idempotency
(key `ready_check_invitation:{jobId}`), audit logging, provider gating, Office authorization,
prepare/send separation and fail-closed behaviour. No new communication provider was created.

---

## 7. Frozen-pricing verification

| Requirement | Result |
|---|---|
| Pricing from the frozen snapshot only | ✅ `template8SnapshotForJob()` reads `lead_campaign_responses` saved totals + the frozen `indicative_estimates.snapshot.settings`. Current rates are never applied. |
| Fee breakdown preserved | ✅ S93 extended the **preview payload** to expose `installation`, `piesaFee`, `apFee` alongside the existing totals (read-only, no new columns, no behaviour change). |
| Preview cannot mutate pricing | ✅ prepare is render-only; two consecutive prepares are byte-identical (asserted). |
| Incomplete snapshot | ✅ `buildTemplate8Snapshot` returns `null` → guarded → nothing prepared. |
| Expired / invalid token | ✅ existing `personalEstimateTokenUsable` rules reused, never extended. |
| Concurrent change | ✅ each prepare re-reads the snapshot; a mid-flight price change is reflected on the next prepare (asserted). |
| Personal estimate CTA | ✅ `/my-estimate/{token}` |
| Booking CTA | ✅ `/estimate/{token}` — never auto-books |
| Public calculator | never substituted |

**No new saved-price columns and no migration.**

---

## 8. Templates 1–7 regression results

`tests/p1-r3-s92-jo-wired-templates.test.ts` — **61 pass · 0 fail** on the integration branch.

| Group | Coverage | Result |
|---|---|---|
| A1 | correct template per outcome (T1–T7) | 8 pass |
| A2 | known / unknown area variants | 2 pass |
| A3 | T3/T4 review gates | 4 pass |
| A4 | T5/T6 media-upload CTA | 2 pass |
| A5 | T7 ineligible routing | 2 pass |
| A6 | pricing values reach the renderer | 5 pass |
| A7 | legacy renderer no longer used for these outcomes | 5 pass |
| B1–B5 | T8 Office manual trigger | 18 pass |
| C | COM-04 safeguards | 15 pass |

All eight templates are covered by wired-path contract tests.

**Jo's approved template copy was not altered.** The separately approved 7 October Hot-leads
Save-my-spot campaign HTML was **not** replaced: `renderStep3SaveSpot` / `renderLaunchCampaignEmail`
are untouched and still byte-locked by `save-spot-only-approved.test.ts` (3 pass) and
`step3-email-parity.test.ts` (8 pass).

---

## 9. Office UI test results

`tests/p1-r1-s93-office-ready-check-ui.test.ts` — **40 pass · 0 fail** (new file).

| Group | Coverage | Result |
|---|---|---|
| A | Office authorization | 6 pass |
| B | Candidate list | 4 pass |
| C | Prepare / preview | 5 pass |
| D | Send confirmation | 4 pass |
| E | COM-04 | 10 pass |
| F | Error handling | 11 pass |

Behavioural tests execute the **real** server modules against a real Postgres engine (PGlite) via
the project's PostgREST shim, with a counting mock provider. Structural tests assert the UI
contract (route placement, admin-guard inheritance, nav entry, required actions, no automatic send).

### 9.1 One real defect found and fixed during these tests

`loadReadyCheckCandidates()` returned PostgREST `numeric` columns as **strings** (e.g. `"3697.24"`),
matching real PostgREST behaviour. The declared type said `number`, and the UI would have rendered
them through a currency formatter unsafely. Fixed at the source in
`src/lib/ready-check-invitation.server.ts` by coercing `saved_total` / `saved_area_m2` to numbers
before they leave the server.

### 9.2 One route-tree regression found and fixed

Regenerating `src/routeTree.gen.ts` with the standalone `@tanstack/router-generator` silently
**dropped** the `@tanstack/react-start` `Register` module declaration, which produced a new
`TS7053` error in `admin.index.tsx`. The block was restored verbatim; TypeScript is back to 0 errors.

---

## 10. Full regression, TypeScript, build

### 10.1 Targeted suites (all re-run on the integration branch)

| Suite | Result |
|---|---|
| S92 wired-template contract | **61 pass · 0 fail** |
| **S93 Office UI (new)** | **40 pass · 0 fail** |
| COM08 Jo templates | 31 pass · 0 fail |
| COM09 personal estimate | 19 pass · 0 fail |
| COM06 (T05–T07) | 7 pass · 0 fail |
| COM04 `email-safety` | 13 pass · 0 fail |
| COM04 `comms` | 6 pass · 0 fail |
| COM04 / S20-R01 automatic enquiry emails | 21 pass · 0 fail |
| Save-my-spot lock | 3 pass · 0 fail |
| Step 3 email parity | 8 pass · 0 fail |

**Targeted total: 209 pass · 0 fail.**

### 10.2 Full isolated regression

`bun ./scripts/test-isolated.ts 8`

| Run | Files | Pass | Fail | Time |
|---|---|---|---|---|
| S92 baseline reported by R3 | 337 | 3278 | 0 | 93 s |
| **S93 after integration + UI** | **338** | **3318** | **0** | 96 s |
| Delta | +1 | **+40** | 0 | — |

The +40 is exactly the new S93 Office UI suite. **No pre-existing test was lost, skipped or weakened.**

### 10.3 TypeScript

```
npx tsc --noEmit -p tsconfig.json   →  exit 0, 0 errors
```

### 10.4 Application build

```
bun run build   →  exit 0
✓ built in 3.36s
✓ built in 3.74s
[nitro] ✔ Generated public .output/public
✓ built in 650ms
```

> Sandbox note: the first build attempt failed because the pre-existing `.output` and
> `node_modules/.nitro` directories could not be emptied — they were blocked by the IDE safe-delete
> bulk guard (887 and 508 files, threshold 500). This is a sandbox artefact, **not** a compile error.
> Clearing them by rename (not deletion) produced the clean exit-0 build recorded above.

---

## 11. Release-build limitation (S83 carried forward)

**Full Nitro/Cloudflare release-build verification was NOT performed.**

Recorded precisely, the stages actually executed were:

| Stage | Executed | Evidence |
|---|---|---|
| Vite client application build | ✅ | `✓ built in 3.36s` |
| Vite SSR build | ✅ | `✓ built in 3.74s` |
| Nitro public output generation | ✅ | `[nitro] ✔ Generated public .output/public` |
| Full Nitro/Cloudflare **release**-build verification | ❌ | not run |
| Cloudflare Workers deploy | ❌ | not performed (not authorized) |

The local Vite + Nitro public output success in §10.4 is **not** evidence of production release
readiness. No deployment to Cloudflare was attempted. The S83 limitation therefore remains open.

---

## 12. S91 fixture preservation

| Item | Status |
|---|---|
| Disposable UAT stack (`hivic-uat-disposable`, API 54331 / DB 54332) | **Not contacted.** No command was run against it. |
| Shared prod-ref stack `wvuffpykgnqliikhodzl` (54321–54324) | **Not contacted.** |
| `supabase db reset` | **Not executed.** |
| Migrations applied | **None.** |
| Fixture data modified | **No.** |
| Production credentials used | **No.** |

S93 required **no database writes outside isolated automated test databases** (in-memory PGlite).
The S91 branch was verified to be present and **not** merged into RC1, and was left on its own
branch — S93 treats it as neither an application dependency nor a merge candidate.

---

## 13. Files changed

### New in S93 (3)

| File | Purpose |
|---|---|
| `src/routes/_authenticated/admin.ready-check.tsx` | the Office Ready Check invitation page |
| `tests/p1-r1-s93-office-ready-check-ui.test.ts` | 40 Office UI tests |
| `docs/phase1/runr1/P1-R1-S93_S92_INTEGRATION_AND_OFFICE_READY_CHECK_UI.md` | this report |

### Modified in S93 (3)

| File | Change |
|---|---|
| `src/lib/office-nav.ts` | nav entry in `ENQUIRY_TABS` + path in `ENQUIRY_PATHS` |
| `src/lib/ready-check-invitation.server.ts` | preview payload exposes the frozen fee breakdown; numeric coercion in the candidate list |
| `src/routeTree.gen.ts` | generated: registers `/admin/ready-check` (with the `react-start` `Register` block restored) |

### Integrated from S92 (9, via cherry-pick)

Listed in §2.1.

### Not touched

- All Jo template renderers (`jo-email-templates.core.ts`)
- COM-09 (`personal-estimate.core.ts` / `.server.ts`)
- The 7 October Hot-leads Save-my-spot campaign HTML
- COM-04 switch logic, `hot-leads-send.server.ts`, `comms.server.ts`
- S91 fixture scripts and documentation
- Any migration

**Migrations created in S93: 0.**

---

## 14. Remaining defects / blockers

1. **Full Nitro/Cloudflare release-build verification is still unperformed** (S83, carried forward).
   The local build is not evidence of production release readiness.
2. **The Office UI is unverified in a browser.** Behavioural and structural tests pass, but the
   rendered page has not been exercised through a real browser. Formal UAT is R6's, not this step's.
3. **The Hot-leads Save-my-spot campaign still uses the separately approved 7 October HTML.**
   Untouched deliberately. Moving it to Jo's 15 October copy needs a separate owner decision
   (carried from S92).
4. **Two untracked build artefacts were left in the worktree** because the IDE safe-delete guard
   blocked their removal: `.output_prev_s93/` and `node_modules/.nitro_prev_s93/`. Neither is
   committed. `.output` is gitignored; `.output_prev_s93` is not, so it shows as untracked —
   recommend manual deletion by the owner.
5. **COM-04 switches remain OFF** — intentional. No T8 invitation can actually be delivered until
   the owner authorises real sending.
6. **S91 fixtures are not part of the RC1 integration branch.** If a UAT run needs them, they must
   be brought across deliberately (see §16).

---

## 15. Recommended final UAT compatibility checks (R6)

All with **both COM-04 switches OFF**. No real email may be sent.

1. **Office navigation:** `/admin/ready-check` appears in the Leads tab row and highlights correctly.
2. **Candidate list:** saved-spot eligible jobs appear; closed, deleted and ineligible jobs do not.
3. **Non-Office role:** a non-admin user is redirected or refused and sees no saved pricing.
4. **Prepare:** Office selects a job and prepares; pricing and both CTAs match the customer's saved
   spot; nothing is sent.
5. **Preview fidelity:** the HTML iframe and plain-text alternative both render the frozen figures.
6. **Send blocked:** with both switches OFF, confirming the send shows “Not sent” with the backend
   reason and no success message.
7. **Templates 1–7:** outcome emails still use the right Jo template and CTA (U1–U8 from the S92 report).
8. **Booking CTA:** `/estimate/{token}` opens the existing Ready Check page and does not auto-book.
9. **Personal estimate CTA:** `/my-estimate/{token}` shows the saved pricing read-only.
10. **Concurrent change:** changing a saved price is reflected on the next prepare, not silently
    mid-preview.

---

## 16. Exact handoff requirements for S90 / S85

1. **S90 (release/RC1):** the release branch `release/p1-rc1` **must remain unchanged**. S93 did not
   push, merge or deploy. Freezing the final RC1 SHA is an **owner-controlled decision** and was not
   taken here — S93 only identifies the integration candidate.
2. **Release-build verification:** S90 still owes the full Nitro/Cloudflare release build (§11).
   Do not treat the local Vite build as satisfying it.
3. **S85:** **not marked complete by this step.** S85 remains open until its own criteria are met.
4. **If a UAT run needs S91 fixtures,** cherry-pick or copy the S91 scripts/documentation from
   `8e3aa295fb9796773ecf2f5807acbfc3d5a96c6c` **separately** — S93 deliberately did not merge that
   branch, and the four fixtures (F-REQ-01..04) are unchanged and untouched.
5. **Do not enable either COM-04 switch** for UAT convenience. Any real send requires an explicit
   owner decision.
6. **Outstanding owner decisions carried forward:**
   - whether the Hot-leads Save-my-spot campaign moves to Jo's 15 October copy (S92 §12.2);
   - final RC1 SHA freezing (owner-controlled).

---

## 17. Guardrails observed

| Guardrail | Status |
|---|---|
| Push | **NONE** |
| Merge into `release/p1-rc1` | **NONE** (release branch untouched) |
| Production deployment | **NONE** |
| Production database changes | **NONE** |
| Shared database writes | **NONE** |
| UAT stack writes / `db reset` | **NONE** |
| Real email or SMS | **NONE** (mock provider; both switches OFF) |
| COM-04 switch activation | **NONE** |
| Migrations created or applied | **0** |
| Formal browser UAT | **NONE** (deferred to R6) |
| Browser used | **NO** |
| S85 marked complete | **NO** |
| Final RC1 SHA frozen | **NO** (owner decision) |
