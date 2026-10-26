---
name: design-review
description: Structured design critique of a built portal screen against the portal kit, tokens and the redesign brief. Checks hierarchy, consistency, states, responsiveness and accessibility. Use when asked for a design review, critique, polish pass, or "how does this look" on portal UI after building it. Not a functional QA pass; that is `bun run portal-qa`.
license: Adapted from julianoczkowski/designer-skills (Apache 2.0); see LICENSE.txt
---

# Portal design review

Review what was built against what the portal already says good looks like. Report findings; do not fix them unless asked.

## 1. Read the brief and the system

Read these before judging anything. They are the brief; there is no separate `DESIGN_BRIEF.md`.

- The surface's design doc, if any: `docs/OFFICE_REDESIGN_PHASE3.md`, `docs/OFFICE_PORTAL_AUDIT_*.md`, `docs/INSTALLER_PORTAL_AUDIT_*.md`, reference mockups in `docs/HIV-design-suite.html` and `docs/designs/`.
- Tokens: `src/styles.css`, the `--hiv-*` palette and the `.portal-theme` block (`--primary` = hiv-blue, `--action`/`--success` = hiv-green, Figtree body at 14px, Outfit display, h1 30 / h2 21 / h3 16).
- Pieces: `src/components/portal/kit.tsx` (`PageHeader`, `Panel`, `Btn`/`btnClass`, `Pill`, `NowPanel`, `StatTile`, `Segmented`, `ListTable`, `RecordRow`, `WithAside`/`AsidePanel`, `NoteBox`, `Field`/`fieldInput`, `MenuPanel`).
- `AGENTS.md` and `src/AGENTS.md`. The redesign changes presentation only; never propose changes to domain guards, workflow or labels that contradict `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`.

If nothing names the intended direction for this screen, ask what it should achieve before reviewing.

## 2. Read the built code

For every changed component, route and style:

- Does it use kit pieces, or re-implement a card, button, pill or table the kit already has?
- Does it use tokens (`text-ink`, `text-sub`, `bg-paper`, `border-line`, `bg-mist`, `text-hiv-blue`...) or hardcoded hex, px radii and one-off font sizes?
- Duplicate components that should be consolidated; file names that break the folder's conventions.

## 3. Look at it

Code alone is not enough; review what a user sees. Use the first source that is available:

1. Screenshots the person pastes or attaches.
2. The latest `bun run portal-qa` output, `screens/*.png` at 390px and 1280px (see `docs/PORTAL_QA_RUNNER.md` for where it writes).
3. A browser you can drive against a local dev server or an isolated fixture (see the `webapp-testing` skill). Use existing TEST personas only, never click mutation controls, and keep screenshots out of git.

Cloud sessions usually cannot reach the live portal. If none of these is available, say so and ask for screenshots at **375, 430 (or 390) and 1280px** of each screen, plus any open menus, error, loading and empty states that matter. Do not present a code-only review as a visual one.

For each screenshot check: is the main action the most prominent thing, is spacing even, do colours match the token meanings, does text wrap rather than overflow on phones, and are there rendering faults (missing logo or font, clipped text, z-index, horizontal scroll).

## 4. Checklist

**Hierarchy.** One clear primary action per view (green `action` or blue `primary` Btn, not both competing). Headings follow the h1/h2/h3 scale. The current status or next step (`NowPanel`) is visible without scrolling on a phone.

**Consistency.** Same meaning, same colour, as `Pill` defines it: green = moving or done, rose = needs attention, plain (mist/blue) = waiting, amber = warning. Card radius 18px, button 10px, input 9px come from the theme, not inline classes. Similar lists use `ListTable`/`RecordRow` the same way across screens.

**Component quality.** Kit pieces used where they fit; new pieces follow the kit's prop and naming style and belong in `kit.tsx` if reused.

**States.** Default, hover, focus, disabled on controls; empty, loading and error on data. A failed read must say unavailable, never show zero or "all clear". Every action gives visible feedback.

**Responsive.** Works at 375, 430 and 1280px with no horizontal scroll. Layout reorganises on phones rather than shrinking. Touch targets at least 44px (buttons and inputs are 42px min-height; check icon-only controls). Long names, addresses and amounts wrap.

**Accessibility.** WCAG AA contrast (4.5:1 body, 3:1 large); `--hiv-sub` is tuned for this, so lighter custom greys are a finding. Visible focus ring (`ring-hiv-blue`). Headings in order, landmarks present, every input has a `Field` label, icon buttons have accessible names. Respect `prefers-reduced-motion`.

**Typography.** Figtree/Outfit actually load (fontsource). No arbitrary sizes outside the scale; body line length comfortable on desktop.

The portal has no dark mode; skip dark-mode checks unless the screen is outside `.portal-theme` and the project adds one.

## 5. Report

Present the review in the reply. Write it to a file only if asked; never commit screenshots or real customer data, and leave out private job identifiers and contact details.

```markdown
# Design review: [screen]

Reviewed against: [docs read]
Looked at: [screenshots/viewports, or "code only: no screenshots available"]

## Summary
[2-3 sentences: overall quality and the biggest finding.]

## Must fix
1. **[Issue]**: [what, where: file:line or screenshot]. _Fix: [concrete suggestion using kit/tokens]._

## Should fix
1. ...

## Could improve
1. ...

## What works well
[What to keep doing.]
```

Severity: **must fix** = broken, inaccessible, misleading status, or contradicts the brief; **should fix** = inconsistency, missing state, phone layout issue; **could improve** = polish.
