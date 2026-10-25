# The one Ready Check prompt for ChatGPT (25 Oct 2026) — replaces the "tidy" and "final fixes" prompts

Item 5 = decision 278 (no price in Mitti); item 6 = decision 290 as corrected by Jo ("they already say if it's difficult
access and why"): the charge/fee pair is simply deleted from both templates, nothing added. After publishing, A1 has 34
questions and A2 has 35 (the ceiling-area section counted once). `tests/lean-ready-check.test.ts` fails if this file
drifts from `src/lib/ready-check-lean.core.ts`.

Paste everything below the line into ChatGPT.

---

Edit the Mitti templates `A1 – Ready Check | Installer-Supplied Customer` and `A2 – Ready Check | HIVIC Sourced Customer`.
Make ONLY these changes, then publish both.

In BOTH templates, in every ceiling-area block (the repeating block and Ceiling Area 1 to 6):

1. DELETE the Photo question `Upload your area sketch or floor plan.` (with its "Rough is fine…" text) wherever it appears.
2. On `Length (m)`, REPLACE the help text with exactly: `Longest length of this ceiling area. Split an L-shaped ceiling into two areas.`
   (remove the sentence about the portal working out the m² and drawing the diagram).
3. Make `Enter the measured ceiling area (m²)` a CALCULATED number = `Length (m)` × `Width (m)` for that area, read-only, shown to the installer.
4. At the end of the Ceiling Assessment section (after the last ceiling-area block), ADD a CALCULATED read-only number
   labelled exactly `Total ceiling area (m²)` = the sum of `Enter the measured ceiling area (m²)` across every ceiling area entered.

In A1 ONLY:

5. DELETE the whole page/section `Your quote to the homeowner`, including every question on it and every "only show when"
   rule that points at those questions. The questions are exactly these seven:
   - `What’s included in your quote?` (tick all)
   - `What else is included?` (text, shown when Other is ticked)
   - `Total quoted price (inc GST)` (number)
   - `Who is doing the electrical safety check?` (pick one)
   - `Electrician name` (text)
   - `Electrician licence number` (text)
   - `Electrician price (inc GST)` (number)
   Do NOT add anything in its place: the business owner enters the price in our portal, not in Mitti; staff doing the
   Ready Check never see a price.
In BOTH templates:

6. In BOTH templates, DELETE the question `Is there a difficult access charge?` and the question `Difficult access fee ($ inc GST)`
   (on the Roof and access page), including every "only show when" rule that points at them. Do NOT add anything in
   their place: the existing `How would you rate the ceiling access?` rating, the access photo and the issues note already
   say whether access is difficult and why; the business owner (A1) or the office (A2) decides any access charge.

If Mitti cannot calculate across the repeating block or the Ceiling Area 1–6 branches, say so before changing anything
and tell me the closest thing it can do.

Publish both templates.
