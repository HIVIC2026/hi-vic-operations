# Installer pages Part 1 · B. My work and job offers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On My work every job sits in exactly one list, "More offers" hides nothing, electricians get plain words, and the job offer page has one accepted label, one new-offer label, a way back on errors, an "Are you sure?" for electricians and no old "pick one of the owner's times" steps.

**Architecture:** List placement stays in the pure cores (`installer-home.core.ts`, `work-places.core.ts`); `trade-view.server.ts` `tradeHome` derives the installer's Coming up from the core's groups so one rule decides. Wording lives in pure cores (`trade-view.core.ts`, `installer-screens.core.ts`); the two routes only render. No workflow, guard or database change.

**Tech Stack:** TanStack Start (React), TypeScript, bun:test (source-reading tests for routes/server wiring, real unit tests for `*.core.ts`).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` — section **B only** (B1–B8).

## Open questions for Jo (proposed answers are used in this plan until Jo says otherwise)

1. **B4 words.** "Moving automatically" → **"Waiting on others"** (tile sub-line "Nothing for you to do now"); "Needs chasing" → **"Taking a while"** (empty line "Nothing is taking a while right now.").
2. **B6 labels.** Accepted job (booked or times sent) → **"Job accepted"**; new offer (installer and electrician) → **"New job offer"**.
3. **B7 electrician wording.** "Not for me?" / **"The offer goes back to the office to pick another electrician. It won't come back to you."** / "Yes, not for me" / "Keep the offer". (The installer line "Nothing counts against you" is left off: electrician offer history feeds their reliability score.)
4. **B1 + firm rule.** A booked job that also needs the installer (e.g. Mitti form missing the price) shows in **Action needed only**, not also in Coming up.
5. **B8 old jobs.** Offers on jobs started the old way (owner gave windows) get the same "Offer the owner 3 times" form as new ones.

## Global Constraints

- Only B1–B8. Nothing else added; the look stays as it is.
- Firm rule: a job is only ever in ONE list at a time (installer: Coming up / Action needed / In progress / Done; electrician: Your move / Coming up / Your jobs; offers only in the offer panel/list).
- Trade screens read only through `trade-view.server.ts`; labels in pure cores (src/AGENTS.md).
- Server guards unchanged: `tradeTakeTime`, `replyTradeOffer` (`cant_make`), `respondToRecOffer`, `acceptPiesaOfferWithTimes` stay as they are; only the offer page stops using the old path.
- `bun scripts/scan-retired-terms.ts` stays at 0 customer-visible failures.

## Review Focus

1. Booked job with Mitti basics missing → Action needed only, not Coming up (Task 1 test `action beats coming up`).
2. Booked job whose quote is held (quote line wins over the booking) → In progress only, and dropped from Coming up (Task 1 test `comingForInstaller keeps only Coming up rows`).
3. Electrician job with a pending offer or a booked visit → never also in Your jobs (Task 3 test `electricianYourJobs`).
4. Offer that isn't for this business (load throws) → message plus "Back to My work" (Task 4 test).
5. Old-way PIESA offer with owner windows still open → the 3-times form, not a dead page (Task 7 test on `piesaDays`).

---

### Task 1: Installer groups — booked jobs get their own "coming" group (B1)

**Files:**
- Modify: `src/lib/installer-home.core.ts` (`HomeGroup`, `installerNext` coming_up line, `installerHomeGroups`, new `comingForInstaller`)
- Test: `tests/installer-home.test.ts`

**Interfaces:**
- Produces: `HomeGroup = "action" | "coming" | "progress" | "done" | "offer"`; `installerHomeGroups(jobs): { action: InstallerHomeRow[]; coming: InstallerHomeRow[]; progress: InstallerHomeRow[]; done: InstallerHomeRow[] }`; `comingForInstaller<T extends { jobId: string }>(coming: T[], home: { coming: { jobId: string }[] }): T[]`.

- [ ] **Step 1: Write the failing tests** — change the existing coming_up expectation (line ~52) to `{ group: "coming", next: "Next: install Tue 27 Oct at 8:00am" }`; in "every line starts with Next:" allow `["action", "coming", "progress"]`; in the groups test expect `g.coming` = `["b"]`, `g.progress` = `["e"]` and include `g.coming` in the uniqueness check. Add `comingForInstaller` to the import, then:

```ts
describe("one job, one list (B1)", () => {
  test("action beats coming up", () => {
    const g = installerHomeGroups([job({ jobId: "a", place: "coming_up", nextAction: "Needs finishing: price on the Mitti form", upcoming: { what: "Ready Check", start: "2026-10-26T21:00:00Z" } })]);
    expect(g.action.map((r) => r.jobId)).toEqual(["a"]);
    expect(g.coming).toEqual([]);
  });
  test("comingForInstaller keeps only Coming up rows", () => {
    const g = installerHomeGroups([
      job({ jobId: "b", place: "coming_up", upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } }),
      job({ jobId: "h", place: "coming_up", quoteLine: QUOTE_HELD_LINE, upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } }),
    ]);
    expect(g.progress.map((r) => r.jobId)).toEqual(["h"]);
    const visits = [{ jobId: "b", start: "x" }, { jobId: "h", start: "y" }, { jobId: "z", start: "w" }];
    expect(comingForInstaller(visits, g)).toEqual([{ jobId: "b", start: "x" }]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-home.test.ts` → FAIL (`comingForInstaller` not exported; group is "progress").
- [ ] **Step 3: Implement** in `installer-home.core.ts`: add `"coming"` to `HomeGroup`; the `j.place === "coming_up" && j.upcoming` line returns `group: "coming"` (same `next` text); `installerHomeGroups` also returns `coming`; add `comingForInstaller` (filter by the job ids in `home.coming`, order kept). `GROUP_LABEL` type stays `Exclude<HomeGroup, "offer" | "coming">`. Update the file's header comment: one of Coming up / Action needed / In progress / Done.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-home.test.ts tests/installer-states.test.ts` → all pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-home.core.ts tests/installer-home.test.ts
git commit -m "fix: installer My work puts a booked job in Coming up only (B1)"
```

### Task 2: Installer My work — Coming up from the groups; "More offers" hides nothing (B1, B3)

**Files:**
- Modify: `src/lib/trade-view.server.ts` (`tradeHome`, ~lines 151–158)
- Modify: `src/routes/_authenticated/field.index.tsx` (installer branch, lines 40–92)
- Modify: `src/lib/installer-home.core.ts` (`offersListView`: remove `comingUpFold`, now unused)
- Test: `tests/installer-home.test.ts`, `tests/installer-states.test.ts`

**Interfaces:**
- Consumes: `installerHomeGroups`, `comingForInstaller` (Task 1).
- Produces: `tradeHome(...).coming` for installers = only Coming up jobs; `home` gains `coming`.

- [ ] **Step 1: Write the failing test** (in `installer-home.test.ts`, "screen files…" describe); drop the `comingUpFold` assertion in `installer-states.test.ts` and add `expect("comingUpFold" in v).toBe(false)`.

```ts
test("B1/B3: Coming up comes from the groups, and More offers hides no list", () => {
  const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
  expect(srv).toContain("comingForInstaller(coming, home)");
  const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8");
  expect(page).not.toContain("comingUpFold");
  expect(page).not.toContain("{!offersList && <>");
  for (const kept of ['group="action"', 'group="progress"', "<DoneGroup", "data-coming-up"]) expect(page).toContain(kept);
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-home.test.ts tests/installer-states.test.ts` → FAIL.
- [ ] **Step 3: Implement** — in `tradeHome`, import `comingForInstaller` with `installerHomeGroups`, and return `coming: home ? comingForInstaller(coming, home) : coming` (electricians unchanged). Default `home` in the route becomes `{ action: [], coming: [], progress: [], done: [] }`. In the route: Coming up always renders `data.coming` (no fold); the Action needed / In progress / Done groups always render (remove the `!offersList` wrapper). Remove `comingUpFold` from `offersListView` and its return type.
- [ ] **Step 4: Run, expect PASS** — same command → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.server.ts src/lib/installer-home.core.ts src/routes/_authenticated/field.index.tsx tests/installer-home.test.ts tests/installer-states.test.ts
git commit -m "fix: installer Coming up follows the one-list rule; More offers hides nothing (B1, B3)"
```

### Task 3: Electrician My work — one list per job and plain words (B2, B4)

**Files:**
- Modify: `src/lib/work-places.core.ts` (new `electricianYourJobs`)
- Modify: `src/lib/trade-view.core.ts` (new `ELECTRICIAN_WORK_WORDS`)
- Modify: `src/routes/_authenticated/field.index.tsx` (electrician branch, lines 103–168)
- Test: `tests/work-places.test.ts`, `tests/job-status-7oct.test.ts` (line 70: replace `toContain("Needs chasing")` with `toContain("ELECTRICIAN_WORK_WORDS.slowFilter")`)

**Interfaces:**
- Produces: `electricianYourJobs<T extends { place: WorkPlace }>(jobs: T[]): T[]`; `ELECTRICIAN_WORK_WORDS = { waitingTile: "Waiting on others", waitingSub: "Nothing for you to do now", waitingFilter: "Waiting on others", slowFilter: "Taking a while", slowEmpty: "Nothing is taking a while right now." } as const`.

- [ ] **Step 1: Write the failing tests** (in `work-places.test.ts`)

```ts
// add to the imports: readFileSync (node:fs), electricianYourJobs (work-places.core), ELECTRICIAN_WORK_WORDS (trade-view.core)
test("electricianYourJobs: offers, Your move and Coming up jobs never also in Your jobs (B2)", () => {
  const jobs = (["offers", "needs_me", "coming_up", "moving"] as const).map((place, i) => ({ jobId: String(i), place }));
  expect(electricianYourJobs(jobs).map((j) => j.jobId)).toEqual(["3"]);
});
test("plain trade words replace Moving automatically / Needs chasing (B4)", () => {
  expect(ELECTRICIAN_WORK_WORDS).toEqual({ waitingTile: "Waiting on others", waitingSub: "Nothing for you to do now", waitingFilter: "Waiting on others", slowFilter: "Taking a while", slowEmpty: "Nothing is taking a while right now." });
  const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8");
  for (const gone of ["Moving automatically", "Needs chasing", "No action needed now"]) expect(page).not.toContain(gone);
  expect(page).toContain("electricianYourJobs(data.jobs)");
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/work-places.test.ts tests/job-status-7oct.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `electricianYourJobs` returns jobs with `place === "moving"`. In the route's electrician branch: `const yourJobs = electricianYourJobs(data.jobs)`; `chasing`, `moving`, `shown`, the "Your jobs" count and the section guard all use `yourJobs`; the tile, both filter buttons and the empty line use `ELECTRICIAN_WORK_WORDS` (keep `data-moving-filter` / `data-needs-chasing` attributes).
- [ ] **Step 4: Run, expect PASS** — same command → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/work-places.core.ts src/lib/trade-view.core.ts src/routes/_authenticated/field.index.tsx tests/work-places.test.ts tests/job-status-7oct.test.ts
git commit -m "fix: electrician job in one list only; plain words for waiting jobs (B2, B4)"
```

### Task 4: Offer page — "Back to My work" when it won't load (B5)

**Files:**
- Modify: `src/routes/_authenticated/field.offer.$offerId.tsx` (line 46, the `if (error)` branch)
- Test: `tests/installer-screens.core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("B5: an offer that won't load shows Back to My work", () => {
  const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
  const err = page.slice(page.indexOf("if (error)"), page.indexOf("if (!data)"));
  expect(err).toContain('<Link to="/field" className={outlineLinkClass}>Back to My work</Link>');
  expect(err).toContain("(error as Error).message");
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-screens.core.test.ts` → FAIL.
- [ ] **Step 3: Implement** — the error branch renders the existing message plus that link, inside `<Screen>`.
- [ ] **Step 4: Run, expect PASS** — same command → pass.
- [ ] **Step 5: Commit**

```bash
git add 'src/routes/_authenticated/field.offer.$offerId.tsx' tests/installer-screens.core.test.ts
git commit -m "fix: offer page error has a Back to My work button (B5)"
```

### Task 5: One label for an accepted job, one for a new offer (B6)

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (new `OFFER_LABEL`; `offerAcceptedView` pill)
- Modify: `src/routes/_authenticated/field.offer.$offerId.tsx` (lines 68, 101, 122)
- Test: `tests/installer-states.test.ts` (line 188 now expects `"Job accepted"`)

**Interfaces:**
- Produces: `OFFER_LABEL = { accepted: "Job accepted", new: "New job offer" } as const`.

- [ ] **Step 1: Write the failing test**

```ts
test("B6: one accepted label, one new-offer label", () => {
  expect(OFFER_LABEL).toEqual({ accepted: "Job accepted", new: "New job offer" });
  expect(offerAcceptedView({ ownerFirstName: null, suburb: null, jobNumber: null, times: [] }).pill).toBe(OFFER_LABEL.accepted);
  const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
  for (const gone of ['"Booked"', "You've taken this job", "Job accepted · times sent", '"New job"', 'took ? "Job accepted"']) expect(page).not.toContain(gone);
  expect(page.match(/OFFER_LABEL\.accepted/g)?.length).toBe(2);
  expect(page).toContain("pill={OFFER_LABEL.new}");
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-states.test.ts` → FAIL.
- [ ] **Step 3: Implement** — add `OFFER_LABEL`; `offerAcceptedView` pill = `OFFER_LABEL.accepted`. Route: booked screen `pill={OFFER_LABEL.accepted}`; electrician times-sent heading `{OFFER_LABEL.accepted}` (sub-line unchanged); pending screen `pill={OFFER_LABEL.new}` for both trades. Remove the now-unused `took` state.
- [ ] **Step 4: Run, expect PASS** — same command → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-screens.core.ts 'src/routes/_authenticated/field.offer.$offerId.tsx' tests/installer-states.test.ts
git commit -m "fix: one label for accepted jobs and one for new offers (B6)"
```

### Task 6: Electrician "Not for me" asks "Are you sure?" first (B7)

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (new `NOT_FOR_ME_SHEET_ELECTRICIAN`)
- Modify: `src/routes/_authenticated/field.offer.$offerId.tsx` (move the sheet at lines 148–157 into a local `NotForMe` component used by both trades; replace the electrician one-tap buttons at lines 184 and 195)
- Test: `tests/installer-states.test.ts`

**Interfaces:**
- Produces: `NOT_FOR_ME_SHEET_ELECTRICIAN = { title: "Not for me?", body: "The offer goes back to the office to pick another electrician. It won't come back to you.", yes: "Yes, not for me", keep: "Keep the offer" } as const`; route-local `NotForMe({ sheet, disabled, sending, onYes }: { sheet: { title: string; body: string; yes: string; keep: string }; disabled: boolean; sending: boolean; onYes: () => void })` holding its own open/closed state.

- [ ] **Step 1: Write the failing test**

```ts
test("B7: electrician Not for me asks first, with electrician words", () => {
  expect(NOT_FOR_ME_SHEET_ELECTRICIAN).toEqual({ title: "Not for me?", body: "The offer goes back to the office to pick another electrician. It won't come back to you.", yes: "Yes, not for me", keep: "Keep the offer" });
  const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
  expect(page).toContain("sheet={NOT_FOR_ME_SHEET}");
  expect(page).toContain("sheet={NOT_FOR_ME_SHEET_ELECTRICIAN}");
  expect(page.match(/data-not-for-me-sheet/g)?.length).toBe(1);
  expect(page).not.toMatch(/data-not-for-me onClick=\{\(\) => send\(/);
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-states.test.ts` → FAIL.
- [ ] **Step 3: Implement** — add the constant; `NotForMe` renders the existing `data-not-for-me-open` button or the existing `data-not-for-me-sheet` section with `sheet` words; installer passes `NOT_FOR_ME_SHEET`, electrician passes `NOT_FOR_ME_SHEET_ELECTRICIAN`; both `onYes` call `send("not_for_me", …)` as today. Drop the `confirmDecline` state from `OfferPage`.
- [ ] **Step 4: Run, expect PASS** — same command → pass (existing "not for me" test still passes).
- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-screens.core.ts 'src/routes/_authenticated/field.offer.$offerId.tsx' tests/installer-states.test.ts
git commit -m "fix: electrician Not for me asks Are you sure first (B7)"
```

### Task 7: Remove the old "pick one of the owner's times" offer steps (B8)

**Files:**
- Modify: `src/routes/_authenticated/field.offer.$offerId.tsx` (header comment lines 1–4; remove `take`/`tap`, `cant`/`cant_sent` modes, `note`, the "Suggest another time" section and the `Pick one of the owner's times` panel, lines 163–198; electrician pending screen always shows the 3-times panel)
- Modify: `src/lib/trade-view.server.ts` (`tradeOffer` `piesaDays`, ~line 183)
- Test: `tests/piesa-times.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("B8: offer page has no old owner-times steps; every pending PIESA offer gets the 3-times form", () => {
  const page = src("src/routes/_authenticated/field.offer.$offerId.tsx");
  for (const gone of ["Pick one of the owner's times", "Suggest another time", "takeTradeTime", '"cant_make"', "data-no-times", "data.windows", "canSuggest", "suggestUnlockLabel"]) expect(page).not.toContain(gone);
  expect(page).toContain("data-piesa-offer-times");
  expect(src("src/lib/trade-view.server.ts")).toContain('const piesaDays = o.kind === "piesa" && o.status === "pending" ? ');
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/piesa-times.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `piesaDays` no longer requires `windows.length === 0`. Route: `send` takes only `"not_for_me"`; mode becomes `"tiles" | "declined"`; remove unused imports (`takeTradeTime`, `shortDay`, `clock`, `Note`). Before committing, confirm `acceptPiesaOfferWithTimes` → `respondToRecOffer(…, null)` → `electricianOfferPiesaTimes` works for an old-way job (`piesaTimeTurn` gives `electrician_to_offer` once an electrician is assigned); if it refuses, stop and report to Jo — do not change server guards. Server functions and their other callers stay.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/piesa-times.test.ts tests/offer-money-boss-only.test.ts tests/trade-payout-gate.test.ts tests/installer-screens.core.test.ts` → pass (`<NoFormNoPay line` still appears twice).
- [ ] **Step 5: Commit**

```bash
git add 'src/routes/_authenticated/field.offer.$offerId.tsx' src/lib/trade-view.server.ts tests/piesa-times.test.ts
git commit -m "fix: remove the old pick-the-owner's-time offer steps (B8)"
```

### Task 8: Full checks

- [ ] **Step 1:** `bun run test` → no failures (compare with a run on the starting commit if any pre-existing failure shows).
- [ ] **Step 2:** `bunx tsc --noEmit` (no typecheck script in package.json; run `bun install` first if `node_modules` is missing) → no errors in the files this plan touched.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` → ends with `0 customer-visible (failing).`
- [ ] **Step 4:** Check on the TEST jobs, phone and computer (spec "Checking"): installer and electrician My work, an offer page, a bad offer link. Jo approves before it goes live.
