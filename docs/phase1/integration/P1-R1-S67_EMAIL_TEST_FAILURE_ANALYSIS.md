# P1-R1-S67 · EMAIL TEST FAILURE ANALYSIS (S72 audit)

**Step:** P1-R1-S72-S67-FINAL-INTEGRATION-AUDIT-AND-HANDOFF-01 · **Executor:** R2 (verification) · **Date:** 2026-10-16 AEDT
**File:** `tests/s20r01-automatic-enquiry-emails.test.ts` · **This-execution result:** 16 pass / **3 fail** (suite-wide 3188 pass / 3 fail; this is the only failing file).

The three failures were investigated with **actual execution evidence** and a **production code-path trace**, not from prior reports.

## 0. Root cause (one sentence)
The three failing assertions encode **pre-COM04** behavior — that the approved "Save my spot" campaign sends even while the global master switch is OFF — but integrated COM04 commit **`9a0adf29` "enforce runtime guards for save my spot sends"** (15 Oct 21:51) moved Save-my-spot behind a **runtime double-switch** (`save_my_spot_real_send_enabled` **AND** `customer_comms_enabled`). The test (last written `c04641e8`, 13 Oct 18:26) was **not updated**, so Save-my-spot (`L`) now correctly sends **nothing**, cascading into all three failures.

## 1. Production code path (traced in HEAD @ 38fb2a47)
```
maybeAutoRouteLeadEmail(job)                     src/lib/lead-email-routing.server.ts:34
  → route.email === "offer_spot"
    → sendSaveMySpot([jobId], null, {...})       src/lib/hot-leads-send.server.ts:47
      → realOn = await realSendingOn()           src/lib/hot-leads-send.server.ts:28
        → SELECT save_my_spot_real_send_enabled, customer_comms_enabled FROM workflow_settings
        → return ws.save_my_spot_real_send_enabled === true
                 && ws.customer_comms_enabled === true
```
The test's `beforeEach` sets `workflow_settings: [{ id: 1, customer_comms_enabled: false }]`
(line 126) and **never sets `save_my_spot_real_send_enabled`**. So `realSendingOn()` → **false**, and
`sendOne(...)` does not make a provider call for the Save-my-spot lead. The compile-time constant
`SAVE_SPOT_REAL_SEND_APPROVED = true` still exists in `hot-leads.core.ts:93` but is **not consumed by the
send path** — the DB runtime switch governs (so it is dead code, not a live bypass).

## 2. Failure-by-failure evidence (actual)

### Failure 1 — `automatic enquiry emails OFF (production today) > only the already-approved Save my spot goes…`
- **Location:** test line 153–154.
- **Expected:** `maybeAutoRouteLeadEmail(L)` → `{ route:"offer_spot", sent:true }` and `calls.map(idem) === [KEYS.L]` (one Save-my-spot send even with master OFF).
- **Actual:** `sent` = **false**; the idem-call assertion expected 1 element, received the other two's non-calls (diff `Expected -1 / Received +2`).
- **Reason:** with both COM04 switches OFF, Save-my-spot is (correctly) gated off.

### Failure 2 — `automatic enquiry emails ON – new enquiry > each outcome sends its email ONCE…`
- **Location:** test line 161.
- **Expected:** `for j in [L,B,I] → sent===true` (3 sends).
- **Actual:** first iteration `L` → `sent` = **false** (`Expected: true / Received: false`).
- **Reason:** `autoOn()` only flips `customer_delivery_settings.enabled`; it does not set the COM04
  `save_my_spot_real_send_enabled`/`customer_comms_enabled` switches, so Save-my-spot is still gated.

### Failure 3 — `automatic enquiry emails ON – new enquiry > a repeated decision… never sends a second email`
- **Location:** test line 173.
- **Expected:** `calls.length === 3` (after one pass over L,B,I).
- **Actual:** `calls.length === 2` (only B and I sent; L never sent).
- **Reason:** same gating; L contributes 0 calls.

(The two adjacent assertions that DO pass — e.g. "a decision still under office review sends nothing", the
422/timeout retry-once test, historical/old/bad-recipient/suppressed/deleted/kill-switch guards, and the
"backlog worker stays OFF" test — confirm the master-switch and consent/idempotency guards are intact.)

## 3. Outdated test vs wrong production — determination
**The test expectation is outdated; production behavior is correct.** Evidence:
- Commit dating: guard `9a0adf29` (15 Oct 21:51) is **newer** than the test's last edit `c04641e8`
  (13 Oct 18:26) and **is** an ancestor of HEAD, i.e. the test predates the behavior change.
- The change is a **hardening** (COM04): Save-my-spot now requires an explicit, default-OFF runtime switch in
  addition to the master switch. The old test asserted the pre-hardening exemption.

## 4. COM04 fail-closed assessment
**PRESERVED and strengthened.** With `customer_comms_enabled=false` (test/production-today) and
`save_my_spot_real_send_enabled` default false (`0205` migration, rehearsal-confirmed), **no** automatic
customer email is sent — including Save-my-spot, which previously leaked through the hard-coded approval.
The failures are produced by production sending **less**, never more. There is **no communication-safety
regression**; the direction is safe.

## 5. Severity
- **Communications-safety severity:** **LOW** (behavior is more locked-down; the red is a stale expectation).
- **Release-process severity:** **MEDIUM** — a non-green suite blocks a clean automated sign-off and could
  mislead a reviewer into thinking real sends leak when the opposite is true.
- **Blast radius:** none (test-only mismatch; no runtime/customer impact).

## 6. Smallest safe remediation (RECOMMENDED — not applied here)
Per task boundaries this is a **verification-only** task; tests must not be edited to force green without
authorization. Recommend R1/owner apply the **test-side** fix only (production code is correct):
1. In `beforeEach`, set the COM04 switches explicitly for each scenario, e.g. for the "OFF (production
   today)" case assert Save-my-spot is now **also gated off** unless `save_my_spot_real_send_enabled` is true;
   for the "ON" cases set `workflow_settings:[{id:1, customer_comms_enabled:false, save_my_spot_real_send_enabled:true}]`
   (or the intended combination) so the assertions match the dual-switch gate.
2. Re-run to confirm 3/3 green **without** touching any guard.
3. Optionally remove the now-dead `SAVE_SPOT_REAL_SEND_APPROVED` constant (separate hygiene change).
Do **not** relax `realSendingOn()` or re-enable a compile-time bypass to satisfy the old test.

## 7. Verification commands (this execution)
- `bun test tests/s20r01-automatic-enquiry-emails.test.ts` → 16 pass / 3 fail (loopback env, fetch stubbed — no network, no sends).
- `bun run test` (isolated) → 3188 pass / 3 fail; only failing file is this one.
- Code trace via grep of `realSendingOn` / `sendSaveMySpot` / `SAVE_SPOT_REAL_SEND_APPROVED`.
