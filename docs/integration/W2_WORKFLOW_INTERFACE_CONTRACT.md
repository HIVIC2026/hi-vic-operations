# W2 — `workflow.server.ts` Interface Contract (for W3 / W4)

**Owner:** W2 (sole owner of `src/lib/workflow.server.ts`)
**Branch:** `w2-lifecycle-office` · **Worktree:** `wt-w2-lifecycle`
**Baseline:** GitHub `main` `ac6e8908` + W0 base `2df6ddc8`
**Port status:** Phase-1 fixes ported from donor; file is byte-identical to the approved donor.

> **Bottom line for W3/W4:** No existing signature changed. The port is **purely additive**.
> W3/W4 can rebase on this `workflow.server.ts` with **zero code changes** required on their side.

---

## 1. Exported interface (the full public surface W3/W4 may import)

All exports are from `src/lib/workflow.server.ts` and imported as `from "./workflow.server"`.

### Symbols W3 / W4 actually import today (must stay stable)
| Symbol | Kind | Signature | Changed by this port? |
|---|---|---|---|
| `WorkflowError` | class | `class WorkflowError extends Error {}` | No |
| `logEvent` | async fn | `logEvent(jobId, actorId, type, summary, details?, opts?) => Promise<void>` | No |
| `requireAdmin` | async fn | `requireAdmin(sb: Sb) => Promise<void>` | No |

These three are the only `workflow.server` symbols imported by W3 (installer / Mitti / one-tap / homeowner) and W4 (FFS / electrician / roles). **Their signatures are unchanged.**

### Full export list (stable — unchanged by the port)
| Symbol | Signature |
|---|---|
| `TRANSITIONS` | `Partial<Record<Stage, Stage[]>>` |
| `CONSUMER_SIGN_BLOCKER` / `ASSIGNMENT_VEEC_BLOCKER` | `string` |
| `agreementSigned` | `(jobId: string) => Promise<boolean>` |
| `assignmentStatus` | `(jobId: string) => Promise<string \| null>` |
| `requireJobRole` | `(sb: Sb, jobId: string, allowed: JobRole[]) => Promise<JobRole>` |
| `requireAdmin` | `(sb: Sb) => Promise<void>` |
| `logEvent` | `(jobId, actorId, type, summary, details?, opts?) => Promise<void>` |
| `getStage` | `(jobId: string) => Promise<Stage>` |
| `piesaStatus` | `(jobId: string) => Promise<…>` |
| `currentApprovedQuote` | `(jobId: string) => Promise<…>` |
| `paymentGate` | `(jobId: string) => Promise<…>` |
| `paymentOptionCleared` | `(jobId: string) => Promise<…>` |
| `piesaRequestFacts` | `(jobId: string) => Promise<…>` |
| `COMMERCIAL_BLOCKER` / `INSTALL_BOOKING_BLOCKER` | `string` |
| `commercialBlocker` | `(jobId: string) => Promise<string \| null>` |
| `measurementBlocker` | `(jobId: string) => Promise<string \| null>` |
| `installBookingBlocker` | `(jobId: string) => Promise<string \| null>` |
| `stageEntryBlockers` | `(jobId: string, to: Stage, actorId?: string \| null) => Promise<string[]>` |
| `transition` | `(jobId, to, actorId, summary, details?, opts?) => Promise<…>` |
| `nextStepBlockers` | `(jobId: string) => Promise<…>` |

---

## 2. New exports added by this port (additive only)

| New symbol | Signature | Notes |
|---|---|---|
| `paymentGateActiveForJob` | `(jobId: string) => Promise<boolean>` | Global switch OR live `qa_test` job; read-only. |
| `READY_CHECK_BOOKING_RECORD_BLOCKER` | `string` const | The one Ready-Check booking-record blocker, now exported for reuse. |
| `CONFIRMED_INSTALL_BOOKING_BLOCKER` | `string` const | P0 "Installation complete" guard message. |
| `INSTALL_BOOKING_READ_FAILED` | `string` const | Fail-closed read-error message for install booking. |
| `confirmedInstallBooking` | `(jobId: string) => Promise<{ booking: { id: string; scheduled_start: string \| null } \| null; blocker: string \| null }>` | P0: confirmed install booking; **fails closed** on read error. |

These are new names; they cannot collide with existing W3/W4 imports.

---

## 3. Internal behaviour changes (no signature impact)

- `transition()` now commits via the existing `commit_guarded_stage` RPC (migration `0073_guarded_stage_commit.sql`, already present on the branch). A concurrent stage change raises `WorkflowError` (a workflow outcome) instead of a hard crash — callers that already catch `WorkflowError` (e.g. `autoAdvanceJob`, sweeps) are unaffected.
- `TRANSITIONS.preliminary_estimate_ready` now also allows `ready_check_complete`.
- AP-review / Ready-for-VEEC evidence gate now **fails closed** via the new pure helper `ap-review-evidence.core.ts#evidenceStageBlockers`.

None of the above changes any exported signature.

---

## 4. Cross-workstream dependencies W2 relies on (keep STABLE)

`workflow.server.ts` dynamically imports from **`verified-eligibility.server.ts` (owned by W4)**:

| Symbol W2 calls | Required signature (must not change without a W0-brokered W2↔W4 decision) |
|---|---|
| `verifiedEligible` | `(jobId: string) => Promise<boolean>` |
| `priorActivityCheck` | `(jobId: string) => Promise<PriorActivityCheck \| null>` |

**W4:** keep these two signatures stable. W2 does **not** modify `verified-eligibility.server.ts`.

---

## 5. Integration instructions for W3 / W4

1. Rebase your branch onto W2's `workflow.server.ts` (this version).
2. You only import `WorkflowError`, `logEvent`, `requireAdmin` — all unchanged, so **no edits needed**.
3. If you need a *new* symbol or a signature change in `workflow.server.ts`, request it via **W0** (do not edit the file — W2 is sole owner).
4. **W4 only:** keep `verified-eligibility.server.ts`'s `verifiedEligible` / `priorActivityCheck` signatures stable (see §4).
