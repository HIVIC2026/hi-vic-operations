# Final portal design (Jo approved 5 Oct) — queued, preview only

Replaces the discarded "warm and friendly" plan. Starts after the bulk-upload fixes, the file-viewer fix and the installer commercial build. Look, layout and screen structure only: no changes to rules, gates, data or compliance wording. Before/after screenshots (desktop 1280 + phone 390) at every stage.

## Look
The public calculator look, used across the whole portal: Outfit 800 headings, Figtree body. Canvas #FBFCFA, navy #22376B text, blue #3C51C4 for selection and links, mist #F3F6FF and mint #EDFAF2 panels, blush #FDF2F6, lines #E4E9F5. Main action buttons are green #07BF61 with white text. White cards about 22px radius with the calculator's soft shadow. The logo goes on every screen header and the office menu. Labels in sentence case.
Signature: a house outline (navy stroke) whose roof cavity fills with pink #F4A9C7 as the job moves forward. It's the progress indicator on job pages, upload and sign-off.

## Stage 1 first: structure fix (Jo to approve the menu and rename list before any page is built)
Jo's feedback: there's no flow, it's hard to find things, and pages are crammed with information and tags that don't help. Fix the structure first, then the colours. Labels and layout only: no rule, gate, data or official wording changes. Old addresses keep working and send people to the new page.

### Office menu: 22 items today, 7 after
| Old menu item | New |
|---|---|
| Today | **Today** |
| To action | Merged into **Today** (the decision strip) |
| Daily brief (on Today) | Stays in **Today** |
| Pipeline | **Jobs** (default view: by stage) |
| Active jobs | Merged into **Jobs** (filter "In progress") |
| Pending quote approval | Merged into **Jobs** (filter "Quote to send") |
| Ineligible | Merged into **Leads** (filter "Not eligible") |
| Enquiries | **Leads** |
| Enquiry email groups | Merged into **Leads** (behind "More") |
| Registered interest | Merged into **Leads** (filter "Out of area") |
| AP approval queue | **Sign-off** |
| VEECs | Merged into **Sign-off** (tab "Lodged") |
| Compliance | Merged into **Sign-off** (tab "Checks") |
| Approved partners | **Partners** |
| Partner applications | Merged into **Partners** (tab "Applications") |
| Staff approvals | Merged into **Partners** (tab "Workers") |
| Electrician team-ups | Merged into **Partners** (tab "Team-ups") |
| Service coverage | Merged into **Partners** (tab "Coverage") |
| Electrician rates | Merged into **Money** (tab "Rates") |
| Prices & margins | **Money** (tabs: Payouts, Prices and margins, Rates) |
| Customer communications | Moved to **Settings** (tab "Emails") |
| Users & access | Moved to **Settings** (tab "People and access") |
| Test Centre | Moved to **Settings** (tab "Testing"), off the menu |

New office menu (7): **Today · Jobs · Leads · Sign-off · Partners · Money · Settings.** The red count only shows next to Today.

### Partner, trade and homeowner menus
- **Installer:** Today (offers and next steps) · My jobs · Add customers (Bulk upload + Import existing job merged into one) · My business (Business profile + Staff). That's 4 items, down from 6.
- **Electrician:** Today (offers) · My jobs · My business. That's 3. They never see prices; the address stays hidden until they accept (unchanged).
- **Homeowner:** a single "My home" page with no menu, showing one step at a time.
- The top-bar links "Partner", "My jobs" and "My home" are replaced by the person's own menu.

### Rename list (shown everywhere: titles, buttons, status words, column headers)
| Now | New |
|---|---|
| AP approval queue / AP review & VEECs / Gate 6 · AP compliance review | Sign-off |
| To action | Needs you |
| Pending quote approval | Quote to send |
| Registered interest | Out of area |
| Ineligible / Does not appear eligible (office lists) | Not eligible |
| Approved partners | Partners |
| Partner applications | Applications |
| Staff approvals / Staff | Workers |
| Electrician team-ups | Team-ups |
| Service coverage / Trade coverage | Coverage |
| Prices & margins / Internal pricing (admin only) | Prices and margins |
| Users & access | People and access |
| Customer communications / Correspondence & history | Emails / History |
| Partner dashboard / Partner | Today |
| Business profile | My business |
| Bulk upload / Import existing job / Attach quote, job sheet… | Add customers |
| Gate 1 · Eligibility | Eligibility |
| PIESA records (entered once by the electrician) | Safety check record |
| PIESA 30-day installation window | Install deadline |
| Electrical assessment record / 2 · Electrical safety | Electrical check |
| People, source & exceptions | People |
| Existing quote lines (kept as source context) | Original quote |
| Margins at current prices (approved trades) | Margins |
| Your task: free Ready Check — eligibility measure-up | Ready Check |
Kept exactly as they are: "Start assessment", "Start install", the official PIESA/PIISA/VEU/Activity 48 terms on forms and agreements, and the customer-facing name "Free Insulation Measure-Up & Eligibility Check".

**Status words (the same small set everywhere, at most one per row):** New · Needs you · Waiting on owner · Waiting on trade · Booked · Blocked · On hold · Done · Cancelled. The 21 pipeline stages stay as they are in the data and in the job timeline. Lists show one of these words, and only when it helps someone decide something. Decorative, duplicate and "source" pills are removed from rows; the source shows on the job page.

### Page rules
- Every page opens with one heading, one sentence on what it's for, and the main action (green). Everything else sits behind "More" or on the detail page.
- Tables show only what's needed to decide. Jobs: Job · Address · Stage · Next step · Due. Leads: Name · Suburb · Result · Received. Partners: Name · Type · Status · Area. Everything else moves to the detail page.
- Each person sees one next step at a time, the same in every portal.

### Build order once approved
1a menu and redirects → 1b renames and status words → 1c page tops, columns and tag clean-up → then the look stages below. Before/after screenshots at desktop and 390px phone for every step.

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
