## Onboarding attachment export: blocked as requested

### Result
I can't produce signed download links for the six onboarding files without breaking a rule you set. I haven't changed anything.

### Why
- The file-signing helper is server-only and needs the app's private file-link secret. Running it here means reading that secret directly, which this request forbids.
- The only existing Office actions that sign partner files are scoped:
  - The REC record view signs the insurance certificate of the REC application you open.
  - The partner file reader needs business membership and a recorded credential.
  - Neither signs an arbitrary list of paths, and invoking them outside a real signed-in Office request would get around their guards.
- A signed link works like a key: anyone who has it can download the file. Printing six of them in chat would expose private partner documents (insurance certificates, PIISA). Earlier rules ban this.

### Safe options (pick one)
1. **No code (recommended):** in the signed-in Office browser, open each application's existing record view and download from there. This covers the REC certificate (`rec-onboarding/43c35ace…`) and any installer certificate the current view shows.
2. **Small reviewed change:** add an Office-only "Download onboarding files" button on the existing application review screen. It would check admin on the server, read paths only from that application's stored record (never paths typed in by the client), and stream a private ZIP to the signed-in Office user. No links appear in chat, logs or audit. This needs build mode, tests and your review before publishing.

Before anything goes to Lorraine, please confirm she's allowed to receive other partners' insurance and PIISA documents. They contain third-party business details.

### Not done
No database writes, file links, bucket changes, emails or publication.
