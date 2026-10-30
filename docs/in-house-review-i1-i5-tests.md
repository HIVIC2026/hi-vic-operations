# In-house review I1–I5 test report

No live SQL, publishing, real messages or Mitti calls. All checks local or mocked.

## Final summaries
```text
Requested combined run: 765 pass / 74 fail / 3 skip / 1 error; 2507 assertions; 72 files.
Same requested files, isolated: 848 pass / 2 fail / 3 skip / 0 errors; 72 files.
5fadf36 available files combined: 609 pass / 73 fail / 3 skip; 56 files.
```

## Remaining isolated failures

- `tests/mitti-autoform.test.ts`: **sweepReadyCheckForms > wired into the 15-minute tick, never sends to owners; stage only via the shared Mitti hold**
  - Current isolated: 27 pass / 1 fail. 5fadf36 isolated: 27 pass / 1 fail. Failure pre-existed there.

- `tests/mitti-sync-overlap.test.ts`: **Mitti instant notice + 15-minute pull overlap > two overlapping syncs then a third → one live quote, sent to the owner exactly once**
  - Current isolated: 0 pass / 1 fail. 5fadf36 isolated: 1 pass / 0 fail. Failure did NOT pre-exist there; it is present before this review too, but not attributed to this review without a full intervening-commit bisect.

## All combined-run failing test names
Combined runs share global module mocks; isolated runs distinguish these from persistent failures. Each failing existing file was also run separately at 5fadf36. New in-house files do not exist at that baseline.

### tests/fixes-day.test.ts
Baseline file check: 11 pass / 0 fail in isolated baseline run.
- completeFixesForm: files are kept first; a failed download holds and is retried > a failed file → held once; no Section C, no evidence update, no completion event; the next run gets past the files — also fails in combined 5fadf36.

### tests/mitti-autoform.test.ts
Baseline file check: 27 pass / 1 fail in isolated baseline run.
- sweepReadyCheckForms > wired into the 15-minute tick, never sends to owners; stage only via the shared Mitti hold — also fails in combined 5fadf36.

### tests/mitti-journey-guard.test.ts
Baseline file check: 2 pass / 0 fail in isolated baseline run.
- armed guard sends product Mitti calls to the simulator, not the network — also fails in combined 5fadf36.
- armed guard without a simulator refuses loudly — also fails in combined 5fadf36.

### tests/mitti-retry-sweep.test.ts
Baseline file check: 44 pass / 0 fail in isolated baseline run.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > fixes: a form Mitti already made is adopted, not duplicated — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > fixes: retry makes one form, clears the flag, sends no email — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > install_day: a form Mitti already made is adopted, not duplicated — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > install_day: retry makes one form, clears the flag, sends no email — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > piesa: a form Mitti already made is adopted, not duplicated — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > piesa: retry makes one form, clears the flag, sends no email — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > ready_check: a form Mitti already made is adopted, not duplicated — also fails in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > ready_check: retry makes one form, clears the flag, sends no email — also fails in combined 5fadf36.
- final review fixes > C1 fixes: a form whose job number and address can't be read means "can't tell": email, never create — also fails in combined 5fadf36.
- final review fixes > C1 fixes: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — also fails in combined 5fadf36.
- final review fixes > C1 fixes: this job's form, read with its own labels, is never duplicated; another job's form is ignored — also fails in combined 5fadf36.
- final review fixes > C1 install_day: a form whose job number and address can't be read means "can't tell": email, never create — also fails in combined 5fadf36.
- final review fixes > C1 install_day: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — also fails in combined 5fadf36.
- final review fixes > C1 install_day: this job's form, read with its own labels, is never duplicated; another job's form is ignored — also fails in combined 5fadf36.
- final review fixes > C1 piesa: a form whose job number and address can't be read means "can't tell": email, never create — also fails in combined 5fadf36.
- final review fixes > C1 piesa: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — also fails in combined 5fadf36.
- final review fixes > C1 piesa: this job's form, read with its own labels, is never duplicated; another job's form is ignored — also fails in combined 5fadf36.
- final review fixes > C1 ready_check: a form whose job number and address can't be read means "can't tell": email, never create — also fails in combined 5fadf36.
- final review fixes > C1 ready_check: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — also fails in combined 5fadf36.
- final review fixes > C1 ready_check: this job's form, read with its own labels, is never duplicated; another job's form is ignored — also fails in combined 5fadf36.
- final review fixes > C2: a TEST partner PIESA retry only reaches the simulator and the TEST Mitti account — also fails in combined 5fadf36.
- final review fixes > C2: a qa_test job PIESA retry only reaches the simulator and the TEST Mitti account — also fails in combined 5fadf36.
- final review fixes > I1: a form already with the trade is linked too — also fails in combined 5fadf36.
- final review fixes > I1: a form still with the API account is not adopted while that account is unknown (email, no create) — also fails in combined 5fadf36.
- final review fixes > I3: a PIESA lost reply (booking path) is retried after searching, not emailed at once — also fails in combined 5fadf36.
- final review fixes > I4: a PIESA retry does not clear the Ready Check office flag — also fails in combined 5fadf36.
- final review fixes > I5: a Mitti outage before the create waits, searches and retries; no instant email — also fails in combined 5fadf36.
- final review fixes > I5: a retry that hits an outage again tries once more, then emails — also fails in combined 5fadf36.
- final review fixes > I5: an outage that lasts through both retries emails once — also fails in combined 5fadf36.
- final review fixes > I7: only the last 14 days of events are read — also fails in combined 5fadf36.
- final review fixes > M3: a full page of Mitti results (no paging) emails and creates nothing — also fails in combined 5fadf36.
- final review fixes > M4: an alert that keeps failing logs at most one error per job and form each hour — also fails in combined 5fadf36.
- the retry sweep > 1. fail then retry works: one form, flag cleared, no email — also fails in combined 5fadf36.
- the retry sweep > 2. lost reply: the form Mitti made is found and linked, nothing new is made — also fails in combined 5fadf36.
- the retry sweep > 3. both retries fail: exactly one email (even with two sweeps at once), flag still open — also fails in combined 5fadf36.
- the retry sweep > 4. trade not found: no retry, email at once — also fails in combined 5fadf36.
- the retry sweep > 5. two sweeps at once make one form and no email — also fails in combined 5fadf36.
- the retry sweep > 7. a search error emails and creates nothing — also fails in combined 5fadf36.
- the retry sweep > 7b. more than one match, or a form that is not with the trade, emails and creates nothing — also fails in combined 5fadf36.
- the retry sweep > 7c. a form for another job or another person does not block the retry — also fails in combined 5fadf36.
- the retry sweep > 8. skips when the office already fixed it — also fails in combined 5fadf36.
- the retry sweep > 9. a test job uses the simulator and the allowlist — also fails in combined 5fadf36.
- the retry sweep > failures before go-live are left alone — also fails in combined 5fadf36.
- the retry sweep > one bad case never stops the others — also fails in combined 5fadf36.

