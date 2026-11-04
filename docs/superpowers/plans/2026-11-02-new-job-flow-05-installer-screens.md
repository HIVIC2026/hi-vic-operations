# New job flow · Part 5 — Installer portal screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the six installer office screens to the approved 2 Nov mock-ups (My work, Job page, Add a job, Money, My business, Team), add the Office role with its "Can see Money" switch, the who-books setting and logo upload, drive the Job page from one "Next step" box, and remove the "How it works" tab and the old four-form booking card.

**Architecture:** Every rule and every line of screen wording goes in new small pure cores (`trade-access-role.core.ts`, `next-step-dates.core.ts`, `next-step-box.core.ts`, `my-work.core.ts`, `job-page-rows.core.ts`, `money-screen.core.ts`, `business-screen.core.ts`, `team-screen.core.ts`); screens read only through `src/lib/trade-view.server.ts` (src/AGENTS.md rule) and only render. Bookings keep using the existing canonical in-house path (`inHouseBookVisit`, `changeInHouseLeadInstaller`, `allocateElectrician`, `tradeHandBack`, `tradeOwnerCancelled`); no guard is weakened. Two pending SQL files (roles; business settings) are proven on PGlite and never run live here.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, bun:test (pure tests + the repo's source-reading tests), PGlite, `bun run portal-qa`.

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` § "Installer portal screens" (+ "What gets removed › Screens"). Wording source: `docs/hiv-touchpoint-decisions.md` (2 Nov; "Decisions from the electrician + SWMS chat" wins). Approved mock-ups: `mywork2.png`, `jobA3-1.png`, `jobA3-2.png`, `add-big.png`, `money-phone.png`, `biz-phone.png`, `team-phone.png` (copy into `docs/approved-samples/2026-11-02/` in Task 1's commit).

## Global Constraints

- Overview Global Constraints apply (`2026-11-02-new-job-flow-00-overview.md`). Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` first; run `bun scripts/scan-retired-terms.ts` before and after.
- Trade screens read only through `trade-view.server.ts`, business-scoped; labels live in pure cores (src/AGENTS.md).
- Always "Home Insulation Victoria" in full on screens; trades see PIESA, SWMS, PIISA unexplained; always "Lead Installer" with capitals; never "fixes", "Rectification", "offer 3 times/days".
- One thing per screen: the Job page shows only the Next step box big; Owner, Visits, Site notes, Job details, What the owner's been told, Paperwork are folded rows; Paperwork is view/download only (uploads only in the Next step box).
- Look: calculator brand style A (Outfit headings, Figtree text, soft white cards, green buttons, pill tabs), desktop-first, works at 390 px. Reuse `TradeShell`, `card`, `greenBtn`, `ghostBtn`, `inputCls` and `src/components/portal/kit.tsx`; no new colours.
- Pay on Home Insulation Victoria leads: the installer's own pay only (install pay + PIESA pay from their rate card), never the owner's price. Own customers: owner's quote + their pay (Part 10 owns the quote figures).
- Roles: Boss always sees and enters prices and sees Money; Office sees and enters prices, sees Money only if the boss turned "Can see Money" on for them; Lead Installers, Crew and Electricians never log in.
- Approved screen wording (verbatim): "Good morning, {Business} crew!" · "{N} jobs need you today." · tabs "Your turn · {n}" / "All jobs · {n}" · search "Search name, address or HV number" · pills "Home Insulation Victoria lead" / "Your customer" · "⏱ {N} days left to install · must be done by {date} (30 days from the PIESA)" · "Locked: ESC has been told. Email us to move this install." · "Add a job" / "Your own customer. Takes a minute." / "Door-knocked or cold-called customers can't be added." / "Electrician for the PIESA" / "Add the job" / "Next: call {first} and book the Ready Check on the job." · "Money" / "What's coming to you and what's been paid." / "COMING TO YOU" / "PAID THIS MONTH" / "Paid 7 days after we approve the install paperwork" / "Paid once {first} has paid in full" · "My business" / "Everything we need from you to keep working." / "NEEDS YOU" · "Team" / "Everyone needs a date of birth and mobile. Lead Installers are registered with the ESC by Home Insulation Victoria." / "Add a person" · who-books choices "Our office" / "Our electrician" / "Either (whoever goes first)".
- Any wording below marked **DRAFT** has no approved text yet: it ships in the screen, is listed in Task 12's "wording Jo hasn't seen" paste, and the part does not switch on until Jo approves it.
- No new emails for the Job page: reuse the approved ones, each linking straight to `/field/{jobId}` (decisions, grill round 2).
- New SQL only in `docs/pending-migrations/` with `.rollback.sql` and a PGlite test; the code treats a missing column/function as "not live yet" via `schema-compat.core.ts` (`isMissingDbObject`), never as a crash.
- Line numbers in this plan are hints from the 2 Nov clone; find edit points by text.

## Review Focus

1. **A job already part-way through on the old flow** (stage `ready_check_ready_to_schedule` with owner-picked windows, `installation_scheduling` with "offer 3 install days", a legacy `rectification` booking) opens on the new Job page: the box shows a sensible next step and never shows "offer", "3 times", "fixes" or "Rectification" → Task 3 test "every live stage maps to a box with no retired words".
2. **An Office person whose boss has "Can see Money" Off** types `/field/money` or `/field/money/{jobId}` directly: the server refuses (not just a hidden tab) and the page shows a way back to My work → Task 1 test.
3. **An install already inside the 2-day lock when this part ships**: the box shows "Locked: ESC has been told. Email us to move this install.", Change Lead Installer and Change time are hidden for the install, and the server still refuses (Part 9 owns the lock rule, Parts 7 and 9 enforce the writers) → Task 3 test + Task 6 test that the UI never offers the action.
4. **Owner with no first name or no phone on file** (old imports): box text says "the owner", the phone chip is hidden, nothing renders "undefined"/"null" → Task 3 test.
5. **Search typed as "hv1234", "1234", "HV-1234", part of a street or a surname in any case**: the right card is found on All jobs → Task 4 test.

---

### Task 1: Office role, "Can see Money", and no logins for Lead Installers, Crew and Electricians

**Files:**
- Create: `docs/pending-migrations/installer-portal-roles.sql`, `docs/pending-migrations/installer-portal-roles.rollback.sql`
- Create: `src/lib/trade-access-role.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeContext`, `bossOrThrow` callers: `tradeMoney`, `tradeMoneyJob`, `tradeMoneyExtras`, `tradeHome` money rows), `src/lib/trade-access.core.ts` (`memberRoleFor`, `tradeAccessBlocker`), `src/components/trade/TradeShell.tsx` (`useTradeItems`), `src/routes/_authenticated/field.tsx` (no-login page), `src/routes/_authenticated/field.money.tsx`, `field.money_.$jobId.tsx`
- Test: `tests/installer-portal-roles.pglite.test.ts`, `tests/trade-access-role.test.ts`

