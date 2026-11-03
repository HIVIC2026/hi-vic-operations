# Team members must have a mobile and an email (Jo 3 Nov, 2:33pm)

Replaces the 29 Oct "no email needed, mobile can come later" rule. Applies to installer and electrician businesses.

## 1. Team page form and save step
- **My business › Team › Add a person:** Mobile and Email become required. The Add button stays greyed out until both are filled in. The labels drop "(optional)".
- **Server check** (in the Team add step, before anything is saved, for both installers and electricians). Wording:
  - No mobile: "Add their Australian mobile, for example 0412 345 678."
  - Mobile not Australian: "That mobile doesn't look right. Use an Australian mobile, for example 0412 345 678."
  - No email: "Add their email address."
  - Email not valid: "That email doesn't look right. Check it and try again."
- Remove the old "Adding someone without an email needs the office's database update first" message.
- The private date-of-birth step stays exactly as it is. No database change is needed: the existing save step already accepts mobile and email, and the new check runs before it.
- The "Add mobile" edit on a person's row will no longer let someone clear a mobile that is already saved.

## 2. Other ways a worker gets added
- **Worker link / office add** (the worker-links add step): the same two checks apply, for both office and boss adds.
- **Worker invite** (the worker-invite add step): it already needs an email. The mobile check is added.
- **Imports / Mitti invites:** checked during the build. Any path that creates a worker gets the same check, or is listed for Jo if it can't (for example a Mitti list that has no mobile).
- **Not changed:** TEST-only setup (the Jo tradie, journey setup and TEST office). These use reserved TEST contacts.

## 3. Live workers missing a mobile and/or email (read-only check, nothing changed)
- **RAPID INSULATION**: 22 approved Crew installers with neither a mobile nor an email: Anthony Nguyen, Austin Field, Damon Langley, Damon Leonard, Dylan Ashfield, Finn Easdale, Gabriel Buchanan, George Bacolas, Harrison Bell, James Murray, Jarrell Seth, Joseph Calarco, Leroy Robins, Liam Zontanos, Louis Booker, Louis Lunn, Madhik Wooden, Mark Forday, Nathaniel Winters, Sebastian Semercioglu, Yaqub Daghistani, Yewan Kospelawatta.
- **Reinsulate**: Wayne Fletcher (Lead, pending), with neither.
- **Silver Spirit Investments**: Chris Lowe (installer), who has an email but no mobile.

How the business is asked to fix them:
- On their Team page, each of these people gets an amber line: "Add Wayne's mobile and email" (or "Add Chris's mobile" when only one is missing). Tapping it opens a short edit with the same required checks.
- A top note on the Team page: "3 people need a mobile or email before we can send their links."
- Office Needs me gets one row per business: "Reinsulate: 1 team member missing contact details."
- Nobody is blocked from current jobs and nothing is sent. Links (for example the ESC notice link) simply wait until the details are added.

**Question for Jo:** should the Lead Installer on a booked job be held until their details are added? The plan assumes no: show it as a warning only.

## 4. Tests (written first)
- Adding a person with no mobile is refused with the exact wording. The same for no email, a non-Australian mobile and a bad email. Checked for both installers and electricians.
- A valid mobile and email saves the person. Date-of-birth privacy is unchanged.
- The worker-links and worker-invite steps refuse missing details.
- The Team page shows the "Add Wayne's mobile and email" line only for that business's own people. Two-business check: Reinsulate can't see Rapid's people.
- An existing mobile can't be cleared.
- Then the related Team and ESC tests, typecheck and build. Nothing sent or published.
