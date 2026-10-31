# Finished Mitti Ready Check marks the installer job as visited — design

Date: 1 Nov 2026 · Approved in chat by Jo · Path: full Superpowers (spec → plan → checked build)

## Problem (what Jo saw)

HV-3497 (Dad's installer job, Silver Spirit Investments). The Mitti Ready Check was marked Complete on
27 Oct 2026 (53.24 m²) and Dad typed his price ($1,590 inc GST). But Dad's installer job page still says
"Have you attended and assessed this property? **No**" and "Have you prepared a quote? **Not yet**".

## Root cause

- Add a job (`src/lib/onsite-ready-check.server.ts`) saves `jobs.installer_site_check = "no"` and
  `jobs.installer_quoted = "no"` — correct at that moment.
- When the Mitti Ready Check is marked Complete (`finishMittiReadyCheck` in `src/lib/mitti-complete.server.ts`)
  the measurements and stage move on, but `installer_site_check` is never set to "yes".
- When the installer types their price (`src/lib/installer-price-set.server.ts`) no
  `installer_quote_answer` event is logged and `installer_quoted` stays "no".
- The installer job page (`getMyIntakeJob` / `getMyIntakeProgress`) reads only those two answers.

## What changes

1. **Finished Mitti Ready Check → Attended Yes.** In `finishMittiReadyCheck`, for installer-added jobs only
   (`channel = "installer_sourced"`), when the form is complete set `installer_site_check = "yes"` and
   `installer_site_check_date` = the Melbourne date the form was finished in Mitti. Log one internal
   event saying the attended answer came from the finished Mitti form. Runs once per form (no repeat
   writes on later syncs).
2. **Typed price → Quote Yes.** When the installer saves their price on the job, if the quote answer isn't
   already "have_quote", set `installer_quoted = "yes"` and log the normal `installer_quote_answer`
   event (`answer: "have_quote"`, `source: "installer_price"`).
3. **Correct the 5 existing jobs** that already have a finished Mitti Ready Check but say Attended No:
   HV-3117, HV-3197, HV-3385, HV-3497, HV-3666 — Attended Yes with their Mitti finish date, and Quote Yes
   where a price was already typed. A one-off SQL migration, run only after Jo says go again just before
   the live database is touched.

The rule comment "Never derived from price, area or files" stays true: attended comes from the finished
Mitti Ready Check (the installer's own visit record), not from price, area or files.

## Not changing

- HIV's own website leads — untouched.
- Quote holds, electrician rules (HV-3497 stays held until "Bright spark" is signed up), prices, emails, texts.
- An installer can still change either answer by hand on their job page.

## Testing

- Automated: finished Mitti form on an installer job → attended "yes" with the Mitti date; same on an HIV
  lead → unchanged; a second sync → no second write/event; typed price → quote "have_quote"; price typed
  when already "have_quote" → no extra event.
- After release: Dad's HV-3497 page shows Attended Yes and Quote Yes; the other 4 jobs checked the same way.

## Delivery

Pull request only — this chat opens it and stops; the coordinating chat merges.