**Interfaces:**
- Produces: `type TradeRole = "boss" | "office" | "none"`; `tradeRoleOf(m: { memberRole: string | null; workerTradeRole: string | null }): TradeRole`; `seesPrices(r: TradeRole): boolean`; `seesMoney(r: TradeRole, canSeeMoney: boolean): boolean`; `NO_LOGIN_NEEDED` (DRAFT copy, below).
- Produces (server): `tradeContext(userId)` now also returns `{ role: TradeRole; prices: boolean; money: boolean }` (keep `boss` for existing callers); `moneyOrThrow(userId)` and `pricesOrThrow(userId)` beside `bossOrThrow` in `trade-view.server.ts`. Part 10 consumes `pricesOrThrow`.
- Produces (SQL): `business_members.member_role` allows `'office'`; `business_members.can_see_money boolean not null default false`; `partner_workers.trade_role` allows `'office'` (no licence/qualification needed); `public.add_team_person_with_identity(_business uuid, _actor uuid, _name text, _role text, _mobile text, _email text, _dob date, _licence text, _rec text) returns uuid` (roles `office|lead|crew|electrician`; mobile and DOB required for all; service_role only; replaces calls to `add_team_installer_with_identity`, which stays for history); `public.set_member_can_see_money(_business uuid, _actor uuid, _worker uuid, _on boolean)` (boss only, writes `admin_config_events` row `member_money_access_changed`).

- [ ] **Step 1: Write the failing PGlite test** `tests/installer-portal-roles.pglite.test.ts` (schema built like `tests/trade-messages-paused.pglite.test.ts`, applying `drizzle/migrations/0186_private_worker_birth_dates.sql` first):
  - `"office member row is accepted and money is off by default"`: insert `member_role='office'` → ok; `select can_see_money` → `false`.
  - `"add_team_person_with_identity: office without licence or qualification"` → returns a uuid; `partner_workers.trade_role = 'office'`, identity row has the DOB.
  - `"mobile and date of birth are required for every role"`: `_mobile null` → throws `/mobile/i`; `_dob null` → throws `/Date of birth/`.
  - `"electrician needs licence and REC"`: `_role 'electrician', _licence null` → throws `/licence/i`.
  - `"only the business admin may add or switch money"`: actor with `member_role 'office'` → both functions throw `/business admin/i`.
  - `"set_member_can_see_money writes one audit row"`: on → `can_see_money = true` and one `admin_config_events` row `member_money_access_changed`.
  - `"rollback restores the old checks"`: apply `.rollback.sql` → `member_role='office'` insert fails.
- [ ] **Step 2: Run** `bun test tests/installer-portal-roles.pglite.test.ts` — Expected: FAIL (file not found / function missing).
- [ ] **Step 3: Write `installer-portal-roles.sql` + `.rollback.sql`.** Drop the unnamed 0052 `partner_workers` CHECK by looking it up in `pg_constraint` inside a `DO` block, re-add with `OR trade_role = 'office'`. Header comment: pending, proven on PGlite, run live only with Jo's OK.
- [ ] **Step 4: Run** the PGlite test — Expected: PASS.
- [ ] **Step 5: Write the failing pure test** `tests/trade-access-role.test.ts`:
  ```ts
  expect(tradeRoleOf({ memberRole: "business_admin", workerTradeRole: null })).toBe("boss");
  expect(tradeRoleOf({ memberRole: "office", workerTradeRole: "office" })).toBe("office");
  expect(tradeRoleOf({ memberRole: "member", workerTradeRole: "installer" })).toBe("none");
  expect(tradeRoleOf({ memberRole: "member", workerTradeRole: "electrician" })).toBe("none");
  expect(seesPrices("office")).toBe(true); expect(seesPrices("none")).toBe(false);
  expect(seesMoney("office", false)).toBe(false); expect(seesMoney("office", true)).toBe(true); expect(seesMoney("boss", false)).toBe(true);
  expect(memberRoleFor("mia@x.com", "boss@x.com", "office")).toBe("office");
  expect(tradeAccessBlocker({ ...leadWorker }, true)).toBe(NO_LOGIN_NEEDED);
  ```
  Plus a source-reading test: `tradeMoney`, `tradeMoneyJob`, `tradeMoneyExtras` call `moneyOrThrow(` (not `bossOrThrow(`); `field.money.tsx` error state renders a `Link to="/field"`.
- [ ] **Step 6: Run** `bun test tests/trade-access-role.test.ts` — Expected: FAIL.
- [ ] **Step 7: Implement.** `trade-access-role.core.ts` with the signatures above and `export const NO_LOGIN_NEEDED = "You don't need to sign in. Your jobs come to you by text."` (**DRAFT**). `memberRoleFor(workerEmail, businessEmail, workerTradeRole?)` returns `"office"` for `workerTradeRole === "office"`. `tradeAccessBlocker` returns `NO_LOGIN_NEEDED` for `trade_role` installer or electrician (Lead, Crew, Electrician never get logins); office workers need a valid email only. `tradeContext` reads `can_see_money` through a schema-compat overlay (missing column → `false`). `TradeShell.useTradeItems`: Add a job + My business → `boss`; Money → `money`; the shell takes `role` and `money` props from `getTradeHome`. `field.tsx`: when `role === "none"` render `TradePublicShell` with `NO_LOGIN_NEEDED` and Sign out.
- [ ] **Step 8: Run** both tests plus `bun test tests/trade-view` — Expected: PASS.
- [ ] **Step 9: Commit** (copy the seven approved PNGs into `docs/approved-samples/2026-11-02/` in this commit)
  ```bash
  git add docs/pending-migrations/installer-portal-roles*.sql src/lib/trade-access-role.core.ts src/lib/trade-access.core.ts src/lib/trade-view.server.ts src/components/trade/TradeShell.tsx src/routes/_authenticated/field.tsx src/routes/_authenticated/field.money*.tsx tests/installer-portal-roles.pglite.test.ts tests/trade-access-role.test.ts docs/approved-samples/2026-11-02/*.png
  git commit -m "feat(installer): Office role, Can see Money, no logins for Lead Installers, crew and electricians"
  ```

### Task 2: "Book by" dates and the 30-day countdown

The Lead Installer lock clock is NOT built here: Part 9 Task 9 owns the one rule (`leadInstallerLock`, `leadInstallerLocked`, `LEAD_LOCKED_MESSAGE` in `prestart.core.ts`, overview cross-part decision); this part only shows it.

**Files:**
- Create: `src/lib/next-step-dates.core.ts`
- Test: `tests/next-step-dates.test.ts`

