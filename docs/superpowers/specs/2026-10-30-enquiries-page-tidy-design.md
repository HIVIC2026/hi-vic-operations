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
6. **Wording**
   - Count line: "{total} enquiries · updated {time}". Use "1 enquiry" for one, and add " · updating…" while refreshing. Drop "showing N".
   - "Email didn't send" hint: "The first email failed or hasn't gone out yet. Failed ones are fixed from Needs me." This text is in `enquiry-categories.core.ts`.

## Not changing

- The page still opens on "Offered a spot". Jo agreed to drop the opening-tab change, because failed sends are already handled on Needs me.
- These stay as they are:
  - the tab order and the other tabs
  - search
  - column sorting and filters
  - "Close all" for Gone quiet and Opted out
  - the side panel
  - server logic and the database

## Testing

- Update any existing tests that assert the old text: `tests/enquiry-categories.test.ts`, `tests/four-bugs-enquiries.test.ts` and `tests/portal-qa-screen-rules.test.mjs`.
- Add tests that check:
  - the Close reason picks the right action (a small pure function, `closeRouteFor(reason)` → `"remove" | "cancel"`)
  - the count-line wording
  - the new hint wording
- Run the full test suite and the type check.
- Look at the page at phone width (390px) and at computer width.
