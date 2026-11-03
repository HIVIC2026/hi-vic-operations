# HV-3682 quick-taps sharing repair (Jo chose this step only)

## Background (read-only findings)
- HV-2730 (Wayne Wilson): his "yes" saved on 2 Nov at 7:09pm. His OK to share his details failed 19 times, because quick taps saved it as a code sign-in and the database requires a verified code for that.
- The 2 Nov fix (0187) is live. Wayne's OK saved at 9:03pm. His job is waiting normally: the batch closes about 7:07pm Thu 5 Nov Sydney, then Jo taps Send.
- HV-3682 is the only other job affected. The owner said yes, but the OK to share is still not saved.

## What will happen
1. **Dry run** of the existing one-off repair. It lists owners who said yes but have no saved OK. Expected: HV-3682 only. I'll show you the list.
2. **Apply, only after Jo OKs the list.** It saves HV-3682's OK once, from the owner's recorded "yes", through the same save the owner's own tap uses. It also logs a "quick_taps_share_repaired" entry in the job history.
3. Confirm the saved OK afterwards.

Nothing is sent. No other jobs, settings or code change, and nothing is published. The repeat-logging change and closing batches early are not included.

## Tests (practice database, before the live run)
- The dry run lists only owners who said yes and have no saved OK. It skips declines, cancelled or deleted jobs, and anyone already saved.
- Running the repair twice saves only one OK.
- The 0187 checks still pass: a quick-tap OK saves for sharing only, and a code sign-in with no code is still refused.
