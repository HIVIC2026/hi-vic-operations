# Pricing method per installer company (installer-sourced jobs)

Queued after the bulk import. Plan only — nothing is built until you say go.

## What it does

The office sets a "Pricing method" on each approved installer company. It applies only to jobs that installer brings in. Jobs Home Insulation Victoria brings in keep the current pricing, with the $30/m² owner price.

| Choice | Who sets the installer's price | Ready Check form used |
|---|---|---|
| 1. Automatic | The portal: the installer's approved onboarding rates × the Ready Check measurements | Form without the price section |
| 2. Assessor enters price | The assessor, onsite (today's Form A1) | Form with the price section (current) |
| 3. Installer owner enters price | The installer company's owner, on each job in their portal | Form without the price section |

Every route builds the customer quote the same way: installer price + AP fee $349 + PIESA $349 − VEU discount, with no markup. The quote is always a draft until the office reviews it. Nothing is sent.

- Default for existing companies: **2. Assessor enters price**, so nothing changes for anyone until the office picks a different method.
- Every change records who made it, when, and the reason. A change only affects jobs whose quote has not been drafted yet. Quotes already drafted, issued or accepted keep their prices.
- Bulk-upload price (already built) still wins: if a price was found in the upload, it goes straight into the draft quote, whatever the method.

## Rates onboarding already collects

These rates are inc GST, or a total rate if the installer is not GST registered. They are saved on the installer's approved rate card when the office approves them.
- R5.0 ceiling insulation supply & install, per m² (required)
- Batts removal, per m² (required)
- Loose fill removal, per m² (required)
- Optional flat charges per job. For each one the installer enters an amount, enters $0 for "no extra charge", or leaves it blank, meaning "quoted separately":
  - Tile roof access (lift & relay tiles)
  - Metal sheet roof access
  - Difficult / restricted ceiling access
  - Minimum charge / call-out

## Are they enough for Automatic?

**Mostly yes for a standard job:** R5.0 install × measured area, plus removal × the area to remove, plus the roof or access extras. The Ready Check already records roof type (Tiles / Metal sheet / Other), access (Easy / Moderate / Difficult), area per ceiling space, insulation type (Batts / Loose fill), and the area to remove.

**Gaps.** When one of these happens, the portal won't guess. The job goes to "Price needed": the office or the installer owner enters the price, or the office adds the missing rate.
1. **Mixed removal:** if one ceiling area has both batts and loose fill, the form records one "area to remove" figure, so the portal can't tell which removal rate applies. Fix: price at the higher rate and flag it for the office, or add a split question to the form. Your call.
2. **Extra left blank** (quoted separately): if the job needs that extra, for example tile access, a price is needed.
3. **"Moderate" access:** onboarding only has a Difficult rate. Planned treatment: Moderate is no extra charge. Please confirm.
4. **Roof type "Other" or removal "Not sure":** price needed.
5. **Minimum charge:** planned treatment: if the calculated installer price is below the minimum, use the minimum. Please confirm.
6. **No rates for:** downlight covers, top-up (as opposed to full R5.0), and other R-values. These are always "price needed" for now.

## Your decisions needed

1. Mixed batts + loose fill: use the higher rate and flag it, or add a split question to the Ready Check?
2. Moderate access = no extra charge?
3. Minimum charge = the floor price for the installer's part?
4. Default method for new companies: Assessor (2)?

## Technical details

- Database: one new column on businesses, `installer_pricing_method` (`automatic` | `assessor` | `owner_entered`, default `assessor`), plus a change-history table. Additive only: proven on the practice database first, with an undo file, and no existing rows changed.
- Pure rule: `installerAutoPrice(rateCard, readyCheck)` in a new `installer-pricing.core.ts`. It returns either the price lines or "price needed" with reasons. Unit tests cover every gap above.
- Form choice: `readyCheckVariant` uses the company's method, not just the channel. Only "assessor" gets `ready_check_priced`.
- Owner-entered route: an installer-portal page for each job showing the Ready Check summary and one total price box, which feeds the existing draft-quote builder. Only members of that company can use it. It records who entered the price and when.
- Office: a selector on the partner page, with a required reason and the change history.
- Quote builder: reuse the existing installer draft (installer price + PIESA + AP − discount). Automatic writes the itemised installer lines as one "Insulation works by your installer" total, so customers never see installer rates.
