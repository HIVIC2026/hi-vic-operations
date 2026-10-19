# PHASE 1 — PRODUCTION SMOKE TEST REPORT

- **Project:** Home Insulation Victoria
- **Phase:** Phase 1
- **Task:** Production Smoke Test & Deployment Verification
- **Mode:** Autonomous — read-only production verification
- **Test window:** 2026-10-20 09:50–09:54 AEDT (Australia/Melbourne)
- **Browser:** Google Chrome 155.0.8059.84 (macOS), CDP-driven, read-only
- **Status of this document:** The production smoke test **did not pass its mandatory preconditions**. The
  report records what was verified, what was refused, and why. It does **not** declare a production PASS.

---

## FINAL VERDICT (stated first)

> ## PRODUCTION SMOKE TEST — BLOCKED
>
> **Reason: DEPLOYMENT NOT COMPLETED.**
> Production is serving commit `63ef6cae`, **not** the approved technical baseline `36a29bf2`. The approved
> baseline is four commits ahead and has never been published. Additionally, **no written C13 owner
> authorisation exists on record**, which is the precondition for publishing at all.

The deployed application itself is up, rendering and correctly protecting unauthenticated routes — but it is
**not the build that passed technical acceptance**, and it is missing four verified corrections.

---

## 1. Test date and time

2026-10-20, 09:50–09:54 AEDT (Australia/Melbourne). All probes were GET-only; no form was submitted, no
credential was entered, no record was created, modified or deleted.

## 2. Production URL

**`https://estimate.homeinsulationvictoria.com.au/`** — HTTP 200, served by Cloudflare
(`cf-ray: a4d35a2f6a192663-MEL`).

`https://hi-vic-operations.lovable.app/` responds **302 →** the URL above, i.e. the Lovable project domain is
an alias for the published production site, not a separate deployment.

## 3. Approved release commit

**`36a29bf27bff29987f1020c06f5cda3e96d33d44`** — the baseline named in the task, and confirmed as
`origin/main` with a clean working tree and no later commits (`git log 36a29bf2..origin/main` is empty).

## 4. Verified deployed commit

**`63ef6cae4eff42058ce77264117e03d8c1d92d18`** — verified, not inferred.

Method: Vite emits content-hashed asset filenames, so the deployed asset set fingerprints the source tree.

1. The production HTML references 37 distinct `/assets/*.js|css` files.
2. Those 37 were compared against a fresh local production build of `36a29bf2` and of `63ef6cae`,
   built in isolated worktrees with the same toolchain.
3. Against the **`63ef6cae` build: 37/37 match, 0 missing.**
   Against the **`36a29bf2` build: 3 missing** (`index-CEM-_FG2.js`, `routes-BP4wjk5Y.js`,
   `JobsWorkspace-CRp0v7WA.js`).
4. Cryptographic confirmation on the differing chunk:

   ```
   production  /assets/JobsWorkspace-CRp0v7WA.js   sha256 6d6055ba05097f7e4c1ff2f2e1cb68a94223898cd89dc8a40f5d792da6366d0a
   local 63ef6cae build, same file                 sha256 6d6055ba05097f7e4c1ff2f2e1cb68a94223898cd89dc8a40f5d792da6366d0a
   ```

   Byte-identical. That chunk does not exist in the `36a29bf2` build at all (it is
   `JobsWorkspace-NhIQiEM9.js` there).

**Conclusion: production is exactly `63ef6cae`, four commits behind the approved baseline.**

```
63ef6cae  ← DEPLOYED IN PRODUCTION
d2ca34e4  docs(p1): update release status after RC-1 fix
fa0d1139  fix(p1): close FFS exposure and PIESA advance gaps          (RC-4, RC-10)
c22adf2e  fix(p1): restore Ready Check ownership guard and harden …   (RC-2, RC-8)
36a29bf2  docs(p1): final acceptance and closure record               ← APPROVED BASELINE
```

## 5. C13 authorization reference