### tests/mitti-sync-overlap-fixes.test.ts
Baseline file check: 1 pass / 0 fail in isolated baseline run.
- Mitti instant notice + 15-minute pull overlap — A3 fixes quote > two overlapping syncs of a Complete A3 needing repairs → one live fixes quote, one owner email, at most one text — also fails in combined 5fadf36.

### tests/mitti-sync-overlap.test.ts
Baseline file check: 1 pass / 0 fail in isolated baseline run.
- Mitti instant notice + 15-minute pull overlap > two overlapping syncs then a third → one live quote, sent to the owner exactly once — also fails in combined 5fadf36.

### tests/mitti-test-routing.test.ts
Baseline file check: 9 pass / 0 fail in isolated baseline run.
- TEST-domain and TEST-partner users never touch the network — also fails in combined 5fadf36.
- a TEST flow (search, template, create, share, owner, read) stays simulated — also fails in combined 5fadf36.
- fixes-day TEST flow: template read goes to the simulator, never the network — also fails in combined 5fadf36.
- real assignee search goes to real Mitti byte for byte — also fails in combined 5fadf36.
- real audit id and real create go to real Mitti unchanged — also fails in combined 5fadf36.
- simulated GET /audits/search lists stored forms modified at or after the time — also fails in combined 5fadf36.
- simulated GET returns the answers sent at creation so auditIdentity reads job number and address — also fails in combined 5fadf36.

### tests/mitti-webhook.server.test.ts
Baseline file check: 16 pass / 0 fail in isolated baseline run.
- handleMittiNotice > a cancelled job is ignored (assessment and measurement lookups) — also fails in combined 5fadf36.
- handleMittiNotice > a complete assessment or measurement row is ignored — also fails in combined 5fadf36.
- handleMittiNotice > a complete job is ignored (assessment and measurement lookups) — also fails in combined 5fadf36.
- handleMittiNotice > a deleted or archived job is ignored; nothing synced, nothing written — also fails in combined 5fadf36.
- handleMittiNotice > a job outside the hivic business unit is ignored — also fails in combined 5fadf36.
- handleMittiNotice > a normal open job is still synced — also fails in combined 5fadf36.
- handleMittiNotice > a on_hold job is ignored (assessment and measurement lookups) — also fails in combined 5fadf36.
- handleMittiNotice > a ready_for_veec job is ignored (assessment and measurement lookups) — also fails in combined 5fadf36.
- handleMittiNotice > audit on an assessment with switch on is synced once with (jobId, null) — also fails in combined 5fadf36.
- handleMittiNotice > audit only on a current Mitti measurement is synced — also fails in combined 5fadf36.
- handleMittiNotice > non-current or non-Mitti measurement rows are ignored — also fails in combined 5fadf36.
- handleMittiNotice > read error such as column not found is off — also fails in combined 5fadf36.
- handleMittiNotice > switch off (false) returns off without doing the lookups — also fails in combined 5fadf36.
- handleMittiNotice > switch row missing is off — also fails in combined 5fadf36.
- handleMittiNotice > sync throwing returns failed, logs ids and message only, does not throw — also fails in combined 5fadf36.
- handleMittiNotice > unknown audit id is ignored, sync not called — also fails in combined 5fadf36.

