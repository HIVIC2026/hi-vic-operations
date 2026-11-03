# Installers' own jobs, start to finish (Deep's first job) — design

Date: 3 Nov 2026 · Scope approved by Jo in chat ("get it done asap", one spec for all 5 parts)

## Why

Reinsulate (Deep) is ready to run his own jobs through the portal. The process Jo decided on 1–3 Nov isn't built yet: the live portal still uses the old flow, with 3-time offers, HIV upgrade quotes, 14-day quotes, no GO / DON'T START emails and the balance due 7 days after the install. This build makes an installer's own job run the way Jo decided, so Deep can start.

Every rule below is one Jo has already decided (dates in brackets). Nothing new is added.

## Who it applies to

- All installers' own jobs (installer-added), for every installer. Rule (2 Nov): new flow only, for ALL installers.
- HIV's own leads keep working. Where a part below also changes HIV leads, it says so.
- TEST jobs and the existing TEST safety blocks stay as they are.

---

## Part 1 — Trade messages on for one business

**Today:** `trade_messages_paused` holds every trade text and email. The per-business exception `businesses.messages_while_paused` only lets emails through. Every text checks the pause without the business id.

**Change:**
- Every trade sender (texts and emails) passes the job's business id to the pause check, so `messages_while_paused = true` lets that business's texts AND emails through. This covers the electrician's job link, SWMS links, install texts, the upgrades link, the certificate reminder, the Mitti links text and the GO / DON'T START emails.
- An electrician linked to an installer counts as that installer's business for this check (Peter → Reinsulate).
- Jo switches it on for Reinsulate only. Claude runs the database change, after asking her.

## Part 2 — The electrician calls and books the PIESA (1 Nov, 2 Nov)

**Today:** the electrician gets a login link, offers the owner 3 times, the owner picks one, and there are 24 hours to reply.

**Change, for installers' own jobs:**
- Who books the PIESA and the upgrades day is set per installer in My business: Our office / Our electrician / Either. New installers start on "Our office". Reinsulate = "Our electrician".
- Once the owner has paid the PIESA fee, the booker gets the job:
  - The electrician gets a **no-login text link** to their job.
  - The installer's office gets an **email**. Installer offices are emailed, never texted.
- The booker calls the owner, enters the day and time, and it is booked straight away. No owner tap and no code.
- The owner gets a "You're booked" text and email, with "Need to change it? Call {installer}" and the installer's office phone.
- They have **2 business days** to book, or the job goes back to the installer's office.
- A **"Can't do this one"** button (busy / owner not answering / other) sends it back to the installer.
- The electrician's link shows only the next step: book the PIESA → do it in Mitti → add the upgrades day if needed → add the certificate → done. Electricians never log in.
- The electrician can be changed until the PIESA is done. **The installer does it from the job page** (Jo, 3 Nov), picking from their onboarded electricians linked to them. The new electrician gets the text link and a fresh 2 business days. A swapped-out electrician gets one email. This replaces "only the office can change an installer's electrician".

### Part 2b — Installers add their own electricians (Jo, 3 Nov)

