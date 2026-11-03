# My work (installer home): what a cold phone visit downloads (3 Nov 2026)

Measured from `bunx vite build` on branch portal-speed-2 (base 6aa67e2), by summing the gzip size of every JS file a
cold `/field` visit fetches: the entry chunk and its static imports (preloaded from the HTML), plus the `/field` layout
and `/field/` route chunks with their imports (preloaded by the route manifest and Vite's preload helper). Not a timing:
`scripts/installer-speed.ts` (below) is the timing; this is only the bytes.

| | before | after | change |
|---|---|---|---|
| entry chunk closure (react-dom, router core, query core, supabase-js, root, route tree, office `validateSearch` bits) | 241.2 kB gz, 36 files | 240.3 kB gz, 38 files | framework; unchanged |
| `/field` route chunks beyond the entry (the home's own code) | 59.0 kB gz, 34 files | 29.6 kB gz, 24 files | −50% |
| whole cold path | 300.2 kB gz (307,381 bytes) | 269.9 kB gz (276,374 bytes) | −10% |

What was pulled in and is not any more (all moved behind a smaller module or a lazy import, same values, same screen):

- `trade-view.core` (22 kB raw / 8.3 kB gz) for four helpers (`tradeGreeting`, `goneIn`, `dayTile`, `ELECTRICIAN_WORK_WORDS`) → now `trade-home-words.core` (1 kB), re-exported from `trade-view.core`.
- `installer-screens.core` (25 kB raw / 8.1 kB gz) + `job-wording`'s display-name chain for one function (`installerStatusLine`) → now `installer-status-line.core`, re-exported.
- `InHouseBookingCard` + `installer-kit` + `install-days.core` + `piesa-windows.core` + `in-house-booking.core` + `worker-compliance.core` + `input` (~14 kB gz) for the in-house booking row, which only draws after the in-house Team/deposit server check answers → `React.lazy`, with the same "Checking your Team and deposit before booking." line standing in while its code arrives (the code starts loading alongside that check).

Second step (same day, `vite.config.ts` chunk groups + three more small modules):

| | before | after |
|---|---|---|
| entry chunk + static imports | 240.3 kB gz, 38 files | 227.0 kB gz, 3 files (index, rolldown runtime, supabase) |
| /field route chunks beyond the entry | 29.6 kB gz, 24 files | 26.2 kB gz, 21 files |
| whole cold path | 269.9 kB gz (276,374 B) | 253.3 kB gz (259,338 B) |
| chunks on the critical path NOT in the HTML preload list | supabase-js (54 kB gz, needed before the saved session is read), server-fn runtime + auth middleware (needed for the first call) — one round trip each | none: the HTML preloads `supabase-*.js` (a chunk group of @supabase/* + the client module, a direct import of the entry) and the server-function runtime now sits in the entry chunk (the `start-client` group absorbed @tanstack/react-start's client side, which the entry imports); `trade-view.functions-*.js` imports only the entry and the runtime helper |
| office code in the entry (every page) | office-jobs.core, jobs-columns.core, office-filters.core, owner-review.core (~3.7 kB gz) | gone: the Jobs routes' `validateSearch`/loaders read `office-jobs-stage.core` and `jobs-saved-view.core`, My job's reads `owner-review-screen.core` (all import-free; the old modules re-export them). `set-password-link.core` (0.6 kB gz, import-free) stays: it is the sign-in destination logic itself. `admin.jobs.$jobId`'s 7 kB non-split part is its component's preload list, intrinsic to that route. |

What stays and why: the entry is 90% framework (react-dom 203 kB raw, router core 52 kB, seroval 25 kB, query core 10 kB) plus supabase-js (214 kB raw / 54 kB gz, needed for the saved session before any page draws). `tailwind-merge` (8.5 kB gz) is the portal kit's class merger. `sonner` (9 kB gz) is the root's toaster, on every page. About 8 kB gz of office code sits in the entry because office routes' `validateSearch` parsers import `office-jobs.core`, `jobs-columns.core`, `office-filters.core`, `owner-review.core`, `set-password-link.core`; splitting those parsers out (as `template-sections.core` was) would take it off every page.

Pinned by `tests/trade-home-first-load.test.ts`: the home route's static source graph ≤ 200,000 bytes (was 335,328; now 168,429) and the heavy modules absent — always; the built cold path ≤ 285,000 bytes gz and the route chunks ≤ 40,000 bytes gz — when `.output` exists (skipped, never passed, otherwise).

Not measured here: time. The published portal is measured with `bun scripts/installer-speed.ts --base https://portal.homeinsulationvictoria.com.au --label after-home --screens home` (runs in Lovable: needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and the server key; see `qa/installer-speed/README.md`), compared with `qa/installer-speed/2026-10-31-after-1s.md` (home cold median 7,970 ms owner / 5,058 ms staff; `tradeHome` 2,940 / 1,793 ms).

## Installer app cache (service worker, 3 Nov 2026, switch OFF)

`vite.config.ts` now also writes `.output/public/sw.js` from the build's Start manifest: 25 files precached (the 24 chunks
of the cold path above + the stylesheet; 976 kB raw / 274 kB gz) under cache `hiv-installer-app:<hash of the list>`.
Nothing registers it until `SERVICE_WORKER_ENABLED` in `src/lib/installer-app-cache.core.ts` is true (one line + publish).
Cold path bytes: unchanged by this (a worker only helps repeat visits; the first visit still downloads everything, and the
worker's own install reads those same files from the HTTP cache). Repeat visit with the worker on: every hashed
/assets/ file of My work comes from the phone (expected 0 static bytes from the network; the HTML shell is asked for
fresh, ~7 kB, with the kept copy as the fallback when there is no signal); the server call and Supabase are never cached.
Measured live by `bun scripts/installer-app-cache-check.ts --base <published url>` (Lovable; TEST owner; read-only),
written to `qa/installer-speed/<date>-app-cache.md` — NOT_RUN here (no published build, no keys).
Known limit: with the network off, the /field guard's roles read (`route-guards.ts` `loadAccessFresh`) answers "no
roles" on a failed fetch and sends the person to /home, so the shell loads from the phone but My work does not show
until that guard tolerates a failed read; `scripts/installer-app-cache-check.ts` records `offline.landed` and
`offline.myWorkShown` so this is visible.
