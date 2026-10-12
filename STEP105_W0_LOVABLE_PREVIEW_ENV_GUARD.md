# STEP 105 | W0 AI — Fix Lovable Preview Supabase Environment Guard

**Verdict: PASS**
**Date:** 2026-10-13 (AEST)
**Worktree:** `wt-w0-step102-lovable-sync`
**Branch / target:** `lovable-release/a1-a4-step95-97` → `origin/main` (GitHub, Lovable-connected)

---

## FINAL OUTPUT

```
STEP 105: PASS
ROOT CAUSE:  src/integrations/supabase/env-guard.ts detectRuntimeMode() inferred "local"
             for everything that was not VITEST/NODE_ENV=test or NODE_ENV/DEPLOY_ENV=production.
             Lovable builds and serves the hosted Preview with NODE_ENV=development, so the
             Preview fell through to 'local' and resolveGuardedSupabaseEndpoint() refused the
             *.supabase.co project endpoint that Lovable itself configured for this project.
             The guard never had a representation for "hosted by Lovable".
FILES CHANGED: src/integrations/supabase/env-guard.ts                (+1 mode, +4 helpers, +1 resolver branch)
               tests/step105-lovable-preview-env-guard.test.ts       (new, 10 cases)
               STEP105_BROWSER_EVIDENCE/                             (new, real-Chromium evidence)
               STEP105_W0_LOVABLE_PREVIEW_ENV_GUARD.md               (this report)
COMMIT:        see "Commit" section below (single commit, no other file touched)
GITHUB PUSH:   fast-forward push to origin/main (git push origin HEAD:main)
LOVABLE SYNC:  commit is on the Lovable-connected default branch `main`; Lovable editor
               auto-syncs that branch (STEP 102 established this is the connected branch)
PREVIEW EXPECTED TO LOAD: YES — for the reported failure (Preview bootstrap / client Supabase init).
               See "Residual risk" for the one thing this step does NOT change.
```

---

## 1. Root cause (with the exact code path)

`src/integrations/supabase/env-guard.ts` (added STEP 88B/91A/95) had three runtime modes only:

```ts
export function detectRuntimeMode(env = process.env): RuntimeMode {
  if (env['VITEST'] || env['NODE_ENV'] === 'test') return 'test';
  if (env['DEPLOY_ENV'] === 'production' || env['NODE_ENV'] === 'production') return 'production';
  return 'local';                      // <-- everything else, including Lovable Preview
}
```

and `resolveGuardedSupabaseEndpoint()` then threw for any `*.supabase.co` host in `local`:

```
[env-guard] Refusing a production Supabase host (*.supabase.co) in local mode.
```

Supabase client initialisation paths that route through this resolver (all already guarded, unchanged):

| File | Call site | Runtime |
|---|---|---|
| `src/integrations/supabase/client.ts` | `resolveGuardedSupabaseEndpoint(SUPABASE_URL)` (browser singleton) | browser |
| `src/integrations/supabase/client.server.ts` | `resolveGuardedSupabaseEndpoint(SUPABASE_URL)` (service-role admin) | server |
| `src/integrations/supabase/auth-middleware.ts` | `resolveGuardedSupabaseEndpoint(SUPABASE_URL!)` | server |
| `src/lib/interest.functions.ts` | `resolveGuardedSupabaseEndpoint(process.env["SUPABASE_URL"]!)` | server |
| `src/lib/journey.server.ts` | `resolveGuardedSupabaseEndpoint(process.env["SUPABASE_URL"]!)` | server |

The reported error message matched the `local` branch exactly, i.e. the **browser** path was firing
during app bootstrap — nothing else in the chain (missing keys, wrong URL) was reached.

## 2. How the Lovable Preview was classified as "local"

There was no signal distinguishing "a browser page served by Lovable" from "a browser page served by
`vite dev`" — the only discriminator was NODE_ENV/DEPLOY_ENV, and Lovable's Preview build is
`NODE_ENV=development`. The two facts together produce `local`.

## 3. The fix (smallest safe change)

`RuntimeMode` gains a fourth value, and the resolver gains one branch. No global disable, no removal
of any existing check, no schema/migration change, no change to how a Supabase client is constructed.

```ts
export type RuntimeMode = 'local' | 'test' | 'lovable-preview' | 'production';
```

### 3.1 Detection — narrow, and based only on signals already verified inside this repository

