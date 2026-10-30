# Enquiries page tidy — design

Date: 30 Oct 2026 · Approved in chat by Jo · Screen: Office › Enquiries (`src/components/portal/EnquiriesScreen.tsx`)

## Why

A design critique of the Enquiries page found things that were in the wrong order, easy to misread, or easy to mis-tap on a phone. Jo picked the fixes below. Nothing about how enquiries are grouped, closed or emailed behind the scenes changes.

## Changes

1. **"Wrote to us" tag**
   - Change the tag's colour from green to amber (`Pill tone="amber"`), because green reads as "all good" when the tag means a reply is needed.
   - Make the tag a link to the Emails tab (`/admin/emails`), where Jo replies.
   - The link opens the top of the Emails tab. It does not jump to one owner's email: Jo chose not to add that.
   - Show the tag on both the phone row and the computer row.
   - Tapping the tag must not also open the job side panel.
   - Do not add a "Wrote to us" tab. The Emails tab already holds these, and each enquiry stays in one pile only.
2. **Remove the "New enquiry (phone)" button** and its dialog from this page. The `createEnquiry` server function stays, because other code may use it.
3. **One "Close" action** replaces "Cancel" and "Remove (duplicate / junk)" under Actions ▾.
   - The dialog title is "Close N enquiries".
   - The preset reasons are: No response, Owner changed mind, Not eligible, Owner opted out, Duplicate, Junk / spam, Test.
   - A typed reason is still required (at least 3 characters), as now.
   - If the reason is exactly Duplicate, Junk / spam or Test, the enquiries are filed with the existing `removeLeadsFn`, which puts them in Closed › Removed / test.
   - Any other reason uses the existing `bulkCancelOfficeJobs`, which puts them in Closed.
   - The dialog description says which reasons go where.
   - The toasts report how many were closed and how many failed, as Cancel does today.
4. **Addresses all show in normal text colour.**
   - Stop greying an address because its suburb or postcode was looked up automatically.
   - Remove the hover-only tooltip that explained the grey.
5. **Bigger tick boxes on the phone row.**
   - The tap area is at least 44×44px, with the visible box around 20px.
   - The tick box is a separate target from the row button, so a tap on it can't open the job, and a tap on the row can't tick it.
   - The computer row is unchanged.
6. **Failed first emails live on Needs me only** (Jo, 30 Oct 2026, one-pile rule).
   - While an enquiry's first email has failed, it is left out of the Enquiries list and out of every tab count, including "All open". It shows on Needs me only, as it does today.
   - Once the email is fixed and sent, the enquiry comes back to Enquiries under "Offered a spot", or wherever the normal rules put it.
   - An owner who opted out stays in "Opted out" even if an email failed. This is today's order and doesn't change.
   - In code, `enquiryCategory` returns a new `"needs_me"` value when `sendFailed` is true. The list and count code skip that value. `"needs_me"` is never a tab and never a `CLOSABLE` group.
   - The tab "Email didn't send" is renamed **"Email not sent yet"**. It now only holds enquiries whose first email hasn't gone out, which is today's `noResponseYet`.
   - Its hint becomes: "The first email hasn't gone out yet. It usually goes on its own shortly. Failed emails are on Needs me."
   - Keep the tab's rose dot.
7. **Wording:** the count line becomes "{total} enquiries · updated {time}". Use "1 enquiry" for one, and add " · updating…" while refreshing. Drop "showing N".

## Colours and fonts

No new colours or fonts. Everything uses the portal's existing look:

- **Fonts:** Figtree for text, and Outfit for headings and prices.
- **Main colour:** HIV blue (#3c51c4) for buttons and links.
- **Tags:** the existing amber "reply needed" style for the "Wrote to us" tag, and the existing rose style for "Email bounced".

## Not changing

- The page still opens on "Offered a spot". Jo agreed to drop the opening-tab change, because failed sends are already handled on Needs me.
- These stay as they are:
  - the tab order and the other tabs
  - search
  - column sorting and filters
  - "Close all" for Gone quiet and Opted out
  - the side panel
  - the database
  - the server logic, except the failed-email change (change 6)

## Testing

- Update any existing tests that assert the old text: `tests/enquiry-categories.test.ts`, `tests/four-bugs-enquiries.test.ts` and `tests/portal-qa-screen-rules.test.mjs`.
- Add tests that check:
  - the Close reason picks the right action (a small pure function, `closeRouteFor(reason)` → `"remove" | "cancel"`)
  - the count-line wording
  - the new tab name and hint wording
  - a failed-email enquiry is in no Enquiries tab or count, and comes back to "Offered a spot" once its email is sent
  - an opted-out owner with a failed email stays in "Opted out"
- Run the full test suite and the type check.
- Look at the page at phone width (390px) and at computer width.
