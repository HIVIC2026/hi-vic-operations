Read-only audit: installer "Add a job" (HV-3066, Reinsulate). Nothing has been changed.

1. Each step today
- Add a job: Reinsulate went in through "A job I've already visited". That path saves the details and the installer's own answers (insulation below R2, 138 m², who organises the job, quote) as a job. It never makes a Mitti job. Only the other two paths make one: "I'm at the property now", or "A job for later" once a visit is booked.
- Mitti: no visit was booked on HV-3066, so the portal was never asked to make a Mitti job. Mitti 1002 was created by hand and the portal doesn't know it exists.
- Results: the portal only fetches results from Mitti jobs it made itself, and it refuses any whose "Portal Job Number" doesn't match. So nothing will come back from 1002.
- Office review: the installer's 138 m² is treated as "provisional". The Ready Check sits at "Needs review" and the office can't accept it, because the portal still wants a separate onsite measurement. That goes against Jo's rule. Today's display fix only hid the yellow warning; the hidden check still blocks it.
- Owner quote: it can't be drafted automatically, because that only happens when Mitti results arrive. The office would use "Prepare owner quote" from the installer's figures. It is also held until the installer's quote amount, the office eligibility check and the commercial setup are done.

2. What the installer types, and what's repeated
- Customer name, phone, email, address, the existing insulation answer, area, the quote or file, plus permission and "who organises" ticks.
- Repeated: everything already in Mitti 1002, because the two aren't linked. Inside the portal, the job page still says "Existing insulation answer missing" even though the installer answered "below R2". Those ticks also reset if a saved draft is reopened.

3. What the portal needs to make a Mitti job for an installer
All of these at once: the business has "Mitti access" ticked; the Ready Check form ID is saved; automatic Mitti is on; a confirmed Ready Check visit is booked in the portal; an installer user is on the job; and no Mitti job exists yet.
Why it didn't happen for Reinsulate:
- HV-3066 was added at 07:27, but "Mitti access" was only ticked at 08:04. The portal doesn't go back and check again.
- They chose "already visited", which never makes a Mitti job.
- No visit was booked.

4. Linking an existing Mitti job like 1002
There is no way to do this: no screen, no button, nothing behind the scenes. A link would also need 1002's "Portal Job Number" set to HV-3066.

5. What the office sees
- HV-3066 sits in Active jobs. The top of the page shows "Needs classification · Stage mismatch", "Existing insulation answer missing — Blocked" and "Preliminary — other eligibility checks need review". The Ready Check box says "provisional (onsite measurement required)" while the Accept button is greyed out.
- Stage words don't match across the page: "Ready Check offered", "Needs review" and "Preliminary estimate ready" all appear for the same moment.
- The job was deleted and restored once tonight, and that shows in its history.

6. Same owner already a website lead
No check happens. HV-3066 reused the same owner record as website lead HV-2303 (same email; the address record is different). Nothing warned the installer or the office. The two jobs now sit in two different piles: HV-2303 in "Ready Check — ready to schedule" and HV-3066 in Active jobs. That breaks the one-pile rule for one house.

7. Fixes, smallest first (not built)
1. Treat the installer's own measure as the Ready Check on installer jobs, so the office can accept it, and change "onsite measurement required" to match.
2. Stop showing "Existing insulation answer missing" when the installer has already given it.
3. Use the same stage wording on the job page and in the lists.
4. Make a Mitti job when "Mitti access" is ticked later, for that installer's jobs that are waiting.
5. Make the Mitti job straight away for "already visited" installer jobs as well, without needing a booked visit.
6. Office action "Link existing Mitti job" (enter the Mitti number, check it is our form, and set its Portal Job Number). Results then come back as normal.
7. When an installer adds a job, check for the same owner email, phone or address on an open website lead. If found, warn the office and keep only one of the jobs in a pile.

Fixes 1–3 are wording and display rules on the office screen. Fixes 4–7 change how the portal behaves, and Jo needs to approve them first.

Add-on: what an installer's quote needs, and partial Mitti forms

1. What's needed to quote (checked against the actual rules)
Needed to draft the quote:
- Ceiling area.
- Existing insulation is none or below R2 ("unknown" stops it, and R2 or more fails it).
- Installer's price, and what it includes.
- The property postcode, so the rebate can be worked out.
- The office's own owner/property eligibility tick. This one is missing from Jo's list.
- Either the installer was onsite (the attendance answer) or the area was measured onsite.

Needed before the quote can be sent:
- Owner contact permission.
- Who does the electrical, decided. "Undecided" stops it.
- Owner fee-awareness recorded for that electrician choice. Also missing from Jo's list.
- Commercial setup done for the installer.

Not strictly needed to quote:
- Removal yes/no is not required. If removal is unknown it just isn't priced.
- Owner name, mobile and email are already required when the job is added, so they aren't separate quote checks.

2. Partial Mitti forms
Confirmed: the quote is only drafted when the Mitti form is marked completed, or "Ready for office review" is Yes.
Partial forms already sync their answers (area, insulation and so on) into the job. Only the quote drafting waits.
To change it: draft the quote whenever the needed-to-quote answers above are present, even if the form isn't finished. The quote would still be held for office review, and nothing would be sent automatically.

3. What can wait until install day
- Can wait, as long as it's captured before work starts: access details, downlight and exhaust details, extra photos of the roof space, and the final measured area if it's checked again.
- Must NOT wait:
  - Photos of the original ceiling condition before any removal or new insulation goes in.
  - The installer's VEU pre-installation safety assessment, signed before work.
  - The owner's ESC consent, at least 24 hours before work.
  - The PIESA or electrical safety check, before install.
- The pre-start check runs at 12pm the day before install and already locks the install form until these are done.
- Not checked yet: whether the install-day form asks only for what's still missing. The rule against asking twice exists, but I haven't confirmed the install-day form follows it for partial Mitti answers.

4. What would need building, smallest first
1. Show "Ready to quote" on installer jobs once the needed-to-quote answers are in, with the same wording everywhere.
2. Draft the held quote from a partial form that has those answers.
3. When an installer adds a job, flag (never block) the same owner email, phone or address on an existing lead or job, so the office can delete one.
4. List the missing Ready Check answers as "collect on install day" and show them on the install-day form only.
5. Mitti-first: make the Mitti job when the job is added, including when "Mitti access" is ticked later, and add an office "Link existing Mitti job" action.
