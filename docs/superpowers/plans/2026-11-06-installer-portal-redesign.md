# Installer Portal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the installer pages with the approved canvas design, page by page: fast, never losing work, one clear next step per job.

**Architecture:** Each screen keeps its rules in a pure `src/lib/*.core.ts` file (tested with `bun test`) and stays a thin TanStack route that draws those results with the portal kit. Server functions keep one database trip per screen. The spec has 13 build steps, which are grouped into 8 phases. Each phase gets its own detailed plan, written just before it starts, so it matches the code at that moment. **Phase 1 is written out in full below.**

**Tech Stack:** TanStack Start + Router, React, Tailwind tokens in `src/styles.css`, Supabase, Bun test + happy-dom, Lovable sync.

**Spec:** `docs/superpowers/specs/2026-11-06-installer-portal-redesign-design.md` (v2). Canvas: https://claude.ai/artifact/J4b2MUfmHFMkD1FeUFwYsF (source copy: `docs/superpowers/mockups/2026-11-06-installer-portal/canvas/`).

## Global Constraints

- Before workflow work, run `bun scripts/scan-retired-terms.ts`. Read `AGENTS.md`, `src/AGENTS.md` and `src/lib/AGENTS.md` before touching their areas.
- Run tests one file at a time: `bun test tests/<file>`. For type checks: `NODE_OPTIONS=--max-old-space-size=4500 npx tsc --noEmit`.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains. Never import `@tanstack/react-start/server` in `*.functions.ts`.
- No live SQL, no sends and no publish without Jo's explicit yes. Pending SQL goes in `docs/pending-migrations/` and is proven on PGlite. One pull request per task group; Jo merges with a merge commit; never force-push.
- **Look:** Open Sans; ink #22376B; sub #5B6785; blue #3C51C4; green #07BF61; background #F5F7FB; line #E3E8F2; amber text #8A4B00 on #FEF3E2; red text #B42318 on #FDECEA. Card radius 16px. Fields 16px text, 48px tall. Touch targets 44px or more.
- **Colour meaning:** green = your turn or done; grey = waiting; amber = reminder or missing; red = stop, don't start or cancelled. Every coloured state also says what it is in words.
- **Words:** always "Home Insulation Victoria" in full, never "HIV". Never "about". Never a deposit percentage. Owners are named, never "her" or "she". "Lead Installer" in full. No price on our leads to installers, anywhere.
- **Roles:** "Admin" (code: `businessAdmin` / `boss`). The UI never says "boss".
- **Greeting:** "Good morning, {first name}" before 12pm Melbourne time, "Good afternoon, {first name}" from 12pm to before 5pm, "Good evening, {first name}" from 5pm. Falls back to "Hi, {business} team" when there's no first name.
- **Speed:** each screen readable in under 2 seconds on a mid-range phone on 4G, in one server call per screen; the last copy shows instantly (`trade-cache`).
- **Saves:** never show "Saved" before the server confirms. Keep typed values on failure and show "Try again". Double taps create one record.

## Review Focus

1. **A job with a booked install and a DON'T START reason** must appear under "Fix before work starts", and nowhere else on Action items. (Task 4 test `stop job is only in fix`.)
2. **The home screen when the prestart facts read fails** for one job: the rest of the screen still loads, and that job shows under Your turn with no stop line, not a crash. (Task 5 test `prestart read failure keeps the screen`.)
3. **Owner names stored in capitals** ("JO LOWE") show as "Jo Lowe" in the action, meta and waiting lines. (Task 4 test `names show in normal case`.)
4. **Melbourne time across the 12pm and 5pm greeting edges and in daylight saving** (UTC+11): 11:59am says morning, 12:00pm says afternoon. (Task 4 test `greeting edges`.)
5. **Phone width 320px:** the Action items rows, buttons and This week list don't scroll sideways and no text overlaps. (Task 6 check in the design-review step.)

---

## Phase map (each phase gets its own detailed plan before it starts)

