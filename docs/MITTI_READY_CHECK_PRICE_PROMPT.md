# Prompt for ChatGPT: take the price OUT of the A1 Ready Check (decision 278) and the access fee out of both (decision 290), 25 Oct 2026

Jo 25 Oct 2026: "Price stays with the boss, out of Mitti." Staff may do Ready Checks and must never see or set the price.
The business owner now enters the price and what is included on the job page in the portal ("Your price" card, business
owner only); the electrician is chosen once at Add a job (decision 289). The A1 template therefore loses its whole "Your
quote to the homeowner" page.

Jo 25 Oct 2026 (decision 290, corrected: "they already say if it's difficult access and why"): the questions
"Is there a difficult access charge?" and "Difficult access fee ($ inc GST)" are deleted from BOTH templates and nothing
replaces them — the existing access rating, the access photo and the issues note are the flag; the business owner (A1) or
the office (A2) decides any access charge in the price.

Every wording below is fixed in `src/lib/ready-check-lean.core.ts` (`A1_QUOTE_PAGE`, `A1_QUOTE_QUESTIONS`,
`LEAN_REMOVE.accessCharge`, `LEAN_REMOVE.accessFee`) and `tests/lean-ready-check.test.ts` fails if this file drifts from
the constants. The portal keeps reading the old questions on forms created before this change, so nothing in progress
breaks.

After publishing: run **Check form** on A1 and A2 in the portal (Office → Settings → Mitti forms) — each must report no
missing questions. The template IDs do not change, so nothing needs re-connecting.

Paste everything below the line into ChatGPT.

> Folded into docs/MITTI_READY_CHECK_ONE_PROMPT.md (the prompt Jo runs); kept as the tested contract.

---

Edit the Mitti template `A1 – Ready Check | Installer-Supplied Customer` (steps 1–2) and then BOTH templates
`A1 – Ready Check | Installer-Supplied Customer` and `A2 – Ready Check | HIVIC Sourced Customer` (step 3). Make ONLY
these changes, then publish both.

1. DELETE the whole page/section `Your quote to the homeowner` from A1, including every question on it and every
   "only show when" rule that points at those questions. The questions on that page are exactly these seven:
   - `What’s included in your quote?` (tick all)
   - `What else is included?` (text, shown when Other is ticked)
   - `Total quoted price (inc GST)` (number)
   - `Who is doing the electrical safety check?` (pick one)
   - `Electrician name` (text, shown for A different electrician)
   - `Electrician licence number` (text, shown for A different electrician)
   - `Electrician price (inc GST)` (number, shown for A different electrician)

2. Do NOT add anything in its place: no price, quote, fee or electrician question anywhere on A1. The business owner enters
   the price in our portal, not in Mitti.

3. DELETE the questions `Is there a difficult access charge?` and `Difficult access fee ($ inc GST)` (Roof and access page)
   on BOTH templates, including every "only show when" rule that points at them. Do NOT add anything in their place and do
   NOT change `How would you rate the ceiling access?` or the access photo: the rating, the photo and the issues note
   already say whether access is difficult and why.

4. Leave every other page, question, option, Required setting and the repeating `Add a ceiling area` section exactly as
   they are. Keep the signature questions as they are.

If Mitti will not let you delete a page or question without affecting another page or rule, say so before changing
anything and tell me the closest thing it can do.

Publish both. Then tell me the question count on each published template (A1 should be 34 questions and A2 35 questions,
with the ceiling-area section counted once) and confirm `Your quote to the homeowner`, `Is there a difficult access charge?`
and `Difficult access fee ($ inc GST)` no longer appear anywhere in either template.
