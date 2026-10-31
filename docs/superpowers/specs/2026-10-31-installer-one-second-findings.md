# /field in ~1 s on 4G: root-cause findings (read-only)

Code read at origin/main `f59be5f8e` (worktree /home/claude/rr-wt-perf). No builds were possible: `node_modules` in the main checkout is missing `@tanstack/react-start`, the router packages and `@lovable.dev/vite-tanstack-config`, so chunk contents come from tracing source imports, not a bundle. `@lovable.dev/vite-tanstack-config@2.26.5` and `@tanstack/start-plugin-core@1.171.49` were downloaded from npm into /tmp just to read them.

## Q1. HTML first byte ~1.7 s unthrottled

**What the server does for GET /field before sending the shell:**

1. `src/server.ts:83-90`: a staff-host check (pure string work, `src/lib/staff-host.core.ts:9-12`), then `getServerEntry()` (`src/server.ts:16-23`), which **dynamically imports the whole TanStack server entry the first time an isolate runs**. That loads and evaluates the route tree and every route module's server side, so cold-start cost grows with bundle size.
2. Module-level imports in `src/server.ts:1-3` (local-network guard, inert in production per `src/lib/local-network-guard.install.ts:1-3`; a console.error wrapper; AsyncLocalStorage). All cheap.
3. Request middleware `src/start.ts:40`: `errorMiddleware` (try/catch only) and `csrfMiddleware`, which is filtered to server functions only (`src/start.ts:33-35`).
4. Root route `src/routes/__root.tsx:65-88`: a static `head()` plus shell/component. **No loader, no beforeLoad, no server function, no Supabase call.**
5. `/_authenticated` is `ssr: false` (`src/routes/_authenticated/route.tsx:5`), so its `beforeLoad` (getUser) and `field.tsx`'s `beforeLoad` (loadAccess) **do not run on the server**.
6. The global function middleware (`src/start.ts:39`) applies only to server-function calls, not page requests.

**Conclusion:** the shell SSR does **no network or database work**. The per-request code work is a React render of a near-empty document, which should take well under 50 ms on a warm isolate. The ~1.7 s is almost certainly platform time: a cold Worker isolate plus evaluating a large server bundle on first import, and/or a Lovable hosting proxy in front. The Lovable config builds `cloudflare-module` or a `lovable-fetch-bundle` preset (`@lovable.dev/vite-tanstack-config` dist/index.js:1184-1213), so the published runtime may not be a plain Cloudflare Worker. Code can only affect the bundle-evaluation part.

**The HTML is identical for every user** (static head, client-only body), so it can be static. TanStack Start supports prerendering (`pages[].prerender`) and SPA-shell mode (`spa`, prerendered to `/_shell`, start-plugin-core schema.js). The Lovable config has explicit "document set" support for publishing prerendered documents (dist/index.js:133-140, 203-290). Prerendering `/field` (and `/home`, `/admin`, `/partner`, `/owner`) would let the asset layer serve the shell without starting the Worker at all.

**One measurement separates cold start from code:** from the same phone or network, request a static asset (`/favicon.png` or a hashed `/assets/*.js`) and `/field` five times in a row. Record TTFB for each and the `cf-ray` / `server-timing` / `cf-cache-status` headers.
- Static asset fast (~100-200 ms), first `/field` slow (~1.7 s), repeated `/field` fast: **cold start / bundle evaluation**. Fix with a static or prerendered shell.
- Repeated warm `/field` still ~1.5 s+: **a per-request layer** (Lovable proxy, region routing). Check the `cf-ray` colo and raise it with Lovable. That would be a hosting issue, not a code issue.

Secondary, client side: `__root.tsx:80` loads Google Fonts CSS as a **render-blocking stylesheet on a third-party origin**. On 4G that is a new DNS+TCP+TLS (~3-4 RTT ≈ 450-600 ms) plus a second origin for the font files. Module scripts wait for pending stylesheets before they execute, so this can delay app start by about 0.5 s on 4G.

