# P1-R1 Brief X — Fix Installer Measurement UI and Resume UAT

**Brief:** X — Fix Installer Measurement UI and Resume UAT · **Priority:** P1 (delivery blocker)
**Owner decision:** APPROVED · **Executor:** R1 — Lead Developer · **Date:** 19 October 2026 (AEDT)
**Defect:** P1-R1-DEF-01 — HIVIC-sourced jobs cannot complete the installer measure-up when Mitti is unavailable.

---

## Status at a glance (facts vs. blocked)

| Item | Status |
|---|---|
| **Fix implemented** | ✅ **YES** — local commit `1e93613e` on `r1/brief-x-measurement-ui` |
| **Local tests passed** | ✅ **YES** — tsc, unit + integration suites, full build (see §5–§7) |
| **Preview deployment confirmed** | ❌ **NO** — not deployed; requires owner-authorised push to shared `main` (withheld, §4) |
| **Browser UAT passed** | ❌ **NO** — not executed; blocked on Preview deployment (§8) |
| **F-1 PASS claimed** | ❌ **NO** — `piesa_scheduled → piesa_complete` not executed/verified here (not claimed) |

> This brief does **not** claim Phase 1 UAT PASS and does **not** claim F-1.

---

## 1. Exact root cause

**VERIFIED.** The manual measure-up component already exists and is complete — `MeasurementForm`
(`src/components/portal/requirements.tsx:169`): it autosaves via `saveMeasurement`, renders the six
measure fields, embeds an `EvidencePanel`, and completes via `completeMeasurement` (which performs the
`ready_check_scheduled → ready_check_complete → measured_estimate_ready` transitions and logs
`measurement_completed`). **But it was never mounted anywhere** — a repo-wide search for
`<MeasurementForm` returned only its definition.

In the installer's onsite route `src/routes/_authenticated/field.$jobId.tsx`, the measuring section of
`InstallerFlow` renders only `<MittiOnly jobId which="ready_check" />`. When Mitti is unavailable,
`MittiOnly` shows a notice that literally promises *"You can still enter and save the Ready Check on
this page"* — **but mounts no form**. So an installer on a HIVIC-sourced job with Mitti
unavailable had no UI to enter or complete the measure-up: **DEF-01**. The server side
(`saveMeasurement`/`completeMeasurement`) already supports the full flow; only the UI was missing.

## 2. Source file and line

**File:** `src/routes/_authenticated/field.$jobId.tsx` (the only file changed; +4 / −3).

- **Import (≈line 36–37):** added `MeasurementForm` to the `@/components/portal/requirements` import;
  added `import { MEASURE_FIELDS } from "@/lib/scope.core";`.
- **`MittiOnly` unavailable branch (≈line 122):** after the existing notice, mounted the manual form
  **only when the Mitti form can't open and `which === "ready_check"`**:

```tsx
: <><p className="text-sm font-medium" data-mitti-unavailable>{!invited ? "…isn't invited yet…" : "…isn't linked to this job yet…"}{which === "ready_check" ? " You can still enter and save the Ready Check on this page." : ""}</p>{which === "ready_check" && <MeasurementForm jobId={jobId} editable={[...MEASURE_FIELDS]} title="Ceiling measure-up" showComplete />}</>
```

- Updated the stale `MittiOnly` doc comment to describe the new fallback.

## 3. Minimal code changes / why safe

- **Reuses the existing component and server functions** — no new measurement system, no workflow
  redesign, no business-rule change. `completeMeasurement` still enforces stage, evidence, missing
  fields, and performs the transitions; `saveMeasurement` still enforces role + `planMeasurementUpdate`.
- **Preserves the Mitti pathway:** the manual form renders only in the Mitti-**unavailable** branch, so
  a Mitti-linked/invited job is unchanged. No duplicate completion action is introduced (the manual
  "Complete measure-up" is the only explicit completion in that state; the Mitti-available branch is
  untouched).
- **No direct `jobs.stage` manipulation** — transitions happen only through the existing server
  `transition()` calls inside `completeMeasurement`.
- **Compliance/RLS/auth/schema untouched** — enforcement stays server-side (`requireJobRole`,
  `requireMeasureEvidence`, `missingMeasureFields`).
