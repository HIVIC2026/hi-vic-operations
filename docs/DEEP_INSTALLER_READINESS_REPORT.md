# Is the system ready for Deep? Morning report (23 → 24 Oct 2026)

Short answer: **the Mitti part is nearly ready; the part after the quote is not.** Deep can fill in his Ready Checks from today. Nothing can reach an owner until the office presses Send. But several things after the quote aren't built or are switched off. Don't email Deep the "how it all works" email until the items in section 4 marked **Must fix** are done.

---

## 1. What happened overnight

| What | Result |
|---|---|
| Bulk upload switched off for installers | **Live** since last night |
| "New from installers" list (Today + Active jobs), no buttons to press | **Live** (published) |
| Automatic Mitti form for each installer job | **Live**. HV-3136–3140 were created at 11:30pm, all assigned to Deep, from the new A1 version. The rest of the 15 were due at 11:45pm and midnight; see section 7. |
| HV-3116–3119 moved onto the new A1 form | **Done**. Done by Lovable's AI: answers copied, HV number + Site address filled in, given to Deep, old forms archived. Nothing skipped. |
| Fixes for the problems below | **Built and tested on the `installer-mitti-workflow` branch. Not live.** |

Loose ends from last night:
- **HV-3119:** the address is only "27/274 Poath Road, VIC", with no suburb or postcode. Fix it on the job and on the form.
- **HV-3151:** has the same phone and email as website enquiry HV-2282 (11 Oct) but a different address. Probably a second property, but please check.

---

## 2. What Deep sees in his app today (live)

**Bottom menu:** My work · Add a job · Money · My business.

**My work:** "Hello Deep", an **Add a job** button, then his jobs in three tabs: **Action needed / In progress / Done**.

