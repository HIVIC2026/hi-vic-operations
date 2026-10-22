Answer only. No changes planned.

1. Link an existing Mitti form to a job: No. There is no Office screen, button or server function for typing in a Mitti ID. The only way a job gets a Mitti ID is when the portal creates the form itself ("Create & assign Mitti assessment" on the job page, `createMittiAssessment`, or automatically when a Ready Check is booked, `onReadyCheckBooked`). Nothing creates a job from a Mitti form either. The "Mitti forms" screen under Templates only stores the blank form IDs, not individual jobs.

2. How results arrive: by polling, not a webhook. `syncPendingMitti` in `src/lib/mitti.server.ts` runs on the regular allocation timer. There is also a manual "Sync from Mitti" button on the job. Both only check jobs that already have a Mitti ID saved by the portal. Each sync also checks that the form's "Portal Job Number" field matches the job and that it uses our form; if not, it refuses. So Reinsulate's forms today will never be picked up.

3. Add a job now: it makes a NEW Mitti form when the Ready Check is booked (or straight away in "I'm at the property now" mode). It can't reuse the one Reinsulate already filled in.

4. Office lists: installer jobs don't appear under Enquiries (that list only shows our own leads). They show in Active jobs at their Ready Check stage. Once results sync, they move on to the installer-quote stage, still in Active jobs. They stay marked "Commercial setup required" until that's set up.

Practical upshot: those Mitti forms need either a new "link existing Mitti form" Office action, which also needs the Portal Job Number filled in on the Mitti form, or the results typed in by hand.
