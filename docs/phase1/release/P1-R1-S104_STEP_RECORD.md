# P1-R1-S104 — STEP RECORD

**Step:** P1-R1-S104 · **Agent:** R1 — Lead Developer · **Mode:** ISOLATED DEVELOPMENT
**Integration branch:** `r1/p1-s104-unified-integration`
**Integration worktree:** `/Users/jet.zhang/CopilotWorkspace/Loveable/wt-r1-p1-s104-unified`
**Frozen baseline:** `c4fc1482dce12d9357a6df91ced921cc0a19d417`
**Report:** `docs/phase1/release/P1-R1-S104_UNIFIED_CODE_INTEGRATION.md`

---

## Source commits and how they were integrated

| Commit | Role | Integrated as |
|---|---|---|
| `c4fc1482` | frozen RC1 baseline | branch point |
| `217de8d4` | S101 environment remediation | `git merge --no-ff` |
| `e121da4a` | S102 COM-04 dual mode | **via S103's ancestry — NOT applied again** |
| `f7c9997f` | S103 Office automatic rules | `git merge --no-ff` |

Ancestry verified: `S102 → S103` is true; `merge-base(S101, S103) = c4fc1482`. S102 was therefore
applied exactly once, as required.

---

## Integration result

- **Conflicts resolved: none.** S101 changed only `vite.config.ts` + its report; S102/S103 changed 27
  other files. Disjoint surfaces, clean `ort` merges both times.
- `git diff f7c9997f HEAD` returns only S101's two files → S103's tree is intact.
- No existing agent worktree modified. The frozen baseline worktree is untouched.

---

## Changes made by this step

| File | Change | Reason |
|---|---|---|
| `src/routes/_authenticated/admin.save-my-spot-rules.tsx` | Preview intro no longer claims equivalence with the live route; "Finally eligible"/"Eligible" → "Matches selection rules — final sending checks pending"; added a disclosure block (scope + 500 cap + VEU≠installer + the sender-side checks the preview does not model); postcode and coverage hints now state the VEU/installer distinction | Step 3 verified defect + Step 4 wording |
| `src/lib/save-spot-rules.server.ts` | `eligible` reason qualified; `scanLimit` added to the preview result | Step 3 |
| `src/lib/save-spot-rules.functions.ts` | `previewScanLimit` returned by the loader so the cap is disclosed from the server | Step 3 |
| `tests/p1-r1-s104-unified-integration.test.ts` | New — 28 tests | Steps 3, 4, 5 |

Nothing else was changed. No sender logic, gate logic, switch, migration, template, workflow or schema.

---

## Step 3 — Preview accuracy: what was wrong and what changed

The preview did imply a guaranteed send:

- "It shows **exactly what the automatic route would do today**" — false; the preview does not model
  `sendOne`.
- "**Finally eligible**" and the per-row "**Eligible**" / "Matches every configured filter and every
  mandatory rule."

Corrected to the owner's suggested wording, plus a scope disclosure. Architecture preserved: same preview
function, same `PREVIEW_SCAN_LIMIT = 500`, same read-only reads, same shared gate logic, **no second
sending engine**. The cap is disclosed from the server value (`d.scanLimit`), not hard-coded, and no
server module is imported into the client component.

---

## Step 4 — Automatic sending safety

Live path confirmed in this order (asserted by index order in the new suite):

```
maybeAutoRouteLeadEmail → automaticLeadEmail → serviceCoverageEstablished → automaticSaveSpotGate
  → await sendSaveMySpot → sendOne
```

Exactly one call to each gate in the branch and in the file.

All ten confirmations hold:

| # | Confirmation | Result |
|---|---|---|
| 1 | Office rules only restrict selection | confirmed |
| 2 | Rules cannot override COM-04 | confirmed — gate never reads the switches; `sendOne:80` refuses |
| 3 | Rules cannot override consent | confirmed — `sendOne:130` |
| 4 | Rules cannot override opt-out | confirmed — `sendOne:103-104`, fail closed on read error |
| 5 | Rules cannot override idempotency | confirmed — `sendOne:143-147`, uncertain never auto-retried |
| 6 | Rules cannot bypass approved templates | confirmed — `sendOne:133/141` |
| 7 | Rules cannot bypass recipient restrictions | confirmed — boundary at `:93` and again at `:304`, immediately before `resendSend` at `:306` |
| 8 | Missing rules fail closed | confirmed — `missing`/`invalid`/`unreadable`/disabled all block |
| 9 | Historical backlog not processed | confirmed — `activatedAt` gate + re-stamp on off→on, no re-scan worker |
| 10 | Manual sending unaffected | confirmed — gate has one caller, takes no actor id |

### VEU postcode vs installer availability

**No material safety gap; no behavioural change made.** The gate proves a *covered Victorian VEU rebate
location*, which is what a Save My Spot invitation is gated on, and the approved email copy makes no
installer-availability promise (it defers to the free Ready Check). A stronger signal exists —
`pilot.core.ts verifiedServiceAreaMatch()` (`businesses.service_postcodes` + `coverage_verified_at`,
used by `allocation.server.ts` for trade allocation) — but requiring a verified installer *before* the
invitation would be a material behaviour change and a business decision, outside "minimal remediation".

Only the **wording** was corrected, in the three places an Office user could misread it. If the owner
wants installer availability gated, that is a separate approved change to the S102 gate.

---

## Step 5 — Test and build results

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | clean |
| Production build `bun run build` | success; `[s101-prune] Removed 28 orphaned server-only chunk(s)` |
| S102 focused | 36 pass / 0 fail |
| S103 focused | 64 pass / 0 fail |
| S104 focused (new) | 28 pass / 0 fail |
| COM-06 T05–T07 | 7 / 0 |
| Uncertain delivery | 31 / 0 |
| S20-R01 automatic enquiry emails | 21 / 0 |
| Group B pre-handoff | 9 / 0 |
| Manual communication links / render | 6 / 0 · 8 / 0 |
| `bun ./scripts/test-isolated.ts 8` | **341 files · 3446 pass · 0 fail** |
| Client-bundle scan | `supabaseAdmin`, `serviceCoverageEstablished`, `veu_location_variables`, `customer_estimate_links`, `save-spot-rules.server`, `service-coverage.server` → 0 files each |

Client-bundle protection measured: public `.js` assets **292 → 264**; files containing the
`SUPABASE_SERVICE_ROLE_KEY` env **name** **1 → 0**.

No unrelated browser UAT repeated.

---

## Remaining defects / release readiness

**No blocking defects.** The candidate is code-complete, conflict-free and fully tested in its current
fail-closed state.

Three items remain, all pre-existing and all requiring an owner decision — none can be done by an agent:

1. **Apply migration 0206** — until then automatic Save My Spot sending is blocked everywhere (by design).
2. **A separate COM-04 activation decision** — configuration capability is not delivery authorisation.
3. **Post-apply end-to-end verification** — every send assertion in this step is `ZERO provider calls`.

Also recorded: admin-wide authorisation for the rules screen (no narrower role exists), and the S103
report text still shows the old "Finally eligible" wording as that step's historical record.

---

## Restrictions honoured

No production writes · no migrations · no COM-04 activation · no real customer emails · no push · no
merge to a protected branch · no deployment · no unrelated feature development. Local commit only.

Build caches created by the IDE safe-delete guard were moved out of the worktree to
`/Users/jet.zhang/CopilotWorkspace/Loveable/.s104-build-caches/`.