| Job state | Tab | What the card says | Job page |
|---|---|---|---|
| Bulk job, Mitti form not made yet | Action needed | "You: quoted? answer needed" | Asks "Have you quoted this customer?" Shows a **New Ready Check** button (risk: blank duplicate form). |
| Mitti form made | Action needed | "You: add the ceiling area, the insulation product, your price and the owner's permission in Mitti" (once the form first syncs) | **Mitti form** button opens that exact form, plus a **What's missing** button. |
| Form partly filled | Action needed | "You: add … in Mitti" (lists what's missing) | What's missing lists each item. |
| Basics all in | Action needed | "You: check the quote" | **Check quote** shows the owner's exact quote. He taps **Quote is ready to send**. |
| He approved it | In progress | "Waiting on office: checking your quote" | — |
| Office sent it | In progress | "Waiting on owner: to accept the quote" | — |
| Owner accepted | ⚠️ back in Action needed as "You: quoted? answer needed" | Still says "to accept the quote" (wrong) | — |

**If he only fills in a few details:** his answers save in Mitti and sync every 15 minutes. He sees exactly what's missing ("You: add your price…"). Nothing is sent to anyone. Photos are optional on A1. Missing photos become **install-day photos**, and the job can't be marked "Installation complete" until they're in.

**How he knows the quote went to the owner:** only by looking at his app. There's no email or text to him at any step.

**"Add a job" today:**
1. **Customer:** address, owner name, mobile, email, permission tick.
2. **Who organises:** Home Insulation Victoria (recommended) or himself.
3. **Job details:** whether he's visited, whether he's quoted, area, insulation, electrician.
4. **Review & submit**, with an evidence tick.

This creates the job, and the automatic Mitti form follows within about 15 minutes. **Exception:** if he answers "Yes, I've visited", no form is ever made (see 4.9).

---

## 3. Your questions, answered

| Question | Answer |
|---|---|
| When he presses **Complete** in Mitti, is the quote made and sent automatically? | **No, not yet.** Today, once the basics are in, the portal **drafts** the quote privately. Deep approves it in "Check quote", then the office presses **Send**. The automatic version (your decision: send on Complete when every check passes) still needs to be built. |
| What's in the quote? | Installer's price (with product and any removal shown), plus electrician/PIESA price, plus the **$349** Home Insulation Victoria fee, minus the VEU rebate. The owner's minimum contribution still applies. **Not yet:** the new A1 *difficult access fee* isn't read into the quote, and your **$15–$30 / $5–$15 per m²** price check and **$500** access limit aren't set up (no range is set today). |
| Do we have the build to email the quote to the owner? | **Partly.** The sending path exists, but **there is no approved "quote ready" email template**, so today the owner would get **nothing**. The text message version isn't approved either. The template needs writing: a link to their secure My job page, the total, and how to accept. |
| How does the owner accept? | **Built.** They open their secure link, get a 6-digit code by text or email, read the quote and agreement, tick, and sign. |
| Is Deep told when the owner accepts? | **No.** A notice is queued but nothing ever sends it. He only sees it in his app, and right now even that's wrong (see table above; fixed on the branch). |
| Can we collect the $349 before booking the electrician? | **Not for installer jobs.** On acceptance the portal makes the invoice locally, but sending it to Xero is switched off, and the deposit request is raised by hand in Xero. The payment check that unlocks the electrician is **switched off**, and even when on, it **always refuses installer jobs**: there's no payment rule for them yet. **So today no installer job can get to the electrician step.** You need to decide the rule (e.g. "same as our leads: $349 paid before PIESA"); then it can be built. |
| How does he book the electrician? | **He doesn't.** With "Home Insulation Victoria arranges", approved electricians get the job offer and the owner picks times. First to accept wins. With "my usual / a different electrician", there's no portal path, so the office arranges it by hand. Deep books the **install day** later, from times the owner picks. Note: the PIESA Mitti form isn't connected in settings yet. |

---

## 4. Problems to fix before Deep relies on it

**Must fix** (stops a job, or misleads Deep):
1. **Owner permission never counted** on Mitti and bulk jobs, so the quote could **never** be sent. ✅ *Fixed on branch:* the A1 "Homeowner agrees to be contacted" answer now records proper permission. ⚠️ This reverses an earlier note ("the Mitti tick is never consent"), so **your OK is needed**.
2. **Mitti jobs not marked installer-led,** so the owner **couldn't accept**. ✅ *Fixed on branch* for new jobs. HV-3116–3119 need a one-off data fix (your OK).
3. **No payment rule for installer jobs,** so no PIESA can ever be booked. ❌ Needs your decision, then a build.
4. **No owner quote email template.** ❌ Needs writing and your approval of the wording.
5. **Automatic quote on Complete** isn't built: the price checks, the access fee and the send. ❌ To build (Phase 4).
6. **Deep never told** when the owner accepts. ❌ To build: an email or text to the installer.
7. **"Quoted? answer needed" dead end** on Mitti jobs, including after acceptance. ✅ *Fixed on branch.*
8. **"New Ready Check" buttons** make blank, unlinked forms. ✅ *Fixed on branch:* removed. The job page now says "your form is on its way, please don't start a new one".
9. **"I've visited" in Add a job → no Mitti form is ever made,** because the provisional measurement blocks it. ❌ Needs a small decision: let the automatic form take over that record (recommended).

**Should fix:**
- ✅ *On branch:* accepted quote still reads "to accept the quote"; "Needs finishing…" never clearing.
- ❌ "Ask the owner for times" button errors, with owner-facing wording. Hide it for Mitti jobs.
- ❌ Add a job's last screen says "add your measurements and quote on this job". It should say "in your Mitti form".
- ❌ Picked-up Mitti forms with a typed HV number are skipped by the pickup.
- ❌ Mitti pickup can still push jobs back to "scheduled", re-adopt cancelled forms, and overwrite owner details (found yesterday).

---

## 5. Decisions I need from you

1. **OK to treat the Mitti permission answer as contact permission** (like Add job's tick)? *Recommended: yes.*
2. **Payment rule for installer jobs before the PIESA:** the same $349 paid first, as for our leads? Paid how (Xero deposit request, by hand)?
3. **Owner quote email:** OK for me to draft the wording, with the secure link, total, what's included and how to accept, for your approval?
4. **Tell Deep by email or text** when the owner accepts? Or both?
5. **"I've visited" jobs:** let the automatic form take over the provisional record? *Recommended: yes.*
6. **Put the branch fixes live** (items 1, 2, 7, 8 and the two wording fixes)?

---

## 6. Test plan (TEST Reinsulate account, practice jobs only, no real owners)

Each step is checked in the app **and** in the portal's records.
1. Add a job (not visited): the job appears in New from installers, and a Mitti form arrives within 15 minutes with job number, Site address and owner filled in. The title reads "HV-xxxx address".
2. Add a job (visited): a form arrives (after fix 4.9).
3. Fill only the area: Deep's card says what's missing, and the office list says "Ready Check missing: …".
4. Fill all the basics and tick permission: a consent record exists, and "Needs finishing" clears.
5. Quote: installer price + PIESA + $349 − rebate. The access fee is added. A price outside $15–$30/m² (or $5–$15 removal) is **held** with the reason, and an access fee over $500 is **held**.
6. Mark Complete in Mitti → automatic send (once built) → the TEST inbox gets the email with a working link.
7. Owner accepts (TEST code on screen) → Deep's card says "accepted", Deep gets his notice, and the invoice is created on the TEST/Demo side only.
8. Payment → PIESA offer → owner picks times → electrician accepts (practice electrician).
9. Edit the form after sending: the new quote is **held**, never auto-sent.
10. Start a blank form in Mitti: it's matched to the right job or sent to the office, never duplicated.

---

## 7. Overnight form check (filled in at the end of the night)

See the bottom of this file.

---

## 8. Draft email to Deep (don't send until section 4's Must-fix items are done)

> **Subject: Your jobs in the Home Insulation Victoria portal: how it works**
>
> Hi Deep,
>
> Thanks for getting your jobs to us. Here's how it works from now on.
>
> **Your jobs.** Everything is in the portal under **My work**, in three tabs: *Action needed* (your turn), *In progress* (with us or the owner) and *Done*.
>
> **Adding a job.** Tap **Add a job** and enter the owner's name, address, mobile and email, and tick that they're happy for us to contact them. That's all you need to start. You can add jobs weeks before you visit. (Please don't use bulk upload; it's switched off.)
>
> **Your Ready Check form.** Within about 15 minutes, the job's Ready Check form appears in your Mitti list. It already has the job number, address and owner details. Open it from the job in the portal (**Mitti form** button), or from your Mitti list. **Please don't start new forms in Mitti yourself**: use the one we make for each job.
>
> **Filling it in.** Fill it in on site. If you've already visited and don't have everything, fill in what you have: area, product, your price (inc GST), difficult access fee if any, and the owner's permission. The job page shows exactly what's still missing. Photos you didn't get can be taken on install day, before you start work.
>
> **The quote.** When you mark the form **Complete**, we build the owner's quote: **your price + difficult access fee + the electrician (PIESA) + our $349 fee − the VEU rebate**, and send it to the owner by email with their secure link. If something doesn't look right (missing details, or a price outside our usual range), we hold it and check it first. If you change the form after the quote's gone, we'll check the new one before anything goes to the owner.
>
> **When the owner accepts.** You'll get a [text/email] and the job moves on. Once the owner pays the $349 safety check, we arrange the electrician and the owner picks times. You don't book the electrician. You'll then book your install day from the times the owner chooses.
>
> Any questions, call us.
>
> Jo

---

## Appendix: overnight form check

Checked 24 Oct 00:09 Melbourne (portal records):
- **HV-3136 – HV-3150: all 15 Mitti A1 forms created automatically**, each linked to its job and assigned to Deep (info@reinsulate.com.au), from the new A1 version (Portal Job Number + Site address prefilled). Exactly one creation attempt per job; no failures or uncertain outcomes; no duplicates.
- **HV-3116 – HV-3119:** moved to the new A1 version by Lovable's AI at 11:24pm; old forms archived; nothing skipped.
- The background scheduler timed out between ~11:22pm and ~11:46pm (while Lovable's AI was running on the development copy) and then recovered by itself. No work was lost.
- Still to confirm by eye: how the titles look in Deep's Mitti list, and the "Mitti form" button link format (it opens Mitti's home, not the form — needs a real form web address from a browser).
