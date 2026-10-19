# P1-R1-S104 — Unified Code Integration and Minimal Remediation

**Project:** Home Insulation Victoria · **Phase:** Phase 1 · **Round:** RC1
**Step:** P1-R1-S104 · **Agent:** R1 — Lead Developer
**Mode:** ISOLATED DEVELOPMENT

---

## 1. Step 1 — Repository verification

### Authoritative repository

| Item | Value |
|---|---|
| Git common dir | `/Users/jet.zhang/CopilotWorkspace/Loveable/hi-vic-github/.git` |
| Main worktree | `/Users/jet.zhang/CopilotWorkspace/Loveable/hi-vic-github` (`main` @ `7e3e5127`) |
| Frozen RC1 baseline worktree | `wt-p1-rc1-s67-integration` — `integration/p1-rc1-s67` @ `c4fc1482` |

`/Users/jet.zhang/CopilotWorkspace/Loveable` itself is **not** a git repository; every agent worktree
resolves to the single common dir above.

### Source commits — all four exist

| Commit | Type | Subject | Parent |
|---|---|---|---|
| `c4fc1482dce12d9357a6df91ced921cc0a19d417` | commit | P1-R1-S93: integrate S92 into RC1 + Office Template 8 invitation UI | `2ae67641` |
| `217de8d4bc1a0505c559a0e5b09fd34bfd34a61a` | commit | P1-R1-S101 (B3-06): prune orphaned server-only chunks from public bundle | `c4fc1482` |
| `e121da4aa6755c2d696c94a859c5f5b33b86f61b` | commit | S102 (final correction): enforce service-area coverage + narrow test-recipient boundary | `be38e46d` |
| `f7c9997f1cc33b27ee273514e456a0d17ca25152` | commit | P1-R3-S103: Office-configurable automatic Save My Spot sending rules | `e121da4a` |

### Ancestry (verified with `git merge-base --is-ancestor`)

```
c4fc1482  frozen RC1 baseline
├── 217de8d4  S101  (single commit on the baseline)
└── be38e46d → e121da4a  S102 (two commits)
        └── f7c9997f  S103 (single commit)
```

- baseline → S101: **yes**
- baseline → S102: **yes**
- baseline → S103: **yes**
- S102 → S103: **yes** (S103 already contains S102)
- merge-base(S101, S103) = `c4fc1482` → the two lines diverge exactly at the frozen baseline

**S102 was therefore applied exactly once**, through S103's ancestry, as instructed.

### Worktree status

| Worktree | Branch | HEAD | Uncommitted |
|---|---|---|---|
| `wt-p1-rc1-s67-integration` | `integration/p1-rc1-s67` | `c4fc1482` | clean (frozen baseline, untouched) |
| `wt-r1-p1-s101-env-remediation` | `r1/p1-rc1-s101-env-remediation` | `217de8d4` | only untracked `.copilot_runs/` (agent scratch, **not** part of the source commit, not integrated) |
| `wt-r3-p1-s103-office-rules` | `r3/p1-s103-office-auto-rules` | `f7c9997f` | clean |

New isolated worktree created for this step: **`wt-r1-p1-s104-unified`** on branch
**`r1/p1-s104-unified-integration`**, created directly from `c4fc1482`. No existing agent worktree was
modified. `node_modules` symlinked from the shared install (same convention as S102/S103).

---

## 2. Step 2 — Integration

### Change surfaces (measured before merging)

| Line | Files | Touches |
|---|---|---|
| S101 | 2 | `vite.config.ts` (build plugin), `P1-R1-S101_ENVIRONMENT_REMEDIATION.md` |
| S102+S103 (baseline → `f7c9997f`) | 27 | `src/lib/*`, `src/routes/*`, `src/integrations/supabase/types.ts`, `src/routeTree.gen.ts`, `tests/*`, `docs/*` |

The two surfaces are **disjoint** — no common path.

### Merge result: **zero conflicts**

```
git merge --no-ff 217de8d4   → Merge made by the 'ort' strategy.
git merge --no-ff f7c9997f   → clean merge, 9 files created.
```

