# Pre-lock QA audit — homeowner enquiry → estimate → referral → email (2026-09-29)

Audit only. No production code, settings, schedules or database rows changed. No messages sent. Both email locks stayed OFF and the delivery bridge stayed disabled. Evidence folder: `/mnt/documents/prelock-qa/` (33 files: screenshots + `results.json`, fixture data only).

## 1. Repository checks (fresh this run)
| Command | Exit | Result |
|---|---|---|
| `bun test ./tests/` | 0 | 491 pass, 0 fail, 2455 expects |
| `bun test ./qa/prelock` (isolated fake-DB dispatch suite) | 0 | 55 pass, 0 fail, 116 expects |
| `bunx tsgo --noEmit` | 0 | clean |
| `bunx vite build --outDir /tmp/prelock-build` | 0 | clean build (output in /tmp only) |

## 2. Live Base44 browser QA (intercepted)
Method: Playwright against `https://homeinsulationvictoria.com.au/homeowner`. Every `functions/homeowner-check-v2` POST (`screen` and `sync`) was answered locally with fixture JSON; other non-GET requests fulfilled empty; analytics aborted. **No request was forwarded to production; no enquiry was created.** Address used: 30 Dash St, Fraser Rise VIC 3336. Widths 390 px and 1280 px.

Save contract observed in the page script: client computes a preliminary result locally (`not_suitable` / `review` / `assessment`) and shows it immediately; then `screen` (needs `screening` + `reference`), then `sync` up to 2 tries (`success`, `referral_share_url`). `submission_id` is generated once per form and reused on retry.

### Results
| Case | Badge | Reference | Referral card | Overflow-x | Notes |
|---|---|---|---|---|---|
| Clean likely, 150 m² (390/1280) | 0.07 s | 0.4 s | 0.95 s | 0 / 0 | PASS |
| Custom 175 m² (390) | 0.06 s | 0.4 s | 0.94 s | 0 | PASS |
| Garage/commercial (390/1280) | 0.07 s | 0.4 s | 0.94 s | 0 / 0 | Correct “Does not appear eligible” + reason heading “Why it doesn’t appear eligible” |
| Insulation present + previous VEU upgrade **Yes** (390/1280) | 0.09 s | 0.44 s | 1.0 s | 0 | **DEFECT D1** |
| Home age **No** (390) | 0.08 s | 0.45 s | 1.0 s | 0 | **DEFECT D1** |
| Save slow (8 s) — wait | instant | 8.2 s | yes | 0 | **D2** |
| Save slow — header “Back to home” | — | — | — | — | **D3**: navigates away, no warning |
| Save slow — reload / browser back | — | — | — | — | **D3**: answers lost, blank form |
| Save 500 → “Try saving again” | — | 10.6 s | 10.95 s | — | PASS: same submission id reused, one sync |
| Double-click submit | — | — | — | — | PASS: 1 screen, 1 sync POST |
| Sync fails twice (500) | — | 0.4 s | none | — | **D4** |
| Sync delayed 12 s | — | 0.4 s | not within 6 s | — | D4 (no progress cue) |

Fonts: Open Sans throughout; one “Back to home” link; no stray platform branding. Copy-link click was not verifiable headless (clipboard), no error shown.

## 3. Defects (not fixed — audit only)
- **D1 (High, Base44 client):** confirmed blockers are shown as “LIKELY ELIGIBLE — ONSITE CONFIRMATION NEEDED” plus “We’re preparing your personalised estimate”. Previous VEU ceiling upgrade = Yes and home age = No are pushed to “review”, not “not suitable”. Lovable Gate 1 hard-fails a confirmed previous Activity 48 upgrade, so the customer sees a contradicting promise.
- **D2 (High):** result + “Keep an eye on your inbox, we’ll email you…” appear before the save succeeds, and stay on screen when the save fails. With both email locks OFF, no email will be sent at all — the promise is currently untrue for every enquiry.
- **D3 (Medium):** while saving, header “Back to home”, reload and browser back lose the enquiry with no warning; “Check another property” is not disabled during save.
- **D4 (Medium):** when sync fails or is slow, the referral card never appears and nothing tells the customer; the “preparing your estimate” copy remains.
- **Carry-over source findings (still open, from repo review):** no unsubscribe link/route in customer emails; follow-up suppression/consent-expiry gaps; provider-accepted-but-DB-write-failed can retry a send; older active estimate links could become eligible for the pending-email scanner when locks turn on.

## 4. Blocked / not tested
Real inbox delivery (locks OFF by design), live Base44→Lovable round-trip (forbidden), quote domain DNS (network check out of scope this run), clipboard copy in headless browser.

## 5. Recommendation
**NO LOCK.** Automated checks are green, but D1 and D2 give customers wrong eligibility/email promises. Fix D1–D2 (and ideally D3–D4 and the unsubscribe gap), then re-run this audit.