**Interfaces:**
- Consumes: `addVicBusinessDays(fromIso, days)`, `melbourneToday`, `addYmd` (all `src/lib/melbourne-time.core.ts`), `melbourneMidnight(ymd)` (`daily-brief.core.ts`).
- Produces:
  - `type BookByStep = "ready_check" | "price" | "piesa" | "install"`; `BOOK_BY_BUSINESS_DAYS: Record<BookByStep, number> = { ready_check: 5, price: 1, piesa: 2, install: 1 }` and the point each one counts from (Jo 2 Nov, answer 11): `ready_check` from the day the job is given to the installer, `price` from the Ready Check done, `piesa` from acceptance (spec), `install` from the deposit being paid — the first moment the install can be booked (answer 21 puts the deposit before booking and opens it straight after the PIESA result, so answer 11's "after clear" is counted from the deposit).
  - `bookBy(step: BookByStep, fromIso: string): string` (Melbourne `YYYY-MM-DD`); `overdue(byYmd: string, now: Date): boolean` (true when `melbourneToday(now) > byYmd`).
  - `installCountdown(installDeadlineYmd: string | null, now: Date): { daysLeft: number; line: string } | null` → line `"⏱ {N} days left to install · must be done by {Ddd D Mmm} (30 days from the PIESA)"` ("1 day left" singular).

- [ ] **Step 1: Write the failing test** `tests/next-step-dates.test.ts`:
  - `bookBy("piesa", "2026-10-30T06:00:00Z")` → `"2026-11-04"` (Fri → Mon 2 Nov, Cup Day Tue 3 Nov skipped → Wed 4 Nov).
  - `bookBy("ready_check", "2026-10-26T01:00:00Z")` → `"2026-11-02"` (5 business days after the job is given); `bookBy("price", "2026-11-04T03:00:00Z")` (Ready Check done Wed 4 Nov) → `"2026-11-05"`; `bookBy("install", "2026-11-05T00:00:00Z")` (deposit paid Thu 5 Nov) → `"2026-11-06"`.
  - `overdue("2026-11-01", new Date("2026-11-01T12:00:00Z"))` → `false`; at `"2026-11-01T13:30:00Z"` (Mon 2 Nov Melbourne) → `true`.
  - `installCountdown("2026-12-06", new Date("2026-11-12T01:00:00Z"))` → `{ daysLeft: 24, line: "⏱ 24 days left to install · must be done by Sun 6 Dec (30 days from the PIESA)" }`; `installCountdown(null, now)` → `null`.
  - Source check: `next-step-dates.core.ts` defines no lock function (`/leadInstallerLock|leadLocked/` absent) — the lock comes from `prestart.core.ts`.
- [ ] **Step 2: Run** `bun test tests/next-step-dates.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/next-step-dates.core.ts` with the signatures above; Melbourne dates via the existing helpers, never a fixed +10/+11.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/next-step-dates.core.ts tests/next-step-dates.test.ts && git commit -m "feat(installer): book-by dates and the 30-day countdown"`

### Task 3: The Next step box rules (pure)

**Files:**
- Create: `src/lib/next-step-box.core.ts`
- Test: `tests/next-step-box.test.ts`

**Interfaces:**
- Consumes: Task 2 (`bookBy`, `overdue`); Part 9 Task 9 `leadInstallerLock(startIso): { emailAt; lockAt; lockLabel }`, `leadInstallerLocked(startIso, now)`, `LEAD_LOCKED_MESSAGE` (`prestart.core.ts`); Part 9 Task 10 before-upgrades warning text; Part 3 Task 19 `type AccessPerson`.
- Produces:
  ```ts
  export type NextStepFacts = {
    channel: string | null; stage: string; ownerFirst: string | null; ownerPhone: string | null; now: Date;
    givenAt: string | null; readyCheck: { start: string | null; done: boolean; missing: string[] };
    priceEntered: boolean | null; quote: "none" | "sent" | "accepted" | "declined" | "expired";
    acceptedAt: string | null; whoBooks: "office" | "electrician" | "either"; electricianName: string | null;
    piesa: { start: string | null; outcome: "pass" | "upgrades" | null; upgradesDone: boolean; certificateIn: boolean };
    access: AccessPerson | null;
    depositPaidAt: string | null; install: { start: string | null; lead: string | null; swmsSigned: number; swmsTotal: number };
    installDone: boolean; pay: { kind: "hivic_after_paperwork" | "own_after_owner_paid"; amount: number | null; paidAt: string | null } | null;
    mittiFormUrl: string | null;
  };
  export type NextStepKind = "book_ready_check" | "ready_check_booked" | "ready_check_missing" | "enter_price" | "waiting_quote"
    | "book_piesa" | "waiting_electrician_book" | "piesa_booked" | "upload_certificate" | "waiting_deposit" | "book_install"
    | "install_booked" | "install_locked" | "after_install" | "closed";
  export type NextStepBox = { kind: NextStepKind; title: string; sub: string | null; yours: boolean; bookBy: string | null;
    overdue: boolean; phone: { name: string; phone: string } | null; button: string | null; lines: string[];
    alsoBookInstall: { button: "Book the install"; warn: string } | null };
  export function nextStepBox(f: NextStepFacts): NextStepBox;
  ```
  `enter_price` body is Part 10's (this task only returns the kind, `title: "Enter your price"`, `yours: true`).

- [ ] **Step 1: Write the failing test** `tests/next-step-box.test.ts` (one `test` per row; `base` = a Home Insulation Victoria lead at stage `ready_check_ready_to_schedule`, owner "Sarah", phone "0400 000 000"):
  | facts change | expected |
  |---|---|
  | base, `givenAt` Mon 26 Oct | `kind "book_ready_check"`, title `"Book the Ready Check"`, `bookBy "2026-11-02"` (5 business days), `button "Book"`, `yours true` |
  | base, `givenAt` Wed 28 Oct | `bookBy "2026-11-05"` (Cup Day Tue 3 Nov skipped) |
  | Ready Check booked Wed 4 Nov 9am | `kind "ready_check_booked"`, `lines[0] "Ready Check · Wed 4 Nov, 9:00am"`, `button "Open the Mitti form"` |
  | done, `missing ["Ceiling photos"]` | `kind "ready_check_missing"`, `sub "Still needs: Ceiling photos"`, `button "Open the Mitti form"` |
  | own customer, done, `priceEntered false` | `kind "enter_price"`, `title "Enter your price"` |
  | quote sent | `kind "waiting_quote"`, `yours false`, `sub` contains `"Nothing for you to do."` and never the words `"call"`/`"chase"` (installers never chase acceptance) |
  | accepted Fri 30 Oct, `whoBooks "office"` | `kind "book_piesa"`, `bookBy "2026-11-04"`, `button "Book"` |
  | accepted, `whoBooks "electrician"`, `electricianName "Will Casdorff"` | `kind "waiting_electrician_book"`, `sub "Waiting for Will Casdorff to book the PIESA. Book by Wed 4 Nov."`, `yours false` |
  | PIESA upgrades still to come, deposit not paid | `kind "upload_certificate"` (title DRAFT `"Upload the Certificate of Electrical Safety"`); `lines` includes DRAFT `"Deposit: waiting for Sarah."`; `alsoBookInstall null` (the install is booked only after the deposit — Jo 2 Nov, answer 21) |
  | PIESA upgrades still to come, deposit paid | `kind "upload_certificate"`; `alsoBookInstall = { button: "Book the install", warn: "Electrical upgrades aren't done yet. The install can't start until the Part C and certificate are in." }` (Part 9 Task 10 warning — booking before the upgrades day is a warning, never a block) |
  | PIESA pass, no deposit | `kind "waiting_deposit"`, `sub "Waiting for Sarah to pay the deposit. Nothing for you to do."`, `yours false` |
  | deposit paid Thu 5 Nov, now Sat 7 Nov | `kind "book_install"`, `title "Book the install"`, `sub "Sarah's deposit is in. Give Sarah a call, agree a day, then add it here. Book by Fri 6 Nov."` (1 business day after the deposit), `overdue true`, `phone {name:"Sarah Brown",phone:"0400 000 000"}`, `button "Book the install"` |
  | install Fri 13 Nov 7:30am, now Mon 9 Nov, 1 of 3 signed | `kind "install_booked"`, `lines` = `["Safety plan signed 1 of 3", "Lead Installer locks Wed 11 Nov, 5pm"]` (`lockLabel` from Part 9's `leadInstallerLock`) |
  | rental, tenant Tina Lee 0400 111 222 lets us in, `book_install` | `phone {name:"Tina Lee (tenant)",phone:"0400 111 222"}` — trades call the person who lets them in (answer 7); the owner's phone stays on the Owner row |
  | same, now Wed 11 Nov 5:00pm | `kind "install_locked"`, `lines` includes `"Locked: ESC has been told. Email us to move this install."` |
  | install done, our lead, pay $3,000 unpaid | `kind "after_install"`, `sub "Your $3,000 is paid 7 days after we approve the install paperwork."` (DRAFT sentence built from the approved Money line) |
  | own customer done, unpaid | `sub "Your $3,275 is paid once Sarah has paid in full."` |
  | paid 3 Nov | `sub "Paid ✓ 3 Nov"` |
  | `ownerFirst null`, `ownerPhone null` on `book_install` | sub starts `"The owner's deposit is in. Give the owner a call"`; `phone null`; `JSON.stringify(box)` has no `"undefined"`/`"null"` text |
  - `"every live stage maps to a box with no retired words"`: for every stage in `Constants.public.Enums.job_stage` (`src/integrations/supabase/types.ts`), `nextStepBox({...base, stage})` doesn't throw and `JSON.stringify` doesn't match `/offer|3 (times|days)|fixes|Rectification|lead installer|HIV\b/`.
- [ ] **Step 2: Run** `bun test tests/next-step-box.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `nextStepBox(f)`** — one ordered list of `(when, build)` rules, first match wins, ordered from the end of the job back to the start (closed → after_install → install_locked → install_booked → book_install → waiting_deposit → upload_certificate → piesa_booked → waiting_electrician_book → book_piesa → waiting_quote → enter_price → ready_check_missing → ready_check_booked → book_ready_check). `book_install` needs `depositPaidAt` (answer 21); the lock uses Part 9's `leadInstallerLocked`. `waiting_electrician_book` when `whoBooks === "electrician"`; `"either"` shows `book_piesa` (whoever goes first). Dates print as `Ddd D Mmm` Melbourne. All wording is a `NEXT_STEP_WORDS` const at the top with a `// DRAFT` comment on every line not quoted in Global Constraints.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/next-step-box.core.ts tests/next-step-box.test.ts && git commit -m "feat(installer): Next step box rules"`

### Task 4: My work — Your turn / All jobs, search, one card per job

**Files:**
- Create: `src/lib/my-work.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeHome` returns `myWork`), `src/routes/_authenticated/field.index.tsx` (rewrite to mywork2.png)
- Test: `tests/my-work.test.ts`, `tests/my-work-page.test.ts` (source-reading)