`git diff f7c9997f HEAD` on the integrated tree returns **only** S101's two files
(`vite.config.ts` + its report). S103's tree is bit-for-bit present, and S101's configuration is
bit-for-bit present. Nothing had to be resolved, so no conflict could be resolved wrongly.

### Conflicts resolved

**None.** No merge conflict, no semantic conflict, no manual resolution.

### Preserved capabilities — verified item by item

| Required to preserve | Where it lives in the integrated tree | Verified by |
|---|---|---|
| Environment hardening | `vite.config.ts` — S101 plugin `hiv-prune-orphan-server-chunks-s101`, `apply: "build"` | build log `[s101-prune] Removed 28 orphaned server-only chunk(s)`; `tests/p1-r1-s104-unified-integration.test.ts` |
| Client-bundle protection | same plugin; measured below | asset count 292 → **264**; service-role env-var name 1 → **0** files |
| COM-04 safety controls | `hot-leads-send.server.ts:29-34` `realSendingOn()` + `:80` sender refusal | S102/S103 suites + full harness |
| Manual Save My Spot sending | `sendSaveMySpot(jobIds, actorId)` — **never** called through the rules gate | S103 suite "Office manual sending is unaffected"; S104 suite item 10 |
| Automatic Save My Spot sending | `maybeAutoRouteLeadEmail` → `offer_spot` branch | S102/S103/S104 suites |
| Test-recipient restrictions | `comms-test-recipient.core.ts`; checked early **and** on the final recipient immediately before `resendSend` | S102 suite (36); S104 suite item 7 |
| S102 service-coverage gate | `service-coverage.server.ts`; one call in the `offer_spot` branch | S102 suite; S104 suite "not applied twice" |
| Office-configurable rules | `save-spot-rules.{core,server,functions}.ts` + `/admin/save-my-spot-rules` | S103 suite (64) |
| Read-only preview | `previewAutomaticSaveSpotMatching` — no `insert` / `update` / `delete` / sender call anywhere in the module | S103 suite + S104 suite |
| Admin permissions | `requireAdmin(context.supabase)` in all 4 server fns | S103 suite (behavioural: non-admin rejected on load/save/validate/preview) |
| Configuration audit | `admin_config_events` append on every save (actor, timestamp, previous config, new config) | S103 suite |
| Fail-closed defaults | `DEFAULT '{}'` in 0206; `readAutomaticRules` → `missing`/`invalid`/`unreadable` all block; COM-04 OFF everywhere | full harness |

---

## 3. Step 3 — Preview accuracy

### The defect was real

The S103 preview UI over-promised in three places:

| Location | Original wording | Problem |
|---|---|---|
| Preview intro | "It shows **exactly what the automatic route would do today**." | The preview does **not** model the sender-side checks. This is a false statement of equivalence. |
| Stat label | "**Finally eligible**" | Reads as "this customer will get the email". |
| Row verdict + reason | "**Eligible**" / "Matches every configured filter and every mandatory rule." | Same implication, per row. |

It also failed to disclose the 500-record scope limit, and never mentioned that a VEU postcode is not
installer availability.

### Smallest safe correction applied

Architecture unchanged: same preview function, same 500-record limit, same read-only reads, same shared
gate logic, **no second sending engine**.

1. **Intro** now states it shows how the route would *select* customers and explicitly: *"It is not a
   promise that an email is sent: the final sending checks run later, in the email sender."* Read-only
   guarantees retained.
2. **Stat label** → **"Matches selection rules — final sending checks pending"** (the owner's suggested
   wording).
3. **Row verdict label** → same wording; row **reason** → *"Matches the selection rules only. The final
   sending checks in the email sender still apply."*
4. **New disclosure block** (a `<details>` element, no new page or engine) listing:
   - the scope: the most recent *N* non-deleted enquiries with an official eligibility decision, where
     *N* comes from the server (`d.scanLimit`, backed by `PREVIEW_SCAN_LIMIT = 500`), and that this is
     not a full history report;
   - that a VEU postcode establishes a covered Victorian rebate location, **not** installer availability;
   - the sender-side checks the preview does **not** model: secure estimate link, current preliminary
     price, spot already saved, whole-VEEC discount check, approved template, provider configured.
