# P1-R1-BRIEF P — Build verification, controlled Preview integration & delivery readiness

| | |
|---|---|
| Brief | P — Build verification, controlled Preview integration & delivery readiness |
| Priority | P1 — delivery critical |
| Mode | VERIFY → INTEGRATE → PREVIEW CHECK → DELIVERY HANDOFF |
| Worktree | `wt-r1-brief-n-ready-check` |
| Branch | `r1/brief-p-phase1-preview-integration` (from `r1/brief-n-ready-check-success`) |
| Baseline at start | `07d7e56a` = `origin/main` |
| Integrated to main | `d64b9af9` (fast-forward, non-force) |
| Date | 17 Oct 2026 |
| **Final classification** | **D — INTEGRATED, PREVIEW VERIFICATION INCOMPLETE** |

Classification is **D**, not A, for one reason only: the build gate passed (§4) and the integration completed (§6), but Lovable Preview answers **HTTP 401** to every request from this environment, so no part of §9 could be observed. The Preview is not reported as verified on the strength of the repository contents.

---

## 1. Executive summary

| Gate | Result | Evidence |
|---|---|---|
| Production build (`npm run build` = `vite build`) | **PASS — exit 0** | clean Debian container, §4 |
| `npx tsc --noEmit` | **PASS — exit 0** | §4.4 |
| Brief O suite / Brief N regression | **17 pass / 0 fail · 37 pass / 0 fail** | §4.4 |
| Git baseline unchanged since Brief G | **CONFIRMED** — `07d7e56a`, 0 behind | §2, §3 |
| Integration branch pushed | **DONE** — `r1/brief-p-phase1-preview-integration` | §5 |
| GitHub `main` fast-forwarded | **DONE** — `07d7e56a → d64b9af9`, non-force | §6 |
| Lovable synchronisation | **TRIGGERED, NOT OBSERVABLE** from here | §7 |
| Read-only Preview verification | **BLOCKED — HTTP 401** | §8 |
| Shared database writes | **NONE** | §1.1 |

The production build is the headline. Brief O could not complete it because the sandbox refused to let the build delete its own previous output and copy ~9 MB of public assets. This brief did not repeat those workarounds: it ran the real command in a **clean Linux container** with a frozen-lockfile install, and it finished — client, SSR, Nitro and the `.output` artifacts.

### 1.1 What this brief did not do

No production deploy. No Preview state-changing action. No write to the shared Supabase database. No migration. No credential, permission, RLS or configuration change. No force-push, no merge commit, no overwrite of anyone else's work. No file was deleted from the repository.

---

## 2. Verified Git baseline

Recorded before anything was changed. Nothing here is assumed.

| Item | Value | How |
|---|---|---|
| Repository | `github.com/jetzhang123/hi-vic-operations` (private, default branch `main`) | `gh repo view`, `gh api` |
| `origin/main` at start | `07d7e56a` — "Brief G: controlled integration of the verified Brief E UI fix" — 2026-10-17T02:32:42Z | `git fetch origin --prune`; `gh api .../branches/main` |
| Development branch | `r1/brief-n-ready-check-success` @ `d64b9af9` | `git rev-parse` |
| Working tree | clean (`git status --porcelain` empty) | — |
| Ahead / behind | **4 ahead / 0 behind** `origin/main` | `git rev-list --left-right --count` |
| Commit ancestry | `2d685f74` (Brief N verify) → `ca1f7e4e` (Brief N report) → `43dfc9fb` (Brief O implementation) → `d64b9af9` (Brief O report numbers) | `git log origin/main..HEAD` |
| Remote branches | 16; none newer than main except the one this brief pushed | `git for-each-ref --sort=-committerdate` |
| Open pull requests | none | `gh pr list --state open` → `[]` |
| Branch protection on `main` | **none** (GitHub returns 403 "Upgrade to GitHub Pro…" — the feature is unavailable on this plan, so nothing is protected) | `gh api .../branches/main/protection` |
| `gh` identity | `jetzhang123`, token scopes `repo`, `workflow`, `gist`, `read:org` | `gh auth status` |
| Local `main` worktree (`hi-vic-github`) | `7e3e5127`, **not authoritative** (carries long-standing uncommitted deletions) — untouched | `git worktree list` |

