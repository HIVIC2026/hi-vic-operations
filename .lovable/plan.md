# Interim path: ReInsulate starts this week with his own leads

Plan only. No changes until "go". Preview first; nothing sent; payment gate stays off.

## Before anything: ReInsulate's business record
- His business must be **approved** in Partners, with his **commercial setup** entered (route = Home Insulation Victoria issues the full invoice). Without it, his jobs stop at payment ("Commercial setup required"). Office task, no build.
- His onsite worker(s) must be approved with **Full certification + expiry** recorded, or no assessment link can be issued. Office task, no build.

## 1. One-off office import of his lead list
**Exists today:** an installer-side import (paste text / one spreadsheet row / files → draft → confirm). Confirmed jobs are tagged permanently to his business as installer-supplied. Works in preview and live.
**Missing:**
- Only the installer's own team can confirm; office cannot import on his behalf.
- One row at a time; no whole-sheet import.
- Duplicate check is by owner email only, not by address.
- An area (m²) is required for every row; his list may lack some.

**Smallest safe build:**
- Office-only "Import for installer" panel on his Partners page: pick business, paste/upload the spreadsheet, see one table of rows (parsed with the existing pattern reader, no AI), fix gaps, tick "installer has the owner's permission to contact" (recorded who/when), then confirm.
- Each row goes through the same job-creation path as today, so tagging and audit are identical. Office is recorded as the confirmer, with a note "on behalf of ReInsulate".
- Duplicate check by cleaned address (and email): matches are shown and skipped, never merged automatically. Matches to an existing Home Insulation Victoria job go to office review (job source is permanent and won't be changed).
- Missing area allowed: job is flagged "area needed" instead of being refused.
- No owner messages created; nothing sent.
- Photos: attached to the job as files only; not counted as evidence (that's the full bulk-import build).

## 2. Tagged eligibility link
**Exists today:** the real eligibility form is the Base44 website, which sends signed enquiries in; they always become Home Insulation Victoria leads. The portal calculator at "/" only records interest, it does not create jobs.
**Missing:** any way to tag an enquiry to an installer.

**Two options (Jo to choose):**
- **A (recommended, no Base44 change):** a short portal page, e.g. `/check/<code>`, with his code in the link. Same eligibility questions as Base44 in tap form; creates or updates his installer-supplied job. Address matched first: if his job already exists at that address, the answers attach to it (no duplicate). If a Home Insulation Victoria job exists there, it goes to office review.
- **B:** Base44 passes his code through on the signed handoff. Needs a Base44 change; Step 1 is locked, so I would not do this without your say-so.

Either way: no consent or signatures on this link (they're signed at quote acceptance), no automatic messages, and his code can be switched off by the office.

## 3. Assessment link per job
**Exists today:** worker job links. Office or installer picks an approved, certified worker on the job and gets a secure link to the existing Ready Check / Mitti assessment form. Refused if the worker isn't approved or certified. Works today.
**Missing:** only the button wording. Change to exactly "Start assessment" (Ready Check form) and "Start install" (install form), which you already asked for.

## 4. Quote
**Exists today:** the installer-supplied quote is drafted **automatically from his priced Ready Check form** (installer price + PIESA $349 + AP fee $349 − discount, no markup, co-branded). Office reviews and sends. Owner accepts and signs consent + VEEC assignment as today.
**Missing:** office can't type his price straight in. If he quotes outside the form, nothing is drafted.

**Smallest safe build:** an office-only "Enter installer's price" box on the job: his total price inc GST (plus optional removal/extras lines with descriptions). It builds the same draft quote type, with the same PIESA, AP fee and discount lines and the same checks (no markup, PIESA and AP fee from the price settings). Reason + who/when recorded. The office "send" step and owner acceptance stay as they are. Existing quotes untouched.

## 5. Office notified on acceptance
**Exists today:** acceptance moves the job and it shows in the to-do list under "Open quote", so the office sees it, but with no specific alert.
**Smallest safe build:** on acceptance of an installer-supplied quote, add an office to-do "Customer accepted — [job]" and a queued (not sent) notice to the installer, matching your earlier co-brand/notify request.

## Edge cases
- Same address imported twice in the list → shown once, second flagged.
- Owner fills the tagged link before the import → import finds the job by address and skips it.
- Address already a Home Insulation Victoria lead → office decides; never retagged automatically.
- Already installed → office marks Not eligible (no VEEC possible).
- No email for an owner → row allowed, flagged "contact missing"; owner can't get quote links until added.

## Publishing
- Real customers and his installer only reach the **live** site, so parts 1–5 need publishing to work for real.
- Publishing pushes **everything** currently in preview, not just this: onboarding form fixes, capacity limits removed, the $30/m² fixed-price quotes and separate PIESA/AP lines, Prices & margins page, office profit card, AP approval queue, reminders/daily brief/Today page, Ready Check booking, cancellations/no-shows. Sending and payment gate stay off after publishing.
- Recommended: click-through test of the new pricing page and the whole ReInsulate path in preview first, then publish once.

## Effect on records / undo
- No existing records or quotes changed. Likely one small database addition (installer link code + switch on the business; maybe an "area needed" flag), proven on the practice database first.
- Undo: roll back in History; imported test jobs can be cancelled with a reason (kept for audit).

## Order
1. Office tasks (approve business, commercial setup, worker certification) — can start now.
2. Part 3 wording + Part 4 office price box (smallest, unblocks a quote).
3. Part 1 office import.
4. Part 5 acceptance notice.
5. Part 2 tagged link (after Jo picks A or B).
6. Browser test in preview, then publish.