**Interfaces:**
- Consumes: Task 3 `nextStepBox`, `NextStepFacts`.
- Produces: `type MyWorkCard = { jobId: string; owner: string; hvSuburb: string; pill: "Home Insulation Victoria lead" | "Your customer"; step: string; reason: string; by: string | null; overdue: boolean; button: string | null; yours: boolean }`; `myWorkCards(rows: { jobId: string; jobNumber: string; owner: string | null; street: string | null; suburb: string | null; channel: string | null; box: NextStepBox; reason: string }[]): { yourTurn: MyWorkCard[]; all: MyWorkCard[] }`; `greeting(business: string, yourTurnCount: number): { title: string; sub: string }`; `matchesSearch(card: MyWorkCard & { street: string | null }, q: string): boolean`; `reasonFor(kind: NextStepKind): string`.
- Produces (server): `tradeHome(userId).myWork = { greeting, yourTurn: MyWorkCard[], all: MyWorkCard[] }` built from the same reads `tradeHome` already makes (no new round trips beyond the Task 3 facts it lacks; batch them with the existing round 3).

- [ ] **Step 1: Write the failing test** `tests/my-work.test.ts`:
  - `greeting("Rapid", 3)` → `{ title: "Good morning, Rapid crew!", sub: "3 jobs need you today." }`; `greeting("Rapid", 1).sub` → `"1 job needs you today."`; `greeting("Rapid", 0).sub` → DRAFT `"Nothing needs you today."`.
  - Ordering: three `yours` cards (by `2026-11-01` overdue, `2026-11-05`, `2026-11-10`) supplied in reverse → `yourTurn.map(c => c.by)` = `["2026-11-01","2026-11-05","2026-11-10"]`; overdue first; cards without `by` last.
  - `yours false` cards appear only in `all`; every open job appears exactly once in `all`.
  - Card text: `{ owner: "Amy Clarke", hvSuburb: "HV-1250 · Ringwood", pill: "Home Insulation Victoria lead", step: "Book the Ready Check", reason: "New job", button: "Book" }`; own customer `enter_price` → `pill "Your customer"`, `reason "Ready Check done"`, `button "Price it"`; `book_install` → `reason "Deposit paid"`, `button "Book"`.
  - Search: card HV-1234 Sarah Brown, 12 Example St, Box Hill → matches `"hv1234"`, `"1234"`, `"HV-1234"`, `"example"`, `"BROWN"`, `"box hill"`; not `"1250"`.
  - Pending job offer (old path) becomes a Your turn card `step "Job offer"`, `button "View offer"` (keeps offers reachable; DRAFT).
