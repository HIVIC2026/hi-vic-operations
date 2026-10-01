# Fix: onboarding test links not loading

## What's wrong

The links themselves are fine — the pages load correctly. The problem is the **preview address** they point to:

- The preview link (`id-preview--...lovable.app`) is protected: anyone opening it who isn't signed in as staff gets a **401 / sign-in wall**. That's why the links "aren't loading" for you.
- The test mode (`?test=1`) and reset (`?reset=1`) features were built recently and are **preview-only** — they have never been published, so the public site (`hi-vic-operations.lovable.app`) doesn't have them yet either.

## The fix

**Publish the app.** That puts the test-mode and reset links onto the public address, which anyone can open with no sign-in:

- `https://hi-vic-operations.lovable.app/installer-onboarding?test=1&reset=1`
- `https://hi-vic-operations.lovable.app/electrician-onboarding?test=1&reset=1`

Publishing also takes live everything else currently waiting in preview:

- The redesigned public calculator (savings-first layout, "Register my interest" button, reworded register panel, no sticky bar)
- The editable $220 lead fee setting on Partner Enquiries
- The corrected installer agreement (version 1.6 — lead fee only on our leads)
- The onboarding wording fixes (bank details, capacity units, invite timing)

Everything above has already been tested (793 checks passing, verified on phone and desktop). Test applications are flagged in the database and can never be mistaken for real applicants, so publishing test mode is safe.

## Alternative (no publish)

If you'd rather not publish yet, you can open the preview links **while signed in to Lovable in the same browser** — the preview wall then lets you through. This works but is fiddly on a phone.

## Recommendation

Publish now — the calculator and onboarding are the two things you want people using, and both are ready.
