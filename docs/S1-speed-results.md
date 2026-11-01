# S1 — practice-only speed results (1 November 2026)

## Failure-count check

The reproduced extra failing file is `tests/enquiry-response-scope-practice-db.test.ts`: its explicitly 30-second-capped PGlite “unapplied page-facts proposal” test times out under parallel suite load. It timed out on both archived Task 7 (`f358d6a1`) and E0 (`1c86040d`), and passes individually on both before/current: **8 passed, 0 failed**, approximately 16 seconds. Its source did not change between Task 7 and E0. This is not an E0 code regression. Original historical per-file lists are unavailable, so this explains the reproduced 98th file rather than proving the exact provenance of the earlier published 98/243 report.

Fresh raw comparison: Task 7 987 files, 10,012 passes / 244 failures / 98 failing files; E0 988 files, 10,016 passes / 244 failures / 98 failing files. Every existing file has identical results. After substituting the same individual timeout recheck on both: Task 7 10,013/243/97 and E0 10,017/243/97. The older test totals cannot be reconstructed from the summaries alone.

## Measurements

Actual server helpers timed inside isolated existing fixtures; no live calls. These are **local double/practice timings, not published-site latency**, and single observations are subject to scheduling noise. Zero-delay provider stubs do not establish real delivery speed. No improvement is claimed from small noise-only differences.

| Action / case | Before ms | After ms | Scope |
|---|---:|---:|---|
| Save my spot | 1.63 | 5.31 | Actual canonical saved-spot replay; first new save NOT RUN |
| Quick-tap YES answers | 2.50 | 2.23 | Actual save/sign helper, in-memory records |
| Quick-tap decline | 2.18 | 1.10 | Actual cancellation and mocked mail, zero provider delay |
| Accept quote | 0.60 | 0.62 | Successful post-commit case; verified-session/signature dependencies stubbed. **Full six-digit-code + four real records NOT RUN** |
| Quote ESC owner signature with stalled AP work | >80 | 2.1 | Response race against blocked provider double; owner signature durable before reply |
| Confirm my safety check | NOT RUN | NOT RUN | Source audit only; signature helper contains reads + audit write, no sender |
| Book Ready Check | 24.91 | 22.13 | First successful actual booking wrapper/PGlite case, Team/provider dependencies stubbed |
| Book safety check | 75.64 | 39.34 | Same first successful case; zero-delay provider doubles |
| Book installation | 115.24 | 98.57 | Same first successful case; zero-delay provider doubles |
| Change Lead Installer | 6.75 | 8.28 | Actual crew-save/A5/SWMS fixture, no real provider latency |
| Installer To book list | 55.1 | 53.3 | Actual tradeHome, in-house office fixture; 10ms/read model. Fixture has no newly awaiting-deposit row |
| Installer My job | measured separately: 4–5 read waves | measured separately: 4–5 read waves | Existing actual server-reader tests; controlled matched numeric before/after NOT RUN |
| Owner My job | 45.38 | 40.28 | Actual public reader, 2ms/read model, issued-quote fixture |
| To book payment batch: 31 jobs | prior per-job full payment-page reads | 14.4 | 5ms/read model, **4 shared reads**; no fabricated prior numeric time |
| Booking Team, 405 workers | serial dependencies (failing overlap test) | 113.1 | 25ms/read doubles, three worker pages; no fabricated prior numeric time |

Benchmark staging and raw logs were stored in `/tmp/s1/metrics`; these temporary files do not persist across sandbox resets. Existing fixture tests and new regression tests remain in the project.

## Implemented, test-first

- New `install-deposit-list.server.ts` reads newest installation invoices, reconciled payment/reversal/separate marks, quote PIESA lines and setting in shared paged batches. Uses unchanged canonical payment-plan maths; repeat/rectification payments never unlock an installation deposit. Missing invoices remain unknown, failures drop the entire batch rather than trusting partial records. Caller supplies already authorised job ids.
- `tradeHome` replaces serial full owner-payment-page reads per awaiting-install job with this bounded reader.
- `bookingTeam` overlaps independent candidate, worker-page, payment and crew reads after access checks; indexes worker records by id instead of repeated array scans. No cross-request/user cache.
- `saveCrewWithLead` reuses its initial crew record instead of reading it twice; old A5 access removal and SWMS refusal still pass.
- Owner My job reuses its loaded payment view for cancellation safety rather than loading the same payment page twice; no change to cancellation rules.
- `signOwnerConsent` responds after owner signature/audit are durable. Existing `awaiting_ap` row is the existing automatic AP sweep's retry source; request lifecycle starts AP work without waiting for PDF/email. Production without lifecycle leaves work for that sweep. Owner signatures are not detached.
- Kept `payment-ledger.server.ts` lean and unchanged: an initial placement broke an import-boundary test, so list-only logic moved to its own module; original test restored without weakening it.

## Tests / comparison

- New tests: **6 passed, 0 failed** across four files. Red-first proofs: missing batch reader, serial Team reads, AP work blocking the signature response, duplicate owner-page payment read.
- Expanded existing handover test: **2 passed, 0 failed**, including one crew read, actual A5 handover/old access removal and SWMS identity refusal.
- Final full isolated run: **992 files, 10,023 passed / 243 failed, 97 failing files**. Same two known stallers excluded: register-interest-validation and save-spot-uncertain-delivery.
- Comparable E0 baseline after identical individual recheck: **988 files, 10,017 passed / 243 failed, 97 failing files**. Six new passing tests; **zero new failing files, zero lost original passes**.
- Automatic checks: build OK. Retired-terms scan: zero customer-visible failures.

## Not complete / why not silently detached

**S1 is partial.** The six-digit code, full real quote-sign/PDF path and PIESA-confirm action still need controlled timed fixtures. No authenticated browser/live-flow claim is made under the no-live-write/no-send restriction.

Booking and Lead Installer actions still await Mitti identity validation/handover; booking also awaits post-booking forms and notices. Quick-tap decline still awaits its email. Quote agreement still renders/stores its signed PDF before completing. Code issuance awaits provider acknowledgement and returns delivery errors. These paths do not all have an existing durable automatic retry that can safely replace the await. Simply calling waitUntil would not meet “queued and retried, nothing lost”; moving pre-write Mitti validation would change refusal behaviour. They remain unchanged rather than falsely reported instant/recoverable.

Inline To book rows still request job-bound access/Team individually; consolidating these into a scoped batch remains unimplemented. Current payment N+1 is fixed, not all row-driven requests.

No settings, secrets, live data, database changes, migrations, sends or publishing. Existing pending migrations remain unapplied.

## Changed files

- src/lib/install-deposit-list.server.ts
- src/lib/trade-view.server.ts
- src/lib/in-house-booking.server.ts
- src/lib/visit-allocation.server.ts
- src/lib/owner-myjob.server.ts
- src/lib/consent.server.ts
- src/lib/AGENTS.md
- tests/s1-deposit-list.test.ts
- tests/s1-booking-team.test.ts
- tests/s1-consent-response.test.ts
- tests/s1-owner-page.test.ts
- tests/in-house-task7-handover.test.ts
- docs/S1-speed-results.md
- roadmap.md