- [ ] **Step 2: Run** `bun test tests/my-work.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `my-work.core.ts`; wire `tradeHome` (installer kind only) to build `NextStepFacts` per live job and return `myWork`.
- [ ] **Step 4: Write the failing page test** `tests/my-work-page.test.ts`: `field.index.tsx` source contains `"Your turn ·"`, `"All jobs ·"`, `"Search name, address or HV number"`, renders `myWork.greeting.title`, uses `border-rose` (red border) and `"· overdue"` for overdue cards, and no longer imports `installerHomeGroups`, `offersListView`, `monthStripWords` or `ElectricianHome`.
- [ ] **Step 5: Rewrite** `field.index.tsx` to the mock-up (pill tabs, search box filtering client-side with `matchesSearch`, one green button per card linking to `/field/{jobId}`).
- [ ] **Step 6: Run** `bun test tests/my-work.test.ts tests/my-work-page.test.ts` — Expected: PASS.
- [ ] **Step 7: Commit** `git commit -m "feat(installer): My work — Your turn, All jobs, search"` (add the four files).

### Task 5: Job page — header, progress, countdown, folded rows

**Files:**
- Create: `src/lib/job-page-rows.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeJobPage` returns `nextStep`, `progress`, `countdown`, `rows`), `src/routes/_authenticated/field.$jobId.tsx` (installer layout rewrite to jobA3-1/2)
- Test: `tests/job-page-rows.test.ts`, `tests/job-page-layout.test.ts` (source-reading)

**Interfaces:**
- Consumes: Task 2 `installCountdown`; Task 3 `nextStepBox`; Part 3 Task 19 `accessPersonFor(jobId): Promise<AccessPerson | null>`; existing `swmsHouseFacts` (`swms-house.core.ts`), `readInstallerPaidElectricians(businessId)` (`installer-paid-electricians.server.ts`) for PIESA pay, existing pay state (`payState`, `installerPayHeldReasons` in `trade-view.core.ts`).
- Produces:
  - `progressSteps(f: { readyCheckDone: boolean; piesaDone: boolean; depositPaid: boolean; installDone: boolean }): { label: "Ready Check" | "PIESA" | "Deposit" | "Install"; state: "done" | "now" | "later" }[]`.
  - `siteNotesRows(h: SwmsHouseFacts, readyCheckNote: string | null): [label: string, value: string, warn: boolean][]` — rows Roof, Hazards, Ready Check notes; a row with no fact is left out (never guessed). No Manhole or Pets / access rows (Jo 2 Nov, answer 12 — no new Ready Check questions for them).
  - `ownerRows(f: { name: string | null; phone: string | null; email: string | null; access: AccessPerson | null }): [string, string][]` — the owner's name, phone and email; when the person who lets the trades in isn't the owner (Jo 2 Nov, answer 7), one more row DRAFT `["Lets you in", "Tina Lee · tenant · 0400 111 222"]` (Part 3 Task 19 `accessPersonFor` — the owner's quick-taps answers; `null` → no extra row).
  - `jobDetailsRows(f: { measuredM2: number | null; areas: number | null; existing: string | null; removal: string | null; product: string | null; access: string | null; installPay: number | null; installPayRule: string; piesaPay: number | null; piesaPaidAt: string | null; ownCustomer: boolean }): [string, string][]` — "Your install pay" `"$3,000.00 · paid 7 days after we approve the paperwork"`, "Your PIESA pay" `"$275.00 · paid ✓"`; never an owner price on a Home Insulation Victoria lead (own-customer quote rows are added by Part 10).
  - `ownerToldRows(events: { at: string; type: string; summary: string }[], payments: { at: string; label: string }[], next: string | null): [day: string, text: string][]` — newest last, max 8, last row `["Next for owner", next]` when given.
  - `paperworkRows(docs: …)`: Ready Check report (Mitti, with photos) · Signed PIESA · Owner's ESC consent · Safety plan (SWMS) · Install form (Mitti); "Ready once the install is booked" when not there yet.

- [ ] **Step 1: Write the failing test** `tests/job-page-rows.test.ts` with the jobA3 values: `progressSteps({readyCheckDone:true,piesaDone:true,depositPaid:true,installDone:false})` → labels `["Ready Check","PIESA","Deposit","Install"]`, states `["done","done","done","now"]`; `jobDetailsRows` gives `["Your install pay","$3,000.00 · paid 7 days after we approve the paperwork"]` and `["Your PIESA pay","$275.00 · paid ✓"]`, and never contains `"Your price"`/`"owner"` on `ownCustomer:false`; `siteNotesRows` with roof "Sloped, tiles", 4 LED downlights, no foil → includes `["Roof","Sloped, tiles",false]`, a Hazards row with `warn:true` containing `"4 LED downlights"` and `"no foil"`, and never a `"Manhole"` or `"Pets / access"` label; `ownerRows` for a rental with a tenant → last row `["Lets you in","Tina Lee · tenant · 0400 111 222"]`, owner-occupied → no "Lets you in" row; `ownerToldRows` returns `["Thu 5 Nov","Accepted · paid $349 ✓"]` style rows and `["Next for owner", "\"You're booked\" once you book the install"]`.
- [ ] **Step 2: Run** `bun test tests/job-page-rows.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `job-page-rows.core.ts`; extend `tradeJobPage` (one extra batched round at most) to return `{ nextStep, progress, countdown, rows: { owner, visits, siteNotes, jobDetails, ownerTold, paperwork }, label }` where `label` is the pill. PIESA pay amount = `readInstallerPaidElectricians(businessId).piesaIncGst` (missing rate → row shows "—", never a made-up number). Owner rows only when `contactVisible` already allows them.
- [ ] **Step 4: Write the failing layout test** `tests/job-page-layout.test.ts`: installer branch of `field.$jobId.tsx` renders, in order, `"‹ My work"`, owner name + pill + `HV-… · {address}`, the progress pills, `countdown.line`, the Next step box (`data-next-step`), then `<details>` rows titled exactly `"Owner"`, `"Visits"`, `"Site notes"`, `"Job details"`, `"What the owner's been told"`, `"Paperwork"`, then the links `"Can't do this one"` and `"Owner cancelled"`; and it no longer renders `InHouseBookingCard`, `A1ReadyCheckTimeCard`, `FixesTimesCard`, `OtherItems`, `ReadyCheckTimesCard`/install-days/PIESA-times cards, "Who's doing this" or the "Send this job to a staff member" fold.
- [ ] **Step 5: Rewrite** the installer layout (`InstallerFlow`) to the mock-up; desktop: left = Next step + Visits + bottom actions, right = Owner, Job details, Paperwork (decision "DESKTOP-first layout"); phone = one column. Keep the electrician branch untouched here (Part 6 removes it).
- [ ] **Step 6: Run** both tests + `bun test tests/field-job` — Expected: PASS (update older source-reading tests that asserted removed cards; never delete a test that pins a guard).
- [ ] **Step 7: Commit** `git commit -m "feat(installer): Job page — progress, countdown, folded rows"`

