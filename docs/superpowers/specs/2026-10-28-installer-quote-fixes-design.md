# Installer quotes always right — design (Jo, 28 Oct 2026)

Path: architectural (money; quote pipeline, price card, Add a job, office screens). Approach A agreed: keep the saved
owner-quote draft and refresh it. Code drafted on 27 Oct on branch `fix-held-quote-latest-price` is a DRAFT to be
checked against this spec and its plan; nothing is published before that.

## Why
On TEST jobs the installer's "owner's quote" preview showed numbers that didn't match: an old $4,201.25 draft after
the price was changed (HV-3129), a $20 line after saving $3,000 (HV-3197), "R5.0" wording for an R6 product, and a
difficult-access fee Jo never entered.

## Rules (Jo's words in brackets where she set them)

### 1. When the owner quote is rebuilt
- When the installer saves a price, when the Mitti form changes, and on the 15-minute check.
- Installer quotes are fully automatic ("we need the descriptions etc to be perfectly formatted automatically").

### 2. What it is built from
- **Insulation line:** the installer's price from the price card; product and m² from the Mitti form. The wording is
  what was ticked, e.g. "Ceiling insulation - supply & install". Old "R5.0" labels display as the current wording.
  Validation still uses the internal canonical key.
- **Difficult access:** when the price comes from the price card, any difficult-access fee on the Mitti form is
  ignored. There is no access text and no access hold. Old jobs with no price-card entry behave as before.
- **Electrician line:** always known, because the electrician is chosen at Add a job. It is either Home Insulation
  Victoria's at the flat $349, or the installer's own electrician at the rate agreed when they onboarded.
- **Fees:** the $349 Accredited Person fee, minus the VEU rebate.

### 3. Electrician must be onboarded before they can be chosen (new, Jo 28 Oct)
- Add a job: "My usual electrician" is offered only when that electrician has finished onboarding with an agreed
  rate. If they haven't, it shows greyed out and can't be picked, with this exact text: "[Name] — not signed up with
  us yet. They need to finish before you can choose them." Home Insulation Victoria's electrician is always offered.
- Bulk upload is not used. No change.
- Existing jobs already set to an electrician who isn't onboarded (e.g. HV-3129), or whose electrician is no longer
  approved:
  - The quote is held. The old draft is removed and no owner preview is shown.
  - The installer sees their own price and this exact note: "We can't send the owner's quote yet. [Name] hasn't
    finished signing up with us. Ask them to finish, or use our electrician ($349) instead."
  - Under the note is the installer's own button: "Use Home Insulation Victoria's electrician ($349) instead". It
    asks "Are you sure?" first. Once confirmed, the choice is final and can't be switched back. It is recorded as a
    new `electrician_choice_set` event, and the quote is then built automatically on the next rebuild. Nothing is
    sent.
  - The office cannot swap the electrician. Only the installer can, because it's their job ("we can't just swap to
    ours on their jobs without permission from them").
  - When their electrician finishes onboarding, the quote is built at the agreed rate on the next rebuild.
  - In the installer's job list, a job stuck like this sits under "Action needed" (Jo 28 Oct), not "In progress".
  - Crew (installer workers who aren't the business owner) never see any price ("The crew shouldn't see the price!!!",
    Jo 28 Oct). On a stuck job they see only "Waiting on your electrician to sign up", with no note, no button and no
    $ amount, in both the job page and the job list. For crew it is not an action; it sits under "In progress".
  - This applies to everything sent to a crew member's phone, not only what's on screen: job notes (e.g. a repeat
    safety check "payable by the owner ($349…)"), hold reasons, and the official ESC rebate form's amounts (owner's
    price before the rebate, the rebate, what they pay). The rebate form's amounts are for the business owner only
    (Jo 28 Oct).
  - The same rule covers electrician staff: only a trade business's owner ever sees a price (Jo 28 Oct). "Owner"
    means owner of the business on that job, not of some other business the person also belongs to.
  - Crew never see office-typed notes (hold reasons, typed next steps). They see a set line instead, e.g. "On hold —
    the office will be in touch" (Jo 28 Oct). Only known, system-written, price-free text is shown to crew.
  - On the rebate form, crew don't see a "Price details" line at all (Jo 28 Oct).
  - When crew can't see an office note they see "On hold — the office will be in touch" or "The office will be in
    touch" (wording approved by Jo 28 Oct).
  - Electrician fixes: electrician staff can still add "Other" fix items with a description, but never see or enter a
    price. The electrician business owner, or the office, sets the price (Jo 28 Oct).
    - Staff are never asked for a price. After adding an unpriced item they see: "Your business owner or the office
      will add the price."
    - Staff can complete the PIESA on site even while their item is unpriced. The fixes quote to the homeowner is not
      sent until every item has a price (Jo 28 Oct).
    - While the homeowner is deciding, the fixes quote is rebuilt after any item is added, priced or removed, so the
      homeowner never sees a removed item (Jo 28 Oct). A fixes quote with any $0 item can't be sent; a $0 item should
      be removed, not sent (Jo 28 Oct).
    - While the homeowner is deciding, the last repair item can't be removed. The message is: "A quote needs at least
      one item. To cancel the repairs, contact the office." (Jo 28 Oct)
    - The repair-price question ("Your total price for all the repair work, including GST") is removed from the Mitti
      PIESA form. Jo does this in Mitti, but only after the portal price card below is live.
    - Repair price works the same as the installer setup (Jo 28 Oct): when the safety check is completed with repair
      work and no price, the electrician BUSINESS OWNER gets one text with a link to a "Your price" card on that job.
      They enter the total repair price inc GST; the ticked work list from the form is shown read-only. The office can
      also enter it. Staff never see the card or the price. The homeowner's fixes quote is built from that price, and
      is held until it is entered.
    - Price card wording (Jo 28 Oct):
      - title "Price the repairs"
      - list heading "Repairs from the safety check"
      - box label "Your price for all of these (inc GST)"
      - button "Save price"
      - after saving: "Your price: $X — Change"
      - extras heading "Extra items to price"
    - Owner text, approved: "The safety check at [street, suburb] needs electrical repairs. Enter your price for the
      repair work: [link]".
    - Owner error messages, approved: "Enter your total price for all the repair work, inc GST (more than $0)." /
      "The repair quote has already gone to the homeowner. To change it, contact the office." / "The repair price can
      only be set after the safety check and before the homeowner has the repair quote."
    - Extra items the staff add, once priced by the owner or office, go on the homeowner's fixes quote as extra lines
      on top of the repair total, and the electrician is paid for them (Jo 28 Oct).
    - If the safety-check form is edited after the owner has priced it, the owner's price still stands (Jo 28 Oct).
    - If the repair price still isn't entered 24 hours after the link was sent, the job shows "Waiting on the
      electrician's price" on Active jobs for the office (Jo 28 Oct). No reminder text.
    - Closing direct database access to prices for staff logins is a separate piece of work with its own spec
      (Jo 28 Oct: "Yes, close it").

