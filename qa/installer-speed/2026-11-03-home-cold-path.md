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

What stays and why: the entry is 90% framework (react-dom 203 kB raw, router core 52 kB, seroval 25 kB, query core 10 kB) plus supabase-js (214 kB raw / 54 kB gz, needed for the saved session before any page draws). `tailwind-merge` (8.5 kB gz) is the portal kit's class merger. `sonner` (9 kB gz) is the root's toaster, on every page. About 8 kB gz of office code sits in the entry because office routes' `validateSearch` parsers import `office-jobs.core`, `jobs-columns.core`, `office-filters.core`, `owner-review.core`, `set-password-link.core`; splitting those parsers out (as `template-sections.core` was) would take it off every page.

Pinned by `tests/trade-home-first-load.test.ts`: the home route's static source graph ≤ 200,000 bytes (was 335,328; now 168,429) and the heavy modules absent — always; the built cold path ≤ 285,000 bytes gz and the route chunks ≤ 40,000 bytes gz — when `.output` exists (skipped, never passed, otherwise).

Not measured here: time. The published portal is measured with `bun scripts/installer-speed.ts --base https://portal.homeinsulationvictoria.com.au --label after-home --screens home` (runs in Lovable: needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and the server key; see `qa/installer-speed/README.md`), compared with `qa/installer-speed/2026-10-31-after-1s.md` (home cold median 7,970 ms owner / 5,058 ms staff; `tradeHome` 2,940 / 1,793 ms).
