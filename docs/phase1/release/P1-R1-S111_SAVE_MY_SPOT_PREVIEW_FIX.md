# P1-R1-S111 — Fix Save My Spot "Preview matching customers"

**Agent:** R1 — Lead Developer · **Priority:** HIGH · **Type:** Targeted bug fix + regression testing
**Branch:** `fix/p1-save-spot-preview-read-batching`
**Worktree:** `/Users/jet.zhang/CopilotWorkspace/Loveable/wt-p1-preview-read-fix`
**Base:** `origin/main` @ `fc45df4e` ("P1-R1-S110: integrate verified RC1 … into main")
**Investigation read first:** `docs/phase1/release/SAVE_MY_SPOT_PREVIEW_MANDATORY_RECORDS_INVESTIGATION.md`
(local, untracked, in `wt-r1-p1-s110-github-integration` — see §9)

---

## 1. Problem description

The owner manually tested **Settings → Automatic sending rules → Preview matching customers** and got:

| Field | Observed |
|---|---|
| Checked enquiries | 500 |
| Match the filters | 25 |
| Excluded by a mandatory rule | **500** |
| Needs office review | 0 |
| Matches selection rules | 0 |

Every row read **"Mandatory records could not be read."**

Three defects are entangled in that output:

1. The five mandatory-record reads were issued with up to 500 ids in one PostgREST request.
2. A read failure was collapsed into the same bucket as a **genuine rule exclusion**, so 500 rows were
   labelled "Excluded by a mandatory rule" — wrong, and misleading to the operator.
3. Even without any read failure, the counting logic put a **filter mismatch** into
   `mandatoryExcluded`, so the totals could not be reconciled with the row outcomes.

## 2. Confirmed findings (verified in this worktree, against `origin/main`)

- `previewAutomaticSaveSpotMatching()` built five unbounded `.in()` queries:
  `owner_contact_consents`, `customer_email_optouts`, `customer_email_sends`,
  `veu_location_variables`, `post_intake_work`.
- The scanned id list is capped at `PREVIEW_SCAN_LIMIT = 500`; those 500 ids went into a single request.
- `readsFailed` was `true` if **any** of the five errored, and `previewMandatoryBlock()` returned the
  literal string `"Mandatory records could not be read."` for every row.
- The classification order was `match.eligible → else if (mandatoryBlock) → mandatory_excluded`, so any
  non-matching row that also had a mandatory block was counted as a mandatory exclusion.
- The project already bounds the **same tables**: `CHUNK = 150` in `enquiry-groups.server.ts:22-25` and
  `i += 150` in `operations-preview.server.ts:48-51`.
- The rules configuration itself reads fine (the owner sees a populated rules panel), so the failure is
  confined to these five bulk reads — not to `readAutomaticRules()`.

## 3. Root-cause hypothesis and verification status

**Hypothesis (from the investigation report):** the ~19–20 KB GET URL produced by 500 uuid ids is
rejected by the gateway, so all five mandatory reads fail.

**Verification status: PLAUSIBLE, NOT INDEPENDENTLY VERIFIED.** I did not reproduce the failure against a
real PostgREST endpoint and did not capture the actual HTTP status. What I *did* verify locally:

- 500 ids are genuinely placed in one `.in()` list before this fix (asserted by the new tests).
- 150 ids per request is the established, working convention for these exact tables elsewhere.

I am **not** claiming the oversized URL is the confirmed production root cause. The fix is correct
regardless of the exact cause — bounding request size is required either way, and the operator-visible
reporting is now correct whether the failure is a URL limit, a timeout, a permission problem or anything
else.

## 4. Files changed

| File | Change |
|---|---|
| `src/lib/save-spot-rules.server.ts` | bounded batching, distinct `records_unavailable` outcome, corrected counting semantics |
| `src/routes/_authenticated/admin.save-my-spot-rules.tsx` | error banner, new verdict label, a fifth count, a plain-English explanation of how the totals relate |
| `tests/p1-save-spot-preview-read-batching.test.ts` | **new** — 26 tests covering required cases A–I |

