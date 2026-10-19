# P1-R2-S01B — All Email Templates for Review (customer-readable)

**Project:** Home Insulation Victoria · **Phase 1 / Round 2 / Step S01B** · For **Jet's consolidated review**
**Source:** Developer Brief V3 (Joannah Lowe, 9 Oct 2026) + existing approved wording. Documentation only — **no emails sent, no production code changed**.

> **How to read this document.** Each template has two clearly separated parts:
> - **📧 THE EMAIL** — the actual customer-facing wording. Jet can read this exactly as a homeowner would. `{{curly braces}}` are automatically filled per job.
> - **⚙️ IMPLEMENTATION NOTES** — technical/automation detail (trigger, variables, gates, readiness). Jet does **not** need to read these to approve the wording.
>
> **Brand & style (brief §2, §4.3):** full name **Home Insulation Victoria**, calculator branding, white background, crisp logo, clean type, refined tick icons, readable pricing, **one** primary button, mobile-friendly. The retired blue-hero / Open Sans style is **not** used. **No phone number and no "call us"** anywhere — owners **message** instead (brief §2 "No phone calls"). Placeholders like **`[PLACEHOLDER: …]`** mark official/legal wording that must come from a verified source — none is invented.
>
> **Never implied anywhere below:** a guaranteed rebate, reserved crew, fixed discount, or an installation date before it is real; and **Save My Spot is never called a booking**.

---

# TEMPLATE 1 — Insulation / Evidence Request

**A. Template name:** `insulation_evidence_request` (S01A row 3; renderer `renderInsulationVideoEmail`, currently DRAFT)
**B. Business purpose:** When preliminary checks show existing insulation is "Yes" or "Unsure", give the owner **simple, safe options** to confirm the situation so we can keep their enquiry moving — without a site visit yet (brief §4.3 "Existing insulation or unsure").
**C. Trigger & recipient:** Enquiry outcome = existing-insulation/unsure → **owner**. Sent once; if media already arrived with the enquiry, **this email is not sent / the media request is skipped**.
**D. Subject line:** `A quick next step for your insulation enquiry`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Thanks for your enquiry about ceiling insulation at **{{property_address}}**. Based on what you've told us, it looks like there may already be some insulation in your ceiling — so we just need a little more detail before we can prepare your estimate.
>
> You can choose whichever of these is easiest for you:
>
> ✓ **Confirm it's loose-fill only** — if the existing insulation is loose-fill (not batts), let us know and we can continue your estimate.
> ✓ **Confirm it's less than R2** — if you already know the existing insulation is below R2, tell us and we'll continue.
> ✓ **Upload a few photos** — a couple of clear photos of the ceiling space help our team check what's there.
> ✓ **Send a short video from the manhole** — if it's safe and easy to reach, a quick video taken **from the manhole opening** is really helpful.
>
> **A note on safety:** please only take photos or a video if you can do so safely from the manhole or ladder. **There's no need to enter or walk in the roof space** — never do that.
>
> If you choose "loose-fill only" or "less than R2", we'll move you straight to the next step. If you send photos or a video, our team will review them and get back to you.
>
> One more thing: if any existing insulation needs to be removed, that's **quoted separately** — we'll explain it clearly before anything is agreed.
>
> **[ Send my insulation details → ]**
>
> Prefer to tell us in writing? Just reply to this message.
>
> Home Insulation Victoria

