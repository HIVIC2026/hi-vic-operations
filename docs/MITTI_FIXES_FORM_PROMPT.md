# Prompt for ChatGPT: build the Electrical fixes template in Mitti (decision 293)

Copy everything between the lines into ChatGPT. It is ONE self-contained build of a NEW template, in the same style as
the Install day build. The PIESA template is left exactly as it is: repair work fixed on the same visit stays on the
PIESA form (questions 30–37 and 45). This form is only for repair work done on a LATER visit. The portal reads every
answer by its question text, so the wording below is fixed in `src/lib/fixes-day.core.ts` and a test fails if this file
and the code drift apart.

---

You are helping me build a form template in **Mitti** (mitti.com.au field inspection app, web template builder). I will
follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can tick
off, nothing skipped. The question wording, answer types, Required settings, help texts and "only show when" logic
below are **fixed and must be copied exactly, character for character, including punctuation and capitals**, because a
connected software system reads every answer by its question text. Do not reword, reorder, merge, split, add or drop
any question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me before
substituting.

**Template name:** `A4 – Electrical fixes`
Build it as a NEW template. The existing "A3 – Electrical safety check (PIESA)" template is not changed.

**Inspection title:** Job number + Address (Q1 and Q2).
**Settings:** turn ON **mandatory mark-as-complete**. Turn ON location/GPS for Q14.
**Pages:** one page per ## group below.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the electrician can correct them. Q8 is the list the portal fills in (Mitti can't lock a text field, so it stays editable); it is not Required.
**Colours:** Q9 `Yes` = GREEN, `No` = RED. Nothing else is coloured.

Answer-type key: Text = single line text (Q8 and Q10 may be multi-line text); Date = date; Yes/No = two choices `Yes`
and `No`; Photo = photo with location on ("several files allowed" = let the electrician attach more than one; "PDF
allowed" = the item must also accept a PDF file); Signature = signature capture.

## Group 1: Job
Text item (not a question), first item on this page (decision 318): `Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged.`
Q1: `Job number` — Text — Required — portal fills this in
Q2: `Address` — Text — Required — portal fills this in

## Group 2: Electrician
Q3: `Electrician name` — Text — Required — portal fills this in
Q4: `Licence number` — Text — Required — portal fills this in
Q5: `REC name` — Text — Required — portal fills this in
Q6: `REC registration number` — Text — Required — portal fills this in
Q7: `Phone` — Text — Required — portal fills this in

## Group 3: The repair work and Certificate of Electrical Safety
Q8: `The repair work listed on the safety assessment:` — Text — portal fills this in — help text: `Filled in by the portal from the safety assessment. Don't retype it.`
Q9: `Have you completed all of the repair work listed, and is the ceiling now safe for insulation?` — Yes/No — Required
Q10: `Anything not done or changed?` — Text — Required — only show when Q9 = `No` — help text: `Say what is still outstanding or what changed, so the office can follow it up.`

Q11: `Certificate of Electrical Safety number` — Text — Required — only show when Q9 = `Yes`
Q12: `Date of certification` — Date — Required — only show when Q9 = `Yes`
Q13: `Certificate of Electrical Safety (photo or PDF)` — Photo, PDF allowed — Required — only show when Q9 = `Yes` — help text: `A photo or the PDF of the certificate.`
Q14: `Photo of the finished work at the switchboard / in the ceiling` — Photo, several files allowed, location on — Required — only show when Q9 = `Yes` — help text: `Show the finished work. More than one photo is fine.`

## Group 4: Sign
Q15: `Electrician signature` — Signature — Required

Publish, then send me the **template ID**. It's in the Mitti web address when the template is open, or under the
template's settings. I'll connect it in the portal (Compliance → Mitti forms → A4) and check it before any electrician
gets one.
