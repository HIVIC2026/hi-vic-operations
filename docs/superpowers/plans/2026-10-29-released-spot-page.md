# Released Spot Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a saved spot is released, the owner's spot-saved My job page stops saying she is waiting.

**Architecture:** A pure helper in `owner-myjob.core.ts` turns `released` into what the page shows. The server adds `released` to `spotSaved` from the job's `spot_released` workflow event. `SpotSavedHome` reads the helper.

**Tech Stack:** TypeScript, React (TanStack Start), Supabase, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-released-spot-page-design.md`

## Global Constraints

- Change only the four things in the spec; headline, Ready Check times box, numbers and later stages unchanged.
- Not-released jobs must look exactly as today.
- Do not merge — open a pull request and stop (only the coordinating chat merges).

## Review Focus

- Spot released but owner never verified her code → waiting box still gone, times box still shows its code gate.
- Job with a `spot_released` event on another job only → must not count (query filters by `job_id`).
- Event lookup fails (DB error) → treat as not released; page still loads.
- Two `spot_released` events (released twice) → still released, no crash.
- Job opted out after release → page already hidden by `isSpotSavedStage`; unchanged.

---

### Task 1: Layout helper

**Files:**
- Modify: `src/lib/owner-myjob.core.ts` (after `SPOT_SAVED_PROGRESS`)
- Test: `tests/my-job-spot-saved.test.ts`

**Interfaces:**
- Produces: `spotSavedLayout(released: boolean): { stepLabel: string; showWaitingBox: boolean; doneSub: string | null; currentIndex: number }`

- [ ] **Step 1: Write the failing test** in `tests/my-job-spot-saved.test.ts`

```ts
test("not released: unchanged", () => expect(spotSavedLayout(false)).toEqual({ stepLabel: "Step 1 of 6", showWaitingBox: true, doneSub: "Nothing else to do until your spot is released.", currentIndex: 1 }));
test("released: no waiting messages, step 2, quote is current", () => expect(spotSavedLayout(true)).toEqual({ stepLabel: "Step 2 of 6", showWaitingBox: false, doneSub: null, currentIndex: 2 }));
```

- [ ] **Step 2: Run** `bun test tests/my-job-spot-saved.test.ts` — expect FAIL (`spotSavedLayout` not exported).
- [ ] **Step 3: Implement** `spotSavedLayout` in `src/lib/owner-myjob.core.ts` returning the values above.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `fix(my-job): layout helper for a released spot`

### Task 2: Server flag and page

**Files:**
- Modify: `src/lib/owner-myjob.server.ts` (second `Promise.all` ~line 46; `spotSaved` object ~line 115)
- Modify: `src/routes/my-job.$token.tsx` `SpotSavedHome` (~lines 928–985)
- Test: `tests/my-job-spot-saved.test.ts`

**Interfaces:**
- Consumes: `spotSavedLayout` (Task 1); `SPOT_RELEASED_EVENT` from `src/lib/spot-release.core.ts`
- Produces: `spotSaved.released: boolean` on the owner view

- [ ] **Step 1: Write the failing test**: a source check that `owner-myjob.server.ts` selects from `workflow_events` with `.eq("event_type", SPOT_RELEASED_EVENT)` and `.eq("job_id", jobId)`, and that `my-job.$token.tsx` calls `spotSavedLayout(` (follow the existing source-text test style in `tests/`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Server** — add to the second `Promise.all`: `admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", SPOT_RELEASED_EVENT).limit(1)`; set `released: !error && (data?.length ?? 0) > 0` in `spotSaved`.
- [ ] **Step 4: Page** — in `SpotSavedHome`, `const L = spotSavedLayout(sp.released)`: use `L.stepLabel` in the top line; render the yellow box only if `L.showWaitingBox`; render the done-card sub line only if `L.doneSub`; in the progress list tick every `i < L.currentIndex` and colour `i === L.currentIndex` blue.
- [ ] **Step 5: Run** `bun run test` and `npx tsc --noEmit` — expect all pass.
- [ ] **Step 6: Check on the TEST job** (released, no time booked) on the preview: waiting box gone, "Step 2 of 6", "Spot released" ticked.
- [ ] **Step 7: Commit, push branch `fix/released-spot-page`, open the pull request, stop.**
