---
name: Electrician offer "It's yours!" + on-the-day job page (Jo-approved 5 Oct)
description: Two approved electrician screens — the taken-offer confirmation moment and the on-the-day job page with the Mitti "Start check" flow and fixes/clear outcomes
type: design
---
Preview only. Queued with the electrician job offer and "My work" home (roadmap: Electrician job offer, Electrician "My work" home screen), after the trade launch fixes. Phone-first, calculator look.

**1. Offer — the moment they take it.** When they tap a time, show a big green banner ABOVE the job card:
- white circle with a green tick
- "It's yours!" (Outfit 800, about 32px)
- "Oooft, that was fast clicking."
- the time they took, e.g. "TUE 14 · 8–10am"

Then the navy card switches to "Locked in" with the owner's name, address, and Directions / Call owner / Calendar buttons. Underneath: "Nice one. The owner knows you're coming, and we'll ping you the day before."

**2. On the day (job page).**
- Navy card: pink pill "Today · {window}", "Safety check · {owner surname}", the address, and Directions and Call owner buttons.
- "Before starting": white card "Ready when you are" / "Tap below to open the safety check in Mitti. We'll pick it up from there." Fixed bottom button: green "⚡ Start check", which opens the Mitti PIESA form pre-filled for this job.
- After tapping: "Over to Mitti" / "Submit the form and this page updates itself."
- When the Mitti form arrives:
  - No fixes: mint card with a tick, "All clear. Done and dusted." / "No fixes needed, so the install's good to go."
  - Fixes: blush card, "{N} fixes found. We'll take it from here." / "We'll price these from your rates and send the owner the quote. If they say yes, it comes straight back to you." Then the list of fixes from the form.
- Then a "Back to my work" button.

RULES: the only call button is "Call owner" on the visit card — no Home Insulation Victoria phone number (mem://constraints/no-call-owner). Nothing shown to the electrician about the customer price, our margin, downlights, ceiling size, installer notes or payment terms (mem://features/electrician-rate). Stage moves (install unlocked, 30-day PIESA clock) still run through the existing workflow guards — this is presentation of the same facts, never a new progression path. Don't publish.
