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
- Add a job: "My usual electrician (<name>)" shows only when that electrician is onboarded with an agreed rate.
  Otherwise the only option is Home Insulation Victoria's electrician.
- Bulk upload: the default is the usual electrician only if onboarded, otherwise Home Insulation Victoria's.
- Existing jobs already set to an electrician who isn't onboarded (e.g. HV-3129):
  - The quote is held.
  - The installer sees their own price plus "Your electrician needs to finish onboarding before the owner gets a
    quote." There is no owner preview.
  - The old draft is removed.
  - The office can switch the job to Home Insulation Victoria's electrician. This is an office-only action, recorded
    as a new `electrician_choice_set` event. Nothing is sent.

### 4. When no owner preview is shown
- The electrician isn't onboarded (rule 3).
- The m² or the rebate can't be worked out yet. A total is never shown without the rebate.
- The price card can't be read for a moment. The existing quote is left as it is and retried at the next check. It is
  never removed by mistake.

### 5. Office
- A held quote can't be sent while it has hold reasons. A held quote with no reason gets "Quote held for office
  review".
- If the office edited a draft by hand and an automatic rebuild replaces it, the office gets one alert: "Installer
  changed their price — the quote your office edited was rebuilt. Check it before sending." It shows on the Active
  jobs row and on the job page. It doesn't block Send. The installer never sees it. It fires once per replaced draft.

### 6. What it shows on screen
- After "Price saved", the owner preview updates straight away, with no reload needed.

### Never
- A quote already sent or accepted is never changed.
- Nothing here sends a text or email.
- Office edit (Adjust) stays available. It is not locked.

## Done when (TEST jobs only, nothing sent)
- HV-3129: no preview, the onboarding note shows, the old $4,201.25 draft is gone, and the office can switch it to
  Home Insulation Victoria's electrician.
- HV-3197: save $3,000 and the preview shows $3,000 straight away, the ticked wording, no access fee, the $349
  electrician line, the $349 fee and the rebate.
- Add a job offers "My usual electrician" only when onboarded.
- Automated tests cover every rule above, including that sent and accepted quotes are unchanged.

## Known limits
- Active jobs shows a saved copy, so the office alert can take up to about 20 minutes to appear.
- Any change in figures rebuilds an edited draft, not only a price change. The alert wording names the price as the
  usual cause.
