# Read-only check: does the portal still read the updated A1/A2 Ready Check forms?

No code, settings, templates, wording or real job data change. Nothing is sent. No Mitti job is created unless step 4 is truly needed.

## 1. Live form vs what the portal reads
- Fetch live A1 (template_01ee…) and A2 (dbaf67a2…) read-only from Mitti, with their modified_at.
- List every label the portal sync and quote logic read: measured ceiling area (per area and total), existing insulation yes/no, type, depth, determined R value, remove/top up, removal m², downlights, issues, outcome pass/fail, fail reasons, total quoted price, "What's included in your quote?" and "What else is included?", pricing-not-discussed tick, measurement method, who is doing the electrical safety check, electrician name/licence/price, homeowner phone/email/consent, life support, 5-year question, insulation product, difficult access charge/fee, Site address, Portal Job Number, photos.
- For each: still found / renamed / missing / new type the portal cannot read (e.g. Site address now `address`, number fields, multi pick lists).

## 2. Reinsulate's live jobs
- Re-read the Mitti forms for HV-3066 (Ziqiao Wang) and HV-1538 (Janet Lyttle) read-only and re-run the portal's reading logic in memory.
- Janet: confirm whether "Below R2.0 is not a valid number" comes from the portal still expecting a number for the R-value while the form now gives a pick list (a portal mismatch), or from something else.
- Ziqiao: confirm whether "Measured ceiling area not found" is because Deep left it blank or because the area question moved/renamed (e.g. now only inside the repeating area block).

## 3. Dry run with a fully filled sample
- Build a complete sample answer set for each new form (all areas, insulation details, R-value pick, product, price, electrician choice, consent Yes, difficult access).
- Run it through the portal's parse, hard-stop, product and quote logic in memory only, no saving.
- Report: area, removal, price lines, electrician choice, product/R-value, quote ready or held, and every issue raised.

## 4. Mitti TEST job
- Skipped unless steps 1–3 cannot answer the question; if needed, only under the [TEST PARTNER] business with a job named TEST and all sending off. Expected: skipped.

## Reply
Plain short lists: what works, what breaks, what would need fixing. No fixes made.
