# Prompt for ChatGPT: take the price OUT of the A1 Ready Check (decision 278, 25 Oct 2026)

Jo 25 Oct 2026: "Price stays with the boss, out of Mitti." Staff may do Ready Checks and must never see or set the price.
The business owner now enters the price, what is included and who does the electrical safety check on the job page in
the portal ("Your price" card, business owner only). The A1 template therefore loses its whole "Your quote to the
homeowner" page. A2 is not touched (our leads are priced from our rate card).

Every wording below is fixed in `src/lib/ready-check-lean.core.ts` (`A1_QUOTE_PAGE`, `A1_QUOTE_QUESTIONS`) and
`tests/lean-ready-check.test.ts` fails if this file drifts from the constants. The portal keeps reading the old questions
on forms created before this change, so nothing in progress breaks.

After publishing: run **Check form** on A1 in the portal (Office → Settings → Mitti forms) — it must report no missing
questions. The template ID does not change, so nothing needs re-connecting.

Paste everything below the line into ChatGPT.

> Folded into docs/MITTI_READY_CHECK_ONE_PROMPT.md (the prompt Jo runs); kept as the tested contract.

---

Edit ONLY the Mitti template `A1 – Ready Check | Installer-Supplied Customer`. Do NOT touch
`A2 – Ready Check | HIVIC Sourced Customer`. Make ONLY this change, then publish A1.

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

3. On question `Difficult access fee ($ inc GST)` REPLACE the A1 help text with exactly:
   `Included in the price your business owner enters in the portal; it is shown on the owner's quote.`

4. Leave every other page, question, option, Required setting and the repeating `Add a ceiling area` section exactly as
   they are. Keep the signature question as it is.

If Mitti will not let you delete the page without affecting another page or rule, say so before changing anything and
tell me the closest thing it can do.

Publish A1. Then tell me the question count on the published A1 (it should be 36 questions, with the ceiling-area
section counted once) and confirm `Your quote to the homeowner` no longer appears anywhere in the template.