Explicitly **unchanged**: `hot-leads-send.server.ts` (the real sender), `lead-email-routing.server.ts`,
`service-coverage.server.ts`, `save-spot-rules.core.ts`, `save-spot-rules.functions.ts`,
`automaticSaveSpotGate`, `previewMandatoryBlock`'s safety checks, `PREVIEW_SCAN_LIMIT = 500`.

## 5. Implementation details

### 5.1 Bounded reads (project convention)

```ts
export const MANDATORY_BATCH_SIZE = 150;

export async function readInBatches<T>(values, read): Promise<BatchRead<T>>
```

Sequential within a source, still five sources in parallel, so no extra requests are introduced for small
scans (<=150 ids means one request per source, exactly as before). A failed batch is **counted and
reported**, never silently dropped, and never treated as "no rows".

### 5.2 Read failure is no longer a rule exclusion

`previewMandatoryBlock()` lost its `readsFailed` parameter. "We could not look" is now carried separately by
`recordsUnavailable` / `recordsError`, and the new verdict is `records_unavailable` with the reason
*"Preview cannot determine this result: the mandatory safety records could not be read."*

- No enquiry is reported ready on partial mandatory records.
- No enquiry is reported as *genuinely excluded* because a request failed.
- The operator sees a red banner naming which records failed and how many of their batches
  (`"owner contact consents (1 of 4 batches failed: …)"`).

### 5.3 Counting semantics

```
matching === eligible + mandatoryExcluded + recordsUnavailable
scanned  === matching + ruleExcluded + needsOfficeReview
```

Classification order: `match.eligible` -> (records unavailable? `records_unavailable`) -> (`mandatoryBlock`?
`mandatory_excluded`) -> `eligible`; else `needs_office_review` (only unknown records blocked it) or
`rule_excluded`. A filter mismatch is therefore **never** a mandatory exclusion. Both invariants are
asserted in the tests, and the UI states them in plain English.

Rows whose filter outcome is knowable from job data alone (`rule_excluded`, `needs_office_review`) stay
correct even while the mandatory records are unavailable — that is why the D-block test sees
`1 rule_excluded + 199 records_unavailable` rather than a blanket "could not determine".

### 5.4 Safety preserved

Every mandatory check still runs and still blocks: lifecycle, `offer_spot` route, S102 coverage, COM-04
switches, delivery configuration, consent, opt-out, duplicate send, automatic selection off, activation
stamp. The preview remains **read-only** — the module still contains no `insert`, `update`, `delete` or
sender call.

## 6. Test commands and actual results