**NOT APPROVED — no written owner authorisation exists on record.**

The only C13 record in the repository is
`docs/phase1/release/P1_C10-C13_CLIENT_DECISION_RECOVERY_2026-10-20.md`, which states:
*"C13 — STILL PENDING (no written approval of release scope/timing found) … BLOCKING — OWNER DECISION
REQUIRED"*, and *"Production 未发布"*.

`docs/phase1/release/P1_FINAL_ACCEPTANCE_AND_CLOSURE.md` §13 likewise records
`C13 — BLOCKED — OWNER AUTHORIZATION REQUIRED`. No later commit adds an approval record.

Technical acceptance closure does **not** constitute C13 authorisation.

## 6. Deployment status

| Item | Result |
|---|---|
| Production site reachable | **PASS** — 200, Cloudflare edge |
| Production Publish of the approved baseline | **NOT COMPLETED** — deployed commit is `63ef6cae` |
| Deployment matches approved commit | **FAIL** — 4 commits behind |
| Deployed build corresponds to a known, identifiable commit | **PASS** — byte-verified `63ef6cae` |
| Preview/production backend | shared Supabase project `wvuffpykgnqliikhodzl` (no write-path test was run) |

**The four verified corrections are NOT live in production:**

| Fix | In `63ef6cae`? | Live risk on production today |
|---|---|---|
| **RC-1** electrician authorisation | **Yes** (this *is* the RC-1 commit) | none — guard is live |
| **RC-4** PIESA stage advancement | **No** (`FFS`/advance wiring absent) | a completed manual PIESA does not advance `piesa_scheduled`; Office next-action goes stale. **P1** |
| **RC-10** FFS event exposure | **No** (`FFS_PROGRESS_EVENT` count in `jobfile.core.ts`: 0, vs 2 on the baseline) | cancelled FFS internal field-progress events still render in owner/trade History timelines and job-pack `timeline.json`/`timeline.csv`. **P1 — internal regulated data reaching customers and trades** |
| **RC-2** Ready Check ownership guard | **No** (Mitti refusal string count: 0) | the portal can silently overwrite a Mitti-owned Ready Check. **P2** (latent — only rows with `external_mitti_id`) |
| **RC-8** malformed signed snapshot | **No** (`Array.isArray(doc)` guard count: 0) | a malformed/legacy signed PIESA/PIISA snapshot raises a `TypeError` from the compliance gate instead of failing closed. **P1** |

This is the most important finding in the report: **the acceptance-tested build is not what customers are
using, and three P1 defects are live.**

## 7. Four-role test matrix

**NOT PERFORMED — blocked by §6.**

The task's preconditions state that if Production Publish of the approved baseline has not occurred, the
smoke test must stop. Running the four-role walkthrough against a four-commits-old build and reporting role
PASSes would attribute acceptance evidence to a build that never received it. No credential was entered and no
production account was used.

| Role | Result | Note |
|---|---|---|
| Office / Admin | **NOT VERIFIED** | blocked — approved baseline not deployed |
| Homeowner / Owner | **NOT VERIFIED** | blocked — approved baseline not deployed |
| Installer | **NOT VERIFIED** | blocked — approved baseline not deployed |
| Electrician | **NOT VERIFIED** | blocked — approved baseline not deployed |

What *was* verified, of the deployed build, without authentication:

- **Availability — PASS.** `https://estimate.homeinsulationvictoria.com.au/` renders the public VEU ceiling
  insulation calculator: title *"Ceiling insulation rebate calculator Victoria (VEU) — Home Insulation
  Victoria"*, `<h1>` *"How much could you save on ceiling insulation?"*, 1,303 characters of rendered text,
  22 KB of root markup, 3 stylesheets applied, **0 console errors, 0 page exceptions**. Screenshot:
  `evidence/prod-smoke-2026-10-20/01-production-home.png`.
