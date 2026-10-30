# Installer and electrician pages — Part 1: how each page works

Approved by Jo, 28 Oct 2026. Source: Claude Doc "Installer portal fixes — Part 1 spec" (https://claude.ai/artifact/RUY4SopQJrrgfZvsAvktvf).

Part 1 fixes how the installer and electrician pages work, page by page, using the fixes Jo picked. Part 2 (the new look) comes after with its own spec.

- Only the fixes listed here get built. Nothing else is added.
- The look stays as it is for now.
- Each fix is built and checked one at a time.

## A. Add a job

1. Block door-knocked leads. Ask how they got the customer. Door-knocked or cold-called jobs can't be added.
2. Flag clashes, don't block. If the address is already an HIV lead, save the job and flag it for the office. Don't stop the installer.
3. Only onboarded electricians. "My usual electrician" can only be picked once that electrician is onboarded.
4. Remove bulk upload. Take away the bulk upload page and its links.
5. Staff refused at the end. Only the business owner can add jobs, so staff are told at the start, not after filling in the form.
6. No half-saved jobs. If a save fails partway, nothing is left behind, and "Try again" works.
7. Clearer retry button. Replace "Retry submission" with plain words.
8. Type in an address. If Google can't find it, the installer can type it in.
9. Price on HIV leads. On HIV's leads, the installer's price comes from their agreed rates automatically. On installers' own jobs, they keep typing a price.

Stays the same: owner name, mobile, email and address all still required. The installer's own Ready Check day/time box stays (it sets up their 6:30am text).

## B. My work and job offers

1. One job, one list. A booked job shows in "Coming up" or "In progress", never both.
2. Same for electricians: a job shows in only one of "Your move", "Coming up" or "Your jobs".
3. "More offers" doesn't hide the other lists.
4. Replace "Moving automatically" and "Needs chasing" with plain trade words for electricians.
5. If an offer won't load, show a "Back to My work" button.
6. One label for an accepted job, and one for a new offer.
7. Electrician "Not for me" asks "Are you sure?" first, like installers.
8. Remove the old "pick one of the owner's times" offer steps.

## C. Job page

1. Use "Pre Insulation Electrical Safety Assessment (PIESA)" everywhere, worded the same on every job.
2. On a job stuck with a not-onboarded electrician, the installer gets a one-way switch to HIV's electrician ($349).
3. The electrician's Call and Text buttons go once their visit is done.
4. PIESA result in Mitti only: remove the Pass/Fail buttons and manual entry from the portal.
5. Electricians don't see "Install must start by…".
6. "Open Mitti form" shows once per screen.
7. Rename "More · staff job links" to plain words.
8. The 6:30am sentence shows once.
9. Tidy up: remove the old step number and parts built twice. No change to what people see.

## D. Today's job

1. "Couldn't get in" keeps the installer on the job; they see "Thanks. We'll rebook it", not "not assigned to you".
2. If "Couldn't get in" is refused, show why.
3. An electrician's fixes visit opens the fixes form, not the PIESA form.
4. A "couldn't get in" text held after 8pm still goes out once the hold ends.
5. Crew picker allows a Lead and 2 more.
6. Crew picked in one place with one name, so the Lead on the form matches who gets Mitti.
7. If the page won't load, show "Back to My work".
8. Reloading doesn't make them tap Start again.
9. Tidy up: remove the old phone-check list and dead messages. No change to what people see.

## E. Money

1. Electricians see electrician words, not "installs" or "once the install is done".
2. Same number of bank digits on every page.
3. The job pay page shows why pay is held, not just "Being checked".
4. "Download statement" saves on an iPhone.

Stays the same: on installers' own customers, pay waits until the owner has paid in full.

## F. My business and Team

1. One Team page: merge "Your staff" into Team; remove "Your staff" and its demo mode; "Add a team member" goes to Team.
2. Each person is Lead or Crew, changeable by Jo or the installer's boss straight away. Only Leads get Mitti.
3. People can be added with no email; the boss adds mobiles later.
4. An electrician boss's staff are asked for a licence, not a CII certificate.
5. Every installer, Lead and Crew, must have CII. Fix the line saying Ready Checks can go to anyone.
6. "Send login invite" says it asks the office.
7. Warn about a missing or expired electrical licence, and check the $5m cover.
8. Usual electrician page no longer mentions a price, and uses one name for the licence number.
9. Write a short "How it works" just for electricians.

## G. Guide, welcome and tidy-up

1. Guide and welcome page use "Pre Insulation Electrical Safety Assessment (PIESA)".
2. SWMS, PIISA, VEEC and Part B get a plain explanation the first time they appear.
3. On the welcome page, staff see only My work.
4. The notice page only calls someone "lead" if they are the Lead.
5. Tidy up code: remove bulk upload leftovers, duplicate pieces and unused bits. The practice page goes only if nothing uses it. No change to what people see.

## Left as is (Jo's choice)

No "who manages it" choice on Add a job. Reinsulate's electrician stays at $350.

## Checking

Each fix is checked on the TEST jobs before the next starts, on a phone and a computer. Jo approves each page before it goes live.