### Task 6: Next step box actions — book, change time, change Lead Installer, change electrician

**Files:**
- Create: `src/components/trade/NextStepBox.tsx`
- Modify: `src/routes/_authenticated/field.$jobId.tsx`, `src/lib/trade-view.functions.ts` (no new server function unless listed)
- Test: `tests/next-step-box-actions.test.ts` (source-reading + `renderToStaticMarkup`)

**Interfaces:**
- Consumes: Task 3 `NextStepBox`; existing server functions `inHouseBookVisit` (`{ jobId, kind, start, workerId?, crewIds? }`), `getInHouseBookingTeam`, `changeInHouseLeadInstaller` (`{ jobId, workerId }`), `getTeamElectricians` + `allocateElectricianFn` (`visit-allocation.functions.ts`), `tradeHandBack`, `tradeOwnerCancelled`, `getMittiJobPresentation`; Part 9 `leadInstallerLocked` and `requireEscWithdrawal(jobId, reason, actorId)`; Part 4 `queueVisitCancelledOwnerEmail(jobId, bookingId, "installer")`.
- Produces: `<NextStepBox jobId box onDone />`. Part 6 adds the certificate upload control inside it (`kind "upload_certificate"`); Part 10 adds the Enter your price form (`kind "enter_price"`).

- [ ] **Step 1: Write the failing test** `tests/next-step-box-actions.test.ts`:
  - `book_ready_check` renders Day + Arrival + "Who's going" (one people picker) and a `"Book"` button calling `inHouseBookVisit` with `kind: "ready_check"`.
  - `book_piesa` renders ONE form: electrician dropdown (from `getTeamElectricians`), Day, Arrival, `"Book"` → `allocateElectricianFn` then `inHouseBookVisit({ kind: "assessment" })`.
  - `book_install` renders Day, Arrival, Lead Installer (Leads only), Crew ticks, `"Book the install"`, and under it `"{first} gets a \"You're booked\" email and text straight away. Install by {date}."`.
  - Booked visits show `"Change time"`; the install shows `"Change Lead Installer"` only when `!leadInstallerLocked(start, now)`; `"Change electrician"` only while `piesa.outcome === null`; `install_locked` shows no change links for the install.
  - `alsoBookInstall` renders a second `"Book the install"` button with its warning shown above it; booking succeeds and the warning stays on the box (never a block).
  - A disabled button always has a visible reason next to it (`aria-describedby`) — no silent greyed-out buttons.
  - `"Can't do this one"` and `"Owner cancelled"` keep the typed-reason confirm and call `tradeHandBack` / `tradeOwnerCancelled`; source check on those server handlers: both call `requireEscWithdrawal(` (reasons `"cant_do_this_one"` / `"owner_cancelled"`, overview cross-part decision), and only `tradeHandBack` calls `queueVisitCancelledOwnerEmail(` for a confirmed booking (Jo 2 Nov, answer 4).
- [ ] **Step 2: Run** `bun test tests/next-step-box-actions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `NextStepBox.tsx` (green-bordered card, eyebrow `"NEXT STEP"`, title, sub with bold "Book by …", phone chip `📞 {name} · {phone}`, the form for the kind, one green button). Server refusals show their message inline (existing `readableError`). Add the two calls to `tradeHandBack` / `tradeOwnerCancelled` (`trade-view.server.ts`) after their existing cancel succeeds; a failure of either call logs on the job and never undoes the hand-back.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(installer): Next step box actions"`

### Task 7: Add a job — the approved form and the consent tick naming the installer

**Files:**
- Modify: `src/lib/add-job-flow.core.ts`, `src/components/trade/add-job-flow.tsx`, `src/lib/onsite-ready-check.core.ts` (`LEAD_ORIGIN_OPTIONS`, `onsiteProblems`), `src/lib/onsite-ready-check.server.ts` (save path: consent record + per-job electrician), `src/routes/_authenticated/partner.import.tsx`
- Delete: `src/components/trade/usual-electrician.tsx` usage on Add a job (file stays if used elsewhere)
- Test: `tests/add-job-new-flow.test.ts`

**Interfaces:**
- Consumes: `TeamElectricianPicker` data (`getTeamElectricians`), existing `add_installer_job` / step-by-step save, `leadOriginProblem`.
- Produces: `ADD_JOB_WORDS` const; `addJobConsentLine(businessName: string): string` (approved — see below); `AddJobInput.electricianWorkerId: string` (required); consent recorded on the existing contact-permission event with details `{ wording, who: ["Home Insulation Victoria", businessName], for: "this job", how: ["phone","visit"], given_at, recorded_by: "installer" }` (Part 3 owns the consent record shape; if Part 3 defines a `recordContactConsent` writer, call it instead and keep this payload).

- [ ] **Step 1: Write the failing test** `tests/add-job-new-flow.test.ts`:
  - `ADD_JOB_WORDS` equals `{ title: "Add a job", sub: "Your own customer. Takes a minute.", name: "Owner's full name", mobile: "Mobile", email: "Email", address: "Address", how: "How did you get this customer?", howNote: "Door-knocked or cold-called customers can't be added.", electrician: "Electrician for the PIESA", button: "Add the job" }` and `nextLine("Tom")` → `"Next: call Tom and book the Ready Check on the job."`.
  - First lead-origin label is `"They contacted us"` (mock-up); `door_knock` / `cold_call` still refused by `leadOriginProblem`.
  - `addJobConsentLine("Rapid Insulation")` → `"The owner has agreed to Home Insulation Victoria and Rapid Insulation contacting them about this job."` (decided — overview "Decided from earlier approvals": VEU rule 1 says name the installer). Unticked → `onsiteProblems` includes that line's problem text; save refused.
  - No electrician chosen → problem `"Choose the electrician for the PIESA."` (DRAFT).
  - Source: `add-job-flow.tsx` no longer renders `VISIT_CARD`, `"Home Insulation Victoria's electrician"`, `"We arrange the electrical safety check"`, or the "Job added" outcome card; on success it navigates to `/field/{jobId}`.
- [ ] **Step 2: Run** `bun test tests/add-job-new-flow.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**: rename the first lead-origin label only; replace the electrician card with a required per-job picker of the business's onboarded Team electricians; save the electrician choice through the existing `recordJobElectricianChoice` / `allocateElectrician` path after the job exists; remove the optional Ready Check visit card; add the required tick with `addJobConsentLine(c.biz.name)`; boss and Office may add (`pricesOrThrow` from Task 1; `ADD_JOB_STAFF_ONLY` stays for nobody else).
- [ ] **Step 4: Run** the test + `bun test tests/add-job tests/onsite-ready-check` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(installer): Add a job — approved form, consent naming the installer, per-job electrician"`

### Task 8: Money — approved layout, pay rules, PIESA pay line

