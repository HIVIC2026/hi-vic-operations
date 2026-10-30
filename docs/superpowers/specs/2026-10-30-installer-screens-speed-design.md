# Installer screens speed: design

Date: 30 Oct 2026 · Owner: Jo · Status: waiting for Jo's approval

## Goal

Every installer screen shows its content in **under 1 second** on a normal 4G phone, for both the installer business owner and their staff logins.

Speed only. What each person sees, what they can do, and who can see what stay exactly the same. No wording, layout, workflow, price or permission changes.

## Screens in scope

| Screen | Route | Data it loads today |
|---|---|---|
| Home / job list | `/field` | `getTradeHome` (refetch every 60s) |
| One job | `/field/$jobId` | `getTradeJobPage`, `getTradeJobBundle`, `getMyMittiInvited` (refetch 30s / 60s) |
| Ready Check / install day | `/field/day/$jobId` | `getTradeDayView`, `getTradeDayExtras`, `onsiteFormStatus` (refetch 30s / 60s) |
| Business pages | `/field/business`, `/field/business/team`, `/rates`, `/details` | `getTradeBusiness` |
| Money | `/field/money`, `/field/money/$jobId` | `getTradeMoneyView`, `getTradeMoneyExtras`, `getTradeMoneyJob` |

## What we already know (30 Oct, live database)

- The 26 Oct fixes are in place: all 395 security rules run their user check once per query, and the indexes on documents, photos and visit times exist. The whole-table reads on documents and photos have stopped growing.
- `tradeHome` waits for about 6 rounds of database reads one after another (sign-in context → offers and assignments → jobs, bookings, photos, deadlines → status facts, money, quotes → form facts and prices → past jobs). Some of those start further reads inside them.
- Nothing yet measures how long installer screens actually take.

## Part 1: Measure (before)

- A new read-only timing script, `scripts/installer-speed.ts`, signs in as the TEST Reinsulate business (`[TEST PARTNER] Reinsulate`): once as the owner login and once as the staff login, the same people `installer-test` uses.
- It opens every screen above 5 times in Playwright with 4G throttling on a phone-sized screen. For each screen it records:
  - the median and slowest time until the content shows
  - the number of server and database calls
  - the slowest call
- TEST jobs and TEST logins only. It only reads: no sends, no writes, no Mitti, no Xero.
- It writes `qa/installer-speed/<date>.md`, a short before table.
- It needs the server key, so it runs where the key lives (the coordinating chat or Lovable), like the other TEST scripts.

## Part 2: Fix, slowest screen first

For each screen, in the order the before table shows (slowest first):

1. **Fewer trips.** The screen gets its data in one or two round trips instead of a chain. Independent reads run together. Where a chain can't be flattened in code, one read-only database function returns the screen's data in a single call, with the same per-business and per-user checks as today.
2. **Instant return visits.** When an installer goes back to a screen they've already opened, the last copy shows straight away while a fresh copy loads quietly. Signing out clears it.
3. **Lighter refreshes.** The automatic refreshes (every 30 or 60 seconds) skip fetching when nothing has changed since the last load.
4. **Small photo previews.** Photo lists show small previews; the full photo loads only when tapped.

Not in scope: office screens, owner screens, the public website, and a bigger database plan (only raised in the report if a screen still misses 1 second).

## Part 3: Safety and proof

- **Same information first.** Before each screen's fix, a test captures exactly what the current version returns for the TEST owner and TEST staff login. The new version must return the same thing, field for field.
- **Database changes** go in `docs/pending-migrations/` with an undo file and are proven on the practice database (PGlite) before any live run. Jo is asked before any live database change.
- Every fix gets an independent code review, then the screen is re-timed with the same script.
- The existing rules in `AGENTS.md` still apply (in-house partner checks, TEST-only safeguards, server function format).

## Done means

- An after table next to the before table for every screen, for owner and staff.
- Every screen under 1 second (median), or listed for Jo to decide on with the reason and options.
- The same-information tests pass for every changed screen.
