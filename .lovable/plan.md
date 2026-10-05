# Installer commercial options + installer-sent quotes

Queued: starts only after the live-safety check and Jo's publish. Preview only, practice database first with an undo file, no existing records changed, nothing sends.

## 1. Customer discount model (per installer company)
An office-only setting on the partner page with change history (who, when, reason).

| | Option 1 (default) | Option 2 |
|---|---|---|
| Customer discount per VEEC | $70 (current office VEEC value) | editable, default $50 |
| AP management fee | $349 | none |
| PIESA | $349 | $349 |
| $200 minimum contribution | always | always |

- Companies without a setting use Option 1. Existing companies are not changed.
- One shared calculation is used everywhere for installer-sourced jobs: the estimates the installer sees, bulk-import and Ready Check draft quotes, the owner quote, the tax invoice (which copies the quote), and the margins and profit view.
- Each quote keeps a record of the model and figures it was built with, so a later change never alters a quote that has already been issued or accepted.
- Our own (HIV-generated) jobs are unchanged.

## 2. "Installer sends own quote" mode (per company, office switch, off by default)
- **Quote figures panel** on each job in the installer's portal. The installer enters their price; the panel shows:
  - VEECs
  - VEU discount
  - PIESA fee
  - AP fee (Option 1 only)
  - $200 minimum adjustment
  - total the customer pays
  - the required wording ("Home Insulation Victoria is the Accredited Person…"). Jo approves the exact text; until then it is marked draft.
- **Price changes:** saving a price updates the job's draft quote and is recorded with who and when. Once the owner has accepted, the price locks.
- **Acceptance link:** a copyable owner link, one per job, which the installer puts on their own quote's "proceed" button. It opens our acceptance page, which always shows the latest saved figures; if the price changed after the link was shared, the owner sees the new figures. The owner reviews the Home Insulation Victoria figures, then signs consent and the VEEC assignment using the existing quote-acceptance signing.
- **Notices:** the office gets a portal notice when the owner accepts. Nothing is emailed or texted.

## Database (practice database first, undo file)
- New columns on the business record: discount model, Option 2 $/VEEC, and the own-quote switch. Defaults: Option 1, $50, off.
- A history table for changes to these settings.
- New columns on quotes: model snapshot, and a link token for the acceptance page. Blank on existing quotes.
- New tables get grants and access rules. Nothing is renamed or deleted.

## Testing
- Automated checks:
  - Option 1 and Option 2 maths at 50, 150 and 600 m², including a cheap job hitting the $200 minimum.
  - Option 2 never charges an AP fee.
  - Default is Option 1.
  - Issued quotes keep their figures.
  - The link shows the latest price and refuses once the quote is locked or cancelled.
- In the browser, with a clearly named TEST company and job: the office sets Option 2 and turns on own-quote mode; the installer enters a price and copies the link; the owner opens it on a phone-size screen, sees the matching figures, and the installer changes the price and the owner sees the update; then the owner accepts. Afterwards I confirm no messages were sent and delete all test data.

## Size
About 2 to 3 days.

## Needs Jo
1. Exact required wording for the panel.
2. Whether a price change after the owner opens the link should show a "figures updated" notice.
3. Whether Option 2 still records the $349 AP fee internally (it will be $0 to the customer either way).
