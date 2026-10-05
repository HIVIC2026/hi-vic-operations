> [!WARNING]
> **RETIRED BRANDING**: This document describes an outdated visual direction (Open Sans, blue hero, offset-shadow elements). Do not use as guidance for new development.

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
- **Carry-over source findings (from an earlier review; NOT re-checked in this run):** no unsubscribe link/route in customer emails; follow-up suppression/consent-expiry gaps; provider-accepted-but-DB-write-failed can retry a send; older active estimate links could become eligible for the pending-email scanner when locks turn on.

## 4. Blocked / not tested
Real inbox delivery (locks OFF by design), live Base44→Lovable round-trip (forbidden), quote domain DNS (network check out of scope this run), clipboard copy in headless browser.

## 5. Recommendation
**NO LOCK.** Automated checks are green, but D1 and D2 give customers wrong eligibility/email promises. Fix D1–D2 (and ideally D3–D4 and the unsubscribe gap), then re-run this audit.

---
## 6. Fix pass + re-run (2026-09-29, later)
### Fixed in the Lovable Operations Hub (item 5)
- Unsubscribe footer added to every customer email (estimate, follow-ups, ineligible); `/api/public/unsubscribe` (GET = confirm page only, POST = opt-out). Opt-out stores a `not_granted` contact consent and suppresses queued follow-ups.
- Suppression: opt-out, bounce/complaint/opted_out/payment_received/quote_declined/booking_completed events, QA/example recipients, closed or progressed stages, and backlog. Backlog cutoff `customer_delivery_settings.jobs_created_after` is NULL, so **no job is eligible** until an admin sets it at enablement; initial/ineligible emails also refuse jobs older than 14 days.
- Duplicates: provider success + DB failure → `delivered_unrecorded`, never retried; stale `sending` rows never auto-resend; follow-up rows re-read after claim.
- Enquiry webhook response now also returns `customer_email_enabled` (true only when comms lock ON + bridge configured + owner consent) so Base44 can decide whether to promise an email. Currently always false.
- Locks re-read: `customer_comms_enabled=false`, `customer_delivery_settings.enabled=false`, cutoff NULL.

### Checks
| Check | Result |
|---|---|
| `bun test ./tests/` | 502 pass, 0 fail (new `tests/email-safety.test.ts`) |
| `bun test ./qa/prelock` | 55 pass, 0 fail (6 former known-defect tests now pass normally) |
| `tsgo --noEmit` | exit 0 |
| `vite build --outDir /tmp/prelock-build2` | exit 0 |

### Live Base44 re-run (intercepted, 390×844 + 1280×900) — evidence `/mnt/documents/prelock-qa/rerun/`
| Case | Result |
|---|---|
| Likely eligible / custom 175 m² | PASS (reference ≤0.9 s, referral ≤1.1 s, no overflow) — but still promises email: FAIL D2 |
| Existing insulation (review) | shows “Likely eligible — onsite confirmation needed” (acceptable) + email promise: FAIL D2 |
| Previous VEU = Yes | FAIL D1 (shows likely-onsite + estimate) |
| Home age ≤5 yrs | FAIL D1 |
| Garage/commercial | PASS outcome; “We’ll email you this outcome”: FAIL D2 |
| Slow save / navigation during save | FAIL D3 (Back to home leaves, no prompt; Check another not disabled; reload/back lose answers) |
| Save failure → retry | PASS (same submission id) |
| Double submit | PASS (1 save) |
| Slow sync / sync failure | FAIL D4 (no progress or fallback; referral never shown) |

### Why D1–D4 remain
They live in the Base44 homeowner page code (client `QT()` preliminary check and result screen), which this project cannot edit. Base44 changes required:
1. `previous_upgrade==='yes'` or `property_over_five_years==='no'` → `not_suitable` (reason text), no estimate promise.
2. Show “we’ll email you” only when the save succeeded AND the sync response has `customer_email_enabled===true`; otherwise: “Your enquiry is saved (reference X). Our team will review it and contact you about the next step.”
3. While `screen` is in flight: disable “Check another property”, intercept header links, add `beforeunload` guard; clear on success/failure.
4. While `sync` runs show “Finishing up…”; after final failure show “Your result is saved — your share link will be available shortly” with a retry; render the referral card whenever `referral_share_url` arrives.

### Recommendation
Lovable side: gates pass. Overall journey: **NO LOCK** until the Base44 changes above ship and this re-run passes.