Brief N and Brief O share one branch, so the integration range is **four commits, not two**. Cherry-picking only `43dfc9fb` + `d64b9af9` would have produced a broken tree (the Brief O tests import `tests/brief-n/harness.ts`, which arrives in `2d685f74`). The whole range was integrated.

---

## 3. Lovable synchronisation preflight

| Check | Finding | Verdict |
|---|---|---|
| Connected repository | `jetzhang123/hi-vic-operations`, default branch `main` | as expected |
| Active tracked branch | `main` (Lovable's own sync model: it pulls on a push to the active branch — established in Brief G from Lovable's GitHub-integration documentation) | as expected |
| GitHub `main` advanced since Brief G? | **No** — still `07d7e56a`, commit date 2026-10-17T02:32:42Z | no divergence |
| Newer development by another agent? | No push event to `main` after 2026-10-16T10:45:15Z; no open PRs; no remote branch newer than main | none |
| Lovable pending/divergent changes? | **Not observable from this environment** — no Lovable API credential, no project page access (`lovable.dev/projects/…` → 403). Judged from GitHub side: `main` is exactly where Brief G left it, so no Lovable write-back is pending on the branch | accepted risk, recorded |
| CI availability | **No CI exists** — `.github/workflows` absent from `origin/main`, `gh api .../actions/workflows` → `total_count: 0`. Actions itself is **enabled** (`allowed_actions: all`) | see §4 |
| Preview reachability | `https://id-preview--fb35adfe-…lovable.app/` → **HTTP 401** on `/`, `/field`, `/admin`, `/estimate/*` | blocked (§8) |
| Published site | `https://hi-vic-operations.lovable.app/` → 302 → `https://estimate.homeinsulationvictoria.com.au/` → 200. This is the **published** build, not the Preview; it was not touched | untouched |

**Preflight verdict: safe to integrate.** The only gate that could not be closed positively is Lovable's internal state, which is not inspectable without a Lovable session; the GitHub side showed no divergence, no newer work, and no force-push requirement.

---

## 4. Production build — mandatory gate

### 4.1 Why not the sandbox again

