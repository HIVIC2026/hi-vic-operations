# Two tidy-ups before Jo's review

## 1. Final AP approval only through the AP queue

**What changes**
- Three office actions can currently move a job from AP review to Ready for VEEC on their own: running the automated compliance checks, setting a compliance check, and reviewing evidence. They also do this on the office job page, through the "Mark Ready for VEEC" button.
- These actions still record their results exactly as now. They just stop moving the job out of AP review. Their earlier steps keep moving as before; for example, evidence review can still move a job into AP review.
- On the office job page, the "Mark Ready for VEEC" button is replaced by an **Approve in AP queue** link to the AP queue page.
- The old "Ready for VEEC" office action now refuses jobs that are in AP review and says to use the AP queue. Nothing else uses it.
- The AP queue approval is then the only way a job leaves AP review for Ready for VEEC. It keeps its own record: who, when, the note and the flags shown.

**Parts touched:** the automatic progression rule for AP review, the three office actions above, the old Ready for VEEC action, and the compliance section of the office job page.

## 2. Electrician daily job limit (office only)

**What changes**
- A new **Daily job limit (jobs per day, empty = no limit)** field goes in the business settings form. It shows only to the office, and only for electrician (REC) businesses.
- Whole numbers from 1 upwards are accepted. 0 or negative numbers are refused with a plain message. Clearing the box saves "no limit".
- Businesses can't change their own limit. If a business saves its own settings, the limit is ignored.
- Each change is recorded in the office settings history: who, when, the old value and the new value.
- Matching already uses this limit, so no change is needed there.

**Parts touched:** the business settings form, its save action, and one new history entry type. No database change: the field already exists.

## Effect on existing records
- No existing records are changed.
- Jobs already in AP review stay there until the AP approves each one in the queue.
- Jobs already at Ready for VEEC or later stay where they are.
- Every electrician's limit stays as it is now (empty means no limit) until the office sets one.
- Sending and the payment gate stay off.

## Undo
Roll back this version in History. There's no database change to undo.

## Tests
- Compliance review, compliance checks and evidence review no longer move a job out of AP review.
- AP queue approval still works.
- The old Ready for VEEC action refuses AP review jobs.
- Daily limit: 0 refused, empty saves "no limit", ignored when a business saves its own settings, and each office change is recorded.
- Then the related existing tests, the code check, the wording scan and the preview build.

## Technical details
- `autoadvance.core.ts` `planStep("ap_review")` always stops with "Approve in AP queue". Remove the `allowApPromotion` option and its three call sites in `portal.functions.ts` (evidence review, compliance review, compliance check).
- `ap-queue.functions.ts` `approveApJob` keeps calling `transition(..., "ready_for_veec")` directly.
- `markReadyForVeec` throws a `WorkflowError` when the stage is `ap_review`. The button in `admin.jobs.$jobId.tsx` `Compliance` becomes a `Link` to `/admin/ap-queue`.
- `pilot.functions.ts` `businessInput` gains `daily_job_limit: z.number().int().min(1).max(50).nullish()`. `saveBusiness` deletes it from the update for non-admins and writes an `admin_config_events` entry (`electrician_daily_limit_set`) when it changes.
- `components/portal/business.tsx`: the field shows for admins on REC/electrician businesses only.
- Update the existing autoadvance tests that expected AP promotion, and add the new tests above.
