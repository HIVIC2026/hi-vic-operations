Answer only. No changes planned.

1. Link an existing Mitti form to a job: No. There is no Office screen, button or server function for typing in a Mitti ID. The only way a job gets a Mitti ID is when the portal creates the form itself ("Create & assign Mitti assessment" on the job page, `createMittiAssessment`, or automatically when a Ready Check is booked, `onReadyCheckBooked`). Nothing creates a job from a Mitti form either. The "Mitti forms" screen under Templates only stores the blank form IDs, not individual jobs.

2. How results arrive: by polling, not a webhook. `syncPendingMitti` in `src/lib/mitti.server.ts` runs on the regular allocation timer. There is also a manual "Sync from Mitti" button on the job. Both only check jobs that already have a Mitti ID saved by the portal. Each sync also checks that the form's "Portal Job Number" field matches the job and that it uses our form; if not, it refuses. So Reinsulate's forms today will never be picked up.

3. Add a job now: it makes a NEW Mitti form when the Ready Check is booked (or straight away in "I'm at the property now" mode). It can't reuse the one Reinsulate already filled in.

4. Office lists: installer jobs don't appear under Enquiries (that list only shows our own leads). They show in Active jobs at their Ready Check stage. Once results sync, they move on to the installer-quote stage, still in Active jobs. They stay marked "Commercial setup required" until that's set up.

Practical upshot: those Mitti forms need either a new "link existing Mitti form" Office action, which also needs the Portal Job Number filled in on the Mitti form, or the results typed in by hand.

Add-on (from the code; the live phone test has not been run in this read-only check)

A. Speed on a phone
- "I'm at the property now" goes: choose mode, customer details, review, save. The exact field and tap counts and the real timing need the live 390px run, which hasn't been done.
- Mitti form: the screen promises "about 90 seconds". It is made in the background after saving, with two automatic retries (after 5 s and 20 s) if Mitti is slow. Until then the installer sees "Preparing form".
- Possible slow points: contact permission and "who organises the job" must be ticked on the review step, and they reset if a saved draft is restored. The office's owner fee-awareness tick holds back sending the quote later, but not saving the job.

B. Where Jo sees the drafted quote
- After the Ready Check syncs, the portal drafts the owner quote automatically (installer jobs only). If anything is missing, it records the reasons on the job ("Owner quote: ...").
- The office sees it under More, then "Quote approvals" (the Quotes tab), which lists jobs by quote stage, and in the job page's quote section.
- I found no separate "quote drafted, ready to check" alert or count. Jo would use Quote approvals and open each job to see whether the draft is ready or held.