### 4. When no owner preview is shown
- The electrician isn't onboarded (rule 3).
- The m² or the rebate can't be worked out yet. A total is never shown without the rebate. (The m² is missing only
  until the Mitti Ready Check is finished, when the installer already sees "Needs finishing". Add a job already
  requires a Victorian postcode on the rebate list, so no change is needed there.)
- The price card can't be read for a moment. The existing quote is left as it is and retried at the next check. It is
  never removed by mistake.

### 5. Office
- A held quote can't be sent while it has hold reasons. A held quote with no reason gets "Quote held for office
  review".
- An office hand-edit to an installer quote is kept until something real changes: the installer's price, or the
  Mitti form. The 15-minute check does not undo it when nothing has changed (Jo 28 Oct).
- If the office edited a draft by hand and an automatic rebuild replaces it, the office gets one alert, worded exactly:
  "The quote your office edited was rebuilt with new figures. Check it before sending." It shows on the Active jobs
  row and on the job page. It doesn't block Send. The installer never sees it. It fires once per replaced draft.

### 6. What it shows on screen
- After "Price saved", the owner preview updates straight away, with no reload needed.

### Never
- A quote already sent or accepted is never changed.
- Nothing here sends a text or email, except the one approved repair-price link text to the electrician business
  owner (its switch is off until Jo turns it on).
- Office edit (Adjust) stays available. It is not locked.

## Done when (TEST jobs only, nothing sent)
- HV-3129: no preview, the exact onboarding note and button show, and the old $4,201.25 draft is gone. Tapping the
  button and confirming switches the job to Home Insulation Victoria's electrician, after which the quote builds with
  the $349 line.
- HV-3197: save $3,000 and the preview shows $3,000 straight away, the ticked wording, no access fee, the $349
  electrician line, the $349 fee and the rebate.
- Add a job shows a not-onboarded usual electrician greyed out with the exact text, and it can't be chosen.
- Automated tests cover every rule above, including that sent and accepted quotes are unchanged.

## Known limits
- Active jobs shows a saved copy, so the office alert can take up to about 20 minutes to appear.
- Any change in figures rebuilds an edited draft, not only a price change. That is why the alert wording is general.
