# Portal speed — Step 2: one trip per screen, instant actions — design

Date: 5 Nov 2026 · Status: written, waiting for Jo's review · Follows Step 1 (3 Nov, `2026-11-03-portal-speed-step1-design.md`)

## Why

Jo (5 Nov): the portal still feels slow everywhere — signing in, lists, opening a job, and after pressing a button — up to 5–10 seconds at worst. Lovable's timed run (5 Nov) shows pages *open* in under 2.3 s; the waits are in the data and the actions.

Cause: the database is in Ireland. Every browser → server → database trip costs roughly half a second from Australia. Most screens make several trips one after another (the office job page loader waits on about 20 steps in a row; installer screens still do 3–6 server calls each), and buttons reload the whole screen before confirming.

Moving the database to Asia Pacific (Lovable option 1) is the only way to shorten each trip. Jo has put that aside for now; this step cuts the *number* of trips instead. It does not change what any screen shows or does.

## Rules (Jo, 5 Nov 2026)

1. **One trip per screen.** Each screen has ONE server function that returns everything the screen needs. Inside it, independent reads run at the same time (`Promise.all`), not one after another. The target: no screen's loader has more than 3 sequential database rounds.
2. **Instant actions, with a safety line.** Buttons that only change the screen for the user (notes, filters, ticks, status labels, folds) update instantly and save in the background; if the save fails the change is undone and a plain message says so. Buttons that move money or message people — **Send, Give to installer, Pay, Book, Cancel** — still wait for the real save before saying "Done". Every action's server function does its write and returns at once; it never re-reads the whole screen. The screen refreshes its data in the background afterwards.
3. **Last copy on job pages too.** Office job page and installer job page draw instantly from the last copy on this device (same rule as Step 1 lists: per signed-in user, 24 h, "Updating…" line, money/send buttons wait for the fresh copy).
4. **Sign-in opens the first screen in one go.** After the password is accepted, the portal fetches the user's role AND the first screen's data together, then shows it. No sign-in → blank → spinner → page.
5. **Order:** installer screens first (My work, job page, Add a job, Money, My business, Team, and the no-login SWMS/Mitti links) → sign-in → office lists (Enquiries, Active jobs, Choose installer, Needs me, Jobs) → office job page → buttons. Each screen is its own pull request; nothing goes live until Jo says.
6. **Proof.** Every pull request shows before/after: number of server calls per screen, number of sequential database rounds inside them (counted by a test), and a timed run of that screen at 390 px and 1280 px.

## Not changing
- No new features, screens, wording or rules. Any guard, gate or domain rule stays exactly where it is (src/AGENTS.md).
- No database move, no schema change, no new tables.
- Trade screens still read only through `trade-view.server.ts`.
