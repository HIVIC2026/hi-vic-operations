> [!WARNING]
> **RETIRED (5 Oct 2026) — this Open Sans / blue-hero / offset-shadow look is no longer our brand. Do not use. Current brand = the live calculator look (.estimate-brand), see .lovable/memory/design/final-portal-design.md.**

# Likely-eligible email brand QA — 29 September 2026

## Scope

Visual-only brand match for the itemised likely-eligible email and its preview. Onsite-confirmation and ineligible renderers were not changed. Quote arithmetic, approved wording, URL validation, tracking, referral and unsubscribe behavior were preserved.

## Authoritative references

- Live website inspected: https://homeinsulationvictoria.com.au/
- Active Base44 page supplied by owner: `src/pages/Home.jsx`
- Base44 global font source supplied by owner: `src/index.css`
- Exact logo: `/home-insulation-victoria-logo.png`; SHA-256 `e556bb8eb15a4d1703f710f66df100cab227d4877e78c738d51dbae89cd12d07`

## Before

- The standalone email named Open Sans but did not load it, so the sandboxed preview used a fallback font.
- The likely-email hero used blue text on white rather than the website's full-width blue hero.
- CTA radius, spacing, typography and shadows did not match the active website.
- The preview rendered two very tall frames together, making mobile review cumbersome.

## After

- Standalone likely-email HTML loads Open Sans 400/600/700/800 in a non-MSO conditional; Outlook retains Arial/Helvetica fallback.
- Logo asset hash matches the Base44 logo exactly.
- Hero uses `#3c51c4`, white text, mint `#93f3b6` eyebrow, Open Sans 800, and the website's compact uppercase proportions.
- The itemised quote is the only `#52c875` offset-shadow card, with a 2px blue border and 24px desktop radius.
- CTAs are rectangular blue/white with crisp green offset shadows.
- Footer uses `#f1f8f3`, navy/blue type and a green rule.
- Responsive email rules use 18px horizontal mobile padding, 24px mobile hero type, and fixed amount columns to prevent crushed labels.
- Preview defaults to responsive Fit and offers explicit 640px desktop and 390px mobile switches. Sample links are inert only in the preview.

## Live computed-style evidence

At 1280px, the Base44 hero heading reported Open Sans 800, 56px, 51.52px line-height, -2.8px tracking, white on `#3c51c4`. The eyebrow reported 12px Open Sans 800 with 2.04px tracking and `#93f3b6`. The CTA reported white background, blue type and a crisp 6px green offset shadow.

At 390px, the hero heading reported Open Sans 800, 24px, 22.56px line-height, -1.2px tracking. The logo rendered 112.27×48px. Pathway cards reported a 19.2px radius and a 3px/4px `#52c875` offset shadow.

## Regression evidence

Before/after SHA-256 hashes for complete rendered payloads remained identical:

- Onsite-confirmation: `07bacd5d2ab0a90ffcea7d7abcc2f90a23ce06b495e15c3ba0c01b184ec0ef27`
- Ineligible: `4e26d12799bd4f6318c609de8c032f9df1783542083544dec2c691711e59c75f`