| Phase | Spec §10 steps | Delivers |
|---|---|---|
| **1** | 1, 2 | Shared look, new menu (computer left menu; phone top bar + bottom tabs), Action items |
| 2 | 3, 4 | Job page and Next step box (all steps, problem boxes, tabs); bookings (calendar Yes/No, How long, change/move, 30-day block, Lead + crew pick, 2-day office email, ESC re-notice) |
| 3 | 5, 6 | Calendar (week grid, phone day list, move, Add a Ready Check), Jobs (search, tabs, counts) |
| 4 | 7, 8 | Add a job (drafts, ceiling spaces, products and favourites, per-product pricing, checklist), our-lead first steps (photo quote with method and upload; Ready Check) |
| 5 | 9 | My business: Team (groups, Approved/Missing, office staff, Can see Money, Make admin), Business details, Rates (per product, default), Products, Documents, Bank (office approval) |
| 6 | 10, 10a | Money; electrician job link, safety plan signing, Today's job, sign in and setup, uploads (offline-safe) |
| 7 | 10b | Office screens (new states and flags); owner pages and messages, each message approved by Jo first; all 16 touchpoints in spec §5 |
| 8 | 11 | Speed pass and reliability pass; full nightly journey green at 390px and 1280px; go-live with Tom's test businesses |

Each phase ends with: the design-review skill against the canvas; `bun run portal-qa` with the screen walk; speed recorded against the 2-second target; phone and computer screenshots to Jo; a pull request for Jo to merge.

---

## Phase 1: shared look, menu and Action items

### File map
- Modify `src/styles.css`: `.installer-redesign` tokens (Open Sans, colours, amber/red).
- Create `src/lib/trade-menu.core.ts`: which menu items show, their labels, links and the active item.
- Modify `src/components/trade/TradeShell.tsx`: in redesign mode, the computer left menu and phone top bar + bottom tabs, from `tradeMenu`.
- Create `src/lib/action-items.core.ts`: greeting, the fix / turn / waiting groups and the This week list. Pure.
- Modify `src/lib/trade-view.server.ts` (`getTradeHome` / its builder around line 330–382): add `actionItems` and `thisWeek` to the result.
- Modify `src/routes/_authenticated/field.index.tsx`: draw Action items.
- Tests: `tests/installer-look.test.ts`, `tests/trade-menu.test.ts`, `tests/action-items.test.ts`, `tests/action-items-home.test.ts`, `tests/action-items-page.test.tsx`.

### Task 1: Installer look tokens

**Files:** Modify `src/styles.css` (rule at line ~461 `.estimate-brand.portal-theme.installer-redesign`). Test `tests/installer-look.test.ts`.

**Interfaces:** Produces the CSS variables `--hiv-ink #22376b`, `--hiv-sub #5b6785`, `--hiv-blue #3c51c4`, `--hiv-green #07bf61`, `--hiv-canvas #f5f7fb`, `--hiv-line #e3e8f2`, `--warning #8a4b00`, `--warning-soft #fef3e2`, `--hiv-rose #b42318`, `--danger-soft #fdeaea`, and `--app-font` / `--app-font-display` = `"Open Sans", ui-sans-serif, system-ui, sans-serif`, all on `.installer-redesign`. Open Sans 400/600/700 is already loaded in `src/routes/__root.tsx`.

