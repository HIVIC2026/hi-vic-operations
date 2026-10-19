# Audit result: legacy exclusion lists vs backlog (read-only, 19 Oct 11:0x UTC)

## Findings
- The two lists exist only in `src/lib/hot-leads.core.ts` and are applied only in `loadHotLeads` (`hot-leads.server.ts` lines 61-62) — the Hot leads screen.
- NOT applied in: `ENQ_00_RECONCILE_ALL.sql`, `ENQ_01_ENQUEUE_SAFE.sql`, `postintake.server.ts`, `lead-email-routing.server.ts`, `save-spot-rules.server.ts`, or `sendOne` / `sendAutomaticInsulationDetails` / `sendSaveMySpot` in `hot-leads-send.server.ts`, nor the T7 ineligible sender.
- None of the 11 jobs currently has a backlog queue row (all 0 `ENQUIRY_BACKLOG_MANUAL` rows).

## Live ENQ_00 result for the 11 jobs
```text
Excluded list
HV-1059  T2  HELD (stage cancelled)   1 failed send
HV-1061  T2  HELD (stage cancelled)   1 failed send
HV-1063  T2  HELD (stage cancelled)   1 failed send
HV-1161  BLOCKED (1 m2)               1 send stuck "sending"
HV-1257  T2  AUTO_SEND   <-- in exclusion set
HV-1291  T2  AUTO_SEND   <-- in exclusion set
Hidden duplicates
HV-1180  T2  AUTO_SEND   <-- newer HV-1181 already answered
HV-1225  T2  AUTO_SEND   <-- newer HV-1461 already answered
HV-1242  T2  AUTO_SEND   <-- newer HV-1359 already answered
HV-1286  T2  AUTO_SEND   <-- newer HV-1359 already answered
HV-1475  NO_ACTION (already sent)
```
6 rows are AUTO_SEND (0 AUTO_SEND_RETRY) and sit in an exclusion set. ENQ_01 would queue them and the automatic sender would send T2.

## Still relevant?
Yes. HV-1257/HV-1291 share one email with 8 other records (Jo's own tests); a related record HV-1437 is also T7 AUTO_SEND. Each hidden duplicate has a newer record for the same email that already received Save My Spot, so sending would be a second email to the same person. HV-1059/61/63/1161 are already held by other rules.

## Proposed fix (needs approval; nothing sent)
1. Move the two lists to one shared exclusion module; ENQ_00 marks them `BLOCKED (LEGACY_EXCLUDED / HIDDEN_DUPLICATE)`, ENQ_01 skips them.
2. Automatic senders (T1/T2/T5/T6 and T7) refuse those job numbers before reserving a send.
3. Add the same check for "another record with the same email already answered" so future duplicates are caught, not just the five listed.
4. Decide on HV-1437 (test-cluster T7) — exclude it too unless Jo says it's real.
5. Tests: listed jobs never AUTO_SEND in ENQ_00 nor queued in ENQ_01; senders block them; normal jobs unaffected. Typecheck. No sends, no queue run, no publish.