- **My business › My electricians** lists every electrician linked to the installer, showing each one's status (Waiting for approval / Approved / Expired).
- "Add an electrician": the installer boss enters:
  - name, email, mobile, REC number;
  - electrical licence: number, expiry and a photo;
  - public liability: certificate, cover amount (must be $5m or more) and expiry;
  - WorkCover: "Does this electrician employ anyone, including themselves through a company?" If Yes, the WorkCover certificate and expiry are required. If No, the installer ticks "Sole trader with no staff — no WorkCover needed". (Claude's advice, Jo agreed: this follows the Victorian rule — compulsory only when the business employs workers, including the owner through their own company.)
- That creates the electrician (business + person) as **waiting for approval**, linked to the installer. Our office checks the documents and approves. Then the electrician is linked to the installer and gets a welcome text. The electrician fills nothing in.
- If the same person is already approved with us (matching licence or email), they're simply linked — no re-upload.
- A missing or expired licence or insurance is a hard block, the same as for other electricians, until the office approves new documents.
- Approved, linked electricians can be picked at Add a job and in the swap on the job page.

## Part 3 — Upgrades billed by the electrician; certificate can come later (2 Nov, 3 Nov)

**Today:** the portal builds an HIV upgrades quote from the electrician's price on the PIESA form and sends it to the owner.

**Change, for ALL jobs (2 Nov: "electrical upgrades on every job are quoted, booked and invoiced by the installer/electrician directly with the owner"):**
- The portal does not build, send or invoice an upgrades quote, and adds no markup. HIV only needs the Part C and the Certificate of Electrical Safety before the install.
- If the upgrades aren't done on the PIESA day, the booker enters the upgrades day on the link. That makes the "A4 – Electrical fixes" Mitti form for that day.
- **No upgrades day entered** (Jo, 3 Nov). The PIESA says upgrades are needed, they aren't being done today, and no upgrades day has been entered:
  - After 1 business day, the electrician gets a reminder text with their link.
  - After 2 business days, the installer's office gets an email to sort it out.
  - If the 30-day install limit is getting close (7 days left), the office gets a red flag.
  - Entering a day stops all three.
- If the install is booked before the upgrades day, that's a warning, not a block. If the upgrades day passes with no form, there's a nudge and then an email to the office. It's a red flag if it would break the 30-day rule.
- The Mitti price questions for upgrades are deleted from the PIESA form (2 Nov). The portal must not need them.
- **Certificate can come later:** everything in `2026-11-03-certificate-later-design.md`, including the new PIESA wording ("Are electrical upgrades needed?" / "Are you doing the electrical upgrades today?").

## Part 4 — Owner messages on installers' own jobs (1 Nov, 2 Nov)

- **"You're booked"** (text + email) goes to the owner for every visit the installer or electrician books on their own jobs: Ready Check, PIESA, upgrades day and install. It includes "Need to change it? Call {installer} on {office phone}". Add a job's "The owner isn't messaged" note goes.
- **Quotes are valid for 30 days** on every job (replaces 14 days). The wording on the quote email, the quote page and the reminders is "Your quote is valid for 30 days, until {date}".
- **The installer's logo** shows on the owner's quote page and quote email for installers' own customers only (30 Oct, 2 Nov). Not on the agreement.

## Part 5 — The install (1 Nov, 2 Nov)

- When the job is clear (PIESA done, plus Part C and a checked certificate if there were upgrades), the owner gets one **"You're clear to install"** email. It opens one page to confirm the PIESA, sign the ESC consent and pay the 10% deposit. This applies to every installer, not just in-house ones.
- **The installer's office calls the owner and books the install day.** It is booked straight away and the owner gets "You're booked". The day must be within 30 days of the PIESA date; anything later is refused with that reason. The office picks the Lead Installer (ESC-registered only) and the crew. The Lead Installer and day lock 2 days before the install. There's no 3-day offer.
- **GO / DON'T START email** to the installer's office at 2pm the day before and again at 6:30am. GO only when every pre-start check passes: ESC consent signed, PIESA done and approved, Part C recorded and the certificate checked (when upgrades were needed), Lead Installer set and ESC-registered, SWMS signed, installer insurance and licence in date, install day inside the 30-day limit. Otherwise it says DON'T START and lists the reasons, and a copy of the DON'T START goes to info@.
- **Deposit first** (Jo, 3 Nov): the installer is only told to book the install once the owner has paid the 10% deposit, so no booked install can have an unpaid deposit and the DON'T START list has no deposit reason.
- **Office override** (Jo, 3 Nov): a "Release without deposit" button on the office job page (office only, with a reason). The installer is then told to book as if the deposit were paid; the owner's install-day payment becomes the full amount; the owner's deposit request is withdrawn; the GO email notes "Released without deposit — owner pays the full amount on the day".
- **The balance (90%) is due on install day** (replaces 7 days after), by card or bank transfer, with reminders and then overdue. The customer agreement wording follows.
- **Installer pay:** own jobs, once the owner has paid in full. HIV leads, 7 days after the paperwork is approved. No pay without the green light.

---

## Not changing

- Add a job fields, Ready Check booking by the installer, the Mitti Ready Check form, and the installer's own price that locks once sent.
- The PIESA fee: own jobs = the installer's own PIESA price (Reinsulate $349), all of it paid to the installer once the office approves the PIESA. HIV leads = $349, with $275 to the installer.
- The SWMS no-login links, the Mitti install form and the ESC robot. The robot is switched on separately by Jo.
- Owner messages on HIV's own leads, except the 30-day quote, upgrades billing and install-day balance noted above.

## Wording

All new owner and trade wording is shown to Jo one message at a time and approved before it goes live (1 Nov). Always write "Home Insulation Victoria" and "Lead Installer" in full, use "electrical upgrades" (never "fixes"), and never write "You pay about".

## Testing

- Each part has unit tests for its rules: the pause with a business id, the 2-business-day return, the 30-day install limit, the 30-day quote date, GO versus DON'T START reasons, and the install-day balance date.
- The morning TEST journey gets an "installer's own job, own electrician, upgrades another day, certificate later" run.
- Before Deep starts, Claude runs one TEST job through all five parts and shows Jo the results.

## Build order

Parts 1 → 2 → 3 → 4 → 5, each its own pull request so it can be checked and merged on its own. Jo chooses who merges.
