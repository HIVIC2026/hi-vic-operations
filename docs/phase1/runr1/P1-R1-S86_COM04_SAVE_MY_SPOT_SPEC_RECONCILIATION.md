# P1-R1-S86 — COM-04 / S20-R01 Save-My-Spot Specification Reconciliation

**Step:** P1-R1-S86 · **Agent:** R1 · **Date:** 2026-10-16 AEDT · **Priority:** P0
**Branch / worktree:** `integration/p1-rc1-s67` @ `wt-p1-rc1-s67-integration`
**Owner decision (precondition):** **Option A approved** — Save-My-Spot real sending requires BOTH
`customer_comms_enabled = true` **AND** `save_my_spot_real_send_enabled = true`.

## 1. Baseline verification (actual, not assumed)
- **HEAD:** `e9f4c4219123b416db5bb4881ec699d112e7bfa0` (S81 tip), working tree clean. Not assumed unchanged — re-read.
- S74 DEF-07 integrated (`035ad23c`); `tests/def07-malformed-signed-snapshot.test.ts` present; DEF-07 **0 fail**.
- COM-04 guard `realSendingOn()` = `save_my_spot_real_send_enabled && customer_comms_enabled` (fail-closed) — unchanged (guard is authoritative, not weakened here).
- Pre-fix `tests/s20r01-automatic-enquiry-emails.test.ts`: **3 fail / 16 pass** (the historical Save-My-Spot master-off exemption).

## 2. The conflict (root cause of the 3 failures)
- **Historical S20-R01 wording** (src/lib AGENTS.md; `hot-leads-send.server.ts` doc comment) said the post-Gate-1
  router's **Save-my-spot** outcome may auto-send with the **master switch OFF** (via the pre-COM-04 hard-coded
  `SAVE_SPOT_REAL_SEND_APPROVED`).
- **COM-04** guard `9a0adf29` replaced that exemption with the two-switch `realSendingOn()`. So Save-my-spot no
  longer sends while the master switch is off → the three tests that asserted the old exemption failed.
- Confirmed by execution: gated Save-my-spot returns `sendOne` outcome `blocked` / detail **"Sending is switched off."**
- **Direction is safe** (the guard makes the app send *less*); it was an outdated spec + test, not a security hole.

## 3. Specification update (Option A encoded; unrelated S20-R01 rules preserved)
- `src/lib/AGENTS.md` (S20-R01 bullet): the master-off new-enquiry exemption now applies **only to
  insulation-details and ineligible**; **Save-My-Spot is explicitly removed from it** and documented as requiring
  BOTH switches (`realSendingOn()`, guard `9a0adf29`, fail-closed). All other S20-R01 requirements (start time,
  14-day cutoff, deleted/test/recipient/suppression re-check, ineligible-via-Resend-never-bridge, backlog worker
  behind the master switch, kill switch) are preserved verbatim.
- `src/lib/hot-leads-send.server.ts`: replaced the duplicated stale comment claiming Save-My-Spot is the one
  campaign allowed while the global switch stays OFF, with the accurate two-switch description.
- **No runtime code change** to any guard/gate; only the authoritative prose + a code comment were reconciled.

## 4. Test corrections (`tests/s20r01-automatic-enquiry-emails.test.ts` only)
Re-encoded to Option A — assertions were **strengthened/retargeted, never removed to force green**:
- **OFF (production today, master OFF):** Save-My-Spot now `sent:false` reason "Sending is switched off.";
  insulation `GROUP_B_GLOBALS_OFF`; ineligible `AUTO_REPLY_OFF`; **0 provider calls**.
- **New — missing switch fails closed:** master ON but `save_my_spot_real_send_enabled:false` → Save-My-Spot blocked, 0 calls.
- **New — positive path (task scenario B):** master ON + Save switch ON + delivery ON → Save-My-Spot sends once under its key.
- **"ON – new enquiry" (master OFF, S20-R01 path):** insulation + ineligible each send ONCE (2 calls, keys `B,I`,
  sent-row `resend`/`re_1`/`re_2`, one `job_communications` each); Save-My-Spot stays gated (Option A).
- **Repeated decision:** no second send; exactly 2 provider calls (B,I); Save-My-Spot gated.
- Preserved untouched: idempotency/dup, suppression, historical/too-old/no-start, bad-recipient, deleted,
  kill-switch, 422-refusal vs timeout `delivered_unrecorded`, backlog-worker-OFF, and ineligible never using the Base44 bridge.

## 5. Verification (THIS execution — not reused)
- Targeted S20-R01: **21 pass / 0 fail**.
- COM-04 + save-spot + hot-leads + enquiry cluster: **200 pass / 0 fail** ("COM-04 fail-closed" campaign-blocked test green).
- DEF-07: **10 / 0**.
- **TypeScript** `bunx tsc --noEmit`: **PASS**. **Build** `bun run build`: **PASS**.
- **Full isolated suite** `bun run test`: **335 files · 3203 pass · 0 fail · 0 skipped** (was 3198/3 before this task; +5 net tests from the added cases, all failures resolved without weakening any guard).

## 6. Safety boundaries honoured
- No production writes / DDL / DCL / config; no production migration; no real email/SMS (fetch stubbed, loopback
  guard, in-memory DB); COM04 real sending left OFF (both default-false switches unchanged); guard NOT weakened.
- No git push, no merge to main, no deployment. Tests not skipped/removed; assertions reflect the authoritative
  Option-A implementation.
- Statutory PIESA/PIISA, consent, RLS/authorization, and Save-My-Spot dual-switch gates all intact.

## 7. Result
The S20-R01 ↔ COM-04 conflict is **resolved by reconciliation to owner-approved Option A**: specification and
tests now state that real Save-My-Spot sending requires both runtime switches, while insulation/ineligible retain
the S20-R01 master-off new-enquiry path. The RC1 integration branch is fully green (3203/0). **No remaining
Save-My-Spot blocker.** Remaining RC1 blockers are unrelated (S64 not integrated, S75/S77 pending, migrations
REPORTED-only, `.env` untrack, isolated UAT runtime) and tracked in the S81 handoff.

**Files changed (S86):** `src/lib/AGENTS.md`, `src/lib/hot-leads-send.server.ts` (comment only),
`tests/s20r01-automatic-enquiry-emails.test.ts`, this report. No production-code behavior change.
