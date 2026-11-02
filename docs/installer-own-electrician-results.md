# Installer-only electrician correction — Jo 3 Nov 2026

## Scope and outcome
- Installer jobs no longer offer HIV-arranged electrician in Add job, upload intake, details editor, job panel or price card; server mutations reject the retired arrangement for installer-sourced jobs.
- Add job needs an approved usual electrician. Upload without one remains undecided. Existing unanswered/retired-default jobs use their approved usual electrician at safety-check time, otherwise hold with the existing office Needs me row.
- Website-lead routing and arrangement are preserved. Historical records remain readable; accepted/sent quote guards remain unchanged.
- Installer agreement unchanged. Repeat hint at installer-screens.core.ts remains open and unchanged by Jo's instruction.
- No schema/settings/secrets changes, live writes, sends or publishing.

## Tests and checks
- Red first: new own-only rules 1 passed / 6 failed before implementation.
- Own-only rules, including legacy installer/website separation and HV-3193 price arithmetic; actual recorded writer practice test uses two separate businesses and refuses cross-business choices.
- Related suites run separately to avoid Bun mock leakage. Baseline comparison is a clean read-only HEAD archive with project dependencies linked, not a checkout.
- Unchanged baseline failures: installer-price 39 pass/4 fail; installer-payer-quote-db 10 pass/6 fail/1 skip; payer-bypass-db 3 pass/8 fail. Installer-part1-job-page had 10 pass/2 fail before, 11 pass/1 fail after the retired-switch expectation was updated; remaining failure is the unchanged multiline Call/Text source expectation.
- Green related suites include electrician-choice, job-electrician-7oct, Mitti question, Add-job flow, onsite-ready-check, onsite-start-stage, onsite-start-exception, installer-intake-edit-db, auto-offer core, insulation-present-auto-offer, our-lead usual/PIESA, installer-paid-electricians reads, installer-home, installer-led, installer-payer-fees and add-installer-job practice.
- Automatic typecheck/build log returned build OK after corrections. Full comparable suite not requested/run this turn.
- Authenticated end-to-end browser check NOT RUN: requesting-user session could not be minted; explicit Jo session approval unavailable. Practice isolation is not claimed as hosted RLS proof.

## Approved separate live step — not performed
Read-only confirmed HV-3136–HV-3150 and HV-3193 are installer-sourced Reinsulate jobs with electrician_choice=hivic_organise. ORLANDO POWERED is approved. No live job was changed because Jo's normal authenticated recorded path is unavailable; no direct SQL bypass was used. HV-3724 and all TEST jobs remain untouched.

### HV-3193 price preview — no save
Latest held, unsent draft: installer price $2,500 + PIESA $349 + AP fee $349 − VEU discount $1,120 = **$2,078 inc GST**.
Reinsulate pays its own electricians; active rate card v2 effective 30 Oct has PIESA ex-GST $318.18, rounded inc-GST **$350**. Holding the other recorded lines fixed, the proposed owner total is **$2,079 inc GST**, increase **$1**. This is read-only arithmetic through the pure owner-price rule, not a saved/reprepared quote or a verified signed-in owner display.
HV-3193 must be last and still requires Jo's separate OK before any save, plus available normal recorded access.