- **Unauthenticated route protection — PASS.** `GET /admin` returns the SSR shell, then the client redirects to
  `https://estimate.homeinsulationvictoria.com.au/auth?next=%2Fadmin` and renders *"Sign in – Home Insulation
  Victoria" / "Welcome back."* with **zero record data** in the DOM. Screenshot:
  `evidence/prod-smoke-2026-10-20/02-unauthenticated-admin-redirects-to-auth.png`.

## 8. Business Admin permission check

**NOT VERIFIED** — same reason as §7. No Business Admin session was used, and no permission boundary was
exercised against production.

## 9. Security / privacy observations

| Observation | Result |
|---|---|
| Unauthenticated `/admin` exposes records | **No** — redirects to `/auth?next=/admin`, empty data shell |
| Transport security | `strict-transport-security: max-age=31536000; includeSubDomains` |
| MIME sniffing | `x-content-type-options: nosniff` |
| Referrer leakage | `referrer-policy: strict-origin-when-cross-origin` |
| Content-Security-Policy | **Absent** — observation, P3 |
| `X-Frame-Options` / `frame-ancestors` | **Absent** — observation, P3 |
| `permissions-policy` | **Absent** — observation, P3 |
| Credentials, keys, tokens in this report | none — no secret was read or printed |
| Customer data in evidence | none — both screenshots are public/login pages |

The three missing headers come from the platform/deployment config, not from this release: the app's own
`_headers` file only sets `cache-control` for `/assets/*`. They are pre-existing and not introduced by any
commit in the delta. No destructive security testing was performed; no privilege escalation was attempted.

## 10. FFS visibility result

**FAIL on the deployed build — and this is expected, because the fix is not deployed.**

`63ef6cae`'s `src/lib/jobfile.core.ts` contains **0** references to `FFS_PROGRESS_EVENT`; the approved baseline
contains **2**. Since `buildTimeline()` is the single boundary feeding the Office timeline, all four role
History timelines and the job-pack `timeline.json`/`timeline.csv`, the deployed build still emits cancelled FFS
internal field-progress events into user-facing output.

Not re-tested interactively: doing so would require a signed-in session and an FFS-bearing job, and no
production write or job-pack download was permitted. The verdict rests on the byte-verified deployment identity
plus source inspection of that exact commit — **not** on a live UI observation, and it is recorded as a
deployment consequence rather than a fresh UI finding.

## 11. External integration safety

**NOT VERIFIED** from production configuration — no privileged access to the production environment was used,
and no secret was read. What can be stated safely:

- No email, SMS, Xero call, Mitti call or payment was triggered by this task. Every probe was an unauthenticated
  GET of a public page or a static asset.
- No customer communication was sent.
- The controls themselves (`XERO_LIVE_CALLS_ENABLED=false`, `XERO_DUE_DATE_UPDATES_ENABLED=false`, email
  suppression when `jobs_created_after` is null) were verified in the **repository configuration** during the
  earlier audit, not in the deployed runtime. Treat as **NOT VERIFIED for production**.

## 12. Browser console / network results

