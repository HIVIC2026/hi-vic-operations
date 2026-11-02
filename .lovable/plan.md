# Ask the installer for their own electrician after a Mitti pickup

## Your question: does Add a job offer a "we arrange it" option?
**Yes.** It happens in three places:
- **Add a job** asks "Electrical safety check by" and always offers **"Home Insulation Victoria's electrician"**. When the installer has no approved usual electrician, that option is the one picked by default.
- **Upload jobs** (bulk) uses the same default, so jobs from installers with no usual electrician are set to Home Insulation Victoria's electrician without anyone choosing it.
- **The installer's job page** has an electrician picker with a **"Home Insulation Victoria arranges"** button. It's available until an electrician accepts.

Removing these is a separate change. It's listed below as an option, and nothing changes there unless you approve it.

## 1. Where and when the installer sees the question
- When a job is picked up from Mitti, it shows on the installer's **My jobs** card and in their **Needs finishing** list as "Choose your electrician".
- The question offers only the installer's own electricians:
  - **Their usual electrician**, picked by default when one is approved and saved (for example, ORLANDO POWERED for Reinsulate).
  - **Another of their electricians:** another approved electrician, one they've already invited, or "+ Add another electrician", which uses the same invite as Add a job.
- There's no "Home Insulation Victoria" option.
- The answer is saved the same way Add a job saves it. It's asked once, then disappears.
- No text or email is sent. Trade texts are paused, and you haven't approved any wording.

## 2. If they don't answer before the safety check is due
- **If they have an approved usual electrician:** the portal uses that electrician automatically. The job history records "Usual electrician used: no answer given".
- **If they have none, or only an invited electrician who hasn't signed up yet:** the job waits, and the office gets a Needs me row, "Installer to choose electrician". The portal never picks an electrician for them.

## 3. HV-3722 (Reinsulate)
- After publishing, the question shows on Reinsulate's HV-3722 card, with ORLANDO POWERED picked by default.
- If Reinsulate doesn't answer by the time the safety check is due, ORLANDO POWERED is used automatically.
- Setting it on HV-3722 straight away would be a live data change, so it needs your separate approval. Only HV-3722 would be touched.

## 4. Tests (written first)
- A Mitti pickup with no electrician choice shows the question. A job created through Add a job doesn't.
- The options never include Home Insulation Victoria. The usual electrician is picked by default when one is approved.
- Choosing an electrician, or inviting a new one, saves exactly as Add a job does. The safety check then offers the chosen electrician first.
- No answer, with an approved usual electrician: that electrician is used, and it's recorded only once.
- No answer, without one: the job waits with the office Needs me row, and no electrician is picked.
- A double tap or a late answer is refused once a choice is saved.
- Another business can't see or answer the question on this job (checked as two different users).
- Nothing is sent, and TEST jobs stay TEST only.
- Then the related tests and the full comparable test run.

## Optional follow-up (only if you approve it separately)
Remove the "Home Insulation Victoria's electrician" / "arranges" option from Add a job, Upload jobs and the job page too. This needs a decision from you on what happens when an installer has no electrician of their own yet. For example: Add a job could ask them to add one first, or the job could wait with an office row.

## Technical details
- New pure helper `mittiElectricianQuestion(job, usual, choices)`. It shows only for `source = installer_mitti` jobs with no `electrician_choice_set` event and no electrician offer or assignment. The options come from the installer's own approved and invited electricians.
- The screen reuses `ElectricianPicker` with `ownOnly`, so it has no HIV button. The save uses the existing `recordJobElectricianChoice` and the `electrician_choice_set` event, scoped to the installer's own business.
- In the auto-offer step, a Mitti job with no choice uses the approved usual electrician (and records that once). Otherwise it adds the office row and makes no offer.
- No database changes, no new settings and no wording changes elsewhere.
