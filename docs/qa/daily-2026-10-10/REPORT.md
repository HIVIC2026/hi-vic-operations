# Daily QA — 10 Oct 2026 (Jo authorised, 04:44 UTC)

Not a whole-portal PASS. Nothing published, no sends, no settings, roles or passwords changed.

## 1. Production fingerprint (read-only) — 2026-10-10T04:44:41Z
`GET https://estimate.homeinsulationvictoria.com.au/` → 200, no redirect (the first 04:44:32Z fetch had the wrong decoding and was thrown away). The references came from the fresh HTML. The video file was resolved from inside the fetched index.

| file | HTTP | bytes | sha256 |
|---|---|---|---|
| index-Cu_v9XUr.js | 200 | 356585 | 6845e8ddb583962f49dfd62cf9fad971c20f68c6bcfe833118abbdf3cf2e848f |
| TradeShell-fhc5Pq4n.js | 200 | 6174 | 844988b33731e2eb08fed19fa61043bcc683b6cf52adec0e8f27c212a4f0d6d1 |
| operations-query-CDmrXud9.js | 200 | 360 | a26d339e87a184b7738b3583cfbf256cfeaa7543c98ee2f16d9197b1b1f31c32 |
| estimate_._token.video-DAdOLeDP.js | 200 | 10954 | a19c329e55107ca1c1263807a0897fde6a0c3255d5c912c652ed1fd4bec9756b |

- Tracked client files: UNCHANGED compared with the 03:54:11Z baseline.
- Server-only comparison: UNKNOWN.

## 2. Source revision (separate from the deployed fingerprint)
- Editor HEAD: `7e998481`. This is not proof of what is deployed.
- New files from this run (harness only; no app code changed):
  - `scripts/qa-onboarding.ts`
  - `e2e/onboarding-qa.py`
  - this folder

## 3. Onboarding click-through — final run 05:01:37–05:04:42 UTC
- **Environment:** local preview sandbox (localhost:8080). It shares the production backend. This is NOT live-site coverage.
- **Budget:** 540 s, one serial run. The `/tmp/portal-qa.lock` check passed and no other QA run was active.
- **Raw results:** `onboarding-results.json`. Screenshots are in `screens/` (`<trade>-<width>-NN-*.png`).

### Isolation proof
- **TEST-only applications.** Every application came from a fresh single-use `onboarding_authorisations` link with purpose `qa_test`, issued by `admin@hivic.test`. That is the same path as the office "Test link". Each one shows the "TEST MODE" banner and was read back as `test_mode=true`.
- **Installer drafts.** These were started server-side from the run's own consumed `qa_test` link, using the same pattern as `installer-test`. The browser then opened them with `?resume=`.
- **No provider calls.** Start, save and sign are database writes only. No `net.*` calls and no triggers that send were found on the onboarding or partner-enquiry tables.
- **Browser limited to localhost.** Every other request was aborted. The only ones blocked were 14 font requests to fonts.googleapis.com.
- **Address fields never typed.** The address lookup is an outside service (Base44/Nominatim).
- **Database afterwards:**
  - 23 TEST drafts in total, all `test_mode=true` and `status=draft`. This includes the exploratory runs and repair runs 1–2.
  - 0 partner enquiries created.
  - 28 `qa_test` links issued. Unused ones expire within 30–60 minutes.
- **No existing record was changed,** so there was nothing to restore. Signed history was not touched.

### Results
| trade | width | check | status |
|---|---|---|---|
| REC | 390 | TEST banner; empty Save refused with errors; page 1 completed and saved, moves to page 2 | PASS |
| REC | 390 / 1280 | Fill page 1 → Save; Back shows the saved answers; fresh browser resumes at the first unfinished page (2), never the welcome; page 1 answers read back from the server; no page errors | PASS |
| REC | both | Database readback: name, email and licence expiry stored, `test_mode=true` | PASS |
| Installer | 390 | TEST banner; empty Save refused with errors | PASS |
| Installer | 390 | Non-relaxed page 1 save | BLOCKED: needs a verified business address (outside lookup) |
| Installer | 390 / 1280 | Fill → Save; Back keeps answers; resume (first unfinished page = 1 because the address was left blank on purpose); server readback; no page errors | PASS |
| Installer | both | Database readback: name and email stored, step saved, `test_mode=true` | PASS |
| REC | 1280 | Final signing on a relaxed TEST draft | BLOCKED: always-required "services" page needs a verified Victorian service address |
| Installer | 1280 | Final signing on a relaxed TEST draft | BLOCKED: server-side guard refused with "Please complete the "Work & coverage" page before signing" (same address need). Database still `draft`, not signed. This is correct guard behaviour. |

### Repair cycles (harness only; no app bugs found)
1. **Cycle 1.** The page counter is in the header, not inside `main`. The REC licence label is not linked to its input. The installer draft only starts on the first save. Fixed: read the page from the whole page, find the input by its label, start the installer draft server-side.
2. **Cycle 2.** The resume check was too strict: by design, the app resumes at the first unfinished page. The signing check reported a refused signing as PASS. Fixed: signing now counts only on a real "submitted" screen, and an address-guard refusal is BLOCKED.

## 4. Not run / blocked (exact missing capability)
- **Onboarding upload and final signing:** a verified address needs the outside Base44 address lookup. No intercept/stub exists on the server path. → BLOCKED
- **Office approve / send back / decline:** these send real Resend emails to the applicant (`office_manual`). There is no proven intercept. → NOT_RUN
- **Owner verification code / signing:** quote acceptance goes into `createInvoiceForQuote` → `pushInvoiceToXero`, which is NO-GO for real calls. The owner code is outbox-only, but signing reaches the invoice path. → NOT_RUN
- **Mitti, worker links, bookings, Xero, VEEC:** never invoked. → NOT_RUN
- **Office delete/restore/classification and Group B:** already done (26 PASS), with no changed behaviour, so not repeated.
- **Real records:** HV-1981, HV-2010 and HV-2015 were not touched. The no-size checker was untouched.
