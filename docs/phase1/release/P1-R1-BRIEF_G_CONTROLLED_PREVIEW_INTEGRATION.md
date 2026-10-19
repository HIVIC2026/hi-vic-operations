# P1-R1 Brief G — Controlled Integration of Verified UI Fixes (Preview Readiness)

**Brief:** Brief G — Controlled Integration of Verified UI Fixes
**Priority:** P1
**Mode:** Targeted integration and Preview readiness
**Branch:** `r1/brief-g-preview-integration` (worktree `wt-r1-brief-g-preview-integration`)
**Integration commit:** `f5462831` — parent `79d7e6fb` (`origin/main`)
**Date:** 17 October 2026
**Status:** **B. INTEGRATED — PREVIEW UPDATE PENDING**

---

## Evidence legend

| Tag | Meaning |
| --- | --- |
| **VERIFIED** | Observed directly in this session; command, output or hash recorded. |
| **INFERRED** | Follows from VERIFIED facts plus a documented external behaviour; not directly observed here. |
| **UNKNOWN** | Cannot be established from this environment; stated as such. |
| **BLOCKED** | Attempted and prevented by an environmental constraint; reason recorded. |

---

## 1. Source baseline

Recorded before any file was modified. Nothing in this section was assumed.

### 1.1 The four environments

| Environment | Revision / state | How recorded |
| --- | --- | --- |
| Local GitHub `main` (`hi-vic-github`, branch `main`) | `7e3e5127` "P1-R3-S76: Lovable build env dependency audit" | `git log --oneline -3` |
| `origin/main` | `79d7e6fb` "P1-R1-S111: integrate verified Save My Spot Preview fix into main" (16 Oct 2026 22:57 +1100) | `git fetch origin --prune` then `git log -1 origin/main`; fetch reported no new objects |
| Lovable working copy (`~/CopilotWorkspace/Loveable/hi-vic-operations`) | **Not a git repository.** Extracted archive snapshot: directory mtime `2026-10-10 15:04`, contained files stamped `1979-11-30` (zip epoch). 160 paths differ from `origin/main` under `src/`. | `ls -d .git` → none; `diff -rq src ../hi-vic-operations/src` |
| Published application | `https://estimate.homeinsulationvictoria.com.au` (`hi-vic-operations.lovable.app` 302-redirects there). Published build revision UNKNOWN. | Brief E live fetch; not re-fetched in Brief G |

**Local `main` is NOT authoritative and is not usable as an integration base.** It carries 32 uncommitted staged changes (17 deletions, 15 modifications) — `git status --porcelain | wc -l` = 32 — including `git rm`-style deletions of `src/lib/mitti-create.server.ts`, `src/lib/my-profile.ts`, `src/lib/schema-compat.core.ts` and others that `origin/main` does contain. Their intent is unknown and they were left untouched.

### 1.2 Actual Lovable source used for Preview

**VERIFIED — this is not a local folder.**

- The Lovable project is connected to the GitHub repository `github.com/jetzhang123/hi-vic-operations.git`: commits authored `gpt-engineer-app[bot] <159125892+...@users.noreply.github.com>` are present on `main` (25 of the last 40 commits), and Lovable's bot is the author of the last commits touching `mitti.tsx` (1 Oct 2026). `gpt-engineer-app[bot]` is Lovable's GitHub identity.
- Per Lovable's own GitHub-integration documentation (**VERIFIED** by fetching `docs.lovable.dev/integrations/github`): sync is **two-way**, but *"Lovable only edits and syncs one branch at a time"* — only pushes to the **active branch** (normally `main`) reach the Lovable project, and *"Lovable pulls your changes when GitHub notifies it about a push to the synced branch."*
- Therefore the Lovable Preview source is the Lovable cloud project, fed by pushes to the active branch. **`~/CopilotWorkspace/Loveable/hi-vic-operations` is a 10-October download snapshot, not the live source.** Editing it would not change Preview.

### 1.3 Preview reachability

**VERIFIED / BLOCKED.** `GET https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app/` (the Preview URL recorded in `src/lib/test-send.server.ts:8` and `tests/local-network-guard.test.ts:200`) returns **HTTP 401 `Unauthorized`**. The Preview cannot be inspected from this environment; its current contents are **UNKNOWN** here.

