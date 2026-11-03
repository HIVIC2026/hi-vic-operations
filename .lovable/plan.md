# Required details when a business adds a team member (Jo 3 Nov, 2:35pm)

This replaces the 29 Oct rule "no email needed, mobile can come later".

| Person | Australian mobile | Date of birth | Email |
|---|---|---|---|
| Installer (Lead or Crew) | Required | Required | Optional |
| Electrician | Required | Required | Required |

## 1. Team page form and save step
- **My business › Team › Add a person:** the Add button stays greyed out until the required boxes are filled in. Electricians get a new Date of birth box. Installers already have one. Optional boxes say "(optional)".
- **Server check** (before anything is saved, for both kinds of business). Wording:
  - "Add their Australian mobile, for example 0412 345 678."
  - "That mobile doesn't look right. Use an Australian mobile, for example 0412 345 678."
  - "Add their date of birth." (The existing date checks stay the same.)
  - Electricians only: "Add their email address."
  - Any email that is typed in but isn't valid: "That email doesn't look right. Check it and try again."
- Dates of birth stay private, kept in the same place and the same way as today.
- **Electricians:** saving the electrician and their date of birth together needs a small database addition. Today's private save step only covers installers. This will be written as a pending change and tested on a practice database first. It goes live only with Jo's OK.
- The "Add mobile" edit on a person's row can't clear a mobile that is already saved.

## 2. Other ways a worker gets added
- **Office add / worker link** and **worker invite**: the same rules apply, including date of birth. These save steps will be changed so they also store it privately.
- **Imports and Mitti invites:** checked during the build. Any of them that can create a worker gets the same rules. Any that can't is listed for Jo instead of being guessed at.
- **Not changed:** TEST-only setup, which uses reserved TEST contacts.

## 3. Live workers missing a required detail (read-only check, nothing changed)
**Electricians** (all four are missing only a date of birth):
- All Powered Electrical: Jack Young (pending)
- ORLANDO POWERED: Peter Orlando (approved)
- Tom Lowe Electrical Services: Tom Lowe (approved)
- Western Suburbs Electrical: Brent Ponsold (pending)

**Installers:**
- RAPID INSULATION: 22 approved Crew are missing a mobile and a date of birth: Anthony Nguyen, Austin Field, Damon Langley, Damon Leonard, Dylan Ashfield, Finn Easdale, Gabriel Buchanan, George Bacolas, Harrison Bell, James Murray, Jarrell Seth, Joseph Calarco, Leroy Robins, Liam Zontanos, Louis Booker, Louis Lunn, Madhik Wooden, Mark Forday, Nathaniel Winters, Sebastian Semercioglu, Yaqub Daghistani, Yewan Kospelawatta. James Sachinidis (pending) is missing only a date of birth.
- Reinsulate: Wayne Fletcher (Lead, pending) is missing a mobile. Bhavdeep Singh, Manminder Singh and Sultan Sharma (pending) are missing a date of birth.
- Silver Spirit Investments: Chris Lowe is missing a mobile and a date of birth. Dominic Doherty is missing a date of birth.
- Matthews Insulation: Gerson Noveros, Harry Matthews and Ronald Matthews (pending) are missing a date of birth.
- Hic: Dominic Doherty (pending) is missing a date of birth.
- INSolation: Tom Lowe (pending) is missing a date of birth.

How the business is asked to fix them:
- On their own Team page, each of these people gets an amber line naming only what's missing, for example "Add Wayne's mobile" or "Add Liam's mobile and date of birth". Tapping it opens a short edit that uses the same checks.
- A note at the top of the Team page: "4 people need details added before we can send their links or register them."
- Office Needs me gets one row per business, for example "Rapid: 23 team members missing details."
- Nothing is sent, and nobody is removed from current jobs.

**Question for Jo:** should the Lead Installer on a booked job be held until their details are added? The plan assumes a warning only, no hold.

## 4. Tests (written first)
- Installer: refused with no mobile, a non-Australian mobile or no date of birth. Saves with no email.
- Electrician: refused with no mobile, no date of birth or no email. Saves when all are present, and the date of birth stays private.
- Office add and worker invite follow the same rules.
- Missing-details lines show only for a business's own people. Two-business check: Reinsulate can't see Rapid's people or their dates of birth.
- A saved mobile can't be cleared.
- The new electrician database step is proven on the practice database.
- Then the related Team and ESC tests, typecheck and build. No sends or publishing.