5. **`previewScanLimit` / `scanLimit`** added to the server responses so the number is disclosed from the
   single source of truth rather than hard-coded in the UI (and no server module is imported into the
   client component).

---

## 4. Step 4 — Automatic sending safety

### Live path, as it actually reads in the integrated tree

```
postintake.server.ts
  → maybeAutoRouteLeadEmail                       lead-email-routing.server.ts:29
      → selectLeadEmailRoute → automaticLeadEmail  enquiry-groups.core.ts   (THE single selector)
      → offer_spot branch:                         lead-email-routing.server.ts:34
          1  syncStep3
          2  serviceCoverageEstablished            service-coverage.server.ts   (S102)
          3  automaticSaveSpotGate                 save-spot-rules.server.ts    (S103)
          4  await sendSaveMySpot                  hot-leads-send.server.ts:47
               → sendOne                          hot-leads-send.server.ts:73
```

Index order asserted in the S104 suite (`syncStep3` < `serviceCoverageEstablished` <
`automaticSaveSpotGate` < `await sendSaveMySpot(`), and exactly **one** call to each gate in the branch
and **one** in the whole file — so S102 is applied once, not twice.

### The ten confirmations

| # | Confirmation | Where enforced | Result |
|---|---|---|---|
| 1 | Rules only restrict selection | Gate returns `allowed:false` only; it has no code path that adds a candidate, and it only ever receives an already-selected `offer_spot` | **confirmed** |
| 2 | Rules cannot override COM-04 | Gate never reads the switches (deliberately); `sendOne:80` refuses on `!realOn` with `"Sending is switched off."`; `realSendingOn()` requires **both** `save_my_spot_real_send_enabled` and `customer_comms_enabled` and fails closed on read error | **confirmed** |
| 3 | Rules cannot override consent | `sendOne:130` `hasCurrentOwnerContactConsent` → skip | **confirmed** |
| 4 | Rules cannot override opt-out | `sendOne:103` fails closed on any unreadable opt-out/response/link/estimate; `:104` skip on opt-out | **confirmed** |
| 5 | Rules cannot override idempotency | `sendOne:143-147` idempotency key + `reservationAllowed`; `delivered_unrecorded` never auto-retried | **confirmed** |
| 6 | Rules cannot bypass approved templates | `sendOne:141` `INSULATION_DETAILS_REAL_SEND_APPROVED`; only the approved Group A email may be sent from this list (`:133`) | **confirmed** |
| 7 | Rules cannot bypass recipient restrictions | `testRecipientBoundary` at `:93` (early) **and** `:304` on the final resolved recipient, immediately before `resendSend` at `:306` | **confirmed** |
| 8 | Missing rules fail closed | `readAutomaticRules()` → `missing` / `invalid` / `unreadable` ⇒ `rules_unavailable`; `enabled !== true` ⇒ `selection_disabled`; unreadable job ⇒ `job_unreadable` | **confirmed** |
| 9 | Historical backlog is not processed | `created < Date.parse(config.activatedAt)` ⇒ `historical`; `activatedAt` re-stamped on every off→on transition; no re-scan worker exists | **confirmed** |
| 10 | Manual sending remains unaffected | The gate has exactly one caller (`maybeAutoRouteLeadEmail`) and takes no actor id; `sendSaveMySpot(jobIds, actorId)` is otherwise unchanged | **confirmed** |

### VEU postcode vs actual installer service availability

**Finding: no material safety gap. No behavioural change made.** Reasoning from the actual repository:

1. **The gate's documented meaning is narrow and correct.** `service-coverage.server.ts` states: *"A
   property whose postcode is present there is positively established as a covered VEU Victorian
   location… This does NOT infer installer availability from a postcode."* The gate therefore proves a
   **Victorian rebate location**, which is what a Save My Spot invitation is gated on.
2. **The customer-facing copy makes no installer claim.** Inspected `save-spot-offer.core.ts`: the
   approved email says the home *"looks likely to be eligible for the Victorian Energy Upgrades ceiling
   insulation rebate"*, gives a preliminary estimate with an explicitly labelled assumed area, and defers
   confirmation to the **free Ready Check**. There is no promise of installer availability, installer
   scheduling, or "we service your area". Asserted by test.
