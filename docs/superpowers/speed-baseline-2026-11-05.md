# Portal speed step 2 — baseline (before) and after

Date: 5 Nov 2026 · Spec: `specs/2026-11-05-portal-speed-step2-design.md` · Plan: `plans/2026-11-05-portal-speed-step2.md`

**Rounds** = sequential database round trips inside the screen's server call(s), counted by a test (queries started
before the first of them answers share a round). **Server calls** = browser→server calls the screen makes for its first
draw. Target per screen: 1 server call for the first draw, ≤ 3 rounds (`ROUND_LIMIT`, `tests/helpers/round-counter.ts`).

How measured: installer screens on the in-memory database fixtures of the existing per-screen tests (named below); office
screens on the synthetic 300-job office (`tests/speed-rounds.test.ts`, run with `SPEED_BASELINE=1` to print). Counts,
not times — a round costs about half a second from Australia to the database in Ireland. Server calls are from reading
each screen's first-draw queries (the shared trade role check `getTradeRole` and the guard's own role reads are listed
separately; they are once per session, not per screen).

## Before (base commit 4cd3a67f)

| Screen | Server loader | Rounds | Queries | First-draw server calls | Measured by |
|---|---|---|---|---|---|
| My work `/field` | `tradeHome` | 3 | — | 1 (`getTradeHome`) | trade-home-speed, trade-home-waves |
| Money `/field/money` | `tradeMoney` | 3 | — | 1 (`getTradeMoneyView`) | trade-money-speed |
| My business `/field/business` | `tradeBusiness` | 3 (boss) / 1 (staff) | — | 1 (`getTradeBusiness`) | trade-business-speed |
| Team `/field/business/team` | `tradeBusiness` (same query as My business) | 3 / 1 | — | 1 | trade-business-speed |
| Installer job page `/field/$jobId` | `tradeJobBundle` | 5 (up to 8 for a boss with a held in-house job) | — | 1 bundle + `my_job_role` browser→database read | trade-job-speed |
| Install day page `/field/day/$jobId` | `tradeDay` + `tradeDayExtras` | 2 + 2 (two calls at once) | — | 2 (`getTradeDayView`, `getTradeDayExtras`) | trade-day-speed |
| Add a job `/partner/import` | `addJobStart` | measured in Task 3 | — | 1 | Task 3 |
| Needs me | saved copy (decision 382) | 1 | 1 | 1 | speed-rounds |
| Needs me (work-out after an action / no copy) | `loadNeedsMePage` | 37 | 241 | — | speed-rounds |
| Enquiries | saved copy (decision 383) | 1 | 1 | 1 | speed-rounds |
| Enquiries (work-out) | `loadEnquiriesList` | 2 | 16 | — | speed-rounds |
| Active jobs | saved copy (decision 383) | 1 | 1 | 1 + lane counts (2 rounds) | speed-rounds |
| Active jobs (work-out) | `loadActiveJobsList` | 3 | 34 | — | speed-rounds |
| Choose installer | `loadInstallerWaitingList` / `installerFacts` | 3 / 3 | 17 / 5 | 1 | speed-rounds |
| Office job page | `loadJobPage` | **30** | 164 | measured in Task 4 | speed-rounds |
| Office job page Money card | `loadJobMoney` | 2 (more on jobs with an electrician / installer price) | 33 | 1 (separate call) | speed-rounds |
| Sign-in → first screen | password accepted → `/portal` reads user + profile + roles → navigate → guard role reads ∥ screen call | 3 browser trips after the password, then the screen's own rounds | — | — | read from `SignInCard.tsx`, `portal.tsx`, `field.tsx` |

Existing tests failing on the base commit (snapshot drift, not part of this work; later tasks compare against these):
`trade-business-waves` (3), `job-bundle-waves` (1), `installer-waiting-waves` (4), `trade-business-speed` (2),
`trade-job-speed` (1), `office-read-budget` (3: Needs me / Active jobs / Enquiries request counts above their caps).

## After

Filled in as each task lands (Task 8).