**F. CTA button text / destination:** `Send my insulation details →` → secure per-property evidence page `{{evidence_url}}` (the `/video` + upload page).
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{evidence_url}}`.
**H. Existing approved wording reused:** subject line and the "Send my insulation details" CTA are reused from the current DRAFT renderer (`estimate-email.ts` insulation/video variant); calculator theme reused.
**I. Newly drafted wording:** the four explicit options and the "from the manhole / do not enter the roof space" safety note (expanded to match brief §4.3's four options and preserve safe-access wording).
**J. Unresolved business decisions:** confirm whether "loose-fill only" and "<R2" self-confirmations should auto-advance to Save My Spot without office review (brief §4.3 says they go to Save My Spot, still preliminary).

### ⚙️ IMPLEMENTATION NOTES
- **Trigger event:** outcome classification `insulation_check` (existing insulation Yes/Unsure).
- **Prerequisites:** usable contact details + consent; media **not** already supplied (brief: "If media came with the enquiry, don't ask for it again").
- **Variable sources:** name/address from enquiry; `evidence_url` = secure per-property link.
- **Workflow gate:** "loose-fill only" / "<R2" → **Save My Spot (still preliminary)**; photos/video → **office review** (brief §4.3).
- **Existing renderer / key:** `renderInsulationVideoEmail` (DRAFT); catalog alignment TBD.
- **Auto-send mechanism:** intended automatic on outcome; **send path currently locked** ("No manual send path yet") — wiring is S02.
- **Duplicate-prevention:** send **once per outcome**; skip if media already present.
- **Failure/retry:** failed send → office task; enquiry never lost (brief §4.3).
- **Status:** renderer DRAFT (needs Jo approval). **Integration gap:** not wired to a send path.

---

# TEMPLATE 2 — Ready Check: Choose Your Times

**A. Template name:** `ready_check_choose_times` (S01A row 10; renderer `renderRcTimesEmail`, DRAFT)
**B. Business purpose:** Invite the owner to book their **free Ready Check** (onsite measure-up & eligibility check) by choosing times that suit them (brief §2 "Ready Check booking", §4.6).
**C. Trigger & recipient:** Capacity released for the owner's saved spot, or an installer asks the office to arrange a Ready Check → **owner**.
**D. Subject line:** `{{installer_business}} — choose a time for your free Ready Check`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Good news — we're ready to arrange your **free Ready Check** at **{{property_address}}**.
>
> The Ready Check is a quick onsite visit where an approved installer measures your ceiling and confirms the details, so we can prepare your confirmed quote. **It's completely free, with no obligation.**
>
> Please choose **3 times** that suit you, and {{installer_business}} will confirm one of them.
>
> **[ Choose my times → ]**
>
> A few things to know:
> ✓ The measured area from this visit is what your final quote is based on.
> ✓ A separate electrical safety check happens later — we'll explain that step when we get there.
> ✓ This visit doesn't commit you to anything.
>
> Kind regards,
> Home Insulation Victoria

**F. CTA button text / destination:** `Choose my times →` → secure scheduling page `{{times_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{installer_business}}`, `{{times_url}}`.
**H. Existing approved wording reused:** "Choose my times" CTA, "{{installer_business}} — choose a time for your free Ready Check" subject, and "free Home Insulation Ready Check" framing from `installer-ready-check.core.ts`.
**I. Newly drafted wording:** the three "a few things to know" ticks (measured area drives the quote; separate electrical check later; no commitment) from brief §4.4/§4.6/§4.8.
**J. Unresolved business decisions — ⚠️ CONFLICT:** current live wording says **"choose 3 to 5 times"**; Brief V3 §2/§4.6 say the owner **"picks 3 times."** This draft uses **3 times** to match the brief — **Jo/Jet to confirm 3 vs 3–5 before activation.**

### ⚙️ IMPLEMENTATION NOTES
- **Trigger event:** capacity release / office-arranged Ready Check (brief §4.4 "On release, the Ready Check invitation goes out").
- **Prerequisites:** saved spot or office request; suitable approved installer in coverage.
- **Variable sources:** `installer_business` from installer profile; `times_url` secure link.
- **Workflow gate:** owner picks times → offer to installers → accepted installer picks one → **Booked** (brief §4.6).
- **Existing renderer / key:** `renderRcTimesEmail`; office-triggered via `installer-ready-check.server.ts`.
- **Auto-send mechanism:** office/automatic on capacity release.
- **Duplicate-prevention:** one invitation per release; reminders at 24h (installer) / 48h office alert are a separate reminder flow (brief §4.6).
- **Failure/retry:** no suitable trade / failed form prep → office (brief §13).
- **Status:** DRAFT ("Jo to approve"). **Integration gap:** 3-vs-5 wording conflict; confirm before send.

---

# TEMPLATE 3 — Measured Quote

**A. Template name:** `measured_quote` (S01A row 11; catalog slot, **no renderer — MISSING**)
**B. Business purpose:** After the Ready Check, send the owner their **confirmed, measured quote** with the real price, VEU discount and what's included/excluded, and let them accept (brief §4.8).
**C. Trigger & recipient:** Ready Check validated → **owner** (automatic; brief §13 "Ready Check validated → calculate measured quote and send it automatically").
**D. Subject line:** `Your confirmed Home Insulation Victoria quote`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Thanks for having your free Ready Check done. We've now measured your ceiling and prepared your **confirmed quote** for **{{property_address}}**.
>
> **Measured ceiling area:** {{measured_m2}} m²
>
> {{#if area_changed_over_15pct}}
> *Please note: the measured area is different from the earlier estimate, so your quote has been updated to reflect the actual area measured onsite.*
> {{/if}}
>
> **Your quote**
> | | |
> |---|---:|
> | Electrical safety check (PIESA) | {{piesa_fee}} |
> | R5.0 ceiling insulation — supply & install | {{supply_install}} |
> | Home Insulation Victoria management | {{ap_fee}} |
> | VEU discount ({{veec_count}} × $70) | −{{veu_discount}} |
> | **Total (inc GST)** | **{{total_inc_gst}}** |
>
> **What this includes**
> ✓ Supply and installation of R5.0 ceiling insulation for the measured area
> ✓ Your electrical safety check (PIESA)
> ✓ Your VEU discount, already applied above
>
> **What's not included**
> ✓ Electrical rectification — **not yet assessed** (only known after the safety check)
> ✓ Removal of existing insulation (quoted separately if needed)
> ✓ Unusual access or other extras
>
> **Next steps:** when you accept, you'll choose **3 times** for your electrical safety check and we'll send the safety-check payment request. **[PLACEHOLDER: refund/cancellation terms for the safety-check fee — insert approved wording.]**
>
> **[ Accept quote → ]**
>
> Want to explore a different area? There's a calculator link on your quote page — it won't change this quote.
>
> Home Insulation Victoria

**F. CTA button text / destination:** `Accept quote →` → secure per-property quote page `{{quote_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{measured_m2}}`, `{{area_changed_over_15pct}}`, `{{piesa_fee}}`, `{{supply_install}}`, `{{ap_fee}}`, `{{veec_count}}`, `{{veu_discount}}`, `{{total_inc_gst}}`, `{{quote_url}}`.
**H. Existing approved wording reused:** "What this includes" tick block, VEU discount "× $70" format, and the calculator-explore line — all reused from the approved estimate theme.
**I. Newly drafted wording:** confirmed-quote framing; the brief's line order (PIESA; R5.0 supply & install; AP management; VEU discount); the >15% area-change note (verbatim intent from §2); the "electrical rectification not yet assessed" exclusion (§4.8).
**J. Unresolved business decisions:** safety-check fee **refund/cancellation** wording is a `[PLACEHOLDER]` (brief §2: confirm against approved terms + consumer rights); do **not** switch on automatic sending until quotes are **100% correct** (brief §2).

### ⚙️ IMPLEMENTATION NOTES
- **Trigger event:** "Ready Check validated" (brief §13).
- **Prerequisites:** measurements accepted; eligibility evidence sufficient; contradictions resolved (brief §4.6 gate).
- **Variable sources:** area/route/rates/rounding stored at calculation (§4.8); fees from business-rules table (§2: AP $349, PIESA $349, VEU $70/VEEC).
- **Workflow gate:** measured-quote gate — accepted area & scope, adequate eligibility evidence, approved rates, minimum-contribution calc (brief §14).
- **Existing renderer / key:** catalog key `measured_quote`; **no renderer** — content via DB template lifecycle.
- **Auto-send mechanism:** automatic after validation; **blocked** by "switch on only once tested quotes are 100% correct" (§2).
- **Duplicate-prevention:** one quote record; accepted versions immutable (brief §13 "distinct records").
- **Failure/retry:** contradictions/exceptional scope → office review (§13).
- **Status:** **MISSING** (no rendered body). **Integration gap:** renderer/DB content to be authored; refund placeholder; >15% conditional.

---

# TEMPLATE 4 — Booking Confirmation + Consent (install booked)

**A. Template name:** `booking_consent` (S01A row 12; catalog slot, **MISSING**)
**B. Business purpose:** Confirm the booked installation, tell the owner how to prepare, request the balance, and collect the consents due at this stage (brief §4.11).
**C. Trigger & recipient:** Install date confirmed → **owner** (brief §13 "Install date confirmed → request balance payment, schedule notices, create forms").
**D. Subject line:** `Your insulation install is booked — {{install_date}}`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Great news — your ceiling insulation install at **{{property_address}}** is booked for:
>
> **📅 {{install_date}} at {{install_time}}**
>
> **How to prepare**
> ✓ Please make sure the ceiling manhole/access point is clear.
> ✓ Your installer is **{{installer_business}}**; you'll see each other's contact details for this visit.
> ✓ {{#if life_support}}We've noted life-support equipment at the property and will plan around it — please keep your plan in place.{{/if}}
>
> **Power on the day:** there may be a short power interruption during the work. We'll keep it to a minimum and let you know on the day.
>
> **Payment:** to confirm the booking, we're requesting the first **50%** of your balance now; the remaining **50%** is due on install day. (If you've chosen to pay in full, there's nothing more to do.)
>
> **[ View booking & pay balance → ]**
>
> **Consents:** **[PLACEHOLDER: owner consent wording required at install booking — insert approved text once the required consent and its deadline are confirmed.]** We'll also arrange the required electrical-safety notice before your install.
>
> Need to change the date? Message us and we'll help.
>
> Home Insulation Victoria

**F. CTA button text / destination:** `View booking & pay balance →` → secure booking page `{{booking_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{install_date}}`, `{{install_time}}`, `{{installer_business}}`, `{{life_support}}`, `{{booking_url}}`.
**H. Existing approved wording reused:** calculator theme; "message us" contact model (no phone).
**I. Newly drafted wording:** booking confirmation, prepare checklist, power-interruption note, 50/50 payment wording (brief §2 schedule, §4.11).
**J. Unresolved business decisions:** owner-consent text and its **deadline** are a `[PLACEHOLDER]` (brief §3/§5: separate owner-consent deadline to be verified). ESC notice is **office/system-submitted**, not signed by the owner in this email.

> **Why this is separate from Template 5:** the **ESC pre-installation notice** and the **PIESA copy delivery** are **legally timed** (PIESA copies to owner ≥24h before install — brief §3/§5). This booking email is sent when the date is set; the ≥24h PIESA copy is a **distinct, later** send (Template 5). Bundling them risks delivering the ≥24h document at the wrong time.

### ⚙️ IMPLEMENTATION NOTES
- **Trigger:** install date confirmed (brief §13).
- **Prerequisites:** electrically cleared (or rectification booked); payment arrangement set.
- **Variables:** dates/installer from job; `booking_url` secure link.
- **Gate:** installation-start gate is **not** released by this email — start is blocked until the server confirms documents, notices, deadlines, staff, payment, onsite PIISA (brief §4.11/§14).
- **Key:** `booking_consent`; **no renderer**.
- **Auto-send:** automatic on booking; office-confirmed where ESC integration absent.
- **Duplicate-prevention:** reschedule re-issues notices and cancels old reminders (brief §4.11).
- **Status:** **MISSING.** **Gap:** consent wording + deadline placeholder; ESC window placeholder.

---

# TEMPLATE 5 — Pre-Installation Pack (your safety-check copy, ≥24h before install)

**A. Template name:** `pre_install_pack` (S01A row 13; catalog slot, **MISSING**)
**B. Business purpose:** Deliver the owner their **signed electrical safety check (PIESA) copy** and final pre-install information at least **24 hours before** the install, as required (brief §3/§5 "copies to owner and installer 24h+ before install").
**C. Trigger & recipient:** PIESA complete & cleared, ≥24h before install → **owner** (separate legally-timed delivery).
**D. Subject line:** `Your electrical safety check & install details`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Your install at **{{property_address}}** is coming up on **{{install_date}}**. Here's everything you need beforehand.
>
> ✓ **Your electrical safety check (PIESA)** — attached / available to download. This confirms the electrical safety assessment for your property.
> ✓ **What to expect on the day** — your installer will arrive within the agreed window, complete an onsite safety check before any work, and keep any power interruption to a minimum.
> ✓ {{#if life_support}}**Life support** — we've planned around the equipment you told us about.{{/if}}
>
> **[ View my documents → ]**
>
> If anything changes before your install, message us and we'll sort it out.
>
> Home Insulation Victoria

**F. CTA button text / destination:** `View my documents →` → secure document page `{{documents_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{install_date}}`, `{{life_support}}`, `{{documents_url}}`.
**H. Existing approved wording reused:** calculator theme; message-us contact model.
**I. Newly drafted wording:** PIESA-copy delivery, pre-install summary (brief §4.9/§4.11/§4.12).
**J. Unresolved business decisions:** exact **≥24h** delivery deadline must be enforced from the verified rule (brief §3 "at least 24 hours before work"); confirm whether the PIESA PDF is attached or linked.

### ⚙️ IMPLEMENTATION NOTES
- **Trigger:** PIESA cleared; scheduled to land **≥24h before** install (brief §5).
- **Prerequisites:** valid signed PIESA; install date set.
- **Gate:** this delivery is itself a pre-start requirement — a missed ≥24h window **blocks** install start (brief §14 install-start gate).
- **Key:** `pre_install_pack`; **no renderer**.
- **Auto-send:** automatic, deadline-driven; alert office before the deadline is missed (brief §5).
- **Duplicate-prevention:** reschedule reissues the copy and cancels old reminders.
- **Status:** **MISSING.** **Gap:** exact window + attach-vs-link decision.

---

# TEMPLATE 6 — VEEC Assignment & Signing (after install)

**A. Template name:** `assignment_signing` (S01A row 14; catalog slot, **MISSING**)
**B. Business purpose:** After installation and AP review, ask the owner to sign the **VEEC assignment and required declarations** in the correct official order (brief §2, §4.13).
**C. Trigger & recipient:** AP evidence approved → **owner** (brief §13 "AP evidence approved → request signatures in order"). **Post-install only.**
**D. Subject line:** `One last step — sign your insulation documents`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Your ceiling insulation at **{{property_address}}** has been installed and reviewed — thank you! There's **one last step** to finalise everything.
>
> Please review and sign your documents:
>
> ✓ **VEEC assignment form** — this assigns the Victorian Energy Efficiency Certificates created by your upgrade.
> ✓ **[PLACEHOLDER: required owner declaration(s) — insert the official declaration wording and the verified signing order.]**
>
> **[ Review & sign → ]**
>
> These are based on the actual completed installation. Once signed, we'll finalise your certificates and send your completion pack.
>
> Home Insulation Victoria

**F. CTA button text / destination:** `Review & sign →` → secure e-signature page `{{signing_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{signing_url}}`.
**H. Existing approved wording reused:** calculator theme; message-us contact model.
**I. Newly drafted wording:** "one last step" framing; plain explanation of VEEC assignment (brief §4.13).
**J. Unresolved business decisions — ⚠️ LEGAL:** the **declaration wording** and the **signing order** are `[PLACEHOLDER]` and a **launch blocker** (brief §3: "Verify the timing and signing order… Quote acceptance must not sign a declaration about installation facts that have not yet occurred"). This email must **never** be sent at quote acceptance.

### ⚙️ IMPLEMENTATION NOTES
- **Trigger:** AP evidence approved (brief §13).
- **Prerequisites:** installation complete; AP review accepted; facts match scope (brief §4.13/§14).
- **Gate:** lodgement gate needs authorised AP approval + valid assignment & declarations (brief §14).
- **Key:** `assignment_signing`; **no renderer**.
- **Auto-send:** automatic, in signing order; remind signers; supersede/reissue if facts change (brief §4.13).
- **Status:** **MISSING.** **Gap:** official declaration wording + signing order (launch blocker).

---

# TEMPLATE 7 — Completion Pack

**A. Template name:** `completion_pack` (S01A row 15; catalog slot, **MISSING**)
**B. Business purpose:** After the certificates are registered, send the owner their full **completion pack** and confirm the job is done (brief §4.13 "Completion pack for the owner"; §5 "Owner completion pack — Closeout").
**C. Trigger & recipient:** Registry outcome recorded → **owner** (brief §13 "Registry outcome recorded → approved completion communication").
**D. Subject line:** `All done! Your insulation completion pack`

### 📧 THE EMAIL

> **Home Insulation Victoria**
>
> Hi {{first_name}},
>
> Your ceiling insulation upgrade at **{{property_address}}** is **complete** — thank you for choosing Home Insulation Victoria. 🎉
>
> Here's your completion pack, all in one place:
>
> ✓ **Completion documents** for your records
> ✓ **Invoice & payment summary**
> ✓ **VEEC assignment form** (signed copy)
> ✓ **Certificate of Electrical Safety (CoES)** {{#if coes}}— included{{/if}}
> ✓ **Warranty** and **manufacturer instructions**
> ✓ **Dispute-resolution information** — how to raise any concern
>
> **[ View my completion pack → ]**
>
> If you ever have a question about your upgrade, just message us — our team is here to help.
>
> **[PLACEHOLDER: AP contact details as required by the VEU Code of Conduct — insert the verified approved contact block.]**
>
> Home Insulation Victoria

**F. CTA button text / destination:** `View my completion pack →` → secure documents page `{{completion_url}}`.
**G. Dynamic variables:** `{{first_name}}`, `{{property_address}}`, `{{coes}}`, `{{completion_url}}`.
**H. Existing approved wording reused:** calculator theme; message-us contact model.
**I. Newly drafted wording:** completion confirmation; the pack checklist (verbatim items from brief §4.13).
**J. Unresolved business decisions:** **AP contact details block** is a `[PLACEHOLDER]` — brief §3 flags "whether the VEU Code of Conduct accepts AP contact details without a phone number"; use verified wording, not invented contact info.

### ⚙️ IMPLEMENTATION NOTES
- **Trigger:** registry outcome recorded; **"uploaded is not registered"** (brief §4.13) — only on **Registered/Finalised**.
- **Prerequisites:** lodgement reference, certificate count, outcome recorded; owner records provided; accounts reconciled (brief §14 finalisation gate).
- **Key:** `completion_pack`; **no renderer**.
- **Auto-send:** automatic on finalisation (approved completion communication).
- **Duplicate-prevention:** one completion send per job; registry queries create a task, not a resend.
- **Status:** **MISSING.** **Gap:** AP contact-details placeholder; CoES conditional.

---

## Consolidated review checklist (for Jet)

| # | Template | Status | Needs decision? |
|---|---|---|---|
| 1 | Insulation / Evidence request | DRAFT completed | Loose-fill/<R2 auto-advance; approve wording |
| 2 | Ready Check — choose times | DRAFT completed | **Confirm "3 times" vs "3–5 times"** |
| 3 | Measured quote | New draft | Refund placeholder; don't auto-send until quotes 100% correct |
| 4 | Booking + consent | New draft | Owner-consent wording + deadline placeholder |
| 5 | Pre-install pack (PIESA ≥24h) | New draft | Exact ≥24h window; attach vs link |
| 6 | Assignment signing | New draft | **Declaration wording + signing order (launch blocker)** |
| 7 | Completion pack | New draft | AP contact-details placeholder |

**All seven are real customer emails Jet can read and approve without opening source code.** Nothing above invents prices, rebates, eligibility guarantees, booking guarantees, installation dates, regulatory deadlines, legal declarations or consent wording — every such item is a clearly labelled `[PLACEHOLDER]` with its source dependency recorded.