```ts
export function currentHostname(): string | null          // window.location.hostname, null off-browser
export function lovablePreviewProjectId(hostname)         // platform-controlled id-preview--<uuid> position
export function isAuthorisedLovablePreviewHost(hostname)  // Lovable zone + THIS project's uuid
export function detectRuntimeMode(env, hostname = currentHostname()): RuntimeMode {
  if (env['VITEST'] || env['NODE_ENV'] === 'test') return 'test';
  if (isAuthorisedLovablePreviewHost(hostname)) return 'lovable-preview';   // STEP 105
  if (env['DEPLOY_ENV'] === 'production' || env['NODE_ENV'] === 'production') return 'production';
  return 'local';
}
```

Ordering is deliberate: **test wins over preview**, and **preview wins over an inferred
production**. The project identity is read only from the platform-controlled
`id-preview--<uuid>.lovable.app` position (the same rule the Lovable-generated
`previewAuthStorage.ts` already uses), so a user-named host cannot impersonate another project.

Values used are constants that already exist in this repo — nothing was assumed:

| Constant | Already present in |
|---|---|
| `fb35adfe-10bf-4d4c-987d-28567ca1ddeb` (project id) | `src/lib/test-send.server.ts` (`TEST_APP_BASE`), `src/lib/trade-view.server.ts` (allowed origin) |
| `id-preview--fb35adfe-….lovable.app` | same two files |
| Lovable hosting zones | `src/integrations/supabase/previewAuthStorage.ts` (Lovable-generated) |
| `wvuffpykgnqliikhodzl.supabase.co` | the endpoint this project is configured against |

### 3.2 Resolver — one endpoint only, and the three other modes are untouched

```ts
// lovable-preview mode: this project's own endpoint only — nothing else is authorised.
if (mode === 'lovable-preview') {
  if (!isAuthorisedPreviewSupabaseEndpoint(url)) throw new Error(
    '[env-guard] Refusing an un-authorised Supabase endpoint in Lovable Preview. ' +
    `Only the endpoint bound to this project (${…supabaseProjectHost}) is permitted.`);
  return url;
}
```

Also, a custom (non-`*.supabase.co`, non-local) endpoint is now refused in `lovable-preview` mode as
well as in `test` mode.

### 3.3 Distinguishing the three environments (Task 4)

| Environment | Signal | `*.supabase.co` project endpoint | Other `*.supabase.co` | Custom host |
|---|---|---|---|---|
| Local dev / automated tests | `VITEST`/`NODE_ENV=test`; otherwise no preview host ⇒ `local` | **REFUSED** (opt-in cannot override) | REFUSED | allowed (local/prod) |
| Lovable-hosted Preview | hostname is this project's Lovable preview surface | **ALLOWED** | **REFUSED** | REFUSED |
| Production deployment | `DEPLOY_ENV=production` / `NODE_ENV=production` **+** `ALLOW_PROD_SUPABASE=1` | ALLOWED | ALLOWED | ALLOWED |

Task 5 ("permit only when the hosting environment is reliably identified and explicitly authorised") is
satisfied by: **reliable identification** = platform-assigned preview hostname + project uuid;
**explicit authorisation** = the frozen `LOVABLE_PREVIEW_AUTHORISATION` record (project id, preview
host, the single permitted Supabase project host) — a reviewable constant, not an inferred fallback.

Tasks 6 and 7 are honoured: the guard is not disabled (every other rule and mode is byte-for-byte
unchanged), and no schema, migration or database object was touched.

## 4. Verification

### 4.1 Targeted + regression tests (Task 8)

| Check | Result |
|---|---|
| `bun test tests/step105-lovable-preview-env-guard.test.ts` | **10 pass / 0 fail** |
| `bun test tests/step88b-env-guard.test.ts tests/step91a-active-guard.test.ts tests/step95-runtime-guard.test.ts` | **22 pass / 0 fail** |
| `bun ./scripts/test-isolated.ts 8` (full suite) | **319 files · 2928 pass · 0 fail** (baseline 318/2918 ⇒ +1 file, +10 cases, zero regressions) |
| `bunx tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun run build` (vite + nitro production build) | exit 0 — `.output/server` + `.output/public` emitted |

New tests cover: preview host ⇒ `lovable-preview` and its own endpoint allowed; **other** Supabase
project refused; a plain site / another tenant's preview host / the published `lovable.app` host /
`localhost` all still fail closed; test mode still un-overridable; explicit production unchanged;
and a structural assertion that no env var and no request header is consulted for the preview verdict.

### 4.2 Real-browser evidence (forced by the brief)