### 1.4 Target files across all four sources — identical

**VERIFIED.** Both target files are byte-identical in every source that holds a copy. This is the fact that makes the integration conflict-free.

| File | `origin/main` | local `main` HEAD | `hi-vic-github` worktree | Lovable working copy |
| --- | --- | --- | --- | --- |
| `src/components/portal/choose-trade.tsx` | `3e2b59b0…` | `3e2b59b0…` | `3e2b59b0…` | `3e2b59b0…` |
| `src/components/portal/mitti.tsx` | `85c0ef91…` | `85c0ef91…` | `85c0ef91…` | `85c0ef91…` |

(MD5, full values: `3e2b59b06e9e6df38eb8d27baac50317`, `85c0ef91c199d6037e06d1e260fe2d50`.)

**Consequence: there are no Lovable-only modifications inside the two files being changed.** No newer content can be lost by this integration in either file.

### 1.5 Unpublished Lovable-only content elsewhere (reported, not touched)

**VERIFIED (local snapshot vs `origin/main`).** Ten files exist only in the 10-October Lovable snapshot and not on `origin/main`:

```
src/lib/external-action-dispatcher.server.ts
src/lib/external-action-outbox.server.ts
src/lib/job-disposition.server.ts
src/lib/local-network-fixtures.ts
src/lib/local-network-guard.install.ts
src/lib/local-network-guard.ts
src/lib/owner-code-delivery.core.ts
src/lib/owner-code-delivery.server.ts
src/lib/uxfix-state.core.ts
src/routes/api/public/hooks/external-actions.ts
```

Their status inside the **live** Lovable project is **UNKNOWN** (Preview returns 401). Whether the Lovable project currently holds commits that GitHub does not — Lovable's "diverged" state — is also **UNKNOWN** from here. Per the Lovable documentation, a push while diverged would replace the Lovable branch with the GitHub version, preserving Lovable's edits on a `lovable-sync` branch and in backups. This is the single risk that must be cleared by the owner **before** any push (§8).

---

## 2. Files integrated

Integration base: `origin/main` @ `79d7e6fb`, in a dedicated worktree, on branch `r1/brief-g-preview-integration`.

Method: **targeted cherry-pick of `98c16685` only** — not a branch merge, per §2 of the brief. The Brief E report commit `6dd1261f` and the Brief F commits (`71a42a30`, `bb10627e`) were deliberately **not** carried over: they are verification documents and test infrastructure, not application code, and the brief restricts integration to the application files.

```
git worktree add -b r1/brief-g-preview-integration \
    ../wt-r1-brief-g-preview-integration origin/main
git cherry-pick -x 98c16685        # → f5462831, clean, zero conflicts
```

Resulting commit `f5462831` — 3 files changed, 204 insertions(+), 10 deletions(-):

| File | Change | Lines |
| --- | --- | --- |
| `src/components/portal/choose-trade.tsx` | persistent inline error feedback | +6 / −2 (6 changed) |
| `src/components/portal/mitti.tsx` | explicit error capture replacing `useAction` | +28 / −10 |
| `tests/brief-e-silent-action-feedback.test.tsx` | Brief E regression test (new file) | +180 |

**Both integrated files are byte-identical to the versions verified in Brief F:**

```
choose-trade.tsx  d65b2c25b771de1a019c45d78beae21a   (== Brief E worktree)
mitti.tsx         1e1ce0cdf1eb75b51b97d142103d3800   (== Brief E worktree)
```

### 2.1 What the change actually is

**A. `ChooseTradePanel`** — adds `const [err, setErr] = useState<string | null>(null)`; clears it at the start of each attempt (`setBusy(true); setErr(null)`); stores the caught message and keeps the existing toast:

```tsx
catch (e) { const m = e instanceof Error ? e.message : "That didn't work"; setErr(m); toast.error(m); }
…
{err && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{err}</p>}
```

The existing `toast.error(...)` behaviour is **preserved**, as required by §4.A.

