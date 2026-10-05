# Installer commercial terms, payouts and installer-sent quotes

Queued: starts only after the live-safety check and Jo's publish. Preview only. Database changes are tested on the practice database first, with an undo file. No existing records are changed and nothing is sent. The visual restyle stays on hold.

## 1. AP management fee per installer company
- New office-only setting on the partner page: "AP management fee (inc GST)". It defaults to $349; ReInsulate is set to $299 for the pilot. Every change records who, when and why.
- The existing per-job office override still wins when it is set.
- The customer discount stays at $70 per VEEC for everyone. There is no $50 option.
- The owner pays $349 for PIESA. The electrician is paid their own agreed PIESA rate out of it.
- The $200 minimum customer contribution always applies.
- One shared calculation feeds:
  - the estimates the installer sees
  - draft quotes (bulk import and Ready Check)
  - owner quotes
  - the tax invoice (which copies the quote)
  - the margins and profit view
- Each quote stores the fee it was built with. Quotes already issued or accepted never change.

## 2. Installer payouts (tracking only; no money moves)

| Job type | Installer is paid | Due date |
|---|---|---|
| Installer-supplied | Their full quoted price | 7 days after the later of: AP approval in the queue, and the owner paying their share in full |
| HIV lead | Their agreed rate | 7 days after AP approval. Owner payment is not a condition; chasing the owner is HIV's job. |

- Payouts never wait for VEEC registration.
- Status per job: Not yet due (shows what it is waiting for), Due (with date), Overdue, Paid.
- The office marks a payout paid, with date, reference and who did it. Nothing is sent to Xero or the bank.
- The payout date and status show:
  - on a new office Payouts list, next to the margins view
  - on the job's profit card
  - in the installer's portal, for their own jobs only, without margins

## 3. "Installer sends own quote" mode (per company, office switch, off by default)
- **Quote figures panel** on each job in the installer's portal. The installer enters their price; the panel shows:
  - VEECs
  - VEU discount
  - PIESA fee
  - that company's AP fee
  - any $200 minimum adjustment
  - the total the customer pays
  - the required wording ("Home Insulation Victoria is the Accredited Person…"). It stays marked draft until Jo approves the exact text.
- **Price changes:** saving a price updates the job's draft quote and is recorded with who and when. The price locks once the owner accepts.
- **Acceptance link:** a copyable owner link for each job. It opens our acceptance page, which always shows the latest figures. The owner reviews the figures, then signs consent and the VEEC assignment using the existing acceptance signing. The office gets a portal notice when the owner accepts. Nothing is emailed or texted.

## Database (practice database first, with undo file)
- **Business record:** new columns for the AP fee (default $349) and the own-quote switch (default off), plus a history table for changes to them.
- **Quotes:** new columns for the AP fee used and the acceptance-link token.
- **Payouts:** a new office-only payout table (job, installer, amount, due date, status, paid by/date/reference). Installers can read only their own rows.
- Grants and access rules on every new table. Nothing is renamed or deleted.
- ReInsulate's $299 is a one-off settings change, made only after you confirm it in the preview.

## Testing
- **Automated:**
  - fee maths at $349 and $299 for 50, 150 and 600 m², plus a cheap job that hits the $200 minimum
  - the per-job override still wins
  - payout due dates for both job types, including the owner paying after AP approval
  - payouts never depend on the VEEC
  - the acceptance link shows the latest price, and refuses once the price is locked or the quote is cancelled
- **Browser:** using a TEST company:
  1. The office sets a $299 fee and turns on own-quote mode.
  2. The installer enters a price and copies the link.
  3. On a phone-size screen, the owner sees figures that match. When the installer changes the price, the owner sees the update. The owner then accepts.
  4. I approve the job in the AP queue, check the payout date and mark it paid.
  5. I confirm nothing was sent, then delete all test data.

## Size
About 3 days.

## Needs Jo
1. The exact required wording for the panel.
2. Whether the $299 applies to ReInsulate jobs that already have quotes. The plan says new quotes only.
3. The installer payout amount on HIV leads: confirm it is the agreed rate inc GST.
