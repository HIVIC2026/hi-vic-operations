---
name: Owner action channels (email + SMS)
description: Which owner/trade messages go by email+SMS vs email only; 24h reminder rule
type: feature
---
- Owner must sign/act (forms to sign, quote approval, booking times to pick, payment links, anything before a deadline e.g. 30-day rule) -> BOTH email and SMS.
- SMS is short: one line + secure link to the same page as the email.
- Not acted within 24h -> ONE reminder by both channels.
- Trade job offers -> SMS and email.
- Pure information (estimates, receipts, updates) -> email only.
- Sending stays OFF for real people until Jo switches it on; test on dummy (qa_test) data only.