**B. `MittiCard`** — replaces `useAction(...)` with `useServerFn(...)` for `createMittiAssessment`, `syncFromMitti`, `syncPendingMittiAssessments`. This is the actual defect: `useAction` (in `src/hooks/use-me.ts`) catches the error, shows a toast and returns `undefined`, so the message never reaches component state. `run()` now takes an optional success message, captures the failure into `err`, renders the same `role="alert"` paragraph, and still fires `toast.success` / `toast.error` and `invalidateQueries()`. Success behaviour is **preserved**, as required by §4.B.

### 2.2 What was NOT touched

**VERIFIED** by `git diff --stat origin/main HEAD` returning exactly the three files above and nothing else.

Backend functions, workflow guards, RLS, authentication, assignments, business rules, external integrations, database schema, and all Lovable-only functionality are unchanged. No other file in the repository differs from `origin/main`. The Brief E diff contains **no** non-UI change to review.

---

## 3. Conflict resolution

**None was required — zero conflicts.**

`git cherry-pick -x 98c16685` applied cleanly on the first attempt (exit 0, no conflict markers, `git status` clean immediately after).

Reason: the two files being patched are byte-identical on the cherry-pick base (`origin/main` `79d7e6fb`) and on the commit's original base (local `main` `7e3e5127`) — see §1.4. The 151-commit distance between those bases does not intersect these files. `mitti.tsx` was last touched by Lovable on 1 Oct and has not changed since.

**No file was replaced wholesale with an older version.** The patch is a three-hunk and a five-hunk delta applied to the current file content; every other line in both files is exactly as `origin/main` has it.

**No manual reconciliation was needed**, and none was invented.

---

## 4. Tests performed

All commands run inside `wt-r1-brief-g-preview-integration` (branch `r1/brief-g-preview-integration` @ `f5462831`), with `node_modules` symlinked from `wt-r1-p1-s111-preview-fix` after confirming `package.json` and `bun.lock` are byte-identical (`52ffa09a…`, `4bd62b83…`).

| # | Check | Command | Result |
| --- | --- | --- | --- |
| 1 | TypeScript | `npx tsc --noEmit` | **PASS** — `TSC_EXIT=0`, zero output |
| 2 | Brief E component regression | `bun test tests/brief-e-silent-action-feedback.test.tsx` | **PASS** — 5 pass / 0 fail / 13 expect |
| 3 | Offer dispatch logic | `bun test tests/offer-dispatch.test.ts` | **PASS** — 6 pass / 0 fail / 17 expect |
| 4 | Mitti core logic | `bun test tests/mitti.core.test.ts` | **PASS** — 27 pass / 0 fail / 103 expect |
| 5 | Mitti T3 async claim | `bun test tests/t3-mitti-async-claim.test.ts` | **PASS** — 19 pass / 0 fail / 84 expect |
| 6 | Change scope | `git diff --stat origin/main HEAD` | **PASS** — exactly 3 files |
| 7 | Working tree cleanliness | `git status --short` | **PASS** — only the untracked handoff folder (§7) |
| 8 | Full build | `bun run build` | **FAIL (exit 1)** — environmental, see §5 |

Brief E's five named assertions are all still green on the new base:

```
(pass) Brief E — Installer Offer dispatch (ChooseTradePanel) > guard rejection shows the failure inline and it PERSISTS (not only a transient toast)
(pass) Brief E — Installer Offer dispatch (ChooseTradePanel) > successful offer: no error, success toast, queries refreshed
(pass) Brief E — Mitti create/sync (MittiCard) > guard rejection on Create & assign shows the failure inline and it PERSISTS
(pass) Brief E — Mitti create/sync (MittiCard) > Sync pending failure is surfaced inline, not silently swallowed
(pass) Brief E — Mitti create/sync (MittiCard) > successful create: success toast, no inline error
```

That covers §5's six required confirmations: both panels compile (1), error messages remain visible (2), success paths remain functional (2), no unrelated source changes (6, 7), TypeScript passes (1), relevant tests pass (2–5).

**Deliberately not repeated**, per §1 of the brief: the Brief F 16/16 direct-integration suite, the 10/10 UI feedback suite, and the 2648-test repository run. They were verified in Brief F on content that is now byte-identical to what is integrated here. The full-suite result on the **`origin/main` base** is therefore not re-established in this brief.

