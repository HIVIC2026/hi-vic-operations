# Automatic co-branded quote from an installer's Ready Check

## What Jo decided
- The installer ticks what's included in their price on the Ready Check (e.g. R5.0 supply & install, removal, access extras).
- The VEU discount is worked out from the measured m², the same way the calculator does now, using the $70 VEEC price setting.
- The office reviews and sends the quote. It carries the installer's branding plus Home Insulation Victoria as the Accredited Person.

## What the owner's quote shows (all inc GST)
1. Installer's price, with the ticked inclusions listed under it
2. Mandatory electrical safety assessment (PIESA) — $349
3. Home Insulation Victoria — Accredited Person fee — $349
4. Estimated project total
5. Estimated VEU / VEEC discount
6. Estimated cost after discount (minimum $200 co-payment still enforced)

No lead fee and no margin on installer-brought jobs. Margins and supplier rates are never shown.

## How it flows
1. Installer finishes the Ready Check in Mitti with their price and ticked inclusions.
2. The portal reads it back (job number must match — existing check), builds a draft quote automatically, and saves the Mitti report to the job's files (already done).
3. If anything is missing or doesn't add up (no price, no inclusions ticked, m² missing, co-payment under $200), the draft is held with a plain reason on the job — never sent.
4. The office opens the draft on the job page, sees a co-branded preview exactly as the owner will, and presses "Send quote to owner". Nothing goes out automatically.
5. Sending is recorded in the job history. Owner acceptance then follows the existing path (one Xero invoice, 50% deposit gate) — unchanged.

## What Jo needs to do
- Add an "Included in my price" tick-list question to the installer Ready Check in Mitti (portal will give the exact option wording). Until then, the portal can't read inclusions and the draft is held.

## Technical details
- Pure: extend `mitti-forms.core.ts` `QuotedPrice` with `inclusions[]`; `validateQuotedPrice` requires ≥1 inclusion. New pure `buildInstallerQuoteDraft()` in `installer-led.core.ts` reusing `ownerPriceFromQuoted`, `HIVIC_PIESA_INC_GST`, AP fee from `retail_estimator_settings.ap_management_inc_gst`, discount from the existing estimator VEEC math (measured m² × location factor × VEEC price setting).
- Persistence: on Ready Check sync (`mitti.server.ts`), create/refresh one `quotes` row (status draft, kind installation) + `quote_items`; idempotent per Ready Check audit; never overwrites a sent/accepted quote.
- Office send: new admin-only server fn `sendInstallerQuote` (requireSupabaseAuth + admin check), co-branded via existing partner branding; respects consent + comms lock; audit `workflow_events`.
- UI: draft card on admin job page with preview + send button; blockers listed.
- Tests: draft totals, missing inclusions/price/m², $200 floor, idempotency, no lead fee/margin rows.