Chromium (only the intact `chromium-1208` build in this environment) was driven over the DevTools
Protocol. The navigation request is intercepted and fulfilled locally, so **the document host really
is the Lovable preview hostname** — `window.location.hostname` is not simulated. The page executes the
real `env-guard.ts` (esbuild bundle of the module under test), and the rendered table is captured.

| Scenario | Real `location.hostname` | Detected mode | Project endpoint | Other project | Custom host | Evidence |
|---|---|---|---|---|---|---|
| **A** Preview surface | `id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app` | `lovable-preview` | **ALLOWED** | REFUSED | REFUSED | `A_preview_host.{png,txt}` |
| **B** Another tenant's preview | `id-preview--00000000-0000-4000-8000-000000000000.lovable.app` | `local` | REFUSED | REFUSED | — | `B_other_tenant_preview.{png,txt}` |
| **C** Local dev | `127.0.0.1` | `local` | REFUSED | REFUSED | — | `C_localhost.{png,txt,dom}` |
| **D** Published Lovable host | `hi-vic-operations.lovable.app` | `local` | REFUSED | REFUSED | — | `D_published_lovable_host.{png,txt}` |

Exact error text observed in scenario A:

```
[env-guard] Refusing an un-authorised Supabase endpoint in Lovable Preview.
Only the endpoint bound to this project (wvuffpykgnqliikhodzl.supabase.co) is permitted.
```

and in scenarios B/C/D (protection intact, unchanged wording):

```
[env-guard] Refusing a production Supabase host (*.supabase.co) in local mode.
Local/test safety cannot be overridden by ALLOW_PROD_SUPABASE. Use a local endpoint (127.0.0.1).
```

Scenario A is the fix; scenarios B, C and D are the proof that this is **not** "every browser
environment bypasses the guard".

Reproduce with `STEP105_BROWSER_EVIDENCE/step105-cdp-harness.mjs` (CDP driver) +
`STEP105_BROWSER_EVIDENCE/harness.ts` (page harness), bundled by:
`esbuild harness.ts --bundle --format=iife --platform=browser --define:process.env='{}'`.

## 5. Commit and sync (Tasks 9–10)

- Single commit on `lovable-release/a1-a4-step95-97` (which is `cabb1cc6` = `origin/main`), touching
  only the guard, its new test and this evidence.
- Pushed as a **fast-forward** to `origin/main` (`00beb7ea..<new sha>`); no force push, no rebase, no
  history rewrite, and neither the dirty MAIN checkout nor any other worktree was touched.
- `main` is the branch Lovable has connected (established in STEP 102), and `cabb1cc6` already proved
  that pushing to it lands in the Lovable editor, so this commit is expected to appear the same way.

## 6. Constraints — compliance

| Constraint | Status |
|---|---|
| Preserve all A1–A4 functionality | ✅ full suite 319/2928/0, tsc 0; guard change is additive |
| No force push | ✅ fast-forward only |
| Do not touch dirty MAIN | ✅ worktree-only; MAIN untouched |
| No production database writes | ✅ no DB access at all in this step |
| No real customer emails or SMS | ✅ none sent, none triggered |
| No unrelated refactoring | ✅ 1 module + 1 new test; the five existing guard call sites unchanged |

## 7. Residual risk (explicit, not hidden)

1. **Server-side classification is deliberately unchanged.** The guard is also called from four
   server-side paths. Off-browser there is no `window`, so `currentHostname()` returns `null` and
   those calls resolve exactly as they did before this step. If Lovable's *server* runtime also
   reports a non-production `NODE_ENV`, those paths would still refuse the project endpoint, and the
   Preview would surface a server-function error rather than the bootstrap error that was reported.
   This step does not guess at a server-side marker, because every candidate (platform env var,
   Host/Origin header) is either unverified in this repo or forgeable — the brief explicitly ruled
   that out. A follow-up would pass `{ hostname }` explicitly at those four call sites from the
   request URL, the same way `src/lib/request-meta.ts` already derives a hostname; that requires
   updating two STEP 95 call-shape assertions and is intentionally out of scope here.
2. **Published production is untouched.** `estimate.homeinsulationvictoria.com.au` /
   `hi-vic-operations.lovable.app` (scenario D) still resolve to `local` unless the production build
   reports `NODE_ENV=production` **and** `ALLOW_PROD_SUPABASE=1` is set. That is the pre-existing
   STEP 91A/95 policy and was not relaxed.
3. **Release status remains HOLD.** This step fixes a Preview environment guard only. The STEP 86B /
   86C blockers (backup, rollback, production smoke, named deployment approver) are untouched and no
   RELEASE GO is claimed.
