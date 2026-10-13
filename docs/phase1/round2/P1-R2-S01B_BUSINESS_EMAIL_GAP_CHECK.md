# P1-R2-S01B — Business Email Gap Check (S01A inventory × Developer Brief V3 × current implementation)

**Project:** Home Insulation Victoria · **Phase 1 / Round 2 / Step S01B**
**Agent:** R2 — Enquiry & Office · **Type:** Investigation / documentation only
**Branch:** `phase1/r2-enquiry-office` · **S05/S06 preserved:** yes (only `enquiry-groups.core.ts` + `office-status.core.ts` modified; no production email code touched here)
**Source document:** *Home Insulation Victoria Portal Developer Brief — 9 October 2026, Refined Version 3, author Joannah Lowe* (replaces V2).

> **Source hierarchy applied:** (1) current verified implementation = what exists; (2) Brief V3 = intended business workflow and wording; (3) existing approved templates = preserve approved wording where still compatible; (4) S01A inventory = reuse the completed technical inventory. **Where sources conflict, the conflict is documented, not silently resolved.**

---

## 1. Method

This document does **not** repeat the full S01A codebase inventory. It cross-checks the 16-row S01A classification against Brief V3 sections **2, 4.1, 4.2, 4.3, 4.4, 4.6, 4.8, 4.9–4.13, 5, 13 and 17**, and sorts every owner-facing communication into categories **A–E**.

---

## 2. Category A — Existing templates that satisfy the brief (KEEP)

| Template (S01A row) | Brief V3 anchor | Why it satisfies the brief |
|---|---|---|
| **Preliminary estimate — likely eligible, area known** (row 1) | 4.3 "Appears eligible, area known" | Already shows area used, preliminary price, fees, VEU discount, total inc GST; primary **SAVE MY SPOT** button; "demand is high" wording. Approved by Jo 7 Oct. |
| **Preliminary estimate — likely eligible, area unknown** (row 2) | 4.3 "Appears eligible, area unknown" | Uses labelled average-area estimate with "Change area"; approved wording present. |
| **Preliminary ineligible result** (row 4) | 4.3 "Ineligible" | States the failed check in plain words; **no** Save My Spot messaging. Subject "Your ceiling insulation eligibility result". Approved. |
| **Save My Spot — likely (campaign)** (row 7) | 4.4 | Automatic campaign send; gated by `LAUNCH_COPY_APPROVED`. Approved. |
| **Save My Spot — offer variants** (row 8) | 4.3 "less than R2 / loose fill → Save My Spot"; 4.4 | Three Jo-approved variants (no insulation / under-R2 reviewed); never infers "no insulation". Approved 12 Oct. |
| **Spot-saved confirmation (email + SMS)** (row 9) | 4.4 "Show and email a confirmation… this is not quote acceptance, payment, VEEC assignment or permission to start" | "Smart move, {name}. Your spot is saved." Approved by Jo 7 Oct. Matches the "not a booking" rule exactly. |
| **Estimate base renderer** (row 16) | 4.3 email rules | Shared calculator-style theme (white background, ticks, one CTA). Internal composition. |

**Conclusion:** rows 1, 2, 4, 7, 8, 9, 16 require **no new drafting** — reuse as-is.

---

## 3. Category B — Existing templates needing wording updates

| Template (S01A row) | Brief V3 anchor | Required update |
|---|---|---|
| **3-day estimate-not-opened reminder** (row 5) | 4.3 "Send once per outcome; resends are deliberate"; 13 (stalled nudge ≈ 7 days for jobs) | Theme-approved only. Recommend explicit Jo wording sign-off; confirm the 3-day cadence is intended for **estimates** vs the 7-day **job** nudge (§13). No contradiction found, but cadence ownership should be confirmed. |
| **Coverage-unavailable** (row 6) | 2 "Service area… Outside the area means **Awaiting coverage**, not ineligible"; 4.2 | Confirm wording says **"Awaiting coverage"** (capacity), **never "ineligible"**. Theme-approved; confirm trigger wiring. No Save My Spot promise of position/crew/date. |

---

## 4. Category C — Draft templates requiring completion (the S01 DRAFTs)