## Q2. 150 JS files on /field

**Router code splitting is ON.** TanStack Start forces `autoCodeSplitting: true` and does not let you turn it off (start-plugin-core `dist/esm/schema.js:6`, `configSchema.omit({ autoCodeSplitting })`). The Lovable config does not override it. Route components are already lazy. The problem is what the `/field/` route component statically imports.

**Why onboarding, email and official-forms code loads.** Each one is pulled in through a single small constant. Shared chunks contain every export used by any route, so `/field` downloads the whole module (and its imports):

| # | Chain (static imports from `src/routes/_authenticated/field.index.tsx`) | What's actually needed | Source bytes dragged in |
|---|---|---|---|
| 1 | field.index → `trade-view.core.ts:283` → `worker-compliance.core.ts:4` → `esc-collection-notice.core.ts:31` → `worker-role.core.ts:5` → `mitti-invite.core.ts:14-15` → **`email-kit.core`** → `email-hero-assets.ts` (60 KB), `estimate-email.ts` → `readycheck.core`, `customer-quote-system`; plus `mail-mjml.core` → `mjml-lite.core`, `emailsafety.core` → `engagement.core` | `COLLECTION_NOTICE_BLOCK_MESSAGE` (a string, esc-collection-notice.core.ts:69) and `CREW_SKIP` (a string, mitti-invite.core.ts:147) | ~250 KB source (email-kit 33K, hero assets 60K, mjml-lite 21K, mitti-invite 19K, esc-notice 23K, readycheck 23K, …) |
| 2 | field.index → `installer-home.core.ts:8` → `installer-screens.core.ts:115` → `fixes-day.core.ts:10-13` → **`official-forms.core`** (67K), `official-short.core` (41K), `mitti.core` (64K), `piesa-evidence.core` | `FIXES_FORM_LINK_LABEL = "Fixes form in Mitti"` (fixes-day.core.ts:307) | ~210 KB source |
| 3 | field.index → `trade-view.core.ts:281` → **`rec-onboarding.core`** (32K) → `rec-agreement.text.ts` (39K), `activity48-agreement-schedule.text.ts` (10K), `melbourne-time.core` → `daily-brief.core` | `MIN_REC_PL_COVER = 5_000_000` (rec-onboarding.core.ts:16) | ~85 KB source |
| 4 | field.index → `components/portal/kit.tsx:7` → `portal-presentation.core.ts:2` → `enquiry.core` (25K) | `menuOffset` | ~40 KB source |
| 5 | field.index → `installer-screens.core.ts:113` → `piesa-owner-confirm.core` (13K) | `OWNER_PIESA_CONFIRM_WAITING` (one template string) | ~13 KB |

My import-graph tracer counts 59 app modules (~850 KB source) statically reachable from field.index.tsx. Most of that is chains 1-3.

**Fix (plain code change, low risk):** move each constant into a tiny leaf module with no imports (e.g. `src/lib/trade-labels.core.ts`) and import it from there in `trade-view.core.ts`, `worker-compliance.core.ts`, `worker-role.core.ts`, `installer-screens.core.ts` and `kit.tsx`. Keep the old exports as re-exports so nothing else changes. Then `email-kit`, `official-forms`, `rec-onboarding`, `mitti.core` and `enquiry.core` drop off `/field`. Splitting `trade-view.core.ts` (43 KB, shared by every trade screen) into "home" and "job page" halves would cut more. Not verified by a build: a build needs the missing packages. Check afterwards with the network panel or `vite build` plus a chunk map.

