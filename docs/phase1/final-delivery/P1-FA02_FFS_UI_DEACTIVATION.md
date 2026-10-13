# P1-FA02 — FFS User Interface Deactivation

Agent: R3 — Feature Developer
Date: 2026-10-14 (Australia/Melbourne)
Baseline: `origin/main` = **`9251fc01`** (P1-S24 final integration; R1 audit P1-FA01 audited this same commit)
Feature branch: `r3/p1-fa02-ffs-ui-deactivation`
Working worktree: `wt-r3-p1-fa02-ffs-ui`

Owner decision implemented (14 Oct 2026): the application presents only the four intended user
groups — **Office, Homeowner, Electrician, Installer**. FFS is **not** an application role and its
functionality must not be user-visible. Backend code, database records and event types are
**preserved unchanged**; complete code cleanup is deferred.

---

## 1. Verified baseline

| Check | Result |
|---|---|
| `git fetch origin` | `origin/main` = `9251fc01` (unchanged since the R1 audit) |
| Local `main` before work | `4ef62eae` (stale) — **not used**; worktree created from `origin/main` |
| Worktree HEAD | `9251fc019d18e53e6070244df11991154278b134` |
| R1 audit re-read | `docs/phase1/final-delivery/P1-FA01_FFS_UI_VISIBILITY_AUDIT.md` (findings F-1…F-4, P-1…P-4, U-1…U-5) |
| Implementation vs audited baseline | **Identical** — no drift detected; all F-1…F-4 locations matched the audit exactly |

Scope confirmation: this step is a **targeted UI deactivation**, not a new development round. No
new roles, no schema/RLS/data changes, no event-type renames, no replacement features.

---

## 2. Files modified

| File | Change | Lines |
|---|---|---|
| `src/routes/_authenticated/field.$jobId.tsx` | Removed the `FfsProgressCard` import, the obsolete `P1-S23B` JSX comment, and the `{!role && <FfsProgressCard …/>}` render | −4 |
| `src/lib/jobfile.core.ts` | `buildTimeline()` now skips `ffs_progress_result` events (single presentation boundary); imports the canonical `FFS_PROGRESS_EVENT` constant | +6 |
| `src/components/portal/panels.tsx` | `TimelinePanel` filters `ffs_progress_result` from its rendered events; imports the same constant | +5 |
| `tests/ffs-minimum-results.p1-s23b.test.ts` | **TEST 9 updated** (not deleted): persistence assertions retained on the stored event; the timeline assertion now encodes the owner decision — no user-facing timeline renders the event, admin included | ±20 |
| `tests/p1-fa02-ffs-ui-deactivation.test.ts` | **New** focused test file (11 tests) pinning the deactivation | +110 |

Nothing else was touched. `git diff --stat`: 4 files changed (+35/−15 approx.), plus the new test file.

---

## 3. UI entry points removed

| Audit finding | What it was | Status |
|---|---|---|
| **F-1** | "Record a field update" card on `/field/$jobId` (generic-named FFS recorder) | **Removed** — component no longer mounts (no import, no JSX, no comment) |
| **F-3** | Card flashed for installers/electricians while `my_job_role` was loading (`!role` true on first render) | **Removed** — no render path exists at all |
| **F-4** | "Only the business admin can add an update." shown to non-admin members | **Removed** — the message lived only inside the removed card |
| **P-2** | `data-ffs-form` / `data-ffs-history` DOM attributes | **Removed from the app** — the whole component is unmounted |
| **P-4** | FFS wording in the JSX comment on the field page | **Removed** |

Method: the component was **unmounted**, not CSS-hidden. Verified in the production build: the
client bundle (`.output/public`) contains **zero** occurrences of `Record a field update`,
`Only the business admin can add an update.`, `Your updates` or `FFS update` (tree-shaken out).

---

## 4. Event presentation filters (smallest FFS-specific boundary)