---

## 5. Build result

**`bun run build` → exit 1. Full build NOT VERIFIED.**

The failure is environmental, not a code defect, and it reproduces the same constraint recorded in Briefs C, E and F:

| Stage | Result |
| --- | --- |
| Vite client bundle | **PASS** — `✓ built in 3.98s`, 823 modules transformed, 265 client assets emitted to `.output/public/assets/` |
| Nitro server bundle | **BLOCKED** — `CODEBUDDY_BROKER_DENY` on `copyfile` of `public/design-preview/known-desktop.b64` into `.output/public/` |

Two pre-conditions had to be cleared before the build could reach Nitro, both sandbox-imposed and both handled without touching source:

1. `SAFE_DELETE_BULK_CONFIRM_REQUIRED` (548 entries) when Vite emptied the shared `node_modules/.nitro` cache → the stale cache was **moved** aside to `/tmp/briefg-cache-moved/`, not deleted.
2. `SAFE_DELETE_BULK_CONFIRM_REQUIRED` (266 entries) when Nitro emptied `.output` → moved aside likewise.

The asset the broker refused to copy **exists and is git-tracked**:

```
-rw-r--r--  1123996  public/design-preview/known-desktop.b64
git ls-files public/design-preview/known-desktop.b64  →  public/design-preview/known-desktop.b64
```

The shim's message begins `ENOENT`, but the error object carries `code: 'CODEBUDDY_BROKER_DENY'`, `decision: 'host-op'`, `__codebuddyBrokerPolicyError: true` — a host-operation denial, not a missing file. This matches Brief F exactly.

**No claim of build success is made.** What the client build does prove is recorded in §7.

---

## 6. Lovable Preview synchronisation status

The brief requires these five operations to be kept distinct. They are:

| # | Operation | Status in Brief G |
| --- | --- | --- |
| 1 | **Local source integration** | **DONE** — `f5462831` on `r1/brief-g-preview-integration`, committed locally |
| 2 | **Lovable source synchronisation** | **NOT DONE** — requires a push to the active branch; not authorised |
| 3 | **Preview refresh/rebuild** | **NOT DONE** — follows from (2); Lovable rebuilds when it receives the push notification |
| 4 | **GitHub push / merge into shared `main`** | **NOT DONE** — explicitly withheld (§9 of the brief) |
| 5 | **Production publish** | **NOT DONE** — and explicitly not required to update Preview |

**Preview is therefore NOT updated.** Status `A. PREVIEW VERIFIED UPDATED` is impossible to claim, and is not claimed: the Preview returns HTTP 401 from here, so even the question "what does Preview contain right now" cannot be answered in this environment.

**What would update Preview (single operation, owner-gated):**

```
git push origin r1/brief-g-preview-integration:main
```

- **Target:** GitHub `origin` (`github.com/jetzhang123/hi-vic-operations.git`), branch `main` — the branch Lovable syncs.
- **Expected effect:** GitHub notifies Lovable of the push to its active branch; Lovable pulls and its Preview rebuilds with the fix. No production publish is involved.
- **Pre-condition the owner must clear first:** confirm in Lovable **Project settings → Git → GitHub** that the sync status is *not* "Lovable and GitHub have diverged". If it is, the push replaces the Lovable branch — Lovable's edits are preserved on a `lovable-sync` branch and in backups, but they would leave the working project (§1.5).
- **If Lovable shows "GitHub is ahead" and does not pull:** push an empty commit (`git commit --allow-empty -m "Trigger Lovable sync"`) to re-trigger the notification. Per the Lovable documentation, "Reconnect" and "Re-check" do not pull commits.
- **Alternative, no push:** paste the two files from §7 into the Lovable editor. This updates Preview directly and avoids the divergence question entirely.

---

## 7. Evidence that Browser Agent will see the fix

Three independent layers, strongest first.

### 7.1 The integrated content is the content Brief F verified

Both files are byte-identical to the Brief E/F-verified versions (`d65b2c25…`, `1e1ce0cd…`). Brief F proved against those exact bytes: 16/16 direct-database integration tests, 10/10 UI feedback tests, 5/5 Brief E regression, 2648/2648 repository tests, TypeScript clean. This is **VERIFIED**.

