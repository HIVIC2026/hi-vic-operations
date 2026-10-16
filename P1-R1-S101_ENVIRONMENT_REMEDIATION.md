# P1-R1-S101 — Environment Remediation (B3-06): Server-only Supabase admin module leaking into the public client bundle

**Verdict: PASS (remediated)**
**Date:** 2026-10-16 (UTC)
**Worktree:** `wt-r1-p1-s101-env-remediation`
**Branch:** `r1/p1-rc1-s101-env-remediation`
**Scope:** Local build artifacts + `vite.config.ts` only. No push / merge / deploy. No schema or migration change.

---

## 1. Finding (B3-06)

The production client build emitted **28 server-only `*.server-*.js` chunks** into the public
asset directory `.output/public/assets/`, including
`client.server-nJvjKR-y.js` — the compiled form of
`src/integrations/supabase/client.server.ts`, which constructs the **service-role** Supabase
admin client that **bypasses RLS**.

Server-only code must never be downloadable from the public (browser-served) asset directory.

## 2. Root cause (correctly identified, after ruling out the initial hypothesis)

### 2.1 Initial hypothesis — DISPROVEN
The first hypothesis was that the three `*.functions.ts` files
(`pilot.functions.ts`, `portal.functions.ts`, `bulk-import.functions.ts`) which top-level-import
`supabaseAdmin` from `client.server` pulled the admin module into the client graph. This was
tested by converting all 110 admin call sites to handler-scoped `await import(...)`. Result:

- `typecheck` passed (0 errors), **but**
- the rebuild produced the **same** `client.server-nJvjKR-y.js` (identical hash) **plus** an
  extra chunk — i.e. it did **not** remove the leak and worsened chunking.

That change was therefore **fully reverted**. The `.functions.ts` files are unchanged from
baseline.

### 2.2 Actual root cause
The 28 `*.server-*.js` chunks are **orphaned code-split chunks**. TanStack Start's
server-function extraction emits them into the client output, but **no** client / route / entry
chunk imports any of them. Proven by static graph analysis of `.output/public/assets`:

- For every one of the 28 server chunks, `nonserver_importers = []`.
- Reachability from the union of **all** non-server (client) chunks reaches **0** server chunks.
- The server chunks reference only one another (a closed, unreachable cluster).

So the browser never loads these chunks, but they are **physically downloadable** from the public
CDN — a code-disclosure surface. (No literal secret value is embedded: the chunk contains only the
`createSupabaseAdminClient()` factory, which reads `process.env` at call-time; `supabaseAdmin` is a
lazy `Proxy`, so the factory never executes at module evaluation, and `process.env.SUPABASE_SERVICE_ROLE_KEY`
is `undefined` in a browser.)

## 3. Remediation (build-level, deterministic)

Added a **build-only Vite plugin** `pruneOrphanServerChunks()` to `vite.config.ts`.
In the `closeBundle` (post, sequential) hook it:

1. Builds the import graph of `.output/public/assets`.
2. Computes reachability from every non-server (client) chunk.
3. **Safety guard:** if ANY `*.server-*.js` chunk is reachable from a client chunk, it **throws**
   and fails the build (so a genuine client→server import edge can never be silently masked — that
   would be a source-level bug to fix, not a prune target).
4. Otherwise deletes the orphaned `*.server-*.js` chunks from the public directory.

The server (SSR) bundle under `.output/server/` is **not** touched.

**Files changed:** `vite.config.ts` (+1 import block, +1 plugin, +1 plugin registration).

## 4. Verification (rebuilt from clean `.output`)

| Check | Result |
|---|---|
| `bun run typecheck` | **0 errors** |
| `bun run build` | **success**; plugin log: `Removed 28 orphaned server-only chunk(s) from .output/public/assets (B3-06).` |
| `.server-*.js` chunks remaining in `.output/public/assets` | **0** (was 28) |
| Literal `sb_secret_` / service-role / JWT value in `.output/public` | **none** |
| `SERVICE_ROLE_KEY` value assignment in `.output/public` | **none** |
| String `SERVICE_ROLE` anywhere in `.output/public` | **none** (orphan factory code removed) |
| Dangling imports among remaining 262 public chunks | **none** — client graph intact |
| SSR admin module `.output/server/_ssr/client.server-*.mjs` | **present** (untouched) |
| Server `_ssr` `.server-*` chunks | **101** (untouched) |
| Publishable (anon) key in browser client `client-*.js` | present — **expected/correct** (anon key is designed to be public, RLS-protected) |

**Interpretation:** The orphaned server-only chunks (incl. the service-role admin factory) are gone
from the public bundle; no secret value was ever shipped; SSR is preserved; and no client chunk
depended on the removed files (zero dangling imports), so the client app is unaffected.

## 5. Residual notes

- **Runtime preview not executed locally.** The Nitro preset is `cloudflare-module`
  (`.output/server/index.mjs` is a Workers `fetch` module, not a Node HTTP server), so
  `node index.mjs` is not a valid local smoke test and `wrangler dev` needs the Cloudflare runtime
  + env bindings. The authoritative correctness guarantee is the static reachability + dangling-import
  proof above (0 reachable server chunks, 0 dangling client imports).
- The publishable anon key and `*.supabase.co` project URL remaining in the browser client are
  **by design** and not part of B3-06.

## 6. B3-06 / B-3 verdict

- **B3-06:** **REMEDIATED** — server-only service-role admin module no longer present in the public
  client bundle; verified with rebuild + secret scan + graph integrity checks.
- **B-3:** the specific B3-06 blocker is cleared at the build-artifact level on this remediation
  branch. Promotion to RC1 and the overall B-3 readiness call remain a release-owner decision
  (this work is local-only; no push/merge/deploy performed).
