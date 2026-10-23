Read-only answer — nothing to build. Approving changes nothing.

Live switches right now: Ready Check booking OFF, offers "automatic", Mitti auto-create ON, installer offers ON, customer emails ON, installer booking/daily text OFF, Mitti auto-pickup OFF. Reinsulate is approved, invited to Mitti and has a mobile.

## Best path on LIVE today: assign Deep directly
1. Office > open the job (stage "Ready to schedule").
2. In the Installer box, pick Deep (Reinsulate) and press Assign.
   - Automatic: Deep is assigned. The next step becomes "Assigned Installer to contact owner and arrange Ready Check".
   - Deep sees the job in his app (Jobs > Needs action) with a "Book" option.
   - Deep gets no text. The owner gets no text or email. No Mitti form yet.
3. Deep phones the owner, agrees a time, and in his app taps the button for a time agreed with the owner (enters the date/time).
   - Automatic: the Ready Check is booked. Nothing goes to the owner.
   - Mitti A2 form: created in the background, assigned to Deep. It's pre-filled from the owner's website answers (allowed because Mitti auto-create is ON and Reinsulate is invited).
   - Deep's "Ready Check booked: …" text: NOT sent (installer text switch is OFF). He finds the form link in his app.
4. Deep fills the Mitti form. The 15-minute sync reads it into the job.

## The other path is blocked on LIVE: "Choose trades" / offers
- On the job page: "Offer Ready Check booking", then "Choose trades for this job", tick Reinsulate, Send.
- This fails with "Ready Check offers cannot start", because Ready Check booking is OFF. No offer, text or owner email.
- Same reason the "offers automatic" setting does nothing for Ready Checks today.

## Owner messages
- Nothing goes to the owner on the direct path.
- Only if Deep chooses "ask the owner for times" in his app would the owner get a pick-your-times link. That also needs Ready Check booking ON, so it's blocked today.

## What's different in the unpublished preview
- Steps 1–4 are the same.
- After the form syncs: a quote draft is made once the basics are in (area, product, owner mobile/email/permission, no stop), without waiting for the full form. It goes to "Quotes to check"; it is never sent automatically. On live, the draft is only made when the form is completed.
- "Needs finishing…" next steps are kept up to date and protected (live only does this while auto-pickup is ON, which it isn't).
- The newer A2 pre-fill (life support and 5-year questions taken from the website instead of the form) is in preview. Live may still use the older version.

Caveat: these steps come from reading the code and the live settings. I didn't click through the live app.
