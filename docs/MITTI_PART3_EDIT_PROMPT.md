# Prompt for ChatGPT: Part 3 edits to the two electrician Mitti templates (Jo, 3 Nov 2026; redone 4 Nov for the rebuilt forms)

Copy everything between the lines into ChatGPT. It edits TWO existing templates — **PIESA – Electrician safety assessment**
(A3) and **A4 – Electrical fixes** — and changes nothing else on either. The portal already reads the new wording AND the old
wording (`src/lib/official-short.core.ts`, `src/lib/fixes-day.core.ts`, `src/lib/piesa-evidence.core.ts`), so forms already
done keep working; `tests/piesa-wording-part3.test.ts` fails if this file and the code drift apart. Do the portal deploy
first, then paste this.

4 Nov: the A1–A5 forms were rebuilt with new wording (see `docs/MITTI_A1_A5_REBUILD_COMPATIBILITY_REVIEW.md`). Jo's ruling
(4 Nov): the Part 3 wording wins on the two electrician forms — keep the rebuild's other changes, add the Part 3 questions,
delete the price questions. Every "find" below gives the rebuilt (4 Nov) wording first and the older wording in brackets, so
the steps work whichever version of the form you are looking at.

Why: electricians now quote and bill the electrical upgrades with the owner directly (no Home Insulation Victoria price), and
the Certificate of Electrical Safety can come later — the electrician has up to 30 days to issue it, so the form asks
whether they have it now; if not, the portal texts them a link to add it.

---

You are helping me edit two existing form templates in **Mitti** (mitti.com.au field inspection app, web template
builder). I will follow your instructions click by click in the Mitti web app. Give me the edits as a numbered list of
steps I can tick off, template by template, nothing skipped. Every question wording and help text below is **fixed and
must be copied exactly, character for character, including punctuation, capitals and the apostrophe**, because a connected
software system reads every answer by its question text. Do not reword, reorder, merge, split, add or delete anything I
have not listed. If Mitti does not offer something I name, tell me the closest option and ask me before substituting.

## Template 1: `PIESA – Electrician safety assessment`

### 1. Reword two questions
1a. Find the question `Does any electrical upgrade work need doing before the insulation goes in?` (older forms:
`Is any electrical repair work needed before insulation can be installed?`) and change its wording to
exactly: `Are electrical upgrades needed?`
Keep it Yes/No, Required, Yes red, and keep every "only show when" rule that points at it (the repair-work questions below
it still show when it is Yes).

1b. Find the question `Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?`
and change its wording to exactly: `Are you doing the electrical upgrades today?`
Keep it Yes/No, Required, only show when `Are electrical upgrades needed?` = Yes.
The rebuilt (4 Nov) form does NOT have this question. If it is not on the form, ADD it, on its own page after
the electrician declaration and signature, as Yes/No, Required, only show when `Are electrical upgrades needed?` = Yes.

### 2. Add the "have you got it now?" question
Right after `Are you doing the electrical upgrades today?` (and after any other Part C work questions your form has), add a
NEW question with exactly this wording: `Do you have the Certificate of Electrical Safety now?`
Yes/No, Required, only show when `Are you doing the electrical upgrades today?` = Yes, with this help text exactly:
`No? We'll text you a link to add it later.`
If Mitti has no help-text field, add the help line as an Instruction (text) item directly under the question.

### 3. The certificate questions show, and are Required, only when the answer above is Yes
These questions stay Required, but change their "only show when" rule to ONE rule: show only when
`Do you have the Certificate of Electrical Safety now?` = Yes. Remove any rule on them that points at question 20 or question 30 instead.
- `Certificate of Electrical Safety number (required for any electrical works completed):`
- `Date of Certification:` (the rebuilt form may call it `Date on the certificate` — keep whichever wording is there)
- question 45 `Certificate of Electrical Safety (photo or PDF)`
If these three are not on the A3 at all (the rebuilt form may not have the after-upgrades page), add them after
`Do you have the Certificate of Electrical Safety now?`: a short text, a date, and a Photo/attachment that also accepts a PDF,
with exactly the wordings listed above, all Required, all with the same "only show when" rule. No help text on these three.

### 4. Delete the price questions
4a. Delete the question `Your total price for all the upgrade work (inc GST)` (older forms:
`Your total price for all the repair work, including GST`). It is the last question on the upgrade/repair work page.
4b. If there is a checkbox about prices on the Job page, delete it too. Its wording is:
`I won't talk about prices with the owner. Home Insulation Victoria sends the owner all prices.` (older forms:
`I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.`)
If it is not on the form, there is nothing to do.
Leave `What upgrade work will you do? Tick everything your price includes.` (older forms: `What will you do? Tick everything
included in your price.`) and every other question exactly as they are — the portal reads the work list from it.

Republish the template. The template ID does not change, so nothing needs reconnecting.

## Template 2: `A4 – Electrical fixes`

### 5. Add the "have you got it now?" question
Right after Q10 `What's not done, or what changed?` (older forms: `Anything not done or changed?`), add a NEW question with
exactly this wording:
`Do you have the Certificate of Electrical Safety now?`
Yes/No, Required, only show when Q9 = `Yes`, with this help text exactly:
`No? We'll text you a link to add it later.`
If Mitti has no help-text field, add the help line as an Instruction (text) item directly under the question.
Then change the "only show when" rule on these three questions so they show only when
`Do you have the Certificate of Electrical Safety now?` = `Yes` (not Q9). They stay Required. The photo question keeps its own
help text (`A photo or the PDF of the certificate.`); the new help line above goes on the new question only.
- `Certificate of Electrical Safety number`
- `Date on the certificate` (older forms: `Date of certification`)
- `Certificate of Electrical Safety (photo or PDF)`

### 6. Everything else stays Required
Do not change these; they stay Required:
- Q9 `Have you finished ALL the upgrade work listed above, and is the ceiling now safe for insulation?` (older forms:
`Have you completed all of the repair work listed, and is the ceiling now safe for insulation?`)
- `Photos of the finished work` (older forms: `Photo of the finished work at the switchboard / in the ceiling`) (location on)
- `Electrician signature`

Republish the template.

## When you have given me the steps
Finish with a short checklist I can use on each republished template: the two new wordings on the A3, the new
`Do you have the Certificate of Electrical Safety now?` question (Required, with its help line) on both forms, the three certificate
questions (number, date, photo) Required and showing only when that question = Yes on both forms, the price question gone,
and a form already in progress still opening.

---
