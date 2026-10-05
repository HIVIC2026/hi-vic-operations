# Final portal design (Jo approved 5 Oct) — queued, preview only

Replaces the discarded "warm and friendly" plan. Starts after the bulk-upload fixes, the file-viewer fix and the installer commercial build. Look, layout and screen structure only: no changes to rules, gates, data or compliance wording. Before/after screenshots (desktop 1280 + phone 390) at every stage.

## Look
The public calculator look, used across the whole portal: Outfit 800 headings, Figtree body. Canvas #FBFCFA, navy #22376B text, blue #3C51C4 for selection and links, mist #F3F6FF and mint #EDFAF2 panels, blush #FDF2F6, lines #E4E9F5. Main action buttons are green #07BF61 with white text. White cards about 22px radius with the calculator's soft shadow. The logo goes on every screen header and the office menu. Labels in sentence case.
Signature: a house outline (navy stroke) whose roof cavity fills with pink #F4A9C7 as the job moves forward. It's the progress indicator on job pages, upload and sign-off.

## Stages (size)
1. **Foundation (M)**: portal-wide tokens taken from the calculator, logo header and menu shell, card/button/pill/photo-tile/lock-message/bottom-action pieces, and the HouseProgress component (fill = existing stage position, display only).
2. **Office Today (M)**: menu groups Work / Partners / Money (incl. Payouts). "Good morning, Jo — N items need your decision". One decision strip sorted by urgency (deadlines within 48h, sign-offs, quotes to send, tidy-ups), pipeline counts by stage, upcoming deadlines table with "owner of task", partner activity. Everything comes from data that already exists.
3. **Office job page (L)**: clickable stage timeline (it moves between views, never changes the stage), one "what to do now" card running the existing action, a "rules for this stage" checklist showing x of y met (taken from the existing guards), "what everyone sees right now" (installer / electrician / homeowner), money strip (installer price, customer pays, VEU discount, our margin), activity log.
4. **Trade and homeowner job screens, phone first (L)**: logo + address + house-progress header, a deadline strip when relevant, one next-step card, evidence as a photo-tile grid (have = filled with a tick, missing = dashed), plain lock messages, a fixed bottom action button. The electrician sees nothing before the electrical stage and never sees prices; the address stays hidden until they accept (existing rules, re-checked). The homeowner sees one clear step per stage, with the quote shown as invoice lines.
5. **Upload leads (M)**: one screen with a drop box, the permission tick and Upload. The result reads "N customers added" plus only the items that need the user: an inline address question with Save, and unplaced photos with "choose customer". Per-file results move behind "See what we read". The reading and matching logic stays the same.
6. **AP sign-off (M)**: exception-first. It opens with "X of Y checks passed on their own" and shows only the flagged items, each with its photo and "It's fine" / "Ask for a retake". One green "Approve and lodge N VEECs" button stays disabled until all flags are resolved and still approves through the existing one-job-at-a-time queue. "See all photos and checks" opens the full grid and rules.

## Guardrails
- Locked likely-eligible email stays byte-identical (hash check); Base44 public site untouched.
- Exact labels kept: "Start assessment", "Start install"; compliance/official wording unchanged.
- No database changes expected; if one turns up, it's proven on the practice database first.
- "It's fine" / "Ask for a retake" use the existing evidence verify/reject actions; no new automatic approval.
- After each stage: focused tests, wording scan, build, screenshots.

## Open points
- Supersedes the locked Space Grotesk/DM Sans portal brand rule (memory updated).
- If a stage needs a fact the data doesn't hold yet (e.g. an "owner of task" for some deadline types), it shows "Office" and I'll flag it rather than invent it.
