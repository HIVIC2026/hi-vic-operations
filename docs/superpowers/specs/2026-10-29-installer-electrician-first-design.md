# Installer's electrician first on HIV's leads, and keep the electrician from installer sign-up

Date: 29 Oct 2026. Approved in brainstorm by Jo. Replaces decision 374 ("HIV always chooses the electrician on our leads") where they differ.

## Why

1. James (Rapid Insulation) gave his electrician at sign-up — Will Casdorff, Viking Electrical Services Aus PTY LTD,
   REC 38603, licence A81638, jesse@vikingelec.com.au — and it never reached the portal. Approval does not copy
   `preferred_electricians` from the installer's application (`rec_onboarding_applications.data`) onto the business,
   and that electrician is never invited to sign up. Matthews Insulation (Tudor Electrical) is caught the same way.
2. Jo wants an installer's own electrician to do the safety check (PIESA) on that installer's HIV website leads too.

## Rules (Jo, 29 Oct 2026)

### Part 1 — Electrician from installer sign-up
- R1. When an installer application is approved, its MAIN electrician (`is_primary: true`; if none is marked, the
  first one) is saved as the installer's usual electrician — the same record the My business › Electrician screen
  writes (`installer_usual_electrician_saved`). Other listed electricians are ignored.
- R2. If that electrician is not an approved electrician business on the portal, it gets the normal electrician
  sign-up invite ONCE (the existing nomination/invite path), using the details from the application.
- R3. If the installer already has a usual electrician saved, approval does not overwrite it.
- R4. One-off fix for already-approved installers whose application lists an electrician but who have none saved
  (Rapid → Viking, Matthews → Tudor Electrical): apply R1–R2. Written as a SQL/script file in
  `docs/pending-migrations`, shown to Jo and run on the live database only after she says yes.

### Part 2 — Who gets the safety check offer on HIV's leads (A2, `channel` not `installer_sourced`)
- R5. "The installer's electrician" = the usual electrician of the installer who did the Ready Check and quote.
- R6. If that electrician is an approved electrician business that can be offered the job (same checks as today:
  covers the postcode, not paused, licence ok, approved workers, agreed PIESA rate), the automatic offer goes to them
  first, alone, for 24 hours.
- R7. No reply in 24 hours → the job goes back to the office (Needs me "Choose again"), as on installers' own jobs.
- R8. They tap "Not for me" → automatic offers carry on to the nearest electrician, one at a time, as today
  (normal 2-miss limit, then office).
- R9. No usual electrician, or it can't be offered the job (not signed up, blocked, doesn't cover the postcode) →
  exactly as today: nearest first, one at a time.
- R10. Money unchanged: owner pays $349 for the safety check; the electrician is paid their own agreed onboarding
  rate; the $100 fixes markup still applies (it's still HIV's lead). Electricians charging over $349 are never
  approved, so no special case.

## Not changing
- Installers' own jobs (A1): their chosen electrician first, back to the office if missed or declined (decision 426).
- Ready Check offers, the installer sign-up form, prices, the 24-hour window, the 2-miss limit, office manual picks.
- Offers already sent before this goes live.

## Where it fits
- `src/lib/auto-offer.core.ts`: `autoOfferPreferredElectrician` and `autoOfferStep` gain the A2 case — preferred
  electrician first; on lapse → `return_to_office` (reason `preferred_missed`); on decline → continue ranking.
  A2 never returns `preferred_blocked` (R9 falls through to nearest first).
- `src/lib/auto-offer.server.ts` `electricianCandidates`: on A2 look up the Ready Check installer's usual
  electrician and match it to an approved electrician business (`matchUsualElectrician`).
- `src/lib/our-lead-piesa-electrician.core.ts`: update the decision comments; `electricianSourceForOurLead` stays
  "ours" (R10).
- Installer approval path (`installer-onboarding` functions): R1–R3.

## Checks
Automatic tests for R1–R3, R5–R9 (incl. lapse vs decline, A1 unchanged), full test run, typecheck. Delivered as a
GitHub pull request; the coordinating chat merges. The live-database fix (R4) needs Jo's yes first.