| Page | Console errors | Page exceptions | Failed requests | Result |
|---|---|---|---|---|
| `/` (public calculator) | 0 | 0 | 1 × `Document net::ERR_ABORTED` (the tab's initial about:blank navigation being superseded — not a resource failure) | **PASS** |
| `/admin` unauthenticated | 0 | 0 | 0 | **PASS** |

No JavaScript error, no blank screen, no broken layout, no unexpected server error was observed on the pages
that were opened. Static assets: all 37 referenced files resolved (the fingerprint comparison fetched one
directly, HTTP 200, 8,060 bytes, hash matched).

## 13. Evidence references

`docs/phase1/release/evidence/prod-smoke-2026-10-20/`

| File | What it shows |
|---|---|
| `01-production-home.png` | production `/` rendering the public calculator, correct layout |
| `02-unauthenticated-admin-redirects-to-auth.png` | unauthenticated `/admin` → `/auth?next=/admin`, login page, no data |
| `production-asset-references.txt` | the 37 asset filenames referenced by production HTML |
| `build-63ef6cae-assets.txt` | the 264 filenames produced by a local build of `63ef6cae` (superset containing all 37) |

Reproducible commands:

```bash
curl -sSI https://estimate.homeinsulationvictoria.com.au/                     # 200, Cloudflare
curl -sS  https://estimate.homeinsulationvictoria.com.au/ -o prod-index.html  # SSR HTML
grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' prod-index.html | sort -u         # 37 references
# build 63ef6cae and 36a29bf2 in isolated worktrees, then:
comm -23 prod-assets.txt assets-63ef.txt    # 0 missing  -> deployed == 63ef6cae
comm -23 prod-assets.txt assets-36a29bf2.txt # 3 missing -> approved baseline NOT deployed
shasum -a 256 prod-JobsWorkspace-CRp0v7WA.js build-63ef6cae/JobsWorkspace-CRp0v7WA.js  # identical
```

## 14. Issues discovered

| # | Severity | Issue | Evidence |
|---|---|---|---|
| 1 | **P0 (release process)** | Production is running `63ef6cae`, four commits behind the approved baseline `36a29bf2`. RC-2, RC-4, RC-8 and RC-10 are **not live**. | §4 — 37/37 asset match with `63ef6cae`, 3 missing vs `36a29bf2`, byte-identical chunk hash |
| 2 | **P0 (governance)** | No written C13 owner authorisation on record, yet a production deployment exists. Either the deployment predates the decision gate or the approval was never documented. | §5 |
| 3 | **P1 (live data exposure)** | RC-10 not deployed: cancelled FFS internal events still reach owner/trade timelines and job-pack exports. | §10 |
| 4 | **P1 (live workflow)** | RC-4 not deployed: a completed manual PIESA does not advance `piesa_scheduled`. | §6 |
| 5 | **P1 (live robustness)** | RC-8 not deployed: a malformed signed snapshot throws from the PIESA/PIISA gate instead of failing closed. | §6 |
| 6 | **P2 (latent)** | RC-2 not deployed: portal can overwrite a Mitti-owned Ready Check if such a row exists. | §6 |
| 7 | **P3** | No CSP, no `X-Frame-Options`/`frame-ancestors`, no `permissions-policy`. Pre-existing platform config, not introduced by this release. | §9 |

No P0/P1 defect **introduced by a deployment** was found — because no deployment of the approved baseline
occurred. The P1s above are defects that the un-deployed baseline would have fixed.

## 15. Final production verdict

| Item | Verdict |
|---|---|
| Production availability | **PASS** (of the deployed build) |
| Unauthenticated route protection | **PASS** (of the deployed build) |
| Deployment matches approved baseline | **FAIL** — `63ef6cae` vs `36a29bf2` |
| C13 owner authorisation | **NOT APPROVED** |
| Four-role acceptance | **NOT VERIFIED** — not performed |
| Business Admin permissions | **NOT VERIFIED** — not performed |
| FFS deactivation on production | **FAIL** — fix not deployed |
| External integration safety | **NOT VERIFIED** for production runtime |
| **PRODUCTION SMOKE TEST** | **BLOCKED — DEPLOYMENT NOT COMPLETED** |

### What must happen before this test can be re-run

1. **Owner records C13 authorisation in writing** — release scope and timing for `36a29bf2`.
2. **Owner publishes `36a29bf2` from the Lovable panel** (not done by this task; publishing is explicitly
   outside this task's authority).
3. Re-run this smoke test; re-verify the deployed SHA with the asset-fingerprint method above (expect 37/37
   against a `36a29bf2` build), then perform the four-role read-only walkthrough.
4. Optionally capture the one outstanding browser gap noted at acceptance closure: the PIESA
   `piesa_scheduled` → `piesa_complete` transition has never been browser-verified.

*No production record was created, modified or deleted. No migration was applied. No email, SMS, Xero, Mitti
call or payment was triggered. No credential or secret was read, printed or stored. The application was not
published or redeployed by this task.*
