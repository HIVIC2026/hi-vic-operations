# Installer "Your price" card edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installer bosses can change product, price, what's included and office-only notes on their own job's "Your price" card until the quote is sent; the Mitti line stops saying "1 thing missing" because of the price.

**Architecture:** Two optional fields (`product_option`, `notes`) ride on the existing append-only `installer_price_set` event. `withInstallerPrice` already sits in front of every installer-job form reader (basics, quote draft, compliance product record via `installer-quote.server.ts:54/72`), so swapping the product answer there carries the new product everywhere. Notes are never turned into form entries, so nothing owner-facing can read them. A pure lock rule decides edit vs read-only on screen and server.

**Tech Stack:** TypeScript, TanStack Start server functions, React, Supabase, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-31-installer-price-card-edit-design.md`

## Global Constraints

- Installer's own jobs only (`channel === "installer_sourced"`); HIV leads untouched.
- Product choices = `APPROVED_PRODUCTS` (`src/lib/insulation-product.core.ts`) — same list as Mitti.
- Notes: optional, trimmed, max 1,000 characters; label "Notes (only you and the office see these)".
- Lock wording exactly: "Quote sent — call the office to change this."
- Edit link wording: "Edit" (replaces "Change your price").
- Unknown/old records: `product_option` and `notes` read as `null` (never guessed).
- No DB schema change. Server functions keep the literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain.
- Read `src/AGENTS.md` and `src/lib/AGENTS.md` before editing.

## Review Focus

1. Boss picks a product while Mitti has none → quote must use the boss's product, not hold for "confirm insulation product". (Task 1 test: `withInstallerPrice` adds the product entry when the form had none.)
2. Old record without the new fields → reads back exactly as before (no product swap, no notes). (Task 1 test.)
3. Owner asked for a new quote after the old one expired → card unlocks even though the old quote has `sent_at`. (Task 1 `priceCardLocked` test.)
4. Save attempted from a stale open screen after the quote went out → server refuses. (Task 2 wiring test.)
5. Notes containing text never reach the owner quote → `priceEntriesFromRecord` emits no notes. (Task 1 test.)

---

### Task 1: Record fields, product swap and lock rule (pure)

**Files:**
- Modify: `src/lib/installer-price.core.ts`
- Test: `tests/installer-price.test.ts`

**Interfaces:**
- Produces:
  - `InstallerPriceInput` gains `productOption?: string | null; notes?: string | null`
  - `InstallerPriceRecord` gains `product_option: string | null; notes: string | null`
  - `PRICE_ISSUES.product = "Pick a product from the list."`, `PRICE_ISSUES.notes = "Keep notes under 1,000 characters."`
  - `priceCardLines(r)` returns `{ price; included; product: string | null; notes: string | null }`
  - `priceCardLocked(f: { quoteSentAt: string | null; newQuoteRequestedAt: string | null }): boolean` — true when `quoteSentAt` is set and there is no request, or the request is older than `quoteSentAt`.
  - `PRICE_LOCKED = "Quote sent — call the office to change this."`

- [ ] **Step 1: Write failing tests** in a new `describe("product + notes (Jo 31 Oct 2026)")`:
  - `validateInstallerPrice({ ...ok, productOption: "bradford gold r6", notes: "  side access only " }).record` has `product_option: "Bradford Gold R6"`, `notes: "side access only"`.
  - `productOption: "Mystery R9"` → issues `[PRICE_ISSUES.product]`; `notes: "x".repeat(1001)` → `[PRICE_ISSUES.notes]`; empty/blank notes → `notes: null`; no productOption → `product_option: null`.
  - Update the existing first test's expected record to include `product_option: null, notes: null`.
  - `installerPriceFromEvent` of an old event (no new keys) → `product_option: null, notes: null`; a stored bad product → `product_option: null`.
  - `withInstallerPrice([{label: LEAN_Q.product, value: "Bradford Gold R5"}], rec with product_option "Fletchers Pink Batts R7")` → `contactAnswersFromEntries(out).productOption === "Fletchers Pink Batts R7"` and only one product entry; with no product entry in the form, the product is added; with `product_option: null` the form's product is kept.
  - `priceEntriesFromRecord(rec with notes "secret")` → no entry's value contains "secret".
  - `priceCardLocked`: `{null,null}` false; `{"2026-10-31T01:00Z", null}` true; request after sent → false; request before sent → true.
- [ ] **Step 2: Run** `bun test tests/installer-price.test.ts` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** in `installer-price.core.ts`: validation uses `insulationProduct()` to canonicalise; `installerPriceFromEvent` reads both keys; `priceEntriesFromRecord` emits `{ label: LEAN_Q.product, value: product_option }` only when set; `withInstallerPrice` also drops product labels (`LEAN_Q.product`, `"Insulation product"`) when `product_option` is set; add `priceCardLocked`, `PRICE_LOCKED`.
- [ ] **Step 4: Run** `bun test tests/installer-price.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: installer price record carries product and office notes`

### Task 2: Server — save, lock, history line, view

**Files:**
- Modify: `src/lib/installer-price.server.ts` (export `readInstallerPriceState(jobId)` returning `{ stored, askedAgain, newQuoteRequestedAt: string | null }`)
- Modify: `src/lib/installer-price-set.server.ts`
- Modify: `src/lib/installer-price.functions.ts`
- Test: `tests/installer-price.test.ts` (wiring facts via `readFileSync`, as the file already does)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `installerPriceView` adds `locked: boolean`, `productOptions: string[]` (from `APPROVED_PRODUCTS`), `mittiProduct: string | null`. `setInstallerPriceFn` input adds `productOption: z.string().max(80).optional().nullable()`, `notes: z.string().max(1000).optional().nullable()`.

- [ ] **Step 1: Write failing wiring tests:** `installer-price-set.server.ts` source calls `priceCardLocked(` inside both `installerPriceView` and `setInstallerPrice`, and throws `PRICE_LOCKED`; `installer-price.functions.ts` source contains `productOption:` and `notes:` in the validator.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Lock input = latest quote `sent_at` (`loadInstallerQuote(jobId).quote?.sent_at`) + `newQuoteRequestedAt`. `setInstallerPrice` refuses with `WorkflowError(PRICE_LOCKED)` when locked, before writing. Event summary: price line, plus `· Product changed from <old effective product> to <new>` when it differs from the previous record's `product_option` (or Mitti's product when none), plus `· Notes: <notes>` when set (internal event = office only). Existing `prepareQuoteFromPortal` is unchanged — it re-drafts the quote, which re-records the compliance product from the swapped entries.
- [ ] **Step 4: Run** `bun test tests/installer-price.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: lock installer price once quote sent; product change in job history`

### Task 3: Card screen

**Files:**
- Modify: `src/components/trade/InstallerPriceCard.tsx`

**Interfaces:**
- Consumes: Task 2 view fields; Task 1 `priceCardLines`, `PRICE_LOCKED`.

- [ ] **Step 1: Implement.** Form order: "Insulation product" native `<select>` (blank "Same as the Ready Check" = null, then `productOptions`), price, what's included, `<textarea>` "Notes (only you and the office see these)". Starts on the current record (or Mitti product). Read view adds "Product" row and "Notes" row when present. Link text "Edit". When `view.locked`: no Edit link, no form, show `<Note>{PRICE_LOCKED}</Note>`.
- [ ] **Step 2: Run** `bunx tsc --noEmit -p .` and `bun run lint` on the file — Expected: no new errors.
- [ ] **Step 3: Commit** `feat: Your price card edits product and notes`

### Task 4: "1 thing missing" fix

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (add `mittiMissingCount(missing: string[], stops: string[]): number` — excludes `BASIC_PRICE`)
- Modify: `src/routes/_authenticated/field.$jobId.tsx:341` (use it)
- Test: `tests/installer-price.test.ts`

- [ ] **Step 1: Write failing test:** `mittiMissingCount(["price"], [])` → 0; `readyCheckRows({ ..., formLinked: true, formCompleted: true, missing: mittiMissingCount(["price"], []) }).form.label` → `"Complete · nothing missing"`; `mittiMissingCount(["price", "area"], ["x"])` → 2.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `field.$jobId.tsx`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `fix: price is never counted as a Mitti item`

### Task 5: Check everything

- [ ] `bun run test` — all pass.
- [ ] `bun scripts/scan-retired-terms.ts` — clean.
- [ ] `bun run portal-qa` on a TEST installer job — gaps reported as NOT_RUN, never PASS.
- [ ] Push branch `installer-price-card-edit` and open a pull request. Do not merge.
