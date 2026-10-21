# Customer SMS activation check — Jo 21 Oct 03:48 UTC

## Outcome
SMS remains **OFF**. No settings, messages, historic attempts, provider writes or publication changed.

## No-send evidence
- `workflow_settings.customer_comms_enabled = true`; `sms_message_switches = {}`; `daily_mitti_text_enabled = false`.
- Australian workspace connection “Joannah's Twilio (1)” reports AU1 and its IncomingPhoneNumbers GET returned HTTP 200. Number +61468098506 is in use and supports SMS. This proves account/number access, not outbound delivery.
- The linked older connection reports US1. Current app sender deliberately uses `api.sydney.au1.twilio.com` with direct `TWILIO_AU1_*` credentials (`src/lib/twilio-au1.server.ts`), not that connector.
- Configured-secret names do not include `TWILIO_AU1_ACCOUNT_SID`, `TWILIO_AU1_API_KEY_SID`, `TWILIO_AU1_API_KEY_SECRET`, or `TWILIO_FROM_NUMBER`. Sandbox presence checks also found each missing. No secret values read or output.
- Needed: add these four settings through Project Settings → Secrets using the existing Australian account/API key and its sending number. No substitute region, secret fabrication, provider credential copying or unrelated code publication attempted.

## Future types and history
If later verified/enabled, approved customer types are spot_saved (immediately upon first new spot save) and owner_code (when owner requests sign-in/signing verification). Booking confirmation wording remains unapproved/off; partner daily texts remain separately off. Consent, Australian mobile validity, STOP and test-record gates stay intact.

Unique `sms_messages.idempotency_key` prevents previously blocked rows from being resent for the same event. No replay was attempted. Current readback is 117 blocked attempts (60 global-off, 57 spot-saved-off), not a rewritten historical count of 116. Reminder SMS/email remain drafts. No automatic texts now send, because type switches remain disabled. Publication was not required or attempted in this read-only outcome; runtime readiness must be verified after credentials are configured before any activation.
## Repair — 21 Oct 03:55 UTC request
- Linked existing Australian AU1 connection with owner approval. Generated-app credential GET of IncomingPhoneNumbers returned HTTP 200 and confirmed the expected Australian sender supports SMS; no outbound request.
- Saved the verified sending-number setting. Replaced obsolete direct-AU1 credential path with the linked AU1 gateway connection; no older US1 fallback.
- Isolated network/routing tests 7 PASS; reserved TEST recipient refusal 1 PASS. No provider sends, historic retries or reminder sends.
- Live SMS type switches remain OFF. Publication required to install the sender repair before published-path verification and future-only activation. No publication attempted.
