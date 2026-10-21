# Save My Spot reminder update — 21 October 2026

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