**Files:**
- Create: `src/lib/money-screen.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeMoney`), `src/routes/_authenticated/field.money.tsx`
- Test: `tests/money-screen.test.ts`

**Interfaces:**
- Consumes: Task 1 `moneyOrThrow`; existing `tradeMoneyRows`, `payState`, `ownerPaidInFullAt`; `readInstallerPaidElectricians` for PIESA pay.
- Produces: `moneyScreen(rows: { jobNumber: string; owner: string | null; what: "install" | "piesa"; amount: number; ownCustomer: boolean; state: PayState; ownerFirst: string | null }[], now: Date): { coming: { total: string; jobs: string }; paidThisMonth: { total: string; jobs: string }; rows: { title: string; rule: string; paid: boolean }[] }`.

- [ ] **Step 1: Write the failing test** `tests/money-screen.test.ts`: the page source `field.money.tsx` has no `"Download statement"` (Jo 2 Nov, answer 14 — the approved mock-up has none); rows as money-phone.png → `coming = { total: "$6,550", jobs: "4 jobs" }`; row titles `"HV-1219 · Ben Ross · install pay $3,000"` with rule `"Paid 7 days after we approve the install paperwork ›"`, `"HV-1241 · Tom Nguyen · install pay $3,275"` with `"Paid once Tom has paid in full ›"`, `"HV-1234 · Sarah Brown · PIESA pay $275"` with `"Paid ✓ 3 Nov"` and `paid: true`; `"1 job"` singular; no row ever contains the owner's price or `"Being checked"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the core; `tradeMoney` adds one PIESA pay row per job whose PIESA is done (amount from the rate card; missing rate → row left out and logged, never invented); page = heading, sub, two tiles, rows linking to `/field/money/{jobId}`.
- [ ] **Step 4: Run** `bun test tests/money-screen.test.ts tests/trade-money` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(installer): Money — coming to you, paid this month, PIESA pay"`

### Task 9: My business — Needs you box, folded rows, who-books setting, logo upload

**Files:**
- Create: `docs/pending-migrations/installer-business-settings.sql`, `.rollback.sql`; `src/lib/business-screen.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeBusiness`; add `tradeSetWhoBooks`, `tradeUploadLogo`, `businessLogoUrl`), `src/lib/trade-view.functions.ts` (two server functions), `src/routes/_authenticated/field.business.tsx`
- Logo storage: the existing `businesses.branding` jsonb (`branding.logo_url`, read by Part 10 through `businessLogoUrl`), no new column.
- Test: `tests/installer-business-settings.pglite.test.ts`, `tests/business-screen.test.ts`

**Interfaces:**
- Produces (SQL): `businesses.piesa_booked_by text not null default 'office' check (piesa_booked_by in ('office','electrician','either'))`; change audit trigger writing `admin_config_events` `who_books_changed` (same style as `trade-messages-paused.sql`).
- Produces (TS): `type WhoBooks = "office" | "electrician" | "either"`; `WHO_BOOKS_LABEL: Record<WhoBooks,string> = { office: "Our office", electrician: "Our electrician", either: "Either (whoever goes first)" }`; `whoBooksOf(raw: unknown): WhoBooks` (missing/unknown → `"office"`); `tradeSetWhoBooks(userId, v: WhoBooks)` (boss only); `tradeUploadLogo(userId, file: { name: string; type: string; bytes: Uint8Array })` (boss only, PNG/JPEG ≤ 2 MB; stored where email clients can load it for good — the same kind of public image path the email logo uses, never a signed URL that expires — and its `https://` URL written to `businesses.branding.logo_url` through the existing admin-checked business save); `businessLogoUrl(businessId: string): Promise<string | null>` (returns `branding.logo_url` when it starts with `https://`, else `null`; Part 10 uses it for the co-branded quote email, page and invoice and falls back to our logo on `null`). Part 6 reads `whoBooksOf(businesses.piesa_booked_by)`.
- Produces: `businessRows(f): { title: string; sub: string; to: string }[]` and `needsYou(f): { title: string; sub: string; button: string; to: string } | null`.

