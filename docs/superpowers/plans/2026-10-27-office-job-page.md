# Office job page (next step first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/admin/jobs/$jobId` so a phone shows the next step and its blocker first, with stages as one-line rows and Money / Contact history / File folded away.

**Architecture:** Pure layout rules go in a new `src/lib/job-page-layout.core.ts` (unit tested with `bun test`). New presentation pieces go in `src/components/portal/job-page-parts.tsx`. The route file `admin.jobs.$jobId.tsx` swaps the old header, Next panel and stage card grid for these pieces. Existing components (`StageWorkspace`, `MoneyCard`, `ContactHistory`, `FileList`, `JobMoreMenu`, `AiReplyDrafts`) are reused unchanged inside them.

**Tech Stack:** React 18, TanStack Start/Router/Query, Tailwind with portal tokens (`src/styles.css`, `src/components/portal/kit.tsx`), bun test.

**Spec:** `docs/superpowers/specs/2026-10-27-office-job-page-design.md`

## Global Constraints

- Presentation only: no change to workflow, wording rules, prices, permissions, guards or server writes (AGENTS.md "Portal look").
- The only new read is the existing `listChooseTrades({ data: { jobId, kind: "ready_check" } })`, with the same query key as the panel: `["choose-trades", jobId, "ready_check"]`.
- Warning pills (TEST, Life support, Install by, ESC notice due) stay visible in the header.
- Estimate working stays inside the Enquiry stage (already behind "Show working").
- Use kit tokens and pieces (`btnClass`, `Pill`, `text-ink`, `text-sub`, `border-line`, `bg-mist`, `bg-mint`, `bg-pink`, `text-rose`); touch targets min-height 44px.
- Copy, exactly: "Can't be done yet", "See installers ›", "Checking installers…", "Couldn't check installers", "Open full details", "Loading installers…", "Couldn't load installers", "Try again", "Contact".

## Review Focus

- Every installer blocked except one: the step is NOT blocked (one usable installer is enough). Test in Task 1.
- An installer list with zero installers at all: blocked, reason "No approved installers cover <suburb>". Test in Task 1.
- Old deep links `#stage-money`, `#stage-contact`, `?section=ap_veec` must open the right fold or row, not scroll to nothing. Test in Task 1.
- A job whose next step is not Choose installer must never call `listChooseTrades`. Checked in Task 3 (query `enabled` flag).
- A long owner name or email on a 375px phone must wrap, not push the page sideways. Checked in Task 4 pictures.

---

### Task 1: Pure layout rules

**Files:**
- Create: `src/lib/job-page-layout.core.ts`
- Modify: `src/lib/job-next-action.core.ts` (add `kind`)
- Test: `tests/job-page-layout.test.ts`

