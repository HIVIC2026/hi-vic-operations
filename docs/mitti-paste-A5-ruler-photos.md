# Mitti paste — A5 Install day: the two ruler photos per ceiling area (decision 396)

Jo, 26 Oct 2026: "A5 asks both ruler photos". The ESC Ceiling Insulation Activity Guide v1.2 (Table 4) needs, for every
ceiling area, a timestamped, geotagged photo with a vertical ruler showing the EXISTING insulation depth (only areas that
had insulation) and one showing the NEW insulation depth after the install. The portal reads both by their exact wording
(`src/lib/install-day.core.ts` `INSTALL_DAY_RULER_Q`) and holds "Installation complete" until every area has them.

Copy everything in the box below into ChatGPT.

```
Edit the Mitti template "A5 – Install day" (template ID 1f325828-3f71-4b1a-988f-083c83414f95). Add ONLY what is listed here, then publish.

1. Add a NEW page called "Ruler photos (each ceiling area)". Put it straight after the page with "Photo of the packaging showing brand, model and R-value" and BEFORE the declaration page (the one starting "INSTALLER DECLARATION – Sign BEFORE insulation work starts.").

2. On that page, add ONE repeating section with the button "Add a ceiling area". Help text on the section: "Add one for each ceiling area, in the same order as the Ready Check areas."

3. Inside the repeating section, add these two questions, in this order. Copy the wording exactly, character for character, including the long dash (—):

   a. "Existing insulation depth — photo with a ruler standing upright in it" — Photo, location (GPS) on — NOT required — help text: "Only if this area had insulation before. Take it before any work starts."
   b. "New insulation depth after install — photo with a ruler standing upright in it" — Photo, location (GPS) on — Required — help text: "Come back to this page when the insulation is in. Don't squash it."

   This form has no "is there existing insulation in this area?" question of its own, so do NOT add any "only show when" logic to question a. Leave it not required; the portal checks it against the Ready Check for each area.

They must be inside the repeating section, so every ceiling area gets its own pair of photos. Do not add them anywhere else.

Change nothing else: no other question, wording, order, colour or setting. Publish.
```

After publishing: a form already sent to an installer before this change may not carry the new page. If an install day
form is missing it, the portal says "The install day form has no ruler photo questions yet …" — send a new form.