**Chunks also start late.** On the client, `_authenticated` `beforeLoad` awaits `supabase.auth.getUser()`, a network call (`src/lib/route-guards.ts:28-34`, `route.tsx:6-9`). Then `field.tsx:6-9` awaits `loadAccess`, which makes 2 more PostgREST reads (`route-guards.ts:40-44`). TanStack loads lazy route chunks in the load phase *after* all `beforeLoad`s, so the `/field/` component chunk tree only starts downloading after those reads finish. That matches the trace: getUser done 6.4-6.6 s, last JS 7.16 s. The home data request (`field.index.tsx:36`, `useQuery` inside the component) starts only after the component has downloaded and rendered. The chain is: JS → getUser → roles → chunk waterfall → render → server function. Every step is serial.

The 157 KB `index` chunk is the entry: React, router, react-query, supabase-js and the route tree. The route tree keeps each route's non-component options (beforeLoad, head, validateSearch) and their imports in the main chunk. Without a build I can't attribute the 54 KB `dist` chunk (probably supabase-js or lucide).

## Q3. Home server function ~1.4-1.7 s server time

**Middleware before the handler** (`src/start.ts:39`, then `.middleware([requireSupabaseAuth])` at `src/lib/trade-view.functions.ts:8`):

1. `testOfficeBoundary` (`src/lib/qa-office-boundary.ts:24`): `sb.auth.getUser(token)`, a **network call to Supabase Auth**.
2. Same file, line 26: `user_roles` select, a **second sequential round trip**. It runs on every authenticated server function call, including installer ones, only to block the QA office login.
3. `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts:94`): `getClaims(token)`. In auth-js 2.118 (`GoTrueClient.js:5534-5541`), an HS256 token or one without a `kid` falls back to **another `getUser` network call**. An asymmetric (ES256) token verifies locally against a JWKS that is fetched once per isolate and cached for 10 minutes (`GLOBAL_JWKS`, `JWKS_TTL`). Which one applies depends on the project's JWT signing key, which I can't see from code. The project uses `sb_publishable_` keys, so asymmetric keys are likely but not certain.

**So 2-3 sequential round trips happen before `tradeHome` starts.** `getUser` runs once or twice and `user_roles` is read again inside `tradeContext`.

**Inside `tradeHome`** (`src/lib/trade-view.server.ts:101-148`):
- Round 1, `tradeContext` (lines 59-64): 3 parallel reads.
- Round 2 (line 113): 3 parallel reads. For a business owner, `tradeMoneyRows` also starts at line 108 and runs its own chain: line 513 round A (bookings ×2 plus `readInstallerPaidElectricians` → businesses), then line 529 round B (~9 parallel reads, where `safetyCheckPayeesFor` is itself 2 rounds: workflow_events then businesses, plus `payoutGateFacts` / `safetyVisitFacts`). The money path is about 3-4 rounds deep after round 1, so **for an owner it is probably the critical path, not "3 rounds"**. It is awaited at line 148.
- Round 3 (lines 134-147): **about 25 requests fired at once**: 3 direct, `statusFactsFor` 12 (`job-status.server.ts:23-37`), `loadInstallerQuotes` 5 (`installer-quote-status.server.ts:54-60`), measurements 1, basics 1, `readInstallerPrices` 2 (`installer-price.server.ts:34-37`), history 1.

**Cloudflare Workers allow only 6 simultaneous outbound connections per request.** Extra `fetch()`es queue. One call makes about **45-50 Supabase HTTP requests** (2-3 middleware, 3, 3, ~25, ~10-12 money). The 25-wide round 3 alone needs about 4-5 waves. **Sequential network waits per call: about 2-3 (middleware) + 1 + 1 + 4-5 (round 3 queued) ≈ 8-10, or the money chain depth if longer.** At ~120-170 ms per Cloudflare-to-Supabase PostgREST round trip, that gives 1.0-1.7 s, which matches the measurement.

**Duplicate reads in one call:** `getUser` (boundary, plus possibly getClaims); `user_roles` (boundary, tradeContext); `ceiling_measurements` current and `workflow_events` `ready_check_basics` (read in tradeHome lines 141-142 and again in loadInstallerQuotes lines 57-58); `jobs` (embedded in round 2, then re-read by statusFactsFor line 25 and loadInstallerQuotes line 55); `bookings` for the same job ids (line 135 and statusFactsFor line 26).