### 7.2 The compiled client bundle contains the new element

**VERIFIED** in the build output from §5 (client stage passed). The change compiles into the two route chunks that actually render these panels, and the new markup is present in each:

| Chunk | Marker | Baseline (`origin/main` source) | Integrated source | Emitted bundle |
| --- | --- | --- | --- | --- |
| `admin.jobs._jobId-ERL7C4QI.js` | `rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive` | 0 | 1 | **1** |
| `requirements-6KEemOlf.js` | `mt-2 rounded bg-destructive/10 px-2 py-1 text-sm font-medium text-destructive` | 0 | 1 | **1** |

Extracted from the emitted chunk (mitti):

```
`mt-2 rounded bg-destructive/10 px-2 py-1 text-sm font-medium text-destructive`,children:p
```

Extracted from the emitted chunk (choose-trade):

```
g&&(0,G.jsx)(`p`,{role:`alert`,className:`rounded-md bg-destructive/10 px-3 py-2 text-sm …
```

The class combination `font-medium text-destructive` does not exist anywhere in the baseline files, so its presence in a bundle is an unambiguous signal that the Brief E code is in that build. This is the check to run against whatever build Preview ends up serving.

### 7.3 Runtime detection instructions for the Browser Agent

Do not judge this by screenshot alone — that is precisely how the original defect was missed. After a rejected action, assert the DOM:

```js
document.querySelectorAll('p[role="alert"]')
// the fix is present when one of these has className containing "font-medium text-destructive"
// and its textContent equals the exact server message
```

Expected message strings (single source of truth: `tests/brief-f/messages.ts`):

| Action | Expected inline text |
| --- | --- |
| Send offer on a job that already has an installer | `Ready Check offers cannot start: An installer is already assigned.` |
| Create & assign Mitti, measure-up template missing | `Measure-up-only Mitti template is not configured. An admin must add the measure-up template ID in workflow settings before a measure-up-only Mitti audit can be sent.` |
| Create & assign Mitti, PIESA mapping not approved | `The PIESA mapping piesa-map-2.0.0 hasn't been approved, so this form can't be used yet.` |
| Create & assign Mitti, no assignee | `Assign an installer before creating the Mitti assessment.` |

Persistence semantics, per §7 of the brief — **state this to the agent so it does not fail the test wrongly**:

- The inline message **must survive** the toast disappearing (≈4 s) and ordinary re-renders. That is the whole point of the fix.
- It **must not** be expected to survive a full page reload. A reload resets component state, and that is correct behaviour, not a defect.
- It clears on the next attempt of the same action.

### 7.4 Paste-ready copies (for the no-push path)

`docs/phase1/release/brief-g-handoff/` contains exact copies of the two integrated files (`choose-trade.tsx.txt`, `mitti.tsx.txt`, plus `PATCH.diff` and a `README.md`). The `.txt` suffix is deliberate — `tsconfig.json` only includes `src/**/*.ts(x)`, so a copy under `docs/` can never be type-checked or bundled by accident.

---

## 8. Remaining approval requirements

Nothing further can be done without an explicit owner decision. Three items, in order.

### 8.1 REQUIRED — authorise one operation to update Preview

| Field | Value |
| --- | --- |
| Operation | `git push origin r1/brief-g-preview-integration:main` (fast-forward of `main` from `79d7e6fb` to the Brief G commit; no force) |
| Target environment | GitHub `origin` → Lovable active branch → **Preview only** |
| Expected impact | Lovable pulls the push and rebuilds Preview. Two files change. No database change, no migration, no publish, no production deploy. |
| Risk | If Lovable reports "diverged", the push replaces the Lovable branch (recoverable via `lovable-sync` + Lovable backups). Check first. |
| Not included | Production publish (`estimate.homeinsulationvictoria.com.au`) — **not needed** to update Preview and **not requested**. |

Two acceptable alternatives, either of which also satisfies the brief:

- Owner pastes `brief-g-handoff/choose-trade.tsx.txt` and `mitti.tsx.txt` into the Lovable editor (no push at all).
- Owner switches Lovable's active branch to `r1/brief-g-preview-integration` in **Project settings → Git** (Lovable then edits/syncs that branch; not recommended, it changes the project's branch).

### 8.2 REQUIRED — confirm Lovable/GitHub are not diverged

Must happen **before** 8.1. In Lovable: **Project settings → Git → GitHub**. If the status reads "Lovable and GitHub have diverged", stop and reconcile first; the 10 files in §1.5 are the known candidates for content that may exist only on the Lovable side.

### 8.3 NOT REQUIRED for this brief, listed for completeness

- Production publish — out of scope; do not publish merely to enable UAT.
- Mitti template IDs in workflow settings — still owner-only (standing item from Briefs E and F). Until they are set, the Mitti create action on a real job will keep being rejected with the template-missing message. That rejection is the *expected* behaviour being tested, not a failure.
- Re-issuing the missing `P1-E2E_UNLOCK_EXECUTION_REPORT.md` referenced by the original UAT brief (standing item from Brief E).

---

## 9. Exact next UAT steps

To be executed **only after** §8.1 has been done and the Preview has rebuilt.

**Step 0 — confirm the build actually carries the fix.** Before any clicking, in the Preview browser console:

```js
document.documentElement.innerHTML.includes('font-medium text-destructive')
```

`false` means the Preview is still serving the old build — stop and re-check the sync, do not proceed to Step 4. (If the string is not found because the page has not loaded the route chunk yet, open a job page first.)

**Step 1 — open `HV-1417`.** Office session, job page.

**Step 2 — verify the actual installer assignment.** Record which installer(s) are assigned and whether the assignment is on the Ready Check or the install stage. **Do not change the assignment.** `HV-1417` already has an installer; the offer button *will* be rejected, and that rejection is the test.

**Step 3 — verify the current workflow stage.** Record the stage string. If the stage is not `ready_check_ready_to_schedule`, the message will be "The job is not waiting for a Ready Check booking." instead of the installer message — record whichever one appears, verbatim.

**Step 4 — test Installer Offer error feedback.** Tick a trade, click **Send offer**. Then:
1. Screenshot immediately (toast visible).
2. **Wait 8 seconds**, screenshot again — the inline message must still be there.
3. Read `document.querySelector('p[role="alert"]').textContent` and record it verbatim.
4. Record that no offer row was created (the job page still shows no open offer).

**Step 5 — test Mitti create/sync feedback.** Click **Create & assign Mitti assessment**. Then repeat the same four sub-steps. Expected on `HV-1417` with unset template IDs: a template-missing message, not silence. If an assessment already exists, use **Sync from Mitti** instead and record that message.

**Step 6 — confirm persistence past the toast.** Explicitly state in the report: toast gone at ~4 s, inline message still present at ~8 s and after scrolling the panel out of view and back.

**Step 7 — record screenshots and actual errors.** One screenshot per state (toast up, toast gone, inline message), plus the verbatim `textContent` strings. Do not paraphrase messages; the assertions in `tests/brief-f/messages.ts` are exact.

**Explicitly out of bounds for the agent:**

- Do **not** modify `HV-1417` assignments, stage, or any other job data to force a *successful* offer. The error path is what is under test.
- Do **not** treat a reload-cleared inline message as a failure.
- Do **not** treat the "installer already assigned" rejection as a defect — it is the correct business rule.

**Expected outcome.** Both actions show a persistent inline `role="alert"` message matching the table in §7.3, and the corresponding database write does not happen. That closes Brief E's defect. If either action is silent again, the Preview is serving a build without `f5462831` — re-run Step 0 before filing anything.

---

## Final status

**B. INTEGRATED — PREVIEW UPDATE PENDING**

The verified Brief E UI fix is integrated cleanly on `r1/brief-g-preview-integration` @ `f5462831` (parent `origin/main` `79d7e6fb`), with zero conflicts, zero unrelated changes, TypeScript clean, and all relevant tests green. The Lovable Preview has **not** been updated: that requires one owner-approved push to the active branch (or a manual paste), which §9 of the brief withholds without explicit approval. Preview contents could not be verified from this environment at all — it returns HTTP 401.
