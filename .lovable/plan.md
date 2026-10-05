# Visual restyle — "warm and friendly" (queued)

Runs only after: live-safety check + publish, then the installer commercial options build. Preview only. Look and feel only — no changes to logic, data, rules, gates, or any wording with compliance meaning.

## Order and size

| Stage | Screens | Size |
|---|---|---|
| 1 | New look foundation: Nunito font, colours, rounded cards/pills/buttons/inputs, house + lightning illustrations, table style | Medium (~0.5 day) |
| 2 | Office Today + left menu | Medium (~0.5 day) |
| 3 | Installer home (phone first) + installer job page | Medium (~0.5–1 day) |
| 4 | Electrician home + job card | Small (~0.5 day) |
| 5 | Homeowner portal | Small–medium (~0.5 day) |
| 6 | Onboarding, eligibility link page, calculator/estimate, email web views, office tables | Large (~1 day, many pages, mostly automatic from stage 1) |

About 3–4 working days in total. Each stage ends with before/after screenshots (desktop + phone) and a test/build check.

## What each screen gets
1. **Office Today**: cream left menu (navy active pill, pink AP-approvals count, "Everything's ticking along / Messages paused" card); blush greeting panel with house drawing; 4 tiles (Jobs to sign off, Quotes to check, Deadlines close in peach, Little tidy-ups); 7-step "Every home's journey" counts ending "Warmer homes" in green; "Coming up this week" rows; "Your partners" card with "Bulk upload leads" button.
2. **Installer home**: blush greeting + "Upload new leads"; tappable job rows; green "customers said yes" note; two count tiles; floating bottom menu.
3. **Installer job**: back pill, step pills, big "next step" card (date picker, 24h/PIESA rule in blush note, "Book it in"), numbered "on the day the form will ask for" list with missing items in peach.
4. **Electrician**: light-blue "N new safety checks near you"; owner time slots as "Take it" buttons, address hidden until accepted (as today); booked job in navy card with "Start the safety check".
5. **Homeowner portal**: blush page, "with [installer]" pill, house drawing + greeting, 6-step progress bar, quote card with green discount row and "Yes, let's do it", installer intro row.

## Guardrails
- Every screen leads with one "what you need to do next" card, using the next action the portal already works out — no new rules.
- Friendly copy only on buttons/headings without compliance meaning. Official wording, the Accredited Person line, consent/assignment text, prices and blockers stay word-for-word.
- Exact button labels "Start assessment" / "Start install" stay unchanged.
- The locked "likely eligible" email stays byte-identical (hash-checked); only other email web views get the new look.
- Contrast at least 4.5:1; touch targets at least 48px; every page checked at phone width.

## Needs Jo's confirmation
- This replaces the locked Space Grotesk/DM Sans look; brand blue/green/navy are kept. I'll update the saved brand rule when stage 1 starts.

## Technical details
- Tokens in `src/styles.css` (oklch equivalents of the hex values), Nunito via `<link>` in `__root.tsx`; shadcn variants (button, card, badge, input, table) restyled so most pages update automatically.
- New presentation-only pieces: `HouseIllustration`, `BoltBadge`, `NextStepCard`, `ActionRow`, `StatusPill`, `IconTile`. Counts and next actions come from existing data/`portal-presentation.core.ts`.
- No database, server function, or test-logic changes; screenshots via Playwright on TEST jobs.