| Command | Actual result |
|---|---|
| `bun test tests/p1-save-spot-preview-read-batching.test.ts` | **26 pass / 0 fail** |
| `bun test tests/p1-r3-s103-office-automatic-sending-rules.test.ts` | 64 pass / 0 fail |
| `bun test tests/p1-r1-s104-unified-integration.test.ts` | 28 pass / 0 fail |
| `bun test tests/p1-r3-s102-com04-dual-mode.test.ts` | 36 pass / 0 fail |
| `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **clean, no output** |
| `bun ./scripts/test-isolated.ts 8` | **342 files · 3472 pass · 0 fail · 102s** |
| `bun run build` | **success** — client, SSR, Nitro; `[s101-prune] Removed 28 orphaned server-only chunk(s)` |

No existing test needed modification. Coverage of the required cases:

| Case | Tests |
|---|---|
| A. small dataset | 2 — verdicts, counts, one request per source |
| B. 150 enquiries | 1 — single request, <=150 ids, all rows used |
| C. 500 enquiries | 3 — no request >150 ids, `[150,150,150,50]` per source, all four job-id sources plus the postcode source, results combined across boundaries (a consented job in the **last** batch is reported ready), filter applied across all batches |
| D. partial batch failure | 4 — fail-closed, banner text, no false ready, no false exclusion, all five sources covered, invariants hold |
| E. filter mismatch | 2 — not counted as mandatory exclusion; summary agrees with the rows |
| F. genuine mandatory exclusion | 7 — opt-out, duplicate, coverage, lifecycle, COM-04 off, missing consent, and unreadable != excluded |
| G. normal eligible | 1 |
| H. selection OFF | 1 — read-only, nothing sent |
| I. read-only guarantee | 2 — no writes / no send rows / no status change, including a failing batch and a 500-row scan |
| batching primitive | 3 — batch sizes, combination, failed-batch accounting |

## 7. Validation

- Diff vs `origin/main`: **2 source files + 1 new test**, +146/-35. No unrelated changes.
- The real automatic sender (`hot-leads-send.server.ts`) and the live gate are byte-identical to
  `origin/main` — verified with `git diff --stat origin/main -- <those paths>` returning empty.
- No safety control weakened: every removed line is a replacement, and `previewMandatoryBlock` keeps all
  of its checks (only the `readsFailed` early-return was replaced by the stronger `recordsUnavailable`
  path).
- Preview still read-only: `writes === []` asserted on 500-row scans **and** on failing batches.
- `PREVIEW_SCAN_LIMIT = 500` unchanged.
- No migration, no COM-04 change, no template change, no send, no database record touched.

## 8. Commit / branch / push status

- Branch: `fix/p1-save-spot-preview-read-batching`
- Commit: the commit that adds this record (SHA reported in the completion message)
- **Push status: NOT PUSHED.** Nothing was pushed. `origin/main` is untouched at `fc45df4e`.

## 9. Notes on repository state

- The local branch `r1/p1-s104-unified-integration` has **2 unpushed S106 documentation commits**
  (`f01d2b2c`, `7483aa16`) not on `origin/main`. They were **not** touched.
- `SAVE_MY_SPOT_PREVIEW_MANDATORY_RECORDS_INVESTIGATION.md` exists only as an **untracked** file in
  `wt-r1-p1-s110-github-integration` and is not on `origin/main`. It was read, not modified, and is not
  part of this commit.
- The `supabase/.temp/` directory produced by the S106 production work is untracked in that worktree and
  was left alone.

## 10. Manual Preview UAT checklist (owner)

> The bug is **not** fixed in Lovable Preview until this branch reaches GitHub -> Lovable Preview and the
> owner re-runs the steps. No production deployment has occurred.

1. Push/merge `fix/p1-save-spot-preview-read-batching` through the existing GitHub -> Lovable Preview path
   (Lovable Publish is out of scope and was **not** used).
2. In Lovable Preview, open **Settings -> Automatic sending rules**.
3. Press **Preview matching customers**.
4. **Expect no red banner.** If one appears it names the failing records and the preview is undetermined —
   send me the exact banner text.
5. **Expect the totals to reconcile:**
   - *Match the filters* = *Matches selection rules* + *Matches filters, but excluded by a mandatory rule*
     + *Cannot be determined*
   - *Checked* = *Match the filters* + *Does not match the configured filters* + *Needs office review*
6. **Expect row reasons to be specific** — e.g. "No contact consent from the owner on record.",
   "service_area_not_established", "Owner opted out", "A Save my spot email already exists…" — and never
   a blanket "Mandatory records could not be read."
7. Turn **one** filter on (e.g. Job status = *new enquiry*) and re-run the preview. **Expect** *Match the
   filters* to drop, and enquiries outside the filter to move to *Does not match the configured filters* —
   **not** to *excluded by a mandatory rule*.
8. Toggle **automatic selection OFF** and re-run. **Expect** 0 *Matches selection rules*, every matching row
   under *excluded by a mandatory rule* with the reason "Automatic Save my spot selection is off".
9. Confirm nothing was sent: no new rows in **Hot leads** / sent-email logs, and no change to any job's
   status.
10. If the totals still do not reconcile, send me the five numbers plus one row's full reason text.
