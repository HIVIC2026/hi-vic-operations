# Photo-quote installers (No Gap) — design

Date: 5 Nov 2026 · Status: written, waiting for Jo's review · Path: architectural (Superpowers)

## Why

No Gap Insulation has told Home Insulation Victoria they don't do Ready Checks. They assess at their desk from the owner's photos/videos. They only want Home Insulation Victoria leads that have photos or videos. They enter the sqm and removal, it comes back to Home Insulation Victoria, the firm quote goes to the owner, and the job carries on to the PIESA.

## Compliance check

The Ready Check is a Home Insulation Victoria step, not a VEU rule. The VEU rules need a PIESA by a licensed electrician (REC) and a PIISA by the Lead Installer before work starts, within 30 days of the PIESA. Both still happen on these jobs (Mitti PIESA form and Mitti install form). Photo ID: not needed separately. Nobody is on site until the PIESA, and the electrician shows ID then (Jo, 5 Nov).

## Decisions (Jo, 5 Nov 2026)

1. **Setting per installer.** Partners › each installer: "How they quote: Ready Check / From photos". Default Ready Check. No Gap = From photos. Any installer can be switched later.
2. **Only photo leads.** A From photos installer can only be given Home Insulation Victoria leads with at least one owner photo or video (`documents.kind = 'intake_media'`). On Choose installer, other leads are greyed out for that installer, with the reason: "No Gap quotes from photos. This owner hasn't sent any." (Rule: greyed-out buttons must say why.)
3. **Owner is told, no choice.** When the job goes to a From photos installer, the owner gets ONE email (replaces #23 "{Installer} will call you" for these jobs). Draft wording, to approve:
   > Subject: Good news: no visit needed
   > Hi {first}, / Good news: {Installer} can quote from the photos you sent, so you don't need a Ready Check visit. / Your quote is on its way. / {Installer} · {office phone} · {business email} / Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).
   No text message. No other owner message until the quote.
4. **Photo quote form (installer job page).** The Next step box reads "Quote from photos". It shows the owner's photos/videos and their intake answers, then:
   - Existing insulation under R2? Yes / No
   - Sqm to remove
   - Sqm to install
   - Product (from their product list; allows top-ups, e.g. R3.5 over existing R1.5)
   - Button: **Send for quote**
   No other fields. Entered in the portal, not Mitti (no Mitti seat needed). "Under R2 = No" can't be sent for quote. It must go through "Can't do this one".
5. **Can't quote.** "Can't do this one" with a reason (photos not clear / looks over R2 / other) sends the job back to the office, like the existing button.
6. **Time limit.** Not sent within 2 business days of the job being given → flagged to Jo on Active jobs (same style as the in-house stall flags). The installer keeps the job.
7. **Quote.** Priced from the installer's agreed rates using their sqm, removal and product (Home Insulation Victoria leads only). It sends itself unless held, as now (over 15% off the estimate → held). Same quote email/page, valid 30 days.
8. **Price is firm.** If the real sqm differs at the PIESA or on install day, the installer installs at the quoted price. No new quote, no portal step.
9. **After the $349.** Exactly like any in-house job: installer's office books the PIESA with their own electrician, Mitti for PIESA, upgrades and install, 10% deposit, balance on install day, PIISA + SWMS on install day.
10. **Photo upload comes back.** Reverses touchpoint #13: the optional "Got photos or a video?" box (Add photos / Add a video) returns to the "Answer 3 quick questions" page `/estimate/{token}/video`.

## Touchpoints changed (2 Nov touchpoint list)

Only on jobs given to a From photos installer, unless marked "all".

| # | Touchpoint | Change |
|---|---|---|
| 13 | Answer 3 quick questions page | (all) optional photos/video box returns |
| 23 | "{Installer} will call you" email + text | replaced by decision 3 email, no text |
| 24 | "You're booked" Ready Check | not sent (no visit) |
| 25 | "See you tomorrow" Ready Check | not sent |
| 27 | "Nearly there" Ready Check chase | not sent; replaced by the 2-day flag to Jo (decision 6) |
| 29 | Quote email + quote page footnote | "Your quote uses what {Installer} worked out from your photos." |
| 54 | Automatic email replies | answers that say "they'll call you to book your free Ready Check" say "{Installer} is preparing your quote from your photos" once the job is with a From photos installer |
| PR #126 | Giving-jobs email to installer office | From photos version: each job is "a quote from photos, due within 2 business days", button to the job; not "a free Ready Check" |

Not changed: #19–22 (Spot saved, texts, It's your turn, quick-taps thanks) still promise a free Ready Check. They go out before the installer is known. Decision 3's email corrects that promise.

## Other knock-ons

- **SWMS "Specific to this house" and the job page's Site notes** fill in from the PIESA (and the installer note) when there's no Ready Check.
- **A2 "different R value?" question**: there's no visit, so it isn't asked. The owner is quoted for the product the installer picks.
- **Paperwork list / progress bar:** the "Ready Check" step shows as "Photo quote" on these jobs, so nothing shows missing or overdue. The Ready Check 5-business-day stall flag doesn't apply.
- **Mitti:** no Ready Check form is created for these jobs. The 15-minute backup that makes missing Ready Check forms must skip them.

## Not in scope

- Installers' own customers (photo quote is for Home Insulation Victoria leads only).
- Partner agreement wording about the firm price (only if Jo asks).
- Asking owners without photos for photos before giving them to No Gap.
- Any change for installers on "Ready Check".

## Testing

- Pure cores for: lead eligibility (has intake media), photo-quote form checks (under R2 required Yes, sqm numbers > 0, product picked), 2-business-day flag date, which owner/installer message a job gets.
- A TEST job end to end through the Test Centre with a TEST From photos installer: give job → owner "no visit needed" email → photo quote → quote auto-sent → $349 → PIESA as normal. No Ready Check messages or Mitti Ready Check form at any point.
- `bun scripts/scan-retired-terms.ts` before and after; `bun run portal-qa`.
