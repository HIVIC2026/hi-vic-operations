# Save My Spot reminder update — 21 October 2026

## Reminder offer-time correction — Jo 05:20 UTC (current result)
Reminder catch-up and automatic selection now accept stored offer records or office_enquiry_index.latest_attempt_at for spot_offered=true, without exact sent-email URL matching. Existing sent/offer record timestamp takes precedence; attempt is the fallback. Current own estimate/link, all exclusions, 24h/activation boundaries, copy and prices remain unchanged.

Actual protected TEST Office dry run at `/admin/save-spot-reminder-blast`, 1280x1800, 05:21 UTC: **246 recipients / 156 skipped**. No missing offered-URL/time skips remain; this change does not increase the latest 246 result because the own-link correction had already included those eligible records. Skips: 106 saved; 33 under 24h; 6 TEST; 2 no current contact consent; 3 cancelled; 5 duplicate phones; 1 current eligibility/estimate office review. The two existing withdrawal/consent blocks remain untouched. No writes, link redemption, sends, switch activation, migration or publication. Live reminder SMS count remains zero.

Focused actual-handler tests **6 PASS** (including stored-attempt-only inclusion and under-24h exclusion); existing reminder/automatic/settings/sender/one-tap suites **43 PASS**. Latest preview build OK. Actual DOM count and skips retained in `/tmp/browser/reminder-links/`; private personal links not reproduced in reports.

No real texts, publication, pricing/copy changes elsewhere, schema migration or unrelated switch changes.

## Implemented
- Personal authenticated-encrypted expiring save-only credential in URL fragment. Opening browser performs POST through canonical Save My Spot; success goes to unchanged campaign Result. Plain GET/HEAD never saves. Current consent, link expiry, deletion and eligibility checks retained; no new signature/authority implied.
- Reminder-only audited switch in existing SMS settings JSON, default false. Conditional compare-and-save retains every other key. Activation timestamp excludes earlier offers from automatic audience; catch-up deliberately separate.
- Actual stored sent offer >=24 hours; not enquiry-created time. Existing sent provider communication/active offered link and current estimate required; exclusions, opt-outs and phone dedup retained. Same SMS type/per-job key/phone primary-key claim across manual and scheduled sends. No retry after uncertain provider result.
- Managed authenticated hourly callback `/api/public/save-spot-reminders`, schedule `home-insulation-spot-reminders`, body `{kind:"automatic"}`. Short callback acknowledges and delegates through existing request lifecycle. At most 10 messages per tick; higher pending volume can delay beyond next hourly run. Off returns without sending. Unauthenticated probe 401.

## Actual dry run
119 recipients / 283 skipped / five fully filled messages. Zero save_spot_reminder sms_messages rows. Reminder switch OFF, Send disabled before explicit confirmation. No provider calls.

Skips: 106 saved; 35 under 24h; 6 TEST; 5 missing/expired/revoked active offered links; 2 no current contact consent; 121 exact offered URL missing from sent email; 3 cancelled; 5 duplicate phone. No invented links from unverified offer history or prices.

Samples shown only within protected admin preview; private secure URLs not copied into this report.

## Verification boundaries
Practice database covers actual reminder-setting handler preserving other SMS keys/audit, existing SMS primary-key/job uniqueness, campaign response persistence. One-tap wrapper tests call stubbed canonical save with PGlite response insert; canonical save guards themselves are reused, not changed. Tampering, wrong key, expiry, duplicate redemption, current refusal/deletion, 24h boundary and switch OFF tested. Browser one-tap navigation and unchanged Result verified with intercepted isolated POST responses on desktop/390x844; this is NOT a live owner mutation end-to-end proof. Real recipient one-tap links intentionally not opened.

Actual protected dry-run desktop/phone: no page errors/overflow; reminder OFF and send confirmation disabled. Existing SMS regressions run. Automatic live sends and published callback remain unverified until release. Latest automatic preview compilation build OK.

## Release
1. Publish these changes (not performed here).
2. Confirm published callback/one-tap path and Australian sender readiness with an isolated reserved TEST fixture, no provider send.
3. Jo enables only "24-hour Save My Spot reminder" at `/admin/save-spot-reminder-blast`; other SMS switches remain OFF. Automatic audience is offers sent after this activation, due after 24h; hourly check introduces up to ~60min plus ~30sec scheduler spread under normal batch volume. It is not exact-second delivery.
4. Catch-up: rerun Dry run after publication, review skips/samples, then separately authorize/send by typing `SEND SAVE SPOT REMINDER BLAST` and pressing Send reminders. Never done here; automatic enable does not send catch-up.

Basic link fetch/scanning cannot save; a scanner executing JavaScript can still imitate opening the link. Literal zero-step activation cannot prove a human tap. One-tap links are longer than the prior estimate links and may use multiple billed SMS segments.

## Recipient-link correction — Jo 05:14 UTC

Reminder URLs now use the newest usable own `customer_estimate_links` record; provider-linked sent email content is no longer required for the URL. Actual sent-offer timestamps remain required for the unchanged 24-hour rule. One-tap wrapper, canonical save checks, prices, exact message, consent, exclusions, phone/job claims and switches unchanged.

Actual protected Office Dry run at 05:17 UTC: **246 recipients / 156 skipped**. Browser screenshot verified, automatic switch OFF. Live SELECT found **402 offered records / 402 with active unexpired own quote links**; zero offered records lack a working own link. The previously referenced stale email-linked records no longer constrain selection. Consequently no link renewal, estimate refresh, database write or migration was necessary or performed. No actual recipient link was opened/redeemed. Zero reminder SMS records after run.

Skips: 106 already saved; 33 offers under 24 hours old; 6 TEST; 2 no consent (HV-2517, HV-1995); 3 cancelled; 5 duplicate phones; 1 current canonical Save My Spot eligibility/estimate office review (HV-2291). No missing-provider-URL or expired/missing-own-link skips remain. 246 is the measured result, not the suggested approximate 265; guards were not changed to force a target.

Focused actual-handler tests: 4 PASS, including own link without linked email and unchanged no-consent exclusion, zero writes/sends. Selection/automatic/idempotency/one-tap suites: 38 PASS including practice-database claim uniqueness. Latest preview build OK. Full skipped job IDs/reasons retained from actual DOM in `/tmp/browser/reminder-links/skips.json`; two sample prices: HV-2779 Liu $2,718 / $980, HV-2773 Hadi $4,738 / $1,960. Private one-tap credentials remain only in protected preview, not copied into this report. No texts, provider calls, switch changes or publication.