- [ ] **Step 1: Write the failing test.** `test("installer redesign uses the website look")` reads `src/styles.css`, takes the `.estimate-brand.portal-theme.installer-redesign { … }` block, and expects it to contain each pair above (lower-case hex) and `--app-font: "Open Sans"`.
- [ ] **Step 2:** `bun test tests/installer-look.test.ts`. Expected: FAIL (the current block has #4b5a7c, Figtree).
- [ ] **Step 3:** Replace that one rule's values with the tokens above. Don't touch other rules.
- [ ] **Step 4:** Run the test again. Expected: PASS. Also run `bun test tests/my-work-page.test.ts`, which should still pass.
- [ ] **Step 5:** Commit: `feat(installer): website look tokens for the redesign`.

### Task 2: Menu rules

**Files:** Create `src/lib/trade-menu.core.ts`. Test `tests/trade-menu.test.ts`.

**Interfaces:** Produces
```ts
export type TradeMenuItem = { key: "action" | "calendar" | "jobs" | "money" | "business"; label: string; to: string; on: boolean; count: number | null };
export const RELEASED_SCREENS: { calendar: boolean; jobs: boolean }; // both false in Phase 1; Phase 3 turns them on
export function tradeMenu(i: { path: string; installer: boolean; admin: boolean; money: boolean; actionCount: number; released?: { calendar: boolean; jobs: boolean } }): { items: TradeMenuItem[]; addJob: boolean };
```
Labels and links: Action items → `/field`; Calendar → `/field/calendar`; Jobs → `/field/jobs`; Money → `/field/money`; My business → `/field/business`. Add a job → `/partner/import` (only when `installer && admin`).

- [ ] **Step 1: Write the failing tests:**
  - `admin sees all five when released`: with `{path:"/field", installer:true, admin:true, money:true, actionCount:4, released:{calendar:true, jobs:true}}`, the keys are `["action","calendar","jobs","money","business"]`, the first item has `count` 4 and `on` true, and `addJob` is true.
  - `phase 1 hides unreleased`: with the default `released`, the keys are `["action","money","business"]`.
  - `office without money`: with `admin:false, money:false`, the keys are `["action"]` (plus calendar/jobs when released) and `addJob` is false.
  - `active item`: a path of `/field/3f2c…-uuid` (job page) sets `action` on; `/field/business/team` sets `business` on.
  - `count zero shows no badge`: `actionCount:0` gives `count` null.
- [ ] **Step 2:** `bun test tests/trade-menu.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `tradeMenu`. "Action" is on for `/field`, `/field/offer…`, `/field/day…` and job ids, matching `useTradeItems` in `TradeShell.tsx`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(installer): menu rules for the redesign`.

### Task 3: Shell (left menu on computer, top bar + bottom tabs on phone)

**Files:** Modify `src/components/trade/TradeShell.tsx`. Test `tests/trade-shell-menu.test.tsx` (happy-dom, set up like `tests/next-step-box-actions.test.tsx`).

**Interfaces:** Consumes `tradeMenu` from Task 2. `TradeShell` gains an optional `actionCount?: number` prop. When `redesign` is true it draws:
- **Computer (`md:` and up):** a 220–240px white left menu with the logo, "+ Add a job" (blue, only when `addJob`), the items (the active one blue on #EAEEFB, the Action items count in a blue pill), and the business name + person name at the bottom.
- **Phone:** the top bar (logo; "+ Add a job" blue button on the right when `addJob`), and a fixed bottom menu with the same items (the active one blue).
- The non-redesign mode is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `redesign draws one nav with Action items first and the count`: render `<TradeShell installer redesign actionCount={4} boss money>` and expect a `nav[aria-label="Main"]` whose first link text is "Action items" and contains "4", plus a link "+ Add a job".
  - `old mode unchanged`: without `redesign`, the existing `nav[aria-label="Trade menu (desktop)"]` is still there.
  - `no boss word`: the rendered text never matches `/boss/i`.
- [ ] **Step 2:** `bun test tests/trade-shell-menu.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Add the redesign branch to `TradeShell` using `tradeMenu`. Keep the sign-out avatar menu and the `trade-saved` status line.
- [ ] **Step 4:** Run it. Expected: PASS. Also run `bun test tests/my-work-page.test.ts`, which should still pass.
- [ ] **Step 5:** Commit: `feat(installer): redesign shell with left menu and phone tabs`.

### Task 4: Action items rules

**Files:** Create `src/lib/action-items.core.ts`. Test `tests/action-items.test.ts`.

**Interfaces:** Consumes `MyWorkRow`, `cardAddress` and `crewName` from `my-work.core.ts`, and `NextStepBox` from `next-step-box.core.ts`. Produces
```ts
export type ActionRow = MyWorkRow & { stop: string | null; waitingOn: string | null; ownerFirst: string | null };
export type ActionCard = { jobId: string; action: string; address: string; meta: string; due: string | null; button: string; stop: boolean };
export type WaitingCard = { jobId: string; address: string; status: string; waitingOn: string };
export type WeekItem = { day: string; date: number; kind: "Install" | "PIESA" | "Ready Check"; time: string; place: string; who: string; flag: string | null; flagTone: "red" | "amber" | null };
export function greetingLine(firstName: string | null, business: string, now: Date): string;
export function actionItems(rows: ActionRow[]): { count: number; sub: string; fix: ActionCard[]; turn: ActionCard[]; waiting: WaitingCard[] };
export function thisWeek(bookings: { kind: string; scheduled_start: string; suburb: string | null; who: string | null; flag: string | null; flagTone: "red" | "amber" | null }[], now: Date): WeekItem[];
```
Rules:
- **fix** = rows with `stop`. Action is the stop line (e.g. "Book an electrician for install day"). Due is "Install {Ddd d Mmm}" from the box. Button is the box button. `stop: true`.
- **turn** = `box.yours` rows that aren't in fix. Action is the box title. Due is "By {Ddd d Mmm}" only when `box.bookBy` is set.
- **waiting** = the rest, except `closed`. `status` is the box title; `waitingOn` is the row's `waitingOn`.
- `meta` is `"{Owner name} · {HV} · {Your customer|Our lead}"`, with the owner name in normal case.
- `address` comes from `cardAddress(street, suburb)`.
- `sub`: `count === 0` → "Nothing needs you today."; 1 → "1 job needs you today."; n → "{n} jobs need you today. {k} must be fixed before work starts." (the second sentence only when k ≥ 1; when k is 1, "1 must be fixed before work starts.").
- `thisWeek`: the current Monday–Sunday in Melbourne, sorted by start. `day` is "Mon"… and `date` is the day of the month. `time` is e.g. "8:00am".

- [ ] **Step 1: Write the failing tests:**
  - `greeting edges`: `greetingLine("Deep","Reinsulate",new Date("2026-11-06T00:59:00Z"))` → "Good morning, Deep" (11:59am Melbourne); `…T01:00:00Z` → "Good afternoon, Deep"; `…T06:00:00Z` → "Good evening, Deep"; `greetingLine(null,"TEST Rapid",…)` → "Hi, Rapid team".
  - `stop job is only in fix`: a row with `stop: "Book an electrician for install day"` and a yours box appears in `fix` only.
  - `waiting says who`: a `piesa_booked` row with `waitingOn: "James (electrician)"` → waiting `waitingOn` is "James (electrician)".
  - `names show in normal case`: owner "JO LOWE" → meta starts "Jo Lowe · ".
  - `sub wording`: counts 0, 1, and 4 with 1 stop give the three exact strings above.
  - `no deadline chip without bookBy`: a turn card with `box.bookBy: null` has `due` null.
  - `this week order and days`: two bookings on Tue 10 Nov 9:00 and Mon 9 Nov 8:00 (now = Fri 6 Nov 2026) → the next week isn't shown; with now = Mon 9 Nov 07:00 Melbourne → `[{day:"Mon",date:9,…time:"8:00am"},{day:"Tue",date:10,…}]`.
- [ ] **Step 2:** `bun test tests/action-items.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use the existing normal-case name helper (search `src/lib` for the capital-names rule from 2 Nov, e.g. `displayName`/`titleCase`) instead of writing a new one.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(installer): Action items rules`.

### Task 5: Home data (stop reasons, who it's waiting on, this week)

**Files:** Modify `src/lib/trade-view.server.ts` (the `myWork` builder, lines ~330–382). Test `tests/action-items-home.test.ts`, following the existing home tests' fakes (see `tests/my-work-own-customer.test.ts` for how `tradeHome` is exercised).

**Interfaces:** Consumes `actionItems`, `thisWeek` and `greetingLine` (Task 4), `prestartFacts` (`src/lib/prestart.server.ts`), and `prestartFailures` / `tradeSafeFailures` (`src/lib/prestart.core.ts`, `src/lib/go-email.core.ts`). The home result gains `actionItems: ReturnType<typeof actionItems> & { greeting: string }` and `thisWeek: WeekItem[]`. Existing fields are unchanged.

Rules:
- **Stop:** only for jobs with a confirmed install starting within the next 7 days. `stop` is the first `tradeSafeFailures(prestartFailures(facts))` line, or null. Read them in parallel (`Promise.all`), and if one job's read throws, that job gets `stop: null` and the screen still loads.
- **waitingOn by box kind:**
  - `waiting_quote` while preparing → "Home Insulation Victoria"; otherwise the owner's first name.
  - `waiting_electrician_book` / `piesa_booked` → "{electrician first name} (electrician)".
  - `waiting_deposit` → the owner's first name.
  - `after_install` → "Home Insulation Victoria" on our leads, the owner's first name on their own customers.
- **thisWeek:** built from the bookings already read (`books`), keeping only this business's jobs.

- [ ] **Step 1: Write the failing tests:**
  - `stop reason from prestart`: a job with an install in 2 days and a fake `prestartFacts` that leads to a failure → `actionItems.fix[0].action` equals the safe line.
  - `prestart read failure keeps the screen`: the fake throws for one job → the result still has `actionItems`, and that job is in `turn` with no stop.
  - `install 8 days away isn't checked`: the fake isn't called.
- [ ] **Step 2:** `bun test tests/action-items-home.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement in the builder. Keep it to one extra parallel read for the few jobs within 7 days.
- [ ] **Step 4:** Run it, and also `bun test tests/my-work.test.ts` and `bun test tests/my-work-own-customer.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(installer): home data for Action items`.

### Task 6: Action items page

**Files:** Modify `src/routes/_authenticated/field.index.tsx`. Test `tests/action-items-page.test.tsx` (happy-dom; fake `getTradeHome` like the existing page tests do).

**Interfaces:** Consumes `data.actionItems` and `data.thisWeek` (Task 5) and the `TradeShell` redesign with `actionCount` (Task 3).

It draws (per the canvas "Action items" and "Action items · phone"):
- An h1 with the greeting, the `sub` line, and search (it filters all three groups by name, address or HV, using `matchesSearch`'s squash rule).
- **"Fix before work starts"** (red box, only when there's one or more).
- **"Your turn"**.
- **"Waiting on someone else"**: a button with the count, folded by default (`aria-expanded`).
- **"This week"** aside with a "Calendar" link (only when `RELEASED_SCREENS.calendar`; otherwise no link).
- Every row is a link to `/field/$jobId`, with one button.
- The existing error ("Your work couldn't load. Check your signal and try again." + "Try again"), loading, and not-linked states stay.

- [ ] **Step 1: Write the failing tests:**
  - `three groups in order`: with fake data containing 1 fix, 2 turn and 3 waiting, the headings in order are "Fix before work starts", "Your turn", "Waiting on someone else".
  - `waiting folded`: the waiting rows aren't shown until the button is clicked; then 3 rows each read "Waiting on …".
  - `no fix box when none`: with 0 fix, there's no "Fix before work starts" heading.
  - `search filters every group`: typing "melton" leaves only the matching rows.
  - `error keeps retry`: a rejected load shows "Try again".
- [ ] **Step 2:** `bun test tests/action-items-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement with `TradeShell redesign actionCount={data.actionItems.count}`, the portal kit pieces, and Tailwind classes using the Task 1 tokens. Use the phone-first layout. From `lg:` the groups and This week sit side by side.
- [ ] **Step 4:** Run it, plus `bun test tests/my-work-page.test.ts` (update its expectations only where they assert the old "My work" heading, and say so in the commit). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(installer): Action items page`.

### Task 7: Phase 1 check and pull request

- [ ] **Step 1:** Run `bun scripts/scan-retired-terms.ts`. Expected: no new hits.
- [ ] **Step 2:** Run `NODE_OPTIONS=--max-old-space-size=4500 npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3:** Run the design-review skill on Action items (computer at 1280px, phone at 390px and 320px) against the canvas boards "Action items" and "Action items · phone". Fix anything it finds that breaks the Global Constraints.
- [ ] **Step 4:** Run `bun run portal-qa` with the screen walk on the TEST job. Record the Action items first-load time on a throttled phone profile. Expected: under 2 seconds. Gaps are reported as NOT RUN.
- [ ] **Step 5:** Open a PR with the supermatt:pr body (summary, before/after screenshots at 390px and 1280px, merge danger). Ask Jo in a box to merge, and remind her to Publish → Update in Lovable after merging.
