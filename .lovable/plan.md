# Save my spot — onboarding email style

## What will change
- Reuse the exact renderer behind **“You're approved — welcome aboard”**, with its **“Set up my account”** button, rather than recreate the design.
- Preserve its header, fonts, colours, spacing, framed body, button and footer treatment for Group A, Group B and hot-lead emails. Add Privacy and Remove my enquiry links in that same footer treatment.
- Use Jo’s requested greeting, eligibility sentence, itemised current estimate, bold Free Ready Check line, urgency, Save my spot button and no-payment line. Group B will say **“could be eligible”** rather than imply confirmed eligibility.
- Keep approved subjects and preview text unchanged. No text images. Keep the likely-eligible email unchanged.

## Check before sending
- Identify any other onboarding subjects recorded for Jo; distinguish recorded deliveries from code-only templates.
- Show onboarding and the new email side by side, each at 390px, with web fonts blocked.
- Only after Jo has seen the comparison, send one **[TEST v9 – onboarding style]** email to **jolowexo@hotmail.com**, using a TEST job and the existing recipient safeguard.
- Do not publish or send to real customers. The new campaign page remains preview-only until publishing; the live link may still show the older page.

## Technical details
- Extract the existing `simpleEmail` presentation into a browser-safe pure renderer; keep the onboarding wrapper’s output byte-identical.
- Reuse the extracted renderer directly in `renderLaunchCampaignEmail`; obtain the breakdown from its existing current-estimate inputs and verify totals reconcile.
- Regression-test shared markup, Group A/B content, link targets, subject/preview preservation and locked likely-email output.
- No database changes.