| Template (S01A row) | Brief V3 anchor | What completion requires |
|---|---|---|
| **Insulation / Evidence request** (row 3) | 4.3 "Existing insulation or unsure" | Must offer the **four** brief options — confirm **loose-fill only**; **upload photos**; **video from the manhole**; or **confirm less than R2** — and route "loose-fill only"/"less than R2" to Save My Spot (still preliminary), photos/video to office review. **Must not ask again** if media already came with the enquiry. Must say removal is quoted separately. Must not auto-require video or encourage unsafe roof access. (Drafted in S01B deliverable 2.) |
| **Ready Check — choose times** (row 10) | 2 "Ready Check booking: the owner picks 3 times"; 4.6; 5 forms register | Already has approved-looking "Choose my times" wording in `installer-ready-check.core.ts` ("choose 3 to 5 times"). **Conflict flagged** — see §7. Needs Jo approval; business purpose = free Ready Check invitation/scheduling. (Drafted in deliverable 2.) |

---

## 5. Category D — Missing templates required by the workflow (CREATE)

| Template | Brief V3 anchor | Stage / trigger (verified in brief) |
|---|---|---|
| **Measured quote** | 4.8; 2 "Automatic quote emails — switch on only once tested quotes are 100% correct"; 2 "Measurement difference" (>15% note) | After Ready Check validated → auto quote (§13 "Ready Check validated → calculate measured quote and send it automatically"). Lines order: **PIESA; R5.0 supply and install; AP management; VEU discount**. |
| **Booking + ESC consent / pre-install pack** | 4.11; 5 forms register ("Pre-install owner consent and ESC notice"); 2 "Install booking" | On install booked: send date/time, how to prepare, power-interruption info, life-support plan, paperwork; request first 50% balance. **ESC notice is office/system-submitted, not an owner signature at this email.** |
| **Pre-installation pack (PIESA copies)** | 3 & 5 "PIESA… copies to owner and installer **24h+ before install**"; 4.9 | Signed PIESA copy to owner ≥24h before install. Separate legally-timed delivery. |
| **Assignment signing (VEEC assignment + declarations)** | 2 "Complete VEEC assignment and declarations **at the verified official stage**"; 4.13; 5; 3 "Quote acceptance must not sign a declaration about installation facts that have not yet occurred" | **Post-installation**, AP-review stage, correct signing order. **Not at quote acceptance.** |
| **Completion pack** | 4.13 "Completion pack for the owner"; 5 "Owner completion pack — Closeout" | After registry outcome: completion docs, invoice & payment summary, VEEC assignment form, CoES if any, warranty, manufacturer instructions, **dispute-resolution information**, AP contact details, signed copies. |

---

## 6. Category E — Communication scenarios needing further investigation before a *separate* template is decided

A single reusable template may cover several outcomes where the architecture allows it — do **not** create unnecessary duplicates.

| Scenario | Question to resolve | Recommendation |
|---|---|---|
| **Booking + ESC consent** vs **Pre-installation pack (PIESA 24h)** | §4.11 bundles booking/consent/ESC; §5 requires PIESA copies to owner **≥24h before install** as a *separately timed* delivery. | **Keep as two emails.** They occur at **different legally-timed stages** (booking confirmation vs. the ≥24h PIESA-copy delivery). Bundling them risks sending the ≥24h document too early or too late. (Explained in deliverable 2.) |
| **Missing/conflicting information** request (4.3) | Is this distinct from the Insulation/Evidence request (row 3)? | Likely a **reusable targeted-request template** parameterised by the missing item; the insulation/evidence email is one instance. Investigate the single office-draft/follow-up path before adding a new renderer. **No new standalone template drafted** pending confirmation. |
| **Measured quote >15% area-change note** (§2) | Separate email or a conditional paragraph inside the Measured Quote? | **Conditional paragraph inside the Measured Quote** (brief: "the measured quote still goes to the owner automatically, **with a note** explaining the area changed"). Not a separate template. |
| **Rectification approval** (4.10) | Owner-facing email needed? | Owner approves rectification quote (§5 "Rectification quote — REC drafts, owner approves"). This is an **owner action email** but is **electrical-flow owned**, likely out of R2 enquiry/office scope. **Flagged, not drafted.** |
| **7-day stalled-job nudge** (§2, §13) | New template vs reuse of reminder engine? | Reuse the existing reminder/follow-up mechanism. Not a new customer template. |
| **Payment request emails** (4.8, 4.11, 4.12) | Separate payment emails or embedded CTAs? | Embedded in Measured Quote (safety-check fee) and Booking/Install emails (50/50 balance). Confirm with R1 payment automation before splitting out. |

---

## 7. Documented conflicts (not silently resolved)

