# HV-2730 (Wayne Wilson) quick taps: findings and fix plan

## What I found (read-only)

### 1) What Wayne saw and why the share didn't save
- 2 Nov, 7:07pm Sydney: Rapid Insulation's area batch (81e531cc…, just 1 home) texted Wayne the quick-taps link.
- 7:09pm: he answered every question and tapped "Yes, let's go". His answers saved once (go = yes, outcome = pass, OK to share = yes).
- Straight after that, the portal tried to save his OK to share his name and number with the installer. The database refused it every time with: *violates check constraint "owner_gate_signatures_check"*.
- Cause: quick taps saved the OK as a "code sign-in", and the database only accepts a code sign-in when a verified code is attached. Quick taps never sends a code, so every attempt failed. It wasn't a security-rule (RLS) problem.
- Because the OK was missing, his screen kept showing the "try again" view instead of the thank-you screen. Each tap logged another failure. The database has **19** of these, not 21, between 7:09pm and 8:49pm.

### 2) Was it saved, and why hasn't his job moved on?
- His "yes" was saved at 7:09pm.
- His OK to share **is now saved**: 2 Nov at 9:03pm Sydney, as "Owner paperwork A: Sharing with your tradies signed". That's after the 2 Nov fix (migration 0187, the new "quick tap link" method) went live. There have been no failures since 8:49pm. On 3 Nov he also did the roof check (pitched).
- **His job isn't stuck.** "Ready Check ready to schedule" with no booking is the normal waiting place under the current rules:
  - The batch closes 72 hours after it was sent: about **7:07pm Thu 5 Nov Sydney**.
  - It then shows as "waiting for your OK to send to the installer".
  - Nothing goes to Rapid until Jo taps **Send**. Only after that does Rapid contact him and book the Ready Check.
  - Rapid is also not switched to in-house yet.

### 3) Did anyone else hit it?
- Only one other job: **HV-3682**. It had 1 failure on 1 Nov, and its OK to share is **still not saved**, even though the owner said yes. That job has since moved on to the safety-check stage.
- No other "yes" answers are missing their OK.

## Fix plan (needs Jo's OK for each step)
1. **The main fix is already live** (0187). There's no new code change for the cause.
2. **HV-3682 repair:** use the existing one-off repair (`repairQuickTapsSharing`).
   - First a dry run, showing the list: it should be HV-3682 only.
   - Then, only after Jo OKs it, save that owner's OK once from their recorded "yes". Nothing is sent.
3. **Optional (Jo to choose):** stop repeat logging. When the same job and batch keep failing for the same reason, record the failure once, so there's no pile of 19 identical failures.
4. **Not proposed unless Jo asks:** closing a batch early when every owner in it has already answered. Today Wayne waits the full 72 hours.

## Tests (only for steps Jo approves)
- Repair dry run on the practice database: lists only owners who said yes but have no saved OK. It skips declines, closed jobs and anyone already saved.
- Running the repair twice saves only one OK.
- The existing 0187 checks still pass: a quick-tap OK saves for sharing only, and a code sign-in with no code is still refused.
- If step 3 is approved: repeat failures for the same job and batch write one log entry.

No code, data, sends or publishing until Jo approves.
