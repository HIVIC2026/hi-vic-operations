# Firm quote from photos (website enquiries) — design

Date: 6 Nov 2026 · Status: APPROVED by Jo (6 Nov 2026, 17:05) · Path: architectural (Superpowers)
Builds on: `2026-11-05-photo-quote-installers-design.md` (From photos installers, already built).

## Why

Demand is very high. From now on the website only takes homeowner enquiries that include photos or a short video of the roof space (Base44 form change, ready, not published). Owners get a preliminary estimate from the m² they gave. If they're happy they press **Proceed to firm quote**. One of our certified installers then does a desktop assessment (photos + aerial imagery + floor plan records), signs it off, and we email a firm quote within 7 business days. No Ready Checks. No "Save my spot".

## Decisions (Jo, 6 Nov 2026)

1. **Who it applies to.** New website enquiries that include owner photos/video (`hasOwnerMedia`). Owners who already saved a spot or got the old estimate email are left exactly as they are.
2. **Email 1 — preliminary estimate (automatic).** Replaces the Save my spot estimate email for these enquiries. Approved design: email 1 in the drafts. Subject `{First}, your preliminary estimate: ${price} after a ${rebate} rebate`. Rebate box, "Your preliminary estimate" price box ("Based on your {m²} m² ceiling estimate"), the existing "Your existing insulation" removal card when the owner said there's some or isn't sure, **Proceed to firm quote** button, "What happens next" (installer desktop assessment, firm quote within 7 business days), "Why the price might change" (size, old insulation removal, hard access, electrical work quoted separately), "Nothing is locked in until you accept your firm quote.", VEU box. No "Save my free spot". Word: "preliminary estimate" (never "preliminary quote").
3. **Proceed to firm quote.** One tap, like Save my spot today. Records the request and the due date = 7 Victorian business days from the tap. The job then shows for the office in Choose installer (portal suggests by area, Jo confirms), only to From photos installers.
4. **Size check.** On Proceed, the aerial + floor plan size check (`runPropertyIntelligence`) runs for the job. Its result shows to the installer beside the owner's photos on the "Quote from photos" box. Floor plans need the Pricefinder keys (`PRICEFINDER_CLIENT_ID`, `PRICEFINDER_CLIENT_SECRET`) set; without them only the aerial check runs.
5. **Installer sign-off = desktop assessment.** The installer uses the existing "Quote from photos" box and presses Send for quote. That is the sign-off.
6. **Firm quote goes after Jo presses Send.** These quotes are always held on Quotes to check for Jo, whatever the variance.
7. **Email 3 — firm quote.** Subject `Your firm quote is ready: ${price} after rebate`. Rebate box, "Your firm quote" price box with "You told us {owner m²} m². We confirmed {confirmed m²} m².", a separate removal line when removal is in the quote ("Removal of old insulation: {m²} m² × $15 = ${amount}"), "Your quote is valid for 30 days, until {date}.", **Accept my quote** (existing quote page). Replaces the normal quote-ready email for these jobs only.
8. **Email 2 — day 4.** 4 days after Proceed, if the firm quote hasn't gone: subject `Your firm quote is on its way`, "Your installer is checking your ceiling size and photos now. Your firm quote will be with you by {due date}. Nothing for you to do in the meantime." Not sent if the quote already went or the job closed.
9. **Save my spot gone for these enquiries.** No Save my spot email, page links, day 2 / 7 / 21 reminders, auto-close, spot texts or "It's your turn" release message. The calculator loses "Spots are released in the order they were saved. We'll be in touch when your spot is released."
10. **Office.** Enquiries screens stay. New tab **With photos** holds every open enquiry with photos/video (and only there — one pile per job), showing "Asked for firm quote · due {date}" once Proceed is pressed.
11. Rules that apply: never "about" with prices; "Home Insulation Victoria" in full; signed "Cheers, the Home Insulation Victoria team"; no "call us".

## Not in scope

- Changing the website (done separately in Base44, publish with this release).
- Owners who already saved a spot.
- Any change for installers' own customers.