- Baseline note: started from the **latest `origin/main` = `f0a3b781`** ("Brief T: F-1 electrician
  workflow fix"); Brief T's changes to `field.$jobId.tsx` (universal `ReadyCheckDraft`) and
  `requirements.server.ts` (electrician `piesa_scheduled→piesa_complete`) do **not** touch
  `MittiOnly`, `InstallerFlow`, `MeasurementForm`, `scope.core`, or `portal.functions` (verified by
  diff). Nothing newer was overwritten.

## 4. Reproduction evidence

- The defect is a **missing mount**, confirmed by: (a) `MeasurementForm` defined but `<MeasurementForm`
  absent repo-wide; (b) `MittiOnly`'s unavailable branch rendering only a `<p>`; (c) the
  `measuring && <MittiOnly …/>` gate being the sole content of the installer measuring section.
- After the fix, the **build output proves the mount is wired into the field route**: the string
  `Ceiling measure-up` (the `title` passed at the new mount) is present in both
  `.output/public/assets/field._jobId-*.js` and `.output/server/_ssr/field._jobId-*.mjs`, and
  `Complete measure-up` is present in the `requirements` chunk.

## 5. Local verification — results and exit codes

Worktree `wt-r1-brief-x-measurement`, branch `r1/brief-x-measurement-ui`, deps via
`bun install --frozen-lockfile` (498 packages).

| Check | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit -p tsconfig.json` | **PASS — exit 0**, zero errors |
| Measure-up logic (scope / AP-standard acceptance / pilot dual-verification) | `bun test tests/measurement.test.ts` | **PASS** (11) |
| Brief E persistent-alert regression (Offer + Mitti) | `bun test tests/brief-e-silent-action-feedback.test.tsx` | **PASS** 5/5 |
| Offer dispatch | `bun test tests/offer-dispatch.test.ts` | **PASS** 6/6 |
| Mitti core mapping | `bun test tests/mitti.core.test.ts` | **PASS** 27/27 |
| Ready Check gating (installer / later) | `bun test tests/installer-ready-check.test.ts tests/later-ready-check.test.ts` | **PASS** |
| Brief N ready-check + offer + office integration (PGlite, incl. transitions & "nothing sent externally") | `bun test tests/brief-n-ready-check-success.test.ts` (own process) | **PASS** 37/37 |

> Cross-process note (§5): running `brief-n` together with the component suites trips its own guard
> ("Supabase client is stubbed in this process… run the Brief N integration suites in their own bun
> invocation"). Run separately, it is **37/37**. This is a harness-isolation requirement, not a failure.

## 6. Real-database / integration test results

`brief-n-ready-check-success.test.ts` exercises the full ready-check → offer → office workflow against
an **in-memory PGlite** database (fixtures seeded, repeatable), asserting stage transitions, that no
offer row is created on rejection, and that **nothing is sent to any external service**. It passed
37/37 standalone. No live/production database was contacted; no HV-1417 / HV-2594 record was touched.

## 7. Build / typecheck results

- **TypeScript: PASS (exit 0).**
- **Production build: PASS (exit 0)** — `bun run build` completed client (3697 modules, ~4.8s), SSR
  (824 modules, ~4.9s) and **Nitro (`cloudflare-module`, ~0.9s)**; artifacts
  `.output/server/index.mjs` (80 KB), `.output/nitro.json` (`preset: cloudflare-module`),
  `.output/server/wrangler.json`.
- **Honest caveat (per §6):** the Nitro stage is only reachable with the local sandbox filesystem broker
  bypassed. In the **default sandbox**, Nitro's `public/design-preview/*` asset copy is denied with
  `CODEBUDDY_BROKER_DENY` — the same pre-existing, environment-only limitation recorded in S97 and
  Briefs C/E/F/G, **unrelated to this change** (it is a `public/` asset copy; the client+SSR stages that
  compile the change succeed either way). The full build above was obtained with the broker bypassed and
  is a genuine `exit 0`.

## 8. Preview integration requirements (not done — needs owner authorisation)

- The fix lives in local commit **`1e93613e`** on branch **`r1/brief-x-measurement-ui`** (base
  `f0a3b781`). It is **not** in Lovable Preview and **not** pushed.
- To reach Preview requires the same owner-gated operation as Brief H: confirm Lovable is **not
  diverged** (Project settings → Git → GitHub), then `git push origin r1/brief-x-measurement-ui:main`
  (non-force, fast-forward). **This brief does not authorise or perform that push** (§4: "Do not push to
  shared main without the required owner authorisation").
- **No production publish, no migration, no COM-04 activation** performed.

## 9. Browser UAT (HV-2594) — NOT executed (blocked)

§5's HV-2594 continuation (measured quote → homeowner acceptance → ≤1 Xero Demo invoice → TEST payment
→ electrician assignment → manual PIESA → F-1) is gated on the fix being **in Preview**, which is
blocked on the owner-authorised push above. Per the brief, no new job was created, no installer account
changed, and previously-passed steps were not repeated. **No interactive browser UAT was run in this
brief.** **F-1 is not claimed** — the `piesa_scheduled → piesa_complete` transition was not executed or
verified here.

## 10. Remaining blockers

| # | Blocker | Needed to clear |
|---|---|---|
| 1 | Fix not in Lovable Preview | Owner authorises one non-force push to `main` after confirming Lovable not diverged (as in Brief H) |
| 2 | HV-2594 UAT not resumed | Blocker 1, then continue from measurement completion per §5 |
| 3 | F-1 not verified | Executed only inside the HV-2594 journey (blocker 2); **not claimed** |
| 4 | Mitti template IDs in workflow settings | Standing owner-only item; until set, Mitti create on a real job is rejected (expected behaviour, not a failure) |

## 11. Safety compliance

No production DB writes · no modification of HV-1417 / HV-2594 · no real notifications · no real
external API calls · no workflow-configuration change · no migrations · no production publish · no
COM-04 activation · no push/merge/deploy · isolated worktree, no other worktrees touched. Tracked `.env`
untouched.

---

*Commit: `1e93613e` (fix) on `r1/brief-x-measurement-ui`. This report committed locally only.*
