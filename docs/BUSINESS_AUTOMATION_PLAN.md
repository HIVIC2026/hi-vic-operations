# Home Insulation Victoria: making the whole business automatic, simple and clean

Overnight review, 23–24 Oct 2026. Covers: what Activity 48 legally requires, what the portal actually does today (both job routes), every page and piece of code, and what to build next. **Nothing in this plan is live yet.** Fixes built overnight are on the `installer-mitti-workflow` branch.

> **About the regulatory facts:** the government websites (ESC, DEECA, legislation.vic.gov.au) were blocked from the overnight machine, so the rules below come from search-engine extracts of those official pages, not a full read. Anything marked *(verify)* should be checked against the official documents before we rely on it: the ESC Ceiling Insulation Activity Guide, the General Accreditation Conditions (Activity 48), VEET Amendment (Ceiling Insulation) Regulations 2026, and the PIESA / installer safety forms.

---

## 1. The honest picture, in five lines

1. **No real job can currently get past "owner accepted the quote".** Three separate things block the electrician step: the payment check is switched off, there's no payment rule at all for installer jobs, and invoices don't reach Xero (live Xero is switched off in code).
2. **The last third of the process can't run.** The official PIESA and PIISA forms are still marked "not approved" in the code, so their Mitti forms can't be created. Without the PIISA, the installer's declaration can't be signed, and without that, no job can reach Final check or VEECs.
3. **Installer jobs probably can't be accepted by the owner,** because they never reach the stage the accept button needs. This has to be confirmed with a TEST run.
4. **Most "automatic" steps are actually manual or switched off:** quote sending, the owner quote email (no template), messages to installers and electricians (an outbox that never sends), the ESC notification and VEEC lodgement (typed in by hand).
5. **The portal carries a lot of history:** 98 pages (about a third are redirects or unused), around 40 unused code files, and 95 MB of old QA documents. The job page stacks about 60 panels, showing the same facts 3–5 times in engine words.

The good news: the hard parts are already built and well guarded. Eligibility, Mitti sync, the quote formulas, owner signing, the ESC timing rules, the PIESA 30-day window and the AP approval queue all exist. What's mostly missing is switching them on, filling a few gaps, and a clear front end.

---

## 2. What Activity 48 requires, as one timeline *(verify)*