3. **A stronger signal exists but belongs to a different decision.** `pilot.core.ts`
   `verifiedServiceAreaMatch()` (`businesses.service_postcodes` + `coverage_verified_at`) is real and is
   used by `allocation.server.ts` for **trade allocation** — a later, per-job decision that happens after
   an owner has saved a spot. Requiring a matching verified installer **before** sending a Save My Spot
   invitation would be a material behaviour change: it would suppress automatic sends whenever no
   installer record covers the postcode, which is a business decision, not a defect fix. It is also
   explicitly outside this step ("Do not introduce new features", "no unrelated feature development").

**Action taken instead (wording only, no logic change):** the integration now states the distinction in
the two places an Office user could otherwise misread it —

- the mandatory-rules list on the screen: *"Service-area coverage established from existing records (S102)
  — a Victorian VEU location, **not installer availability**"*;
- the postcode-filter hint: *"...even that only establishes a Victorian VEU location, not installer
  availability"*;
- the preview disclosure block repeats it.

**Recommendation for the owner (not implemented here):** if the business wants automatic Save My Spot
sending to require a verified installer for the postcode, that is a separate, owner-approved change to
the S102 gate, and it should use `verifiedServiceAreaMatch` rather than the postcode alone.

---

## 5. Step 5 — Testing

