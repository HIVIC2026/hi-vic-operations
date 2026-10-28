# Jobs pages redesign: Our jobs, Installer jobs, Closed jobs

Date: 28 Oct 2026. Approved design by Jo. Checked by a 3-reviewer jury (all said "build, with the gaps below settled"; all settled by Jo).

## Problem
The Active jobs page is cluttered and doesn't show what to do next. Before the jobs you see three link rows, eight
stage buttons and a five-row filter box. 384 of 410 jobs sit in one stage, so the stage buttons don't help. Our
website leads and installers' own leads are mixed together. It is hard to use on a phone.

## Pages and menu
- The Jobs menu heading opens three pages: **Our jobs**, **Installer jobs**, **Closed jobs**, each with its count
  (e.g. "Our jobs 384 · Installer jobs 26"). Phone bottom tabs stay the same; Jobs opens the same three choices.
- **Our jobs** = active jobs that are not installer-sourced. **Installer jobs** = active jobs with
  `channel = installer_sourced`. **Closed jobs** = today's Closed tab, unchanged, on its own page.
- A job is on exactly one of the three pages (one-list rule).
- The Active / Closed tabs are removed. Old links (`/admin/jobs/active`, `?stage=`) go to Our jobs.

## Top of Our jobs and Installer jobs
Only these, nothing else:
- **Search box** (job number, owner name, suburb).
- **Needs us** switch: shows only jobs whose next step is ours to do.
- **Actions** button, same as now: Cancel · Put on hold · Mark as test · Delete (test jobs only).
- **Mitti sync problems · X** in red, shown only when X is above 0. Tapping it opens the same list as now.

Removed: stage buttons, "Installers' own jobs" button, "Choose installer list" link, "New from installers",
"Ready Checks started in Mitti", the filter box, and the "checked 18 min ago" line.

## Columns (same on both pages, in this order)
1. **Job** (HV number).
2. **Next step**: the existing next-step wording for the job's status (`SITUATION[...].next` in the office rules).
   When the job isn't waiting on us, say who it's waiting on: "Waiting on installer", "Waiting on owner",
   "Waiting on electrician", or "Nothing yet" (e.g. spot saved while Ready Checks are off). On hold: "On hold".
   Shown in **red** when the job is past its time limit (the limits already in the office rules).
3. **Owner** (name).
4. **Suburb**.
5. **Stage**: Choose installer · Ready Check · Quote · PIESA · Install · Final check.
6. **Days at stage**: whole days since the job last changed stage.
7. **m²**: measured area when the Ready Check is done, otherwise the estimated area. Blank if unknown.
8. **Insulation**: **Yes** (owner said Some or Not sure) or **No**.
9. **Total cost** (inc GST): the quote total once quoted; before that the estimate, shown as "$2,340 est.".
   Installer jobs use the installer's price card only. Blank if unknown.
10. **Installer**.
11. **Last heard** (from us, as now).

The old Status column is removed (Next step replaces it).

## Filters and sorting
- Every column header sorts (tap once up, again down).
- Every column header has an Excel-style filter: a tick list of that column's values with "Select all".
  Number and money columns (Days at stage, m², Total cost) filter by ranges (e.g. 0–7, 8–30, 30+ days).
- Filters, sort and the Needs us switch stay set when Jo comes back (saved in her browser per page).
- A "Clear filters" link shows when any filter is on.

## Phone
- No table. One card per job: Next step on top (red when late), then Job · Owner · Suburb, then Stage ·
  Days at stage, then m² · Insulation · Total cost, then Installer · Last heard.
- One **Filter** button opens the same column filters and sort as a full-screen list.
- Tick boxes for Actions stay on each card.

## Not changing
- Closed jobs content and Reopen.
- Job detail pages, the Needs me page, Enquiries, and how jobs move between stages.
- No new data is stored; everything shown already exists.

## Tests
- Every active job appears on exactly one of Our jobs / Installer jobs; installer-sourced only on Installer jobs.
- Counts in the menu match the rows on each page.
- Insulation: Some → Yes, Not sure → Yes, No → No.
- Total cost shows "est." before a quote and the quote total after; installer jobs use the price card.
- Next step: an "Us" status shows its action; other statuses show "Waiting on …"; late jobs flagged red.
- Days at stage counts from the last stage change.
- Column filter and sort on each column; filters still set after leaving and returning.
- Needs us switch shows only jobs whose next step is ours.
- Mitti sync line hidden at 0, shown in red above 0.
- Phone width shows cards, not the table; computer shows the table.