**Interfaces:**
- Produces:
  - `export type FoldKey = "money" | "contact" | "file"`
  - `export type InstallerTrade = { business: string; blocker: string | null }`
  - `export function installerBlock(list: { matching: InstallerTrade[]; others: InstallerTrade[]; suburb: string } | undefined): { blocked: boolean; reasons: string[] }`. `blocked` is true only when no trade in `matching ∪ others` has `blocker === null`. `reasons` is one `"<business>: <blocker>"` per trade, or `["No approved installers cover <suburb or 'this area'>"]` when there are no trades.
  - `export function stageRowLine(card: StageCard): string`: the first line whose value is not `"—"`, as `"<label>: <value>"`, else `CARD_STATE_LABEL[card.state]`.
  - `export function landingTarget(hash: string, section: string | undefined): { card: CardKey | null; fold: FoldKey | null }`: `#stage-money` → fold money; `#stage-contact` → fold contact; `#stage-file` → fold file; `#stage-<card key>` → that card; else the legacy `?section=` map now in the route (`enquiry, ready_check, quote, piesa, installation, ap_veec`) or a card key.
  - `NextAction` gains `kind: string | null` (the top needs candidate's `kind`, else null).

- [ ] **Step 1: Write the failing tests** in `tests/job-page-layout.test.ts`:
  - `installerBlock` with `matching: []`, `others: [{business:"Reinsulate",blocker:"No approved installer with a Full, current EEC certification recorded."},{business:"Matthews Insulation",blocker:"Has not agreed to free Ready Checks for Home Insulation Victoria leads."}]` → `blocked: true`, two reasons starting `"Reinsulate: "` and `"Matthews Insulation: "`.
  - The same plus one `others` trade with `blocker: null` → `blocked: false`.
  - `{matching: [], others: [], suburb: "3184"}` → `{ blocked: true, reasons: ["No approved installers cover 3184"] }`; `undefined` → `{ blocked: false, reasons: [] }`.
  - `stageRowLine` for lines `[{label:"Installer",value:"Not chosen yet"}]` → `"Installer: Not chosen yet"`; for all `"—"` with state `"later"` → `CARD_STATE_LABEL.later`.
  - `landingTarget("#stage-money", undefined)` → `{card:null, fold:"money"}`; `("#stage-ready-check", undefined)` → `{card:"ready-check", fold:null}`; `("", "ap_veec")` → `{card:"final-check", fold:null}`; `("", undefined)` → both null.
  - `nextAction(...)` for an existing choose-installer fixture in `tests/` (reuse the input another test already builds for `choose_installer`) → `kind === "choose_installer"`.
- [ ] **Step 2: Run** `bun test tests/job-page-layout.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions above, and add `kind` to every `NextAction` return in `job-next-action.core.ts` (`top.kind` in the candidate branch, `null` elsewhere).
- [ ] **Step 4: Run** `bun test tests/job-page-layout.test.ts` and every existing test that imports `job-next-action.core`. Expected: PASS, with no new failures.
- [ ] **Step 5: Commit** "Job page: layout rules (blocked installers, row lines, landing links)".

### Task 2: Choose installer panel never blank

**Files:**
- Modify: `src/components/portal/choose-installer.tsx:28`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1:** Replace `if (!d || …) return null` so that `q.isPending` renders `<p role="status" className="text-sm text-sub">Loading installers…</p>` and `q.isError` renders `<div role="alert">Couldn't load installers. <button onClick={() => void q.refetch()}>Try again</button></div>` (kit `btnClass("secondary")`). The existing `channel / stage / hasInstaller` → null rule stays as it is.
- [ ] **Step 2: Run** `bun test tests/email-buttons.test.ts tests/office-phase3.test.ts`. Expected: same results as before.
- [ ] **Step 3: Commit** "Choose installer: show loading and error instead of a blank pop-up".

### Task 3: Job page pieces and route

**Files:**
- Create: `src/components/portal/job-page-parts.tsx`
- Modify: `src/routes/_authenticated/admin.jobs.$jobId.tsx`

**Interfaces:**
- Consumes: Task 1 exports; `JobPage`, `StageWorkspace`, `MoneyCard`, `ContactHistory`, `FileList`, `JobMoreMenu`, `LogNoteDialog` from `office-job.tsx`; `listChooseTrades`.
- Produces:
  - `JobTop({ h, more }: { h: Header; more: ReactNode })`: the same pills and data as `JobHeader`, but street, phone, email and the source/permission/last-heard line sit behind a `Contact` toggle (`aria-expanded`). Call / Text / Email are 44px buttons.
  - `NextBox({ jobId, next, onGo }: { jobId: string; next: NextAction; onGo: (k: CardKey) => void })`: today's `NextPanel` look. When `next.kind === "choose_installer"` it runs `useQuery` (key above, `enabled` only then). Pending → "Checking installers…"; error → "Couldn't check installers" with the button still enabled; `installerBlock(...).blocked` → a `bg-pink` box "Can't be done yet" listing the reasons, the button grey (`btnClass("secondary")`), and a "See installers ›" link calling `onGo("ready-check")`. `next.blocked` (existing) shows in the same box.
  - `StageRows({ cards, open, onToggle, workspace })`: one 52px button per card (number or ✓, title, `stageRowLine`, "Now" highlight), `id={"stage-"+key}`. The open row shows its lines plus "Open full details", which renders `workspace(key)` below it.
  - `Fold({ id, title, hint, open, onToggle, children })`: a 52px header button with `id={"stage-"+id}`; children are mounted only when open.
- [ ] **Step 1:** Build `job-page-parts.tsx` with the four pieces.
- [ ] **Step 2:** In the route, render `JobTop`, `NextBox`, `AiReplyDrafts` (unchanged, before the stages), `StageRows`, then Folds for Money (no hint), Contact history (`hint`: `String(data.contacts.length)`) and File (no hint; these need no new reads), plus `LogNoteDialog`. Replace the hash/section effect with `landingTarget`, which sets the open card or fold and then scrolls to `stage-<key>`. `go("money" | "contact")` now opens the fold first.
- [ ] **Step 3: Run** `NODE_OPTIONS=--max-old-space-size=12000 node_modules/.bin/tsc --noEmit -p tsconfig.json`. Expected: only the 6 known errors (`@lovable.dev/cloud-auth-js`, `xlsx`).
- [ ] **Step 4: Run** `bun test tests/job-page-layout.test.ts tests/office-phase3.test.ts tests/estimate.test.ts tests/email-buttons.test.ts tests/portal-qa-screen-rules.test.mjs`. Expected: the same pass/fail counts as before this branch (estimate 2 and screen-rules 3 failures are pre-existing), plus the new test passing.
- [ ] **Step 5: Commit** "Job page: next step first, stages as rows, the rest folded".

### Task 4: Look at it

**Files:**
- Test fixture only (not committed): `.qa-fixture/` (git-excluded) gains `?s=job-blocked|job-ready|job-waiting`, rendering the route's pieces with mock `getOfficeJobPage`, `listChooseTrades` and section data.

- [ ] **Step 1:** Take screenshots at 375, 390 and 1280px of the three states, with no horizontal scroll (`scrollWidth === viewport width`) and no page errors.
- [ ] **Step 2:** Compare them to the mock-up artboards (Blocked / Ready / Waiting). Fix any difference in order, wording or hierarchy.
- [ ] **Step 3:** Push branch `job-page-redesign` and send Jo the before/after pictures. Do not merge or publish without her yes.
