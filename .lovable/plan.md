# Remove "Home Insulation Victoria arranges" for the electrician, everywhere

## Your Add a job question
Yes, Add a job currently offers **"Home Insulation Victoria's electrician"** for the safety check. When the installer has no approved usual electrician, that option is picked by default. Upload jobs uses the same default. The installer's job page also has a **"Home Insulation Victoria arranges"** button.

## Assumption to confirm
This covers **installer jobs only** (jobs the installer brings). For Home Insulation Victoria's own website leads, the safety check still goes to an approved partner electrician from the list, as it does today. Tell me if that should change too.

## 1. Where the option still appears, and what changes
| Where | Today | After |
|---|---|---|
| Add a job: "Electrical safety check by" | "Home Insulation Victoria's electrician", picked by default when there's no usual electrician | Only "My usual electrician (name)". With no approved usual electrician, the installer is told to add one under My business › Electrician first. |
| Add a job confirmation | "We arrange the electrical safety check…" | Removed. The usual electrician line stays. |
| Upload jobs | Defaults to Home Insulation Victoria's electrician | Defaults to the usual electrician. With none, the job is saved and asks the installer to choose, the same as Mitti pickups. |
| Installer job page and job details editor | "Your electrician or ours?" with a "Home Insulation Victoria arranges" button | Own electricians only |
| Installer price card | Button "Switch to Home Insulation Victoria's electrician" | Button removed |
| Older payer choice in the installer's job details (`hivic`) | Selectable | No longer selectable. Old records still read correctly. |
| Owner quote and price wording ("HIV electrician $349") | Shown for `hivic` jobs | Shows the installer's electrician and price |
| Installer agreement text | Mentions Home Insulation Victoria's electrician and fee pathways | **Not changed.** This is signed legal wording. Before I touch it, you'd need to approve new wording. Existing signed copies always stay as they are. |
| Installer screens hint: "Home Insulation Victoria arranges the new PIESA" (repeat safety check) | Shown | Needs a decision from you: the repeat safety check would go to the installer's own electrician. Wording to be approved. |

## 2. Live jobs that already have Home Insulation Victoria chosen
I checked this read-only. **17 open live jobs**, all Reinsulate's:
- HV-3136 to HV-3150 (15 jobs from Upload jobs, all at "Ready Check booking"). These were set by the old default, not chosen by Reinsulate.
- HV-3193 ("quote ready"), from an installer import.
- HV-3724 ("Ready Check booking"), from an onsite Add a job.

There are also 53 TEST jobs; I'd leave those alone.

**What I'd do (only after your separate OK):** switch each of the 17 jobs to Reinsulate's approved usual electrician, ORLANDO POWERED. Each switch is recorded in the job history with your reason, and nothing is sent. HV-3193 already has a quote ready, so its price shown to the owner may change. I'll show you its before and after before saving anything.

Until then, these jobs follow the new rule when their safety check comes up. The approved usual electrician is used; if there isn't one, the job waits and the office gets a Needs me row.

## 3. Tests (written first)
- Add a job, Upload jobs, the job page, the details editor and the price card never offer Home Insulation Victoria. The server also refuses `hivic` / `hivic_organise` if anything sends it.
- With no approved usual electrician, Add a job asks the installer to add one, and Upload jobs saves the job with the question open.
- Old jobs with `hivic` still open and display, and the safety check uses the usual electrician or holds the job.
- The installer agreement text is unchanged, byte for byte.
- Home Insulation Victoria's website-lead safety check offers are unchanged.
- Nothing is sent, and TEST jobs stay TEST only.
- Then the related tests, the typecheck and the full comparable test run.

## Technical details
- Remove the `hivic` option from `electrician-choice.core`, the `ElectricianPicker` buttons in job-intake, intake-details-editor and installer-intake-flow, `switchJobToHivic` and its functions and price-card button, the `add-job-flow.core` line, and the installer-intake/price payer `hivic` paths. Keep the read-side handling for old rows.
- The server-side guard in `recordElectricianChoice`, `recordJobElectricianChoice` and `chooseElectrician` refuses `hivic` / `hivic_organise` for installer-sourced jobs.
- No database or settings changes. Changing the 17 jobs is a separate, approved data step.