Stored `ffs_progress_result` rows (written by the now-dormant backend) are excluded from every
user-facing surface by **one filter per presentation boundary**, keyed on the canonical
`FFS_PROGRESS_EVENT` constant (single source of truth — the literal is never duplicated or renamed):

| Boundary | File / location | Effect |
|---|---|---|
| Timeline builder (feeds the Office "Timeline / audit" list, the field/owner "History" timelines, **and** the job-pack `timeline.json`/`timeline.csv`) | `src/lib/jobfile.core.ts` → `buildTimeline()` — `if (e["event_type"] === FFS_PROGRESS_EVENT) continue;` | FFS events never become timeline items for **any** role, admin included |
| Office/owner "History" panel | `src/components/portal/panels.tsx` → `TimelinePanel` query result — `.filter((e) => e.event_type !== FFS_PROGRESS_EVENT)` | FFS events never render in the panel |
| Job pack export ("Include internal items") | Covered by the `buildTimeline` filter above (`exportJobPack` composes `buildTimeline(...).filter(includeInternal \|\| !internal)` at `src/lib/jobfile.server.ts:88`) | Selecting "Include internal items" still exports every **other** internal event; FFS events never appear |

Explicitly **not** done, per the brief:

- No global hiding of internal events — a non-FFS internal event (`qa_payment_simulated`) still
  reaches the admin timeline and still exports with "Include internal items" (pinned by tests).
- No database change, no summary rewrite, no `event_type` rename, no change to FFS persistence.
- No unrelated workflow history, evidence, photos, forms or documents touched.

Already-excluded paths verified (no change needed): `journey.tsx` reads only
`to_stage/created_at` and filters `.not("to_stage","is",null)` — FFS events have `to_stage = null`;
`worker-links.functions.ts` selects summaries `.eq("internal", false)` — FFS events are internal.

---

## 5. Tests executed

| Suite / command | Result |
|---|---|
| `bun test tests/p1-fa02-ffs-ui-deactivation.test.ts` (new) | **11 pass / 0 fail** |
| `bun test tests/ffs-minimum-results.p1-s23b.test.ts` | **30 pass / 0 fail** (TEST 9 updated to the owner decision) |
| `bun test tests/jobfile.test.ts` | **14 pass / 0 fail** |
| `bun test tests/allocation.core.test.ts` | **27 pass / 0 fail** |
| `bun test tests/legacy-path-retired.test.ts` | **11 pass / 0 fail** |
| `bun test tests/owner-job-route-terminal.test.tsx` | **8 pass / 0 fail** |
| `bun test tests/scheduling.test.ts` | **17 pass / 0 fail** |
| `bun test tests/trade-launch.test.ts` | **11 pass / 0 fail** |
| `bunx tsc --noEmit` | **exit 0** |
| `bun run build` (production) | **exit 0** |
| `bun ./scripts/test-isolated.ts 8` (full suite) | see §6 |

The new test file verifies, against the real source and the real pure functions: (1) no route
mounts `FfsProgressCard` or imports the FFS write surface; (2) `buildTimeline` drops
`ffs_progress_result` while normal and other-internal events remain; (3) the export composition
keeps non-FFS internal items with the option on and hides internals with it off; (4) both filters
are pinned to the canonical constant; (5) the installer/electrician flows on the field page are
untouched.

---

## 6. Test results (full suite)

`bun ./scripts/test-isolated.ts 8` — full isolated run, **328 files · 3057 pass · 22 fail · 87s**.

All 22 failures are in exactly the 4 files of the known pre-existing baseline (identical on the
untouched `9251fc01`, recorded in P1-S24): `existing-insulation-send` (2),
`group-b-declaration-routing` (8), `manual-communication.server` (11),
`save-spot-uncertain-delivery` (1). They are unrelated to this change and await their owning agent.
**Zero new failures** — no regression from this step. The new P1-FA02 test file and the updated
FFS suite are part of the 3057 passing.

---

## 7. Remaining backend FFS files (intentionally dormant)

