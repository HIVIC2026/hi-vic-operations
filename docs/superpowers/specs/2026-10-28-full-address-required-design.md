# Full address required for every enquiry

Date: 28 Oct 2026. Design approved by Jo; spec awaiting her approval.

## Problem
The homeowner website accepts an address with no street. On 28 Oct, HV-3542 came in as just
"Brighton VIC 3186". The website only checks that the address is at least 8 characters long
(`src/pages/Homeowner.jsx`, line 140). The portal logged `address_lookup_unresolved` (reason `no_street`),
but the job carried on and the Save my spot email went out anyway.

## Rules
1. **Website:** the address must be picked from the suggestion list. Typed text that wasn't picked is
   refused with: "Please choose your address from the list."
2. **Portal:** a new website or email enquiry with no street is held. No Save my spot email is sent for it,
   automatically or in the Hot leads bulk send.
3. **Ask the owner:** the held job sends the owner one email and one text: "We need your full address to
   check your home." Both carry a secure link to a short page where the owner picks their address from the
   same suggestion list.
4. **After they pick it:** the address (street, suburb, postcode, state) is saved to the job, the hold is
   lifted, and the job carries on by itself. The normal Save my spot rules then apply.
5. **No reply:** one reminder (email and text) 24 hours after the first message, then nothing more. The job
   waits until the owner replies.
6. Existing rules still apply: no texts after 8pm (a text due then goes at 7am), customer emails master
   switch, owner opt-outs, and TEST jobs send to the test address only.

## What counts as "no street"
The same check the portal already uses: `parseStreet` in `src/lib/address-complete.core.ts` finds no street
number and name in the stored address line.

## Changes
**Website (Base44 app `6ab0c47ee6cd14456bf15362`)**
- `src/components/homeowner/AddressAutocomplete.jsx`: tell the page when an address has been picked from
  the list; any later typing clears that.
- `src/pages/Homeowner.jsx`: the Next check on the address step needs a picked address, not just
  8 characters.

**Portal (Lovable)**
- New pure rule file `src/lib/address-request.core.ts`: decides whether a job needs the address request,
  and whether the request or the reminder is due.
- Save my spot sending (`save-spot-rules.server.ts` and the Hot leads send): skip jobs with an open address
  request, with the reason "Waiting for the owner's full address".
- The address request and reminder are sent from the existing 15-minute tick, recorded as workflow events
  so they never send twice.
- New owner page `src/routes/my-address.$token.tsx`: shows the address search (same lookup Add a job uses,
  `address-lookup.server.ts`) and saves the picked address through the audited `saveEnquiryDetails`.
- New email and text wording added to the message templates, shown to Jo before it goes live (same as other
  new owner messages).

## Not included
- Installer "Add a job" (already requires a picked address).
- Jobs already in the portal before this goes live, including HV-3542.

## Tests
- Website: a typed address that wasn't picked can't go to the next step; a picked one can; typing after
  picking needs a new pick.
- Portal: a no-street job gets no Save my spot email; gets the address request once; gets one reminder at
  24 hours and no more; no text after 8pm.
- Picking an address saves it, lifts the hold, and the job then follows the normal Save my spot rules.
- A job with a full street address is not touched.

## Addendum (28 Oct 2026, approved by Jo): full name on the website
- The website's "Full name" box must have at least two names, each at least 2 letters ("Jo Lowe" passes, "Jo" is refused).
- Error copy, exactly: "Please enter your first and last name."
- Website only (`src/pages/Homeowner.jsx`, contact step, currently `contact.name.trim().length < 2`). Nothing changes in the portal.