| # | Step | Who | Form / evidence | Timing rule |
|---|---|---|---|---|
| 0 | Standing setup | AP | Accreditation conditions; installers hold **full** CII (provisional doesn't count), registered as scheme participants in the VEU Registry, given the privacy notice; electricians licensed under an REC; products on the VEU register with CodeMark | Before any job |
| 1 | First contact | AP / installer | No telemarketing or door-knocking unless the customer asked; VEU Code of Conduct and statement of rights | Always |
| 2 | Eligibility | Installer on site | Uninsulated, or existing average below R2.0. Not built or renovated in the last 5 years. No downlights that can't be covered. One upgrade per premises | Before contract |
| 3 | Contracts and quote | AP + owner | **AP–consumer contract** and **AP–installer contract** (both mandatory from 1 Oct 2026); minimum **$200** co-payment; minimum R5 | Before works |
| 4 | Life support | Installer / electrician | Written consent or medical plan before isolating power | Before PIESA |
| 5 | PIESA | Licensed electrician | Official PIESA (Sections A, B, C); geotagged switchboard-cable photo (from 21 Aug 2026); photo of electrician on site | Signed **no more than 30 days before works commence** |
| 6 | Fixes | Electrician | Hazards fixed, then Section C | Before install |
| 7 | PIESA copies | AP | Copy to owner **and** installer | **At least 24h** before install |
| 8 | Owner ESC consent | Owner | ESC template consent (share with ESC, WorkSafe, ESV) | **At least 24h** before install |
| 9 | Install notification | AP | VEU Registry "Install notification" | **24h to 5 days** before install (editable until then) |
| 10 | Installer safety assessment | Lead installer | Official form (not a replacement for the SWMS) | Before works, within 30 days of PIESA |
| 11 | Installation | CII installer | Geotagged photos (power isolation, product, installed R-value); pre/post video *(details verify)*; floor plan or aerial | Must **commence** within 30 days of signed PIESA |
| 12 | Paperwork | AP + owner | VEEC assignment form (new version mandatory from 1 Oct); **tax invoice names the AP, not the installer** | After install |
| 13 | QA | Director / AP | Sign-off on QA reports | Ongoing |
| 14 | VEEC creation | AP | VEU Registry (bulk API available) | By **30 June** of the following year |
| 15 | Records | AP | Everything above | Keep **6 years** |

**Where our rules differ from the law:**
- **Business choices, fine to keep:** Ready Check, quote approval before payment, $349 safety-check payment before PIESA, 48h booking rules. We just shouldn't describe them as regulation.
- **Missing from our source of truth** (the code has the $200 minimum, but the document doesn't say so): the statutory gates (consent, notification window, PIESA copies, installer safety assessment, assignment form, VEEC deadline), both contracts, the 5-year and downlight exclusions, personnel checks, newer evidence items, QA sign-off and 6-year retention.
- **Bug (✅ fixed on branch):** the 30-day check measured install **completion**, but the rule is **commencement**. A job that ran past the deadline could be failed wrongly. (`compliance-timeline.core.ts`)
- **Needs legal sign-off:**
  - Direct billing by an own electrician or installer, when the tax invoice must name the AP.
  - Taking the $349 during a cooling-off period.
  - The "Reg 23A" citation.

---

## 3. The target: one automatic pipeline, two ways in

Two ways in, then the same automatic path for both:
- **Our lead:** website → eligibility → estimate email → owner saves a spot → offered to installers → installer accepts
- **Installer's own customer:** installer taps Add a job (or starts in Mitti)

| Step | What should happen automatically | Who's told | Human needed? |
|---|---|---|---|
| Ready Check form | Portal creates the Mitti form (A2 for our leads, A1 for installer jobs), prefilled, assigned | Installer: text + app | No |
| Form progress | Missing items shown; chase after 24h | Installer; office only if stuck | No |
| Form **Complete** | Job moves on by itself; eligibility answers checked; quote built | — | Only if a check fails |
| Quote | Sent automatically when all checks pass (completeness, eligibility, electrician priced, price per m², access fee ≤ $500, no duplicate, **co-payment ≥ $200**); otherwise held with the reason | Owner: email + text with secure link | Only on hold |
| Owner accepts | Signs contract, VEEC assignment consent, payment terms; invoice made in Xero; deposit request raised | Owner receipt; installer and office told | No |
| $349 paid | Payment seen in Xero, which unlocks the PIESA | Owner receipt | No |
| PIESA | Offered to electricians (or the nominated one); owner picks times; first to accept books; Mitti PIESA form sent | Electrician, owner, installer (planning notice) | Electrician does the PIESA |
| Fixes | Standard-rate fix quotes released automatically; others held | Owner | Only non-standard |
| Before install | Owner ESC consent requested; PIESA copies sent to owner and installer ≥24h; install notification due-date reminder (and Registry API if available); PIISA form sent to installer | Owner, installer, office | Office submits notification (until API) |
| Install | Install day booked from the owner's times (within 30 days of PIESA); install-day photo list | Installer | Installer does it |
| Evidence | Photos and video checked for presence, geotag and timestamp; missing items chased | Installer | No |
| Final check | Everything ticked shows "Ready for final check"; AP reviews and approves | AP | **Yes (by law)** |
| VEECs | Assignment applied, claim prepared, Registry lodgement (API), status synced, deadline tracked | — | AP approves each claim |

---

## 4. What's stopping us, in priority order

| # | Blocker | Fix | Needs you? |
|---|---|---|---|
| 1 | Payment check off; no rule for installer jobs; Xero live calls off | Decide the payment rule for both routes; connect live Xero; switch the check on; apply pending migration 0131 so the database and code agree | **Yes**: rule, plus confirmation that Xero is set up |
| 2 | Official PIESA/PIISA forms "not approved"; no PIESA Mitti form ID | Review and approve the form wording and mapping; connect the PIESA Mitti form | **Yes**: approval |
| 3 | Installer jobs never reach the "owner can accept" stage | Move installer jobs to the quote stage when the quote is ready (guarded) | No (TEST run first) |
| 4 | No owner quote email template; quote SMS not approved | Draft the template (link, total, inclusions) and quote SMS | **Yes**: wording |
| 5 | Outbox never sends (executor not deployed; only 3 message types supported) | Deploy the executor and add the partner, booking and paperwork message types | Wording approval |
| 6 | Quotes never auto-send (`auto_send_quote` ignored) | Build automatic release with the checks above, behind a switch that starts off | Turn it on when happy |
| 7 | Mitti "Complete" doesn't move the job | Complete → next stage (guarded) | No |
| 8 | Installers and electricians never told about offers or acceptance | Approved texts plus emails | Wording |
| 9 | Our-lead Ready Check booking switched off | Turn on once offers and texts are ready | **Yes** |
| 10 | ESC notification and VEEC lodgement typed in by hand | Due-date reminders now; Registry API later (check what the API supports) | Later |
| 11 | 30-day rule uses completion | ✅ Fixed on branch: uses commencement | No |
| 12 | $200 minimum co-payment | ✅ Already enforced on both quote formulas (`estimate.core` / `installer-led.core:43`). The source of truth should just name it | No |
| 13 | Legal gaps (contracts, personnel checks, evidence items, QA sign-off, retention) | Build them as checks in the existing evidence and compliance lists | Some wording |

---

## 5. Decisions only you can make

1. **Payment rule.** Same for both routes: $349 safety-check payment before the PIESA? Paid by Xero deposit request?
2. **Xero.** Is the live Xero organisation ready for real invoices? If so, I'll switch it on, which needs one code change and your OK.
3. **Official forms.** Approve the PIESA and PIISA wording and mapping (I'll prepare a side-by-side), and give me the PIESA Mitti form ID.
4. **Owner quote email and texts.** Approve the wording I draft.
5. **Messages to trades** (offer, acceptance, PIESA booked): approve the wording.
6. **Automatic quote sending.** Confirm the checks, then turn it on after a TEST run.
7. **Legal questions** for your lawyer or the ESC: direct billing vs the AP tax invoice; $349 during cooling-off; the 30-day clock is settled by decision 316 (Jo reconfirmed 27 Oct): official PIESA date + 30 days, never Section C.
8. **Clean-up.** OK to delete the "needs decision" items in section 7 (old redirect pages break old bookmarks).
9. **Mitti-started forms.** Keep accepting forms installers start in Mitti (matched by owner details), or require Add a job first?

---

## 6. Redesigned pages (to build after your OK)

**Office job page.** The top shows six plain things, the same for every job:
1. What this job is
2. Where it's up to (one sentence)
3. Whose turn it is
4. What to do next (one button)
5. Key facts (eligibility, area, quote, paid, install-by date)
6. Key documents

Everything else goes into a closed **Full details** section, grouped in workflow order. Only the current group opens, and steps not yet reached show nothing. All the risky buttons (hold, cancel, delete, overrides) sit together in one red "Exceptions" group at the bottom.

*Installer jobs already have the first version of this on the branch.*

**Remove from the job page:**
- the old electrician-assessment panels (retired stage)
- "Capacity" (retired)
- the triple "Change classification" controls
- the website estimate on installer jobs (done)
- engine words: Gate 1, Step 3, GHG maths, stage mismatch, Payload, Visit scope

**Office lists:**
- *Enquiries:* one row of six tiles; delete the duplicated tools strips.
- *Active jobs:* six stage chips instead of 25; one "Needs you" box instead of four.
- *Navigation:* move Templates under More.

**Installer app (one "Do this now" card):**
- One "Do this now" card instead of five "where is it up to" cards.
- Tabs: Needs you · Coming up · In progress · Done.
- Delete the retired "proposed scope & price" form.

**Owner My job:**
- One action card and one step count; remove the triple progress display.
- Spell out PIESA once, then call it the "safety check".

---

## 7. Clean-up

**Done overnight (branch):**
- Removed 11 files nothing used.
- Removed the dead "Submit via ESC adapter" button and the owner rows that did nothing.

**Safe next (tests updated alongside):**
- About 25 more unused modules and components (each one only kept alive by its own test).
- The dead admin sidebar.
- Dead preview code.
- Stale internal links (Needs me → old pages, a broken `/admin/settings` link).

**Needs your decision:**
- About 20 redirect-only pages that keep old bookmarks working (they're tiny).
- The old Quote approvals board (overlaps "Quotes to check").
- Needs me vs Today (two "what needs me" lists).
- The one-off SMS blast page.
- Office-only bulk upload.
- The old preliminary Save-my-spot landing page (keep until sent links expire).
- Two owner estimate pages.
- 95 MB of old QA screenshots and evidence in `docs/`: archive outside the repo.

**Must keep (audit history or law):**
- Retired stages, readable for old jobs.
- Signed agreements and their texts.
- Lead-fee history.
- Retired database columns.
- Property-intelligence history tables.
- Accepted quotes' frozen prices.

---

## 8. Suggested order

1. **This week: unblock.** Decisions 1–4. Fix blockers 1–4. Run a full TEST job through both routes, end to end.
2. **Next: automate.** Blockers 5–10. Automatic quote, messages to everyone, Complete moves the job, reminders for every legal deadline.
3. **Then: compliance gaps.** Contracts, personnel checks, the new evidence items, QA sign-off, retention, Registry API.
4. **Alongside: redesign the pages** in the order office job page → installer app → owner My job → lists → navigation. Clean-up goes in the same changes.

Each step is tested on TEST jobs first, and nothing reaches owners or trades until you've approved the wording and the switch.