**The FFS backend is preserved in the source tree, unchanged. It is NOT removed, and it is NOT
reachable from the UI.** Nothing in this step deleted, rewrote or disabled a backend file:

| File | Role | Status |
|---|---|---|
| `src/lib/ffs-progress.core.ts` | Event type, result categories, validation, summary builder | Unchanged; imported by the two filters for the canonical constant only |
| `src/lib/ffs-progress.server.ts` | Authorisation + persistence via `logEvent()` | Unchanged; no caller imports it any more (see §8) |
| `src/lib/ffs-progress.functions.ts` | Validated server functions `recordFfsProgress` / `listFfsProgress` | Unchanged; no caller imports it any more |
| `src/components/trade/ffs-progress.tsx` | The removed card's component | **File kept**, unmounted (per the brief: "Do not delete the underlying FFS component file") |
| `tests/ffs-minimum-results.p1-s23b.test.ts` | Backend behaviour tests | Kept and passing; TEST 9 re-pointed at the stored event + new invisibility rule |
| Database rows `event_type = 'ffs_progress_result'` in `workflow_events` | Historical records | **Untouched** — no SQL executed, no row read-modified-written |

Build note (verified, not a claim): because no module imports the FFS write surface after the card
removal, the production build tree-shakes `ffs-progress.functions/server` out of the bundle; only
the event-type constant survives in a 569-byte server chunk. The **source of record remains in the
repository** and can be re-activated or deleted wholesale in the deferred cleanup.

---

## 8. Known dependencies

- `src/routes/_authenticated/field.tsx:4-5` and `src/lib/clearance-guard.core.ts:3` still mention
  "FFS" in **source comments** (not rendered to users). Left in place to keep this diff minimal;
  cosmetic cleanup deferred.
- `src/lib/jobfile.core.ts` and `src/components/portal/panels.tsx` now import
  `FFS_PROGRESS_EVENT` from `ffs-progress.core`. This is deliberate: it guarantees the hide-filter
  can never drift from the (dormant) writer, and it forbids a future rename of the event type
  without failing `tests/p1-fa02-ffs-ui-deactivation.test.ts`.
- RLS is unchanged and remains the backstop: non-admin viewers never receive internal
  `workflow_events` rows at all. The new filters are presentation-layer defence-in-depth on top.
- The Lovable Preview/Production hosts still return HTTP 401 to unauthenticated probes, so — as in
  P1-FA01 — every UI claim here is code- and build-verified, not browser-observed.

---

## 9. Future cleanup instructions (deferred, owner approval required)

1. **Decide the fate of the dormant backend** (owner decision item from P1-FA01 §6.3): keep as-is,
   or delete `src/lib/ffs-progress.core.ts`, `ffs-progress.server.ts`, `ffs-progress.functions.ts`,
   `src/components/trade/ffs-progress.tsx` and re-point/delete
   `tests/ffs-minimum-results.p1-s23b.test.ts` at whatever remains.
2. **If the backend is deleted**, remove the two `FFS_PROGRESS_EVENT` imports/filters added here
   (or keep them reading a local literal if the stored rows must stay hidden).
3. **Existing rows** keep their `FFS update · …` summaries in the database. They are now invisible
   in every user-facing surface. Rewriting or deleting those rows is a **data change** and needs
   explicit owner approval — it is not part of this UI-only step.
4. Cosmetic: delete the FFS wording from `field.tsx:4-5` and `clearance-guard.core.ts:3` comments.
5. If FFS is ever re-approved as a feature, the card can be restored by re-adding the removed
   4 lines to `field.$jobId.tsx` and removing the two presentation filters — the backend still
   works exactly as P1-S23B left it.

---

## Verdict

No normal application user — Office, Homeowner, Electrician, Installer or business administrator —
can see or interact with FFS functionality any more: the recorder card does not mount, and
`ffs_progress_result` events are excluded from every user-facing timeline and job-pack export. The
four intended role workflows are untouched. The FFS backend remains **intentionally dormant and
preserved** in the source tree, and all existing database records are unchanged.
