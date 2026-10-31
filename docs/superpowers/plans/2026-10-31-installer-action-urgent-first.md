# Installer "Action needed" most urgent first: plan

Spec: `docs/superpowers/specs/2026-10-31-installer-action-urgent-first-design.md` (waiting for Jo's approval)

**Global constraints:** order only; same jobs, same words, same groups; no new database reads; installer home only.

### Task 1: Sort rule (test first)
- [ ] Add `waitedSince: string | null` to `InstallerHomeJob` (optional, so other callers still compile).
- [ ] Failing tests in `tests/installer-home-urgent-order.test.ts`:
  - two jobs with deadlines → soonest first;
  - a deadline beats no deadline;
  - two without a deadline → older `waitedSince` first;
  - full tie → lower job number first;
  - the coming, progress and done groups keep their old order.
- [ ] Add `actionOrder(a, b)` in `installer-home.core.ts` and use it only for `action` in `installerHomeGroups`.
- [ ] Tests pass; the existing installer-home tests still pass.

### Task 2: Feed the date (no new reads)
- [ ] In `tradeHome` (`src/lib/trade-view.server.ts`, where `installerHomeGroups` is called), pass `waitedSince: byId.get(j.jobId)?.updated_at ?? null`.
- [ ] `tests/trade-home-speed.test.ts` still passes: same round count, same snapshot apart from the action order. Update the snapshot only for the order, and say so in the commit.

### Task 3: Review and check
- [ ] Independent task review.
- [ ] PR, then merge with Jo's yes. Lovable checks the TEST owner home order and runs `installer-speed-capture --compare`. Publish only with Jo's yes.