1. **Ready Check "3 times" vs "3 to 5 times".** Brief §2 and §4.6 say the owner **"picks 3 times."** The current renderer `installer-ready-check.core.ts` says **"choose 3 to 5 times."** → **CONFLICT.** The S01B draft uses **"3 times"** to match the authoritative brief but **flags** that the live wording differs; Jet/Jo to confirm which is intended before activation.
2. **VEEC assignment timing.** The *earlier* brief (V2) implied VEEC assignment **at acceptance**; V3 §3 and §4.13 explicitly correct this: assignment and declarations occur **at the verified official (post-install) stage**, and "quote acceptance must not sign a declaration about installation facts that have not yet occurred." → The Assignment-Signing template is placed **post-install**, and the Measured-Quote/Acceptance email does **not** request VEEC assignment. Conflict resolved **in favour of V3**, and the dependency on the official signing order is flagged as a launch blocker (brief §3, §14).
3. **Cooling-off rights.** Brief §2/§3: website origin alone does **not** justify hard-coding "no cooling-off rights." → No template asserts cooling-off status; a **placeholder** is used pending verified consumer-rights wording.
4. **PIESA fee refund wording.** Brief §2: "Confirm refund wording against approved terms and applicable consumer rights." → Measured-Quote template uses a **placeholder** for refund terms, not invented wording.
5. **ESC notice window.** Brief §3: 24h–5 days per public guidance, but "implement the precise current requirement from the authoritative documents." → Pre-install/ESC email treats the ESC submission as **office/system-confirmed** and uses a **placeholder** for the exact notice window.

---

## 8. Required-scenario coverage check (Part 2 of the task — Section 4.3)

| # | Required outcome scenario | Covered by | Separate template needed? |
|---|---|---|---|
| 1 | Appears eligible — known ceiling area | Row 1 (EXISTS) | No — existing |
| 2 | Appears eligible — unknown ceiling area | Row 2 (EXISTS) | No — existing |
| 3 | Existing insulation — Yes/Unsure | Row 3 (DRAFT → completed) | One template, four options (loose-fill confirm / photo / manhole video / <R2 confirm); no duplicate evidence requests; no forced video |
| 4 | Ineligible — specific failed check | Row 4 (EXISTS) | No — existing |
| 5 | Missing / conflicting information | Reuse targeted-request path (Cat E) | Investigate before new template |
| 6 | Awaiting service coverage | Row 6 (EXISTS, update wording) | No — update only |
| 7 | Save My Spot confirmation | Row 9 (EXISTS) | No — existing |
| 8 | Ready Check invitation & scheduling | Row 10 (DRAFT → completed) | One template ("choose your 3 times") |

**Existing-insulation handling (brief-aligned):** loose-fill-only confirmation and below-R2 confirmation route to Save My Spot (still preliminary); photo upload and manhole video route to office review; **no duplicate evidence requests** when media already arrived; **video is not automatically required**; existing safety wording preserved and **no encouragement of unsafe roof-space access**.

---

## 9. Automation-compatibility summary (brief §13 — the system is AUTOMATIC, not copy-paste)

| Template | Automatic trigger (brief §13 / §5) | Current status |
|---|---|---|
| Insulation/Evidence | Enquiry outcome = existing insulation/unsure | Renderer DRAFT; send path locked (S02 wiring) |
| Ready Check times | Capacity released → owner invited | Office-triggered; renderer DRAFT |
| Measured quote | "Ready Check validated → send automatically" | **No renderer** (DB template only); gated "switch on only once quotes 100% correct" |
| Booking + ESC / pre-install | "Install date confirmed → request balance, schedule notices, create forms" | **No renderer**; ESC submission office-confirmed |
| Pre-install PIESA copy (≥24h) | PIESA complete → copies to owner/installer | **No renderer**; legally-timed |
| Assignment signing | "AP evidence approved → request signatures in order" | **No renderer**; post-install only |
| Completion pack | "Registry outcome recorded → approved completion communication" | **No renderer** |

**Not claimed as working:** automatic sending for the five MISSING templates is **not implemented**; this step is drafting + documentation only. R1 owns the sending engine — **no R1 files or branches touched**.

---

## 10. Restrictions honoured
No production email templates modified; no sending configuration changed; no emails sent; no deploy/merge; S05/S06 changes preserved (only `enquiry-groups.core.ts` + `office-status.core.ts` show diffs, both pre-existing). This step is investigation + the three S01B documents only.