Confidence: high on the counts, which come from the code. Medium on the 6-connection queuing being the main multiplier: it is a documented Workers limit, but there is no timing trace. **To confirm:** log `Date.now()` around each `await` (or add a `Server-Timing` header) for one call, and record the Supabase project region (`wvuffpykgnqliikhodzl`). A non-Sydney region would multiply everything.

## Ranked fixes (expected seconds saved on 4G, cold first visit)

| # | Fix | Saves (4G) | Confidence | Risk | Type |
|---|---|---|---|---|---|
| 1 | Stop the client waterfall: start `getTradeHome` in a route `loader` (or right in `_authenticated` beforeLoad via `queryClient.prefetchQuery`) so it runs alongside chunk download. Use `supabase.auth.getSession()` (local) for the UI-only guards instead of the network `getUser()` and do `loadAccess` in parallel or lazily. The server already re-checks access. | 1.5-2.5 s | high | low-medium (guards are UI-only by their own comment, route-guards.ts:1; expired sessions must still redirect, so handle a 401 from the server function) | code |
| 2 | Cut `tradeHome` server time: remove duplicate reads, reuse the round-2 jobs and bookings in statusFactsFor / loadInstallerQuotes, and merge round 3 into a few wider selects or **one Postgres RPC (SQL function) returning the whole home payload**. One RPC = 1 round trip instead of ~45 requests. Make the owner money strip a separate, later query so it never blocks the job list. | 1.0-1.4 s | high (RPC) / medium (dedupe only) | medium (business-scoping rules move into SQL; needs the existing tests) | code (plus a DB migration for an RPC) |
| 3 | Middleware: skip `testOfficeBoundary` network reads for non-QA tokens. Decode the JWT locally and only check `user_roles` when needed, or move the check into `requireSupabaseAuth` and reuse its claims. Make sure `getClaims` verifies locally (asymmetric JWT keys). | 0.25-0.5 s on every server call | high | low-medium (security boundary: keep the check for QA-office users) | code (+ Supabase JWT signing-key setting if HS256) |
| 4 | Serve the shell statically: prerender `/field` (and other `ssr:false` entry paths) via `tanstackStart.pages[].prerender`, or SPA-shell mode, so the HTML comes from the asset layer without a Worker cold start. | 1.0-1.5 s (if Q1 measurement shows cold start) | medium (depends on Lovable hosting serving prerendered documents ahead of the Worker) | medium (asset/deploy behaviour, staff-host redirect only on "/", stale-shell after deploy) | config (vite.config.ts) + hosting behaviour |
| 5 | Cut the `/field` bundle: move the 5 constants into a leaf module (chains 1-5 above). Optionally split `trade-view.core.ts` / `installer-screens.core.ts` by screen. | 0.3-0.8 s (fewer files and bytes, shallower waterfall; ~585 KB at 1.6 Mbps ≈ 3 s of raw transfer, of which the chains are a large share) | medium (no build to measure exact chunk bytes) | low | code |
| 6 | Make Google Fonts non-blocking: self-host the fonts, or preload + `media="print" onload` swap. Fewer weights too. | 0.3-0.6 s | medium | low (brief font swap) | code |
| 7 | Return visits already paint from `trade-cache` (field.index.tsx:35). With fix 1 that paint no longer waits for getUser. | (covered by 1) | high | low | code |

Fixes 1, 2 and 4 are the ones that can plausibly get a cold 4G open near 1-2 s. Hitting a true 1 s cold also needs fix 4 (or a warm isolate) plus fix 5, because 585 KB over 1.6 Mbps is ~3 s of transfer by itself. A return visit (cached data plus HTTP-cached JS) can reach ~1 s with fixes 1 and 6.