| Check | Command | Result |
|---|---|---|
| TypeScript | `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **clean, no output** |
| Production build | `bun run build` | **success** — client, SSR, Nitro; `[s101-prune] Removed 28 orphaned server-only chunk(s)` |
| S102 focused | `tests/p1-r3-s102-com04-dual-mode.test.ts` | **36 pass / 0 fail** |
| S103 focused | `tests/p1-r3-s103-office-automatic-sending-rules.test.ts` | **64 pass / 0 fail** |
| S104 focused (new) | `tests/p1-r1-s104-unified-integration.test.ts` | **28 pass / 0 fail** |
| COM-06 duplicate/idempotency | `tests/com06-t05-t07.test.ts` | 7 / 0 |
| Uncertain delivery + duplicates | `tests/save-spot-uncertain-delivery.test.ts` | 31 / 0 |
| Automatic enquiry emails | `tests/s20r01-automatic-enquiry-emails.test.ts` | 21 / 0 |
| Group B pre-handoff | `tests/group-b-prehandoff.test.ts` | 9 / 0 |
| Manual communication links | `tests/manual-communication.links.test.ts` | 6 / 0 |
| Manual communication render | `tests/manual-communication.render.test.ts` | 8 / 0 |
| **Authoritative isolated harness** | `bun ./scripts/test-isolated.ts 8` | **341 files · 3446 pass · 0 fail** |
| Client-bundle scan | `grep` over `.output/public/assets/*.js` | `supabaseAdmin`, `serviceCoverageEstablished`, `veu_location_variables`, `customer_estimate_links`, `save-spot-rules.server`, `service-coverage.server` → **0 files each** |

`scripts/test-isolated.ts` is the authoritative harness; raw `bun test tests/` is not used because it
produces known false failures from shared-process Happy-DOM/PGlite conflicts.

### No-regression confirmations required by the step

| Area | Evidence |
|---|---|
| Manual sending | S103 "Office manual sending is unaffected"; S104 item 10; `manual-communication.*` 6 + 8 pass |
| Automatic selection | S103 live-path block (7 tests); S104 path-order block (3 tests) |
| COM-04 OFF behaviour | S102 suite; S103 "COM-04 switches are not re-implemented in the gate"; S20-R01 21 pass with the original `route`/`reason` values |
| Test-recipient boundary | S102 suite (reserved-domain-only narrowing) + S104 item 7 (final-recipient check precedes the provider call) |
| Office permissions | S103 behavioural non-admin test + source guard; S104 integration-preservation block |
| Preview read-only behaviour | S103 "ZERO side effects"; S104 `no insert/update/delete/sender in the module` |
| Duplicate prevention | `com06-t05-t07` 7/0; `save-spot-uncertain-delivery` 31/0; S104 item 5 |
| Historical backlog prevention | S103 no-backlog block (4 tests); S104 item 9 |

### Measurable S101 client-bundle protection effect

| | S103-only build | S104 integrated build |
|---|---|---|
| public client `.js` assets | 292 | **264** |
| files containing the `SUPABASE_SERVICE_ROLE_KEY` env **name** | 1 | **0** |

S101's plugin removes orphaned server-only chunks that the server build emits into the public directory.
Integration preserved it and the effect is real and measurable.

No unrelated browser UAT was repeated.

---

## 6. Changes made by this step

### Integration (no authored conflict resolution required)

- Merged `217de8d4` (S101) into the new branch.
- Merged `f7c9997f` (S103, carrying S102) into the same branch.

### Minimal remediation

| File | Change | Why |
|---|---|---|
| `src/routes/_authenticated/admin.save-my-spot-rules.tsx` | preview intro, stat label, row verdict label, new disclosure block, postcode + coverage wording | Step 3; Step 4 wording |
| `src/lib/save-spot-rules.server.ts` | qualified `eligible` reason; `scanLimit: PREVIEW_SCAN_LIMIT` in the preview result | Step 3 |
| `src/lib/save-spot-rules.functions.ts` | `previewScanLimit` exposed by the loader (server-side value, not a hard-coded number) | Step 3 |
| `tests/p1-r1-s104-unified-integration.test.ts` | **new** — 28 integration/safety tests | Steps 3, 4, 5 |

No sender logic changed. No gate logic changed. No switch, migration, template, workflow or schema was
touched.

---

## 7. Remaining defects

**None blocking release.** Known, pre-existing and explicitly out of scope for this step:

1. **0206 is still a proposal.** `workflow_settings.save_my_spot_auto_rules` is **not** applied, so the
   column read fails and **automatic Save My Spot sending is blocked in every environment**. This is the
   intended fail-closed design, not a defect, but it is the hard prerequisite for any automatic sending.
2. **COM-04 switches remain OFF.** No automatic or manual Save My Spot email can be delivered. No
   activation was performed and none was authorised by this step.
3. **No end-to-end evidence of a real send.** Every send assertion in this step is `ZERO provider calls`,
   by design and by restriction.
4. **The Office preview cannot be validated at production scale** until 0206 is applied (the page shows
   "rules could not be read from settings" meanwhile).
5. **Documentation defect inherited from S103, corrected here:** the S103 report presented the eligible
   bucket as "Finally eligible" and did not disclose the preview's 500-record limit or its non-modelled
   checks. The UI is fixed; the S103 report text remains as the historical record of that step.
6. **Authorisation is admin-wide** for the rules screen — there is no narrower "communications settings"
   role in this platform. Documented in S103 §9; unchanged.
7. **Installer availability is still not verified** before an automatic Save My Spot send (see §4). Not a
   defect against the current approved S102 design; listed as an owner decision if it ever should be.

---

## 8. Release readiness

### Ready

- S101, S102 and S103 are integrated into **one coherent tree** with **zero conflicts**, from the frozen
  baseline `c4fc1482`, on an isolated branch.
- All eleven required capabilities are present and verified.
- TypeScript clean, production build succeeds, **341 files / 3446 tests pass / 0 fail**.
- The live automatic path is in the required order, S102 is applied exactly once, and all ten safety
  confirmations hold. The Office rules can only ever remove candidates.
- The preview no longer implies a guaranteed send, discloses its scope and its limit, and states the
  VEU-vs-installer distinction.
- S101's client-bundle protection is active and measurably effective (292 → 264 chunks; service-role env
  name eliminated from the public bundle).

### Not ready — required before any automatic email is delivered

1. **Apply 0206** (owner approval, controlled procedure in `docs/pending-migrations/README_DO_NOT_APPLY.md`).
2. **A separate, explicit COM-04 activation decision.** Configuration capability ≠ delivery authorisation.
3. **Post-apply end-to-end verification** on the live path once 1 and 2 are done.

**Verdict: the release candidate is code-complete, conflict-free, fully tested and safe in its current
fail-closed state. It is not authorised to send, and by design it cannot.**

### Restrictions honoured

No production writes · no migrations applied · no COM-04 activation · no real customer emails · no push ·
no merge to a protected branch · no deployment · no unrelated feature development. Local commit only, on
`r1/p1-s104-unified-integration`.