### tests/in-house-advance-server.test.ts
Baseline file check: not present at 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > fixes: a form Mitti already made is adopted, not duplicated — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > fixes: retry makes one form, clears the flag, sends no email — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > install_day: a form Mitti already made is adopted, not duplicated — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > install_day: retry makes one form, clears the flag, sends no email — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > piesa: a form Mitti already made is adopted, not duplicated — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > piesa: retry makes one form, clears the flag, sends no email — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > ready_check: a form Mitti already made is adopted, not duplicated — not observed failing in combined 5fadf36.
- 6. every kind of form passes the fail-then-retry case, and the lost-reply case > ready_check: retry makes one form, clears the flag, sends no email — not observed failing in combined 5fadf36.
- Mitti instant notice + 15-minute pull overlap > two overlapping syncs then a third → one live quote, sent to the owner exactly once — not observed failing in combined 5fadf36.
- Mitti instant notice + 15-minute pull overlap — A3 fixes quote > two overlapping syncs of a Complete A3 needing repairs → one live fixes quote, one owner email, at most one text — not observed failing in combined 5fadf36.
- TEST-domain and TEST-partner users never touch the network — not observed failing in combined 5fadf36.
- a TEST flow (search, template, create, share, owner, read) stays simulated — not observed failing in combined 5fadf36.
- armed guard sends product Mitti calls to the simulator, not the network — not observed failing in combined 5fadf36.
- armed guard without a simulator refuses loudly — not observed failing in combined 5fadf36.
- completeFixesForm: files are kept first; a failed download holds and is retried > a failed file → held once; no Section C, no evidence update, no completion event; the next run gets past the files — not observed failing in combined 5fadf36.
- final review fixes > C1 fixes: a form whose job number and address can't be read means "can't tell": email, never create — not observed failing in combined 5fadf36.
- final review fixes > C1 fixes: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — not observed failing in combined 5fadf36.
- final review fixes > C1 fixes: this job's form, read with its own labels, is never duplicated; another job's form is ignored — not observed failing in combined 5fadf36.
- final review fixes > C1 install_day: a form whose job number and address can't be read means "can't tell": email, never create — not observed failing in combined 5fadf36.
- final review fixes > C1 install_day: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — not observed failing in combined 5fadf36.
- final review fixes > C1 install_day: this job's form, read with its own labels, is never duplicated; another job's form is ignored — not observed failing in combined 5fadf36.
- final review fixes > C1 piesa: a form whose job number and address can't be read means "can't tell": email, never create — not observed failing in combined 5fadf36.
- final review fixes > C1 piesa: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — not observed failing in combined 5fadf36.
- final review fixes > C1 piesa: this job's form, read with its own labels, is never duplicated; another job's form is ignored — not observed failing in combined 5fadf36.
- final review fixes > C1 ready_check: a form whose job number and address can't be read means "can't tell": email, never create — not observed failing in combined 5fadf36.
- final review fixes > C1 ready_check: a right-template form whose reply can't be identified means "can't tell": one email, no create, no release — not observed failing in combined 5fadf36.
- final review fixes > C1 ready_check: this job's form, read with its own labels, is never duplicated; another job's form is ignored — not observed failing in combined 5fadf36.
- final review fixes > C2: a TEST partner PIESA retry only reaches the simulator and the TEST Mitti account — not observed failing in combined 5fadf36.
- final review fixes > C2: a qa_test job PIESA retry only reaches the simulator and the TEST Mitti account — not observed failing in combined 5fadf36.
- final review fixes > I1: a form already with the trade is linked too — not observed failing in combined 5fadf36.
- final review fixes > I1: a form still with the API account is not adopted while that account is unknown (email, no create) — not observed failing in combined 5fadf36.
- final review fixes > I3: a PIESA lost reply (booking path) is retried after searching, not emailed at once — not observed failing in combined 5fadf36.
- final review fixes > I4: a PIESA retry does not clear the Ready Check office flag — not observed failing in combined 5fadf36.
- final review fixes > I5: a Mitti outage before the create waits, searches and retries; no instant email — not observed failing in combined 5fadf36.
- final review fixes > I5: a retry that hits an outage again tries once more, then emails — not observed failing in combined 5fadf36.
- final review fixes > I5: an outage that lasts through both retries emails once — not observed failing in combined 5fadf36.
- final review fixes > I7: only the last 14 days of events are read — not observed failing in combined 5fadf36.
- final review fixes > M3: a full page of Mitti results (no paging) emails and creates nothing — not observed failing in combined 5fadf36.
- final review fixes > M4: an alert that keeps failing logs at most one error per job and form each hour — not observed failing in combined 5fadf36.
- fixes-day TEST flow: template read goes to the simulator, never the network — not observed failing in combined 5fadf36.
- handleMittiNotice > a cancelled job is ignored (assessment and measurement lookups) — not observed failing in combined 5fadf36.
- handleMittiNotice > a complete assessment or measurement row is ignored — not observed failing in combined 5fadf36.
- handleMittiNotice > a complete job is ignored (assessment and measurement lookups) — not observed failing in combined 5fadf36.
- handleMittiNotice > a deleted or archived job is ignored; nothing synced, nothing written — not observed failing in combined 5fadf36.
- handleMittiNotice > a job outside the hivic business unit is ignored — not observed failing in combined 5fadf36.
- handleMittiNotice > a normal open job is still synced — not observed failing in combined 5fadf36.
- handleMittiNotice > a on_hold job is ignored (assessment and measurement lookups) — not observed failing in combined 5fadf36.
- handleMittiNotice > a ready_for_veec job is ignored (assessment and measurement lookups) — not observed failing in combined 5fadf36.
- handleMittiNotice > audit on an assessment with switch on is synced once with (jobId, null) — not observed failing in combined 5fadf36.
- handleMittiNotice > audit only on a current Mitti measurement is synced — not observed failing in combined 5fadf36.
- handleMittiNotice > non-current or non-Mitti measurement rows are ignored — not observed failing in combined 5fadf36.
- handleMittiNotice > read error such as column not found is off — not observed failing in combined 5fadf36.
- handleMittiNotice > switch off (false) returns off without doing the lookups — not observed failing in combined 5fadf36.
- handleMittiNotice > switch row missing is off — not observed failing in combined 5fadf36.
- handleMittiNotice > sync throwing returns failed, logs ids and message only, does not throw — not observed failing in combined 5fadf36.
- handleMittiNotice > unknown audit id is ignored, sync not called — not observed failing in combined 5fadf36.
- real assignee search goes to real Mitti byte for byte — not observed failing in combined 5fadf36.
- real audit id and real create go to real Mitti unchanged — not observed failing in combined 5fadf36.
- simulated GET /audits/search lists stored forms modified at or after the time — not observed failing in combined 5fadf36.
- simulated GET returns the answers sent at creation so auditIdentity reads job number and address — not observed failing in combined 5fadf36.
- sweepReadyCheckForms > wired into the 15-minute tick, never sends to owners; stage only via the shared Mitti hold — not observed failing in combined 5fadf36.
- the retry sweep > 1. fail then retry works: one form, flag cleared, no email — not observed failing in combined 5fadf36.
- the retry sweep > 2. lost reply: the form Mitti made is found and linked, nothing new is made — not observed failing in combined 5fadf36.
- the retry sweep > 3. both retries fail: exactly one email (even with two sweeps at once), flag still open — not observed failing in combined 5fadf36.
- the retry sweep > 4. trade not found: no retry, email at once — not observed failing in combined 5fadf36.
- the retry sweep > 5. two sweeps at once make one form and no email — not observed failing in combined 5fadf36.
- the retry sweep > 7. a search error emails and creates nothing — not observed failing in combined 5fadf36.
- the retry sweep > 7b. more than one match, or a form that is not with the trade, emails and creates nothing — not observed failing in combined 5fadf36.
- the retry sweep > 7c. a form for another job or another person does not block the retry — not observed failing in combined 5fadf36.
- the retry sweep > 8. skips when the office already fixed it — not observed failing in combined 5fadf36.
- the retry sweep > 9. a test job uses the simulator and the allowlist — not observed failing in combined 5fadf36.
- the retry sweep > failures before go-live are left alone — not observed failing in combined 5fadf36.
- the retry sweep > one bad case never stops the others — not observed failing in combined 5fadf36.

## Choice and scope
Preferred auto-progression chosen: only held partner-billed separate rectification at piesa_complete advances to rectification_scheduling through normal guards/history, rather than adding an office queue. HIV-billed/non-held unchanged; failed billing read logs and stays put. C1 preserved. No pending SQL needed. Hosted end-to-end NOT RUN; practice/mocked booking flows passed. Generated types changed automatically during this task; the agent did not edit that managed file.
