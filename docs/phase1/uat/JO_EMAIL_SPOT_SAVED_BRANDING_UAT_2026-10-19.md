# Jo's T1–T8 email templates — reuse the original Spot Saved design

**Date:** 2026-10-19
**Branch:** `fix/jo-email-preview-and-branding`
**Commit:** `0fb9c906` (merge of `origin/main` @ `beb7250e` into the branding work)
**Scope:** presentation only. Jo's approved copy, CTAs, send gates, suppression and approval wording are unchanged. No production deploy, no customer email sent.

---

## 1. Why this change

Jo rejected the earlier header built with `V2_THEME.header` (logo + `JO_BADGE`). The instruction was to reuse the **original Spot Saved email design**: the per-owner campaign art image (logo + caps line + headline drawn into one PNG) as the header — while keeping the size-preview fix already made and Jo's approved copy verbatim.

## 2. What changed (source of truth)

File: `src/lib/jo-outcome-email.core.ts`

- Removed `JO_BADGE` and every `V2_THEME.header(badge)` usage.
- `joShell(...)` now receives the header row as a parameter instead of embedding a fixed badge header.
- New `joHeader()` builds the Spot Saved art row through the existing `campaignArtImg` + `emailArtUrl` helpers:
  - **T1–T6** → `headline` art (logo + `FREE ESTIMATE` caps line + rebate headline).
  - **T8** → `spot` art.
  - **T7** → the same logo **alone** (ineligible: no estimate / no rebate art applies), never a badge.
- `originAndToken()` accepts both `/estimate/{token}` and `/my-estimate/{token}`.
- `firstHeadline()` supplies Jo's own first line as the image `alt`/fallback text.
- Jo's copy, CTA placeholders and the shared approved button are untouched.

Test updated: `tests/jo-email-size-and-branding.test.ts` — asserts the art header (`email-art` / `hiv-logo`), the shared shell class, and the **absence** of `class="lx-badge"` on T1–T8.

The Templates-preview sample data is also template-specific now (`template-hub.tsx`: 210 m² known / 150 m² assumed), so the preview no longer shows a misleading shared size.

## 3. Automated verification

| Suite | Result |
|---|---|
| `tests/jo-email-size-and-branding.test.ts` | **19 / 19 pass** |
| `tests/jo-email-templates.test.ts` | **31 / 31 pass** |
| `tests/p1-r3-s92-jo-wired-templates.test.ts` | **61 / 61 pass** |

- Merge of the latest `origin/main` is clean (no conflicts).
- `bun run build` succeeds (`✓ built`, nitro prebuilt ready).
- Full suite: 360 files, **3433 pass / 121 fail**. The 121 failures are **pre-existing on `origin/main`**: the same failures reproduce on a pristine `origin/main` worktree (sample: `tests/lifecycle-emails.test.ts` → 19 pass / 2 fail on `beb7250e`). None of the Jo email suites are among them. They are unrelated to this change.

## 4. Browser UAT (visual)

**Method.** The real email HTML was rendered through the **production renderers** (`renderJoOutcomeEmail` / `renderJoReadyCheckInvitationEmail`), the actual header art PNGs were drawn with `email-hero.core`, and both the art and the logo were inlined. Each template was then screenshotted at **desktop (760 px)** and **mobile (390 px)** with headless Chrome — no live server, no database, no send.

Script: `scripts/gen-jo-email-previews.ts`.

**Results.**

- All of T1–T8 render inside the 640 px Spot Saved shell with a single branded footer.
- **T1–T6 and T8** show the campaign art header (logo + caps line + headline). **T7** shows the logo alone. **No `lx-badge` anywhere.**
- Size wording is correct per template: T1/T3/T5 → `150 m² — estimated, not measured`; T2/T4/T6 → `210 m² — based on the size you provided`.
- T5/T6 keep the **Upload my photos or video** CTA only; T1–T4 keep **Save my spot**; T7 keeps **Review my result**; T8 keeps **Book my Ready Check**.
- Unsubscribe slot filled once; no CTA placeholder survives.

Screenshots (`docs/phase1/uat/screenshots/jo-email-2026-10-19/`):

- `summary_desktop.png` — all 8 templates side by side (desktop)
- `summary_mobile.png` — all 8 templates side by side (mobile)
- `T1_desktop.png` … `T8_desktop.png` — per-template desktop close-ups

## 5. Deployment status

- Work is on `fix/jo-email-preview-and-branding`, pushed to `origin` (`0fb9c906`).
- **Not merged to `main`** — no production / Lovable build triggered. Awaiting sign-off.
- Send rules, `customer_comms_enabled`, backlog cut-off, `emailSuppression` and approval copy unchanged.

## 6. Next step

On Jo's sign-off: merge `fix/jo-email-preview-and-branding` → `main` → let Lovable rebuild → re-check `/admin/templates` for each template. The deployment itself is a single merge; no SQL changes are required.
