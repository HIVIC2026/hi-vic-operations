# Enquiries page tidy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy Office › Enquiries.
- Failed first emails live on Needs me only.
- The "Email didn't send" tab is renamed "Email not sent yet".
- The "Wrote to us" tag is amber and links to Emails.
- The phone button is removed.
- Cancel and Remove become one Close action.
- Addresses are never grey.
- Phone tick boxes are bigger.
- The count line is plainer.

**Architecture:**
- **Category rule (one pure change in `enquiry-categories.core.ts`):** a failed first email returns a new `"needs_me"` category.
- **Server list:** drops those rows before it counts and filters.
- **Screen copy and the Close routing:** two small pure functions in a new `enquiries-screen.core.ts`, so they can be tested.
- **Screen changes:** everything else is markup in `EnquiriesScreen.tsx`.

**Tech Stack:** TanStack Start (React), Tailwind, Bun tests (`bun test`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-30-enquiries-page-tidy-design.md`

## Global Constraints

- Tab label: `Email not sent yet`.
- Tab hint: `The first email hasn't gone out yet. It usually goes on its own shortly. Failed emails are on Needs me.`
- Close reasons, in this order: `No response`, `Owner changed mind`, `Not eligible`, `Owner opted out`, `Duplicate`, `Junk / spam`, `Test`.
- `Duplicate`, `Junk / spam` and `Test` are filed with `removeLeadsFn`. Every other reason uses `bulkCancelOfficeJobs`.
- Count line: `{n} enquiries · updated {checkedLabel}`, using `1 enquiry` for one.
- No new colours or fonts. Use the existing `Pill tone="amber"`.
- Phone tick-box tap area is at least 44×44px, with a visible box of about 20px.
- Opted out still wins over a failed send.
- No database change. No change to Needs me.

## Review Focus

- An owner who opted out and also has a failed email shows under Opted out and still counts. Test in Task 1.
- A failed email that is later re-sent comes back to "Offered a spot". The test feeds `sendFailed: false` with a recent outbound and expects `offered`. Test in Task 1.
- A typed reason like "duplicate" or " Duplicate " in a different case or with spaces still routes to remove. Test in Task 2.
- "Close all" never reaches `needs_me` rows. Test in Task 1: `CLOSABLE` has no `needs_me` and `inView("needs_me", v)` is false for every view.
- Tapping the "Wrote to us" tag on a phone row goes to Emails and does not open the side panel. The tag must not sit inside the row `<button>`. Checked in Task 3's code review and screen check.

---

### Task 1: Failed first emails on Needs me only

**Files:**
- Modify: `src/lib/enquiry-categories.core.ts`
- Modify: `src/lib/office-lists.server.ts` (around lines 174–192)
- Test: `tests/enquiry-categories.test.ts`

**Interfaces:**
- Produces:
  - `EnquiryCategory = "offered" | "not_sent" | "opted_out" | "quiet" | "needs_me"`
  - `inView("needs_me", v) === false` for every view.
  - `categoryCounts` ignores `needs_me`, and `all` counts only the shown ones.

- [ ] **Step 1: Update and add the failing tests**
  - Change the first test: `{ ...base, sendFailed: true, createdAt: ago(90), lastOutboundAt: null }` now expects `"needs_me"`.
  - Add `test("failed first email is on Needs me only", …)`:
    - `inView("needs_me", v)` is false for each of `ENQUIRY_VIEWS`.
    - `categoryCounts(["needs_me", "offered"])` equals `{ offered: 1, not_sent: 0, opted_out: 0, quiet: 0, needs_me: 0, active: 1, all: 1 }`. Keep `needs_me` in the record but always 0, so the type stays a full record.
    - `CLOSABLE.needs_me` is undefined.
    - `{ ...base, optedOut: true, sendFailed: true }` is `"opted_out"`.
    - `{ ...base, sendFailed: false }` is `"offered"`.
  - Add a test that the `not_sent` entry in `ENQUIRY_CATEGORIES` has the label and hint exactly as in Global Constraints.

- [ ] **Step 2: Run, expect FAIL**
  - Run: `bun test tests/enquiry-categories.test.ts`
  - Expected: FAIL on `"not_sent"` vs `"needs_me"` and on the label.

- [ ] **Step 3: Implement**
  - Add `"needs_me"` to `EnquiryCategory`, and return it where `sendFailed` returned `"not_sent"`.
  - Give `"needs_me"` `CATEGORY_RANK` 9.
  - Make `inView` return false for it before any other check.
  - Make `categoryCounts` skip it, and don't increment `all` for it.
  - Do not add it to `ENQUIRY_CATEGORIES` (it is not a tab) or to `ENQUIRY_VIEWS`.
  - Update the `not_sent` label and hint.
  - Update the file's top comment: "failed first emails are on Needs me only (Jo 30 Oct 2026)".
  - In `office-lists.server.ts`, filter out `category === "needs_me"` rows straight after they're built, before `counts`, so `open` excludes them too.
  - `wantIds` (used by Close all) goes through the same filtered list, so needs-me rows are never closed.

- [ ] **Step 4: Run, expect PASS.** Run `bun test tests/enquiry-categories.test.ts tests/four-bugs-enquiries.test.ts tests/four-bugs-enquiry-server.test.ts`. Fix any old assertions that expected `not_sent` for a failed send, so they follow the spec.

- [ ] **Step 5: Commit** with the message `Enquiries: failed first emails on Needs me only; tab "Email not sent yet"`.

### Task 2: One Close action

**Files:**
- Create: `src/lib/enquiries-screen.core.ts`
- Modify: `src/components/portal/EnquiriesScreen.tsx` (the `ActionsMenu` and the two `ReasonDialog`s for cancel and remove)
- Test: `tests/enquiries-screen.test.ts`

**Interfaces:**
- Produces:
  - `CLOSE_REASONS: readonly string[]`, which is the seven reasons in order.
  - `closeRouteFor(reason: string): "remove" | "cancel"`

- [ ] **Step 1: Write the failing test** `test("Close reason picks where it's filed", …)`:
  - `closeRouteFor("Duplicate")`, `closeRouteFor(" junk / spam ")` and `closeRouteFor("TEST")` each return `"remove"`.
  - `closeRouteFor("No response")`, `closeRouteFor("Owner opted out")` and `closeRouteFor("Duplicate address, owner moved")` each return `"cancel"`. Only an exact match removes.
  - `CLOSE_REASONS` deep-equals the Global Constraints list.

- [ ] **Step 2: Run, expect FAIL.** Run `bun test tests/enquiries-screen.test.ts`; the module is missing.

- [ ] **Step 3: Implement**
  - Match by trimming and lower-casing the reason against the three remove reasons.
  - In the screen, the Actions menu has one item: `{ key: "close", label: "Close", danger: true }`.
  - The Close dialog:
    - title: `Close {n} enquir{y|ies}`
    - description: `Duplicate, Junk / spam or Test go to Closed › Removed / test. Any other reason goes to Closed. History is kept.`
    - `presets={[...CLOSE_REASONS]}`
  - Its `run` calls `remove({ ids, reason }, "Removed")` or the existing cancel body, chosen by `closeRouteFor(reason)`.
  - Delete the old `cancel` and `remove` dialogs. The Close-all dialog is unchanged.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** with the message `Enquiries: one Close action, reason decides Removed vs Closed`.

### Task 3: Screen tidy (tag, phone button, addresses, tick boxes, count line)

**Files:**
- Modify: `src/lib/enquiries-screen.core.ts`
- Modify: `src/components/portal/EnquiriesScreen.tsx`
- Test: `tests/enquiries-screen.test.ts`

**Interfaces:**
- Consumes: `checkedLabel` from `office-needs-snapshot.core`.
- Produces: `enquiryCountLine(total: number, checked: string | null): string`

- [ ] **Step 1: Write the failing test** `test("count line", …)`:
  - `enquiryCountLine(48, "5 min ago")` returns `"48 enquiries · updated 5 min ago"`.
  - `enquiryCountLine(1, "just now")` returns `"1 enquiry · updated just now"`.
  - `enquiryCountLine(1200, null)` returns `"1,200 enquiries"`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `enquiryCountLine`** using en-AU number formatting.

- [ ] **Step 4: Change the screen**
  - **Count line:** the status span shows `enquiryCountLine(d.total, d.fromCopy ? checkedLabel(d.computedAt, false) : null)`, plus ` · updating…` while fetching. Drop "showing N".
  - **Phone button:** delete `NewEnquiryDialog`, its imports (`createEnquiry`, `tidyEnquiryDetails`, `Checkbox`, `Dialog*` if now unused) and its use in the header. `createEnquiry` stays in `portal.functions`.
  - **"Wrote to us" tag:** render it as `<Link to="/admin/emails">` wrapping `<Pill tone="amber">` with the mail icon and `Wrote to us · {age}`, and `aria-label="Owner wrote to us — open Emails"`.
    - On the phone row, move the tag line out of the row `<button>` into a sibling under it, so the link is not nested in a button and tapping it does not open the panel.
    - On the computer row it already sits outside the owner button. Keep it there.
  - **Addresses:** remove the `text-sub` condition and the `title` on the address span.
  - **Phone tick box:** wrap the phone checkbox in a `<label className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center">`, and give the input `h-5 w-5`. The computer row keeps `h-4 w-4`.

- [ ] **Step 5: Run the whole suite and types**
  - Run: `bun test`
  - Run: `bunx tsc --noEmit`
  - Run: `bunx eslint src/components/portal/EnquiriesScreen.tsx src/lib/enquiries-screen.core.ts src/lib/enquiry-categories.core.ts`
  - Expected: all pass, no new type or lint errors.

- [ ] **Step 6: Screen check**
  - Run `bun run dev` and open `/admin/enquiries` at 390px and 1280px wide, signed in as office if a test login is available. Otherwise render `EnquiriesScreen` with mocked data.
  - Check:
    - the tag is amber and goes to Emails without opening the panel
    - there's no phone button
    - Actions ▾ shows only Close
    - addresses are black
    - the tick box tap area is 44px
    - the count line wording is right
    - the tab reads "Email not sent yet"
  - Save screenshots for Jo.

- [ ] **Step 7: Commit** with the message `Enquiries: amber Wrote-to-us link to Emails, no phone button, black addresses, bigger phone tick boxes, plainer count`.