- [ ] **Step 1: Write the failing PGlite test**: default `'office'`; `'nobody'` rejected; change writes one `who_books_changed` row; rollback drops the column and trigger.
- [ ] **Step 2: Run** `bun test tests/installer-business-settings.pglite.test.ts` — Expected: FAIL.
- [ ] **Step 3: Write the SQL + rollback.** Run — Expected: PASS.
- [ ] **Step 4: Write the failing core test** `tests/business-screen.test.ts`: `needsYou` for public liability expiring 14 Nov seen on 2 Nov → `{ title: "Public liability expires in 12 days", sub: "Upload the new certificate. Our office checks it before your jobs can carry on after 14 Nov.", button: "Upload certificate" }`; nothing due → `null`; `businessRows` titles exactly `["Team","Electricians","Insurance and licences","Business details","Your rates","Bank details","Agreement and ESC notice"]` with subs like `"6 people · all have date of birth + mobile ✓"`, `"Will Casdorff (Viking Electrical) · PIESA price $330"`, `"Workers comp ✓ · Public liability expiring"`, `"Office 03 9000 0000 · logo ✓"`, `"Agreed 28 Oct"`, `"••••5678"`, `"Signed ✓"`; `whoBooksOf(undefined)` → `"office"`; `tradeSetWhoBooks` source calls `bossOrThrow(`.
- [ ] **Step 5: Run** — Expected: FAIL.
- [ ] **Step 6: Implement** the core and page. The Electricians row opens a page listing Team electricians (name, business, PIESA price from that electrician business's rate card when onboarded, else no price) and the who-books radio with the three approved labels (label above it DRAFT: `"Who books the safety check and the upgrades day?"`). Business details row gets "Upload your logo (for co-branded quotes)" (DRAFT). Remove the "How it works" link and "My usual electrician" link from the list. Keep the existing sub-pages (details, rates, bank, insurance, agreement, ESC notice).
- [ ] **Step 7: Run** both tests + `bun test tests/field-business` — Expected: PASS.
- [ ] **Step 8: Commit** `git commit -m "feat(installer): My business — Needs you, who books, logo upload"`

### Task 10: Team — roles, required date of birth and mobile, Money switch

**Files:**
- Create: `src/lib/team-screen.core.ts`
- Modify: `src/lib/trade-view.server.ts` (`tradeAddTeamPerson` → new RPC; team view returns role + checks; add `tradeSetMoneyAccess`), `src/lib/trade-view.core.ts` (`TeamMemberView.role` gains `"office"`; `TEAM_ADD_SHEET`), `src/routes/_authenticated/field.business_.team.tsx`
- Test: `tests/team-screen.test.ts`

**Interfaces:**
- Consumes: Task 1 SQL (`add_team_person_with_identity`, `set_member_can_see_money`); existing `crewClearance`, `electricianVerified`, ESC registration stamp (`escRegistered`).
- Produces: `teamRow(m: TeamMemberView & { escRegistered: boolean; licenceAndRec: boolean; canSeeMoney: boolean; hasDob: boolean }): { name: string; line: string; warn: boolean }`; `tradeSetMoneyAccess(userId: string, workerId: string, on: boolean)` (boss only).

- [ ] **Step 1: Write the failing test** `tests/team-screen.test.ts` (team-phone.png values): Boss → `"Boss ›"`; Office Money on → `"Office · prices ✓ · Money: On ›"`; Lead Installer → `"Lead Installer · CII ✓ · ESC registered ✓ ›"`; Crew → `"Crew · CII ✓ ›"`; Crew without CII → `{ line: "Crew · needs CII certificate ›", warn: true }`; Electrician → `"Electrician · licence + REC ✓ ›"`; missing DOB → line ends `"· needs date of birth ›"`, `warn: true` (DRAFT words); missing mobile → `"· needs mobile ›"` (DRAFT). `TEAM_INTRO` = `"Everyone needs a date of birth and mobile. Lead Installers are registered with the ESC by Home Insulation Victoria."`; Add a person roles = `["Office","Lead Installer","Crew","Electrician"]`; mobile + DOB required for every role.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: rows open a person sheet holding the existing per-person actions (mobile, CII link, White Card, signing link, ESC notice link, Remove) plus, for Office, the "Can see Money" switch. `tradeAddTeamPerson` calls `add_team_person_with_identity` (missing function → the existing "needs the pending database update" message).
- [ ] **Step 4: Run** `bun test tests/team-screen.test.ts tests/worker-role` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(installer): Team — roles, DOB and mobile for everyone, Money switch"`

### Task 11: Removals — "How it works", old booking card, Rectification, old time-offer cards

**Files:**
- Delete: `src/routes/_authenticated/field.guide.tsx`, `src/components/trade/InHouseBookingCard.tsx`, `src/components/trade/FixesTimesCard.tsx`, the ready-check/install-days/PIESA times cards no longer imported, `TeamElectricianPicker.tsx` only if Task 6 inlined it
- Modify: `src/lib/trade-view.core.ts` (remove `GUIDE_STEPS`, `GUIDE_WORDS`, `guideTabTitle`; electrician guide words stay for Part 6 to remove), `src/routes/_authenticated/field.welcome.tsx` (drop "How every job works"), `src/routeTree.gen.ts` (regenerated), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` (installer screens rule: "one Next step box; no How it works tab")
- Test: `tests/installer-removals.test.ts`

- [ ] **Step 1: Write the failing test**: files above don't exist; `grep` over `src/` finds no `"/field/guide"`, no `"Rectification"` in `src/components/trade` or `src/routes/_authenticated/field*`, no `InHouseBookingCard`; `/field/guide` old bookmarks redirect to `/field` (add to `partner.$.tsx`-style redirect list).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Delete and redirect;** update the two workflow docs in the same commit; run `bun scripts/scan-retired-terms.ts` → 0 customer-visible failures.
- [ ] **Step 4: Run** `bun test tests/installer-removals.test.ts` and `bun run test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "chore(installer): remove How it works tab, old booking card and time-offer cards"`

### Task 12: Full checks and Jo's phone sign-off pack

- [ ] **Step 1:** `bun run test` — all green.
- [ ] **Step 2:** `bun scripts/scan-retired-terms.ts` — 0 failures.
- [ ] **Step 3:** `bun run portal-qa` for `/field`, `/field/{jobId}` (one job per Next step kind on Tom's test company), `/partner/import`, `/field/money`, `/field/business`, `/field/business/team` — gaps reported NOT_RUN, never PASS.
- [ ] **Step 4:** Phone-width (390 px) and desktop pictures of each screen beside its mock-up, plus one text paste of every line marked DRAFT (from `NEXT_STEP_WORDS` — including the before-upgrades box —, `ADD_JOB_WORDS`, `NO_LOGIN_NEEDED`, team "needs" words, who-books label, logo line, empty My work line, the "Lets you in" Owner row, "Job offer"/"View offer" while Part 7 hasn't removed offers). Nothing switches on until Jo approves.

## Open questions for Jo

None left for this part (draft screen lines are approved from the Task 12 pictures at build time).

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Book-by dates (answer 11, read with 21):** PIESA 2 business days after acceptance; Ready Check 5 business days after the job is given; price 1 business day after the Ready Check; install booked 1 business day after the deposit is paid (Task 2).
- **Deposit and booking (answer 21, supersedes 3 and 5):** the install is booked only after the deposit; booking before the upgrades day is offered with Part 9's warning (Task 3).
- **Access at rentals (answer 7):** the Owner row shows the person who lets the trades in; the booking phone chip calls them (Tasks 3, 5).
- **Manhole and Pets / access rows (answer 12):** left out; no new Ready Check questions (Task 5).
- **Money (answer 14):** no "Download statement" button (Task 8).
- **Add a job tick:** names the installer (decided from VEU rule 1, Task 7).
- **Lead Installer lock:** Part 9 owns the rule; this part only shows it.

## Assumptions

- "Good morning, {Business} crew!" is shown as approved at any time of day.
- The mock-up's "Give her a call" / "pay her deposit" use the owner's first name instead of "her" (we don't record gender); this is flagged in the DRAFT paste.
- The progress bar has the same four steps for own customers (Ready Check · PIESA · Deposit · Install); Part 10 adds the price step in the box, not the bar.
- Lead Installer lock clock is calendar days (install Monday → email Saturday 9am, lock Saturday 5pm). Part 9 Task 9 owns the pure clock and `LEAD_LOCKED_MESSAGE`; Part 7 owns the 9am email and the refusal on the Lead/crew writers; Part 9 also refuses in `validateBooking`/`recordLeadChange` and owns the ESC update/withdraw rules.
- Crew stays changeable after the lock (only the Lead Installer and the install day/time lock).
- Moving every installer onto the "installer books" path (today `businesses.in_house`) is Part 3 Task 18; the Next step box calls the in-house booking functions and shows their refusal if a business isn't switched yet.
- PIESA pay is read from the installer's own rate card (`readInstallerPaidElectricians`); $275 in the mock-up is an example.
- Pending job offers (old path) stay reachable as a "Job offer" card until Part 7 Task 9 removes the old offer messages and page (overview cross-part decision; it counts in-flight offers first); then the card goes too.
- Part 3 owns the stored contact-consent record; Task 7 writes the same fields on the existing event so Part 3 can read them. Part 10 owns "Enter your price" and co-branding; it consumes `pricesOrThrow`, `businessLogoUrl` and the `enter_price` box kind. Part 6 consumes `whoBooksOf`, the `upload_certificate` box kind and `NO_LOGIN_NEEDED`. Parts 5 and 7 both consume Part 9's `leadInstallerLock` / `leadInstallerLocked`.