Brief O made seven attempts on the host and every one failed *after* successful compilation, on two sandbox refusals: `SAFE_DELETE_BULK_CONFIRM_REQUIRED` (the build may not delete its own previous output in one burst) and `CODEBUDDY_BROKER_DENY` (the brokered filesystem refuses Nitro's `cp` of `public/**`). Those are environment controls, not source defects, and the brief forbids disabling them or stripping the public assets to force green. So the build was moved to a **clean environment** instead.

### 4.2 The environment actually used

No CI workflow exists to trigger, so a clean Linux container was used: `node:22-bookworm`, fresh install from the committed lockfile, nothing mounted from the host except a byte-identical copy of the tree at `d64b9af9`.

```bash
# tree copy: worktree at d64b9af9, clean; node_modules/.git/.output excluded
rsync -a --exclude node_modules --exclude .git --exclude .output --exclude dist --exclude .nitro \
      wt-r1-brief-n-ready-check/ /tmp/brief-p-build/

docker run --rm -v /tmp/brief-p-build:/app -w /app node:22-bookworm bash -lc '
  node -v; npm -v
  npm i -g bun@1
  bun install --frozen-lockfile
  npm run build; echo "BUILD_EXIT=$?"
'
```

### 4.3 Result — EXIT CODE 0

```
v22.23.3
10.9.9
bun 1.4.3 installed
DEPS_EXIT=0        # 502 packages installed [37.86s], frozen lockfile
BUILD_EXIT=0
```

| Phase | Observed |
|---|---|
| Client environment | `vite v8.1.5 building client environment for production…` → `✓ 3696 modules transformed` → `✓ built in 5.35s` |
| S101 prune plugin | `[s101-prune] Removed 28 orphaned server-only chunk(s) from .output/public/assets (B3-06).` |
| SSR environment | `building ssr environment for production…` → `✓ 823 modules transformed` → `✓ built in 4.88s` |
| Nitro | `[nitro] ◐ Building [Nitro] (preset: cloudflare-module, compatibility: 2026-10-17)` → `✔ Generated public .output/public` → `✓ 3880 modules transformed` → `✓ built in 1.01s` |
| Completion | `[nitro] ✔ You can preview this build using npx vite preview` / `✔ You can deploy this build using npx nitro deploy --prebuilt` |

Artifacts verified on disk:

```
.output/           874 files, 33 MB
.output/public/    _headers  assets  design-preview  email-preview  favicon.png  robots.txt  templates
.output/server/    _chunks  _libs  _runtime.mjs  _ssr  _tanstack-start-manifest_*.mjs  …
.output/nitro.json
```

`design-preview/`, `email-preview/` and `templates/` — the three asset groups the sandbox refused to copy in Brief O — are all present in the finished build. Nothing was removed to make the build pass.

### 4.4 Checks re-run on the integration branch

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `bun test tests/brief-o-ready-check-delivery.test.ts` | **17 pass / 0 fail / 43 expect** |
| `bun test tests/brief-n-ready-check-success.test.ts` | **37 pass / 0 fail / 224 expect** |

The integration changed no code relative to Brief O (it is the same commits), so no further targeted checks were required.

---

## 5. Integration branch and exact commit range

* Branch: **`r1/brief-p-phase1-preview-integration`**, created from `r1/brief-n-ready-check-success` @ `d64b9af9`, pushed to `origin` (remote sha verified = `d64b9af9`).
* Range integrated: `07d7e56a..d64b9af9` — four commits:

| Commit | Content |
|---|---|
| `2d685f74` | Brief N: Ready Check success path verified end to end (service, DB, browser) — includes `tests/brief-n/harness.ts` |
| `ca1f7e4e` | Brief N: report + browser evidence under `docs/phase1/release` |
| `43dfc9fb` | Brief O: native Ready Check for both channels, day-page handoff, Mitti guards, corrected Office wording, report, evidence |
| `d64b9af9` | Brief O: report numbers corrected to the measured values |

* Diff vs `origin/main`: **66 files, +4570 / −6**.

| Group | Count | Files |
|---|---|---|
| Product source | 6 modified | `src/components/portal/panels.tsx`, `src/components/trade/ReadyCheckDraft.tsx`, `src/lib/ready-check-draft.server.ts`, `src/lib/workflow.server.ts`, `src/routes/_authenticated/field.$jobId.tsx`, `src/routes/_authenticated/field.day.$jobId.tsx` |
| Tests | 7 added | `tests/brief-n-ready-check-success.test.ts`, `tests/brief-n/{harness,messages,prep-browser,submit-rc}.ts`, `tests/brief-o-ready-check-delivery.test.ts`, `tests/brief-o/prep.ts` |
| Reports & evidence | 53 added | `docs/phase1/release/P1-R1-BRIEF_N_*`, `P1-R1_BRIEF_O_*`, `brief-n-evidence/browser/**`, `brief-o-evidence/browser/**` |

Exclusions verified explicitly:

* `.env` **not** in the diff (`git diff --name-only | grep -c '^\.env$'` → 0).
* No `.env.local`, no `node_modules`, no `.DS_Store`, no `.output`, no disposable database dump.
* No unrelated feature change, no accidental reversion: the only `−6` lines are the six lines these commits intentionally replace.
* Credential scan of the whole diff found no service-role key, no private key, no GitHub token, no OpenAI key. The only credential-like strings are documentation of the **disposable local stack** (`office@brief-n.test` and its local password), which cannot reach production.

---

## 6. GitHub main integration result

| Step | Command | Observed |
|---|---|---|
| Push integration branch | `git push -u origin r1/brief-p-phase1-preview-integration` | `* [new branch] … -> r1/brief-p-phase1-preview-integration`; `git ls-remote` = `d64b9af9` |
| Re-fetch + recheck immediately before integration | `git fetch origin --prune` | `origin/main` = `07d7e56a` (unchanged) |
| Fast-forward compatibility | `git merge-base --is-ancestor origin/main HEAD` | **true**; ahead 4 / behind 0 |
| Integrate | `git push origin HEAD:main` | `07d7e56a..d64b9af9  HEAD -> main` — **non-force fast-forward, no merge commit** |
| Verify (GitHub) | `gh api repos/.../branches/main` | `sha d64b9af9`, msg "Brief O: state the measured line count and the two browser passes accurately" |
| Verify (local) | `git fetch origin` + `git log -1 origin/main` | `d64b9af9` |

| Record | Value |
|---|---|
| Previous main | `07d7e56a` |
| New main (code) | `d64b9af9` |
| Integration branch | `r1/brief-p-phase1-preview-integration` @ `d64b9af9` (+ this report commit) |
| Force used | none |
| Merge commit created | none |
| Production deploy triggered | none |

A second, identical fast-forward carries this report onto `main` (the same pattern Brief G used: code first, documentation after). It changes no source file.

---

## 7. Lovable Preview synchronisation result

| Item | Status |
|---|---|
| Push accepted by GitHub | **YES** — `07d7e56a..d64b9af9`, repo `pushed_at` advanced to 2026-10-17T11:42:36Z |
| Lovable notified | **EXPECTED, NOT OBSERVED** — Lovable pulls on a push to the active branch; there is no push-back commit to look for, and no API to query sync state |
| Write-back commit on `main` after the push | **none** (main still `d64b9af9`; no `gpt-engineer-app[bot]` commit appeared) |
| Preview now serving the new code | **NOT VERIFIED** — §8 |

So: the code is on the branch Lovable synchronises from, and the push event that triggers sync has happened. Whether Lovable actually rebuilt and is serving it **cannot be established from this environment** and is not claimed.

---

## 8. Read-only Preview verification

### 8.1 Blocked

| Probe | Result |
|---|---|
| `GET https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app/` | **401** |
| `…/field` | **401** |
| `…/admin` | **401** |
| `…/estimate/test-token` | **401** |
| `GET https://lovable.dev/projects/fb35adfe-…` | **403** |
| `GET https://hi-vic-operations.lovable.app/` | 302 → `estimate.homeinsulationvictoria.com.au` (published build, **not** Preview) |

The Preview host requires a Lovable session; no credential for it exists in this environment, and the brief forbids obtaining one by other means. **Nothing in §9 of the brief was executed.** No Preview page was opened, no bundle inspected, no network response read.

### 8.2 What *is* verified instead — code present on the synced branch

Read directly from GitHub `main` via the contents API (not from the local worktree):

| Target | File:line on `main` | Evidence |
|---|---|---|
| A. Native Ready Check no longer restricted to `installer_sourced` | `src/routes/_authenticated/field.$jobId.tsx:95` | `{role === "installer" && <ReadyCheckDraft jobId={jobId} />}` — the channel condition is gone; `:92` still gates `MyIntakeDetailsCard` on `installer_sourced` |
| B. Day-page handoff for `hivic_sourced` | `src/routes/_authenticated/field.day.$jobId.tsx` | `data-native-rc-handoff` section + `data-open-native-rc` link (Brief O §2.4) |
| C. Mitti-owned rows read-only | `src/components/trade/ReadyCheckDraft.tsx:31–33` | `if (data.fromMitti) … data-rc-from-mitti` |
| D. Corrected Office wording | `src/components/portal/panels.tsx:64,67,69` | `No stage checks block the move to …` · `Stage checks only — this does not confirm the work for that stage has been done.` · `data-rc-fact` |

### 8.3 Evidence levels, kept separate

| Level | Status |
|---|---|
| **Code present in the repository Preview builds from** | **VERIFIED** (§8.2, read from GitHub `main`) |
| **Code present in the Preview JavaScript bundle** | **NOT VERIFIED** (401) |
| **UI actually rendered in Preview** | **NOT VERIFIED** (401) |
| **Behaviour verified in a real browser (local disposable stack)** | **VERIFIED** — Brief O, 37/37 checks |
| **Behaviour verified against Preview** | **NOT VERIFIED** |

No Preview end-to-end pass is claimed.

---

## 9. Phase 1 scope / evidence matrix

Authoritative scope: `HI_VIC_Phase1_AI_Guardrails/01_PHASE1_SCOPE_AND_EXCLUSIONS.md`. Legend: **IMPL** = present on `main`; **TEST** = automated suite; **BROWSER** = real-browser evidence; **PREVIEW** = verified against Preview. Preview is **NOT VERIFIED** for every row (401) and is therefore stated once here rather than repeated twelve times.

| # | Area | Required Phase 1 behaviour | Implementation | Evidence | Blocker | Prevents delivery? |
|---|---|---|---|---|---|---|
| 1 | Enquiry / Save My Spot | approved template, select/populate responses, record outcome | IMPL — `src/lib/enquiry.server.ts`, `/save-my-spot`, COM04 guards (`realSendingOn()` requires both flags, default OFF) | TEST — 11 save-spot suites; reports S65/S102/S103/S111; Brief G integrated the S111 Preview read fix | sending stays **fail-closed** until flags are enabled; Preview render unverified | No — but the OFF-by-default send must be enabled by the owner for live use |
| 2 | Gate 1 / eligibility | recorded eligibility outcome and evidence | IMPL — `owner-gates.functions.ts`, `property_facts`, `eligibility_decision_source` | TEST — 3 eligibility suites; Brief N/O fixtures exercised a recorded Gate 1 decision end to end | none found | No |
| 3 | Homeowner availability | homeowner picks 3–5 times and submits | IMPL — `estimate.$token` + `ReadyCheckTimesPicker` | **BROWSER** — Brief O A1–A7, incl. 2 rejection cases; TEST — Brief N 11 assertions | Preview unverified | No |
| 4 | Ready Check booking | windows reach Office and drive dispatch | IMPL — `submitReadyCheckWindows`, `ready_check_windows` | **BROWSER** — Brief O B1–B4; Brief N B-stage | Preview unverified | No |
| 5 | Installer Ready Check | installer records, saves, uploads, submits; Office sees it | IMPL — native form on both channels + Mitti guards | **BROWSER** — Brief O E1–E11, F1–F6; TEST — 17 Brief O tests + 37 Brief N | reopen → correct → resubmit not exercised (§10) | No |
| 6 | Measured quote | measured estimate after the Ready Check | IMPL — `measured_estimate_ready`, `refreshIndicativeEstimate` | TEST — `tests/measured-quote-accept.test.ts` + 15 quote suites; **no browser evidence in Brief P** | never browser-verified end to end | **Possibly** — see §10 item 2 |
| 7 | Quote / offer / acceptance | offer a quote, record acceptance | IMPL — offers + `acceptReadyCheck` | **BROWSER** — Brief N C/D (offer receipt, address withheld then released); TEST — `offer-dispatch` 6 pass | quote-side acceptance (post-measure) not browser-verified in N/O/P | Possibly — same item as #6 |
| 8 | Installer installation workflow | assigned job, instructions, progress, completion, next action | IMPL — `InstallerFlow`, `InstallerProgressCard` | TEST — 32 install-related suites; earlier reports; **not browser-verified in Brief P** | not re-verified here | Unknown — needs the UAT in §11 |
| 9 | Basic electrician workflow | login, assigned work, basic progress, **basic work results**, Office sees them | IMPL — `ElectricianFlow` + `ElectricianManualResult` (`field.$jobId.tsx:175`) | TEST — `electrician-manual-result.test.tsx`, `electrician-matching{,-db}`, `electrician-rates{,-discard}-db`, `job-electrician-7oct` (6 files) | not browser-verified in Brief P; the older S67 matrix's "S64 ABSENT" line is **stale** — S64 is now on `main` | Unknown — needs UAT |
| 10 | Office oversight & handoffs | status, responsible person, outstanding item, next action, view other roles' results | IMPL — admin job page, `BlockersPanel`, sections | **BROWSER** — Brief O F1–F6; Brief N F | Preview unverified | No |
| 11 | Homeowner visibility | authorised job info, quote, acceptance | IMPL — `/estimate/$token`, `/my-estimate/$token` | **BROWSER** — Brief O A1 (own estimate only); TEST — `com09-personal-estimate-cta` | COM09 Template-8 **send not wired** (S67 §3) — a known limitation, not a Phase 1 basic-action blocker | No, but must be disclosed at handover |
| 12 | Security & RLS | role restrictions, cross-role isolation, validation | IMPL — RLS policies unchanged by this work | **BROWSER** — Brief O N1–N3, D2; TEST — Brief O 5a/5b (installer A 1 row, B 0 rows) | none found | No |

Scope rules respected: basic electrician workflow counted as **required** (row 9); advanced electrical/PIESA and advanced Mitti treated as excluded; advanced Mitti is not listed as a blocker.

---

## 10. Remaining delivery blockers

| # | Blocker | Severity | Whose action |
|---|---|---|---|
| 1 | **Preview verification impossible from this environment** (401 on every path). Nothing has been confirmed rendered in Preview. | High for sign-off, none for the code | Owner opens Preview (or provides an authorised session) |
| 2 | **Measured quote → offer → acceptance (rows 6–7) has no browser evidence in this cycle.** Brief N covered offer/accept for the Ready Check path; the post-measure quote path was not driven in a browser. | Medium | one UAT script (§11, test 3) |
| 3 | **Installer installation workflow (row 8) and basic electrician results (row 9) not browser-verified in this cycle.** Code and suites exist; acceptance evidence does not. | Medium | UAT (§11, tests 4–5) |
| 4 | **Ready Check reopen → installer correction → resubmit** not exercised end to end (Office can reopen — Brief O F2 is UI-level only). | Low–Medium | UAT (§11, test 2) |
| 5 | **`public/` ships 9.2 MB of preview imagery** (`design-preview`, `email-preview`), copied into every build. Not functional, but it inflates the bundle and was the direct cause of Brief O's build block. | Low | owner decision (keep or move out of `public/`) |
| 6 | **COM09 Template-8 send is not wired** (S67 §3, unchanged). The personal-estimate page exists and renders; the email that should carry it is not connected. | Low for Phase 1 basics | disclose at handover; separate change if wanted |
| 7 | **`.env` is tracked** (S70 deferred; publishable keys only). | Low | owner decision |

Not blockers: the Ready Check workflow itself, Mitti ownership protection, RLS, the build, and the integration — all closed.

---

## 11. Minimum final browser UAT plan

Five tests, in this order, on Preview. **None is executed in this brief.** Every one requires separate owner approval because Preview shares the production Supabase database.

Shared preconditions for all tests: signed-in TEST accounts that already exist (office + installer A + installer B); a TEST job (`jobs.source = 'qa_test'`) identified **read-only first**; a second browser profile signed out for the negative checks. Brief P could not enumerate the shared TEST records — this environment has no authorised read path to the production database — so each test starts with a read-only identification step instead of a fabricated ID.

### Test 1 — Office sees the corrected transition wording (read-only, no approval needed beyond opening Preview)

* **Job:** any TEST job at stage `ready_check_scheduled`; starting state: Ready Check not submitted.
* **Account:** office (TEST).
* **Action:** open the job page; read the "Current blockers" panel.
* **Expected DB change:** none.
* **Read-back:** panel shows "No stage checks block the move to Ready Check Complete", the "Stage checks only …" line, and "Ready Check: not started" / "started, not submitted".
* **Stop if:** any wording implies the work is done, or the fact line is missing.

### Test 2 — Ready Check reopen → installer correction → resubmit

* **Job:** a TEST job whose Ready Check is already `submitted` (Brief N/O equivalent exists locally; in shared data one must be identified read-only).
* **Accounts:** office, then installer A.
* **Starting state:** `ready_checks.status = 'submitted'`, one row.
* **Actions:** office reopens; installer A edits one observation and resubmits.
* **Expected DB changes:** `ready_checks.status` submitted → draft → submitted; `ready_check_observations` updated for one `field_key`; a `workflow_events` row per transition (append-only).
* **External side effects:** **must be checked before running** — reopening does not normally send email/SMS, but verify the job's comms flags are OFF and no webhook is configured; a TEST label alone does not prove silence.
* **Safety controls:** run only on the identified TEST job; no evidence deletion; stop before any stage change.
* **Stop conditions:** any notification is queued, or the resubmit is blocked for a reason other than the intended one.
* **Read-back:** installer sees editable form then submitted state; office sees submitted + updated observation.

### Test 3 — Measured quote → offer → homeowner acceptance

* **Job:** TEST job past a submitted Ready Check.
* **Accounts:** office, homeowner link, installer A.
* **Starting state:** measured estimate present, no open offer.
* **Actions:** office records the measured quote and sends the offer; homeowner accepts via the token link.
* **Expected DB changes:** quote/offer rows inserted; acceptance recorded; stage advances per existing guards; `workflow_events` appended.
* **External side effects:** **email may be sent** — confirm `customer_comms_enabled` / `save_my_spot_real_send_enabled` state and the test-recipient boundary (S102) before sending; if in doubt, use the documented manual alternative.
* **Stop conditions:** any real customer address is used, or a send flag is ON without approval.
* **Read-back:** office sees accepted quote and the new stage; homeowner page shows the accepted state.

### Test 4 — Installer installation workflow (basic)

* **Job:** TEST job at installation stage, assigned to installer A.
* **Actions:** open the day page, record progress, upload one synthetic photo, record completion, set the Office next action.
* **Expected DB changes:** progress/completion rows for that job only; one evidence row; `workflow_events` append.
* **External side effects:** completion may notify Office by email — verify the same flags as test 3.
* **Read-back:** office sees the completion and the next action.

### Test 5 — Basic electrician result

* **Job:** TEST job with an assigned electrician and no Mitti-linked assessment.
* **Account:** electrician (TEST).
* **Actions:** open the job, enter the manual result fields, save.
* **Expected DB changes:** `assessments` row updated for that job (manual path); no PIESA form generated.
* **Stop conditions:** a Mitti-linked assessment appears (then the manual entry must be hidden — that is the correct behaviour, and the test is invalid for that job).
* **Read-back:** office sees the electrician result and the responsible party.

Plus, without any approval: the four read-only checks from §8.2 can be repeated by eye in Preview (A–D).

---

## 12. Exact owner approvals required next

1. **Open Preview for verification** — or authorise a session/credential so §8 can be completed. Without this, classification cannot move from D to A.
2. **Approve tests 1–5 above individually** (Preview writes to the shared production database). Tests 2–5 need explicit approval each; test 1 needs only Preview access.
3. **Confirm the comms flags for the UAT window** (`customer_comms_enabled`, `save_my_spot_real_send_enabled`, test-recipient boundary) so tests 3–4 cannot email a real customer.
4. **Decide on `public/` preview imagery** (9.2 MB in every build) and on the tracked `.env` — both delivery-hygiene decisions, neither urgent.
5. **Acknowledge COM09 Template-8 send as unwired** for handover, or authorise it as separate work.
6. **Production deploy remains unauthorised** — nothing in this brief deployed anything, and Preview is not production.

---

## Appendix — command log

```bash
git rev-parse --abbrev-ref HEAD                 # r1/brief-n-ready-check-success
git rev-parse HEAD                              # d64b9af9…
git status --porcelain                          # (empty)
git rev-list --left-right --count origin/main...HEAD   # 0	4
gh api repos/jetzhang123/hi-vic-operations/branches/main       # 07d7e56a
gh api repos/jetzhang123/hi-vic-operations/actions/workflows --jq .total_count   # 0
gh pr list --state open --json number,title,headRefName          # []
curl -o /dev/null -w '%{http_code}' https://id-preview--…lovable.app/   # 401

# build (clean container)
docker run --rm -v /tmp/brief-p-build:/app -w /app node:22-bookworm bash -lc \
  'npm i -g bun@1 && bun install --frozen-lockfile && npm run build; echo BUILD_EXIT=$?'
#   DEPS_EXIT=0   BUILD_EXIT=0   .output 874 files / 33 MB

# integration
git switch -c r1/brief-p-phase1-preview-integration
git push -u origin r1/brief-p-phase1-preview-integration     # d64b9af9
git merge-base --is-ancestor origin/main HEAD                # true
git push origin HEAD:main                                    # 07d7e56a..d64b9af9
gh api repos/jetzhang123/hi-vic-operations/branches/main     # d64b9af9
```
