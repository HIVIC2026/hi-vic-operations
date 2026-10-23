# Owner email cleanup — preview verification

- No publishing, email sends, manual copier runs, historical catch-up or database changes.
- Copier requests use `manual` redirects, refusing redirect responses rather than forwarding credentials. Read-only account/Inbox/Sent Items access passed.
- Live stored state read: last successful copier pass 23 Oct 2026 06:40 UTC (5:40 pm Melbourne), no stored error, zero pending processing records. Recovery/history columns exist. No further blocker identified; a post-publication copier pass has not been exercised.
- 47 email presentation/review/correspondence tests and 34 PGlite recovery tests passed.
- Authenticated Office phone check: 390×844, owner-grouped rows, latest plain message previews, suburb fallback, Open conversation and review controls, collapsed unmatched rows and Link to job expansion. No review or linking submissions were made.
- Two private image thumbnails loaded at their original dimensions; shared conversation also rendered on HV-1982's actual job history. Browser reported no page errors.
- Originals remain intact. Human replies to automated subjects remain visible; automated portal mail, recognised automatic replies, bounces, newsletters and marketing patterns are hidden. Unrecognised non-customer mail can still be dismissed using Not a customer.
- Evidence: `before-owner-emails.png`, `before-unmatched.png`, `after-owner-list-phone.png`, `after-conversation.png`, `after-photo-conversation.png`, `after-unmatched-row.png`, `after-link-to-job.png`, `after-job-history.png`, `copier-read-only-check.png`.
- Latest preview build: OK.