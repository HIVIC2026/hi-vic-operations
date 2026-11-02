# Certificate of Electrical Safety can come later — design

Date: 3 Nov 2026 · Approved in chat by Jo (brainstorm, 3 Nov 2026)

## Why

Electricians in Victoria have up to 30 days to issue the Certificate of Electrical Safety (CoES). Many don't have it on the day of the electrical upgrades. Today the Mitti forms won't count the upgrades as done without it, so the electrician gets stuck and the job stalls.

## What Jo decided

1. The electrician finishes the Part C in Mitti without the certificate, then adds the certificate later.
2. The installer can still book the install while the certificate is outstanding. If it isn't in and checked, the 2pm and 6:30am emails say DON'T START.
3. Chasing: a reminder text to the electrician 2 business days after the upgrades are done. After 4 business days, the office gets a flag to call the electrician.

## How it works

### 1. Mitti forms (Jo changes these in the Mitti form editor)
- **A3 PIESA form, same-visit upgrades:** Q45 "Certificate of Electrical Safety (photo or PDF)" becomes optional.
- **A4 Electrical fixes form:** "Certificate of Electrical Safety number", "Date of certification" and "Certificate of Electrical Safety (photo or PDF)" become optional. Q9, the finished-work photo and the signature stay required.
- Help line under the certificate question on both forms: "Don't have it yet? Leave this blank — we'll text you a link to add it."
- The ChatGPT build prompts (`docs/MITTI_PIESA_*`, `docs/MITTI_FIXES_FORM_PROMPT.md`) and `fixes-day.core.ts` are updated so the drift test still passes.

### 2. Portal reads the form
- Upgrades done + Part C answered + no certificate = **the Part C counts as recorded**, and the job moves to a new state, "Waiting for certificate". It is NOT an office item on its own.
- PIESA evidence (`piesa-evidence.core.ts`): `ces_file` is no longer required to complete the form. Its absence sets "certificate to come" instead.
- The PIESA approval and the installer's PIESA pay are unchanged. They do not wait for the certificate.

### 3. Who sees it
- **Installer job page:** a status line, "Waiting for {electrician}'s Certificate of Electrical Safety".
- **Office job page and Active jobs:** the same line.
- **Electrician's text link:** next step = "Add your Certificate of Electrical Safety", with one photo/PDF upload and a certificate number and date. This reuses the existing portal "record fixes done" certificate upload path, so the certificate lands in the same place (`coes-check.server.ts`, source "portal").

### 4. When the certificate arrives
- The existing certificate check runs unchanged: the AI ticks it if it describes ceiling-space work, otherwise the office Ticks or Rejects (`coes-check`).
- The owner gets their certificate copy as now (`coes-owner-copy`).
- The "Waiting for certificate" status clears.

### 5. Install
- Install booking is not blocked.
- The existing install-day gate (`coesBlockerFor`) already blocks when there's no ticked certificate. The 2pm and 6:30am GO / DON'T START emails must show DON'T START with the reason "Certificate of Electrical Safety not in yet" (no file) or the existing "Check electrical certificate — {why}" (file not ticked).

### 6. Chasing
- Counted from the day the upgrades were recorded as done (Part C date), business days only, Victorian public holidays skipped.
- **2 business days, no certificate:** one text to the electrician with their job link: "Hi {first name}, we still need the Certificate of Electrical Safety for {address}. Add a photo here: {link}". It follows the 8pm–7am quiet hours. Jo approves the final wording before it goes live.
- **4 business days, no certificate:** office flag on Active jobs, "Certificate not in — call {electrician} ({phone})".
- Both stop as soon as a certificate file arrives.

## Not changing
- The 30-day install rule (from the PIESA date).
- Jobs with no upgrades. They need no Part C and no certificate.
- Who quotes and bills the upgrades (the installer/electrician, direct with the owner).

## Testing
- Unit: an A3 form with same-visit upgrades and no Q45 completes, giving "Waiting for certificate". An A4 form with no certificate fields completes the same way. With the certificate, the behaviour is the same as today.
- Unit: chase timing (2 and 4 business days, a weekend and a public holiday in between, and both stopping once the file arrives).
- Unit: the GO / DON'T START email reason when the certificate is missing versus not ticked.
- The fixes-day drift test still passes after the prompt and wording change.
- The TEST journey in the morning run covers "upgrades, certificate added later".
