# A5 — one BEFORE page (Jo, 5 November 2026, 7:32pm)

Copy the instructions below into Mitti's form builder. Do not change or publish any other form.

```text
Edit the existing “A5 – Install day” form. Do not create a second template.

Add one page called “BEFORE photos”. Put it after the isolation and safe-to-enter checks, before insulation or removal work starts. Keep the existing declaration and all AFTER pages unchanged.

At the top, add this text:
“BEFORE WORK: Take these photos before removing or installing any insulation. The power is off, so use a bright torch or work light.”

Add this text field, prefilled by the portal, read-only and optional:
“Ceiling areas in Ready Check order”

Add a repeating section called “Ceiling area BEFORE work”.
Button: “Add a ceiling area”
Help: “One for each ceiling area, in the same order as the Ready Check.”

Inside each area, use these exact labels in this order:

1. “Ceiling area name”
   Text. Prefilled from the Ready Check where the section already has its own item ID. Read-only when prefilled. Do not rename an area.

2. “Before photo: the whole ceiling area showing what's there”
   Photo. REQUIRED for every area. Location (GPS) and capture time on.
   Help: “Show the whole area clearly, before any removal or installation.”

3. “Before photo: old insulation with a ruler standing upright in it”
   Photo. Location (GPS) and capture time on.
   Help: “Only if this area has old insulation. Show its depth before any work starts. Don't squash it.”
   Required when old insulation is present. Do not ask the installer again whether old insulation is present: use the Ready Check fact. If Mitti cannot use that saved fact for conditional requiredness, leave this item optional in Mitti; the portal still requires it for every area with old insulation (and holds an unknown insulation state for review).

Do not add a BEFORE video, backing photo or new measurement question.
Keep the current AFTER videos and AFTER ruler/depth-photo questions exactly as they are.
Do not change A1, A2, A3 or A4.
```

## Compatibility and prefill limits

- The portal reads the new named BEFORE sections and current v23 without a BEFORE page. The new page is enforced when present; v23 is not given a new missing-page block before it is republished. Existing v23 AFTER and old-depth checks remain.
- Ready Check videos no longer hold A5 completion. New BEFORE whole-area and old-depth photos must be on A5; Ready Check photos cannot substitute for them.
- Each area name is matched independently; a missing, duplicate or unexpected name holds completion. GPS/time and before-work timing are checked. Private file copying must succeed before completion clears.
- The portal fills the area-order field and existing section name fields using actual Mitti item IDs. Creating extra repeat instances automatically is not proven by Mitti's API; no payload is invented. Before publishing, confirm the draft supplies a distinct name field for each area or that Mitti supports repeat-instance prefills. Until that is proven, automatic prefilling of every dynamically added repeat is NOT VERIFIED.
- No Mitti template was edited, no messages sent, and no form published by this change.