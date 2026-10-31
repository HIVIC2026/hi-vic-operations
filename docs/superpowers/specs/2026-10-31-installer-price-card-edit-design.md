# Installer "Your price" card: edit product, price and notes; fix "1 thing missing"

Date: 31 Oct 2026 · Asked by Jo · Path: architectural (product change reaches every product reader)

## What Jo asked for
- On the installer's own jobs, the boss can edit the "Your price" section to **change the product** and **add notes**.
- The Mitti line always says "1 thing missing" — fix it.

## Jo's answers (31 Oct 2026)
1. A product changed in "Your price" is used **everywhere**: owner quote, SWMS, install form, ESC lodgement.
2. Notes are **office only** — the office and the boss see them; never on the owner's quote, pages or emails.
3. The section is **locked once the owner's quote is sent**.

## Cause of "1 thing missing"
`readyCheckBasics` lists `price` as missing on installer-sourced jobs with no price. The list is stored on the
basics event at the Mitti pull. Saving a price on the job page does not re-run basics, so the stored list keeps
`price`. The job page (`field.$jobId.tsx` → `readyCheckRows`) counts it as a Mitti item: "Complete · 1 thing missing".

## Design

### 1. Card (`InstallerPriceCard.tsx`)
- Same card, same place, boss only (team members still never see it).
- "Change your price" becomes **"Edit"**. The form has, in order:
  - **Insulation product** — dropdown of the same product options the Mitti Ready Check uses. Starts on the current product.
  - **Your price to the owner (inc GST)** — unchanged.
  - **What's included** — unchanged (removal rule from 27 Oct kept).
  - **Notes (only you and the office see these)** — optional free text, max 1,000 characters.
- Read view shows Product, Price, Includes, and Notes (when present).
- The "Insulation product" Ready Check row above stays, showing what Mitti said, so a change is visible.

### 2. Stored record (`installer-price.core.ts`)
- The `installer_price_set` event (append-only, latest wins) gains two optional fields:
  `product_option: string | null` and `notes: string | null`.
- Old records without them read as `null` = "use the Mitti product", "no notes". Nothing is guessed.
- Validation: `product_option`, when given, must resolve with `resolveMittiProduct` as ready; otherwise refused with
  "Pick a product from the list." Notes trimmed; over 1,000 characters refused.

### 3. Product goes everywhere
- `withInstallerPrice` (applied centrally by `entriesWithInstallerPrice`) also replaces the form's product answer
  with `product_option` when set. Every reader of the form snapshot (quote, SWMS, install form, area diagram,
  lodgement) then sees the boss's product with no changes of its own.
- On save, the job's `mitti_product_recorded` compliance event is re-recorded through the existing
  `mittiProductForJob` using the updated entries, so the compliance record matches.
- The plan step will list every product reader and confirm each reads through `entriesWithInstallerPrice`;
  any that read raw Mitti entries are switched to it. Readers that cannot be switched are flagged to Jo, not guessed.
- Job history gets a plain line: "Product changed by <boss> from X to Y".

### 4. Notes are office only
- Shown on the boss's card and on the office job page (job history/notes area).
- Never passed to the owner quote, owner pages, owner emails/texts, or partner emails. A test checks the owner
  quote and owner email builders never include them.

### 5. Locked once the quote is sent
- When the job's owner quote has been sent (`loadInstallerQuote` shows sent), the card is read-only: no Edit,
  with the line "Quote sent — call the office to change this."
- Server refuses a save in the same state (not only the screen).
- After an owner's "Send me a new quote" request (29 Oct rule: installer re-prices), the card unlocks again —
  as today, the old price isn't reused.

### 6. Fix "1 thing missing"
- `price` is never counted as a Mitti item: the job page's Mitti count leaves out `BASIC_PRICE`.
- When a price is missing, it shows on the card as today (the "Your price" next step), not on the Mitti line.
- Result: Mitti form finished + price saved → "Complete · nothing missing".

## Not changing
- HIV's own leads (price from agreed rates) — no card, no change.
- Mitti forms, quote maths, the $349 fees, electrician choice, payments.
- No database schema change (fields live in the event's JSON details).

## Testing
- Core: validation (product, notes, old records), `withInstallerPrice` swaps product, notes never in owner outputs.
- Lock: save refused once quote sent; allowed after a new-quote request.
- `readyCheckRows` count without price → "nothing missing".
- `bun run portal-qa` on a TEST installer job.

## Delivery
Pull request on branch `installer-price-card-edit`; not merged (coordinating chat merges).
