# Garage-only Mates Rates — implementation and release gate (23 Nov 2026)

**Do not merge/publish or contact any real owner/installer before review.** The pricing and safety guard in this branch are an initial implementation, not an approved end-to-end retail workflow.

## Real example
- HV-2968 / Eric Stobbie. An issued $9,498 VEU 250 m² quote (250 m² removal) went to the owner on 23 Nov. He subsequently requested ONLY 42 m² previously uninsulated garage; he explicitly asked to be re-quoted. No Gap is assigned.
- No Gap minimum job size **100 m²**. Treat as a *minimum chargeable amount*, pending confirmation they accept 42 m² physically and bill their 100 m² minimum. Do not record 100 m² installed.
- HIVIC Mates Rates pricing in live retail_estimator_settings v5 (20 Nov): R5 $28, R6 $32, R7 $34/m² incl GST.
- No Gap active rate card R5 $21.99/m² **ex GST**. At 42 m² physically / 100 m² billed: owner $2,800 including GST; installer indicative $2,418.90 including GST; $381.10 before other costs. The final amount is NOT approved until No Gap accepts minimum billing and safety/access charges are confirmed.

## Intended complete workflow (remaining work)
1. Inbound request attaches to same job. Record a structured pending scope change and hold/supersede the existing issued quote **atomically** before any old-link acceptance, payment or reminders. The guard in this branch rejects acceptance where a clear owner garage-only email postdates the quote, but UI suppression and transactional supersession must be completed before release.
2. Office job action: **Change scope → Garage only → Mates Rates / no VEU**, with actual install m² (42), removal 0, product R5, minimum charge 100 m², and explicit confirmation of invoicing entity.
3. Installer assignment remains No Gap. Issue one guarded No Gap **Revise quote** request (do not auto-allocate another installer), idempotent event, one partner email, visible portal task; show their agreed minimum and required confirmations without exposing HIV margin.
4. No Gap returns actual measurement, optional additional charge and safety/access requirements. Office sees owner's line items: 42 m² × $28 ($1,176) + 58 m²-equivalent minimum-job charge ($1,624) = $2,800 incl GST before approved extras. Prevent extra m² appearing in evidence, the roof plan, supplier installation or government reporting.
5. Issue a separate **non-VEU** quote. No $349 VEU AP management fee automatically, no mandatory VEU PIESA line automatically, no VEEC/discount/lodgement/ESC notification, no VEU-only consent/claims. Do not skip independent electrical safety and work health/safety requirements; have the responsible person specify what is necessary for private installs.
6. Separate retail agreement, payment/invoice/deposit flow, safe installation scheduling, non-VEU job progression and completion receipt/evidence. Do **not** reuse the VEU acceptance flow until every VEU-only payment, consent and claim side-effect is disabled for this quote type.
7. Ensure quotes to owner say 42 m² physically installed and explain that the small-job minimum is a charge, not extra work. No misleading rebate imagery.
8. Isolated TEST end-to-end proof: No Gap sees change; homeowner sees no old quote; no owner accepts $9,498 after scope request; $2,800 quote with clear 42/100 units; exactly-once owner & installer notifications; no ESC/VEEC, invoice correct; positive/negative tests, duplicate emails, accepted-original race and concurrency. No real delivery in testing.

## Current branch implementation
- Pure retail pricing engine with separate area / minimum charge, negative-margin block, zero rebate/ESC flags.
- Conservative garage-only detection from actual owner emails and owner-quote safety gate helper.
- Unit tests. **No** live customer quote, installer notification, payment or release.

## Implementation concern
The live database has Mates Rates fields but the current general quote builder routes through VEU PIESA, AP fees, payments and VEEC consent. A zero discount alone is not a safe non-VEU implementation. It must have a distinct end-to-end mode.
