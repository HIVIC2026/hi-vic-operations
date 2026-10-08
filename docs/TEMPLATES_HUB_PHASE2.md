# Phase 2 — Templates hub + operations preview flags (8 Oct 2026)

Baseline: `e6f77ed374efc82290ec1f5ecb4c51f90ff28a4b`. No database writes, migrations, sends, Mitti calls, cron runs or publishing. No router changes.

## Links
- Templates: `/admin/templates?cat=email|mitti|compliance&t=<entry id>` (one office heading "Templates"; tabs Email / Mitti / Compliance).
- Operations preview: `/admin/operations-preview` (direct link only; still not in navigation).
- Original tools still valid: `/admin/communications` (now accepts `?key=<template key>`), `/admin/compliance` (accepts `?key=` to preselect "Add a version"), `/admin/owner-paperwork`, `/admin/campaign-emails`, `/step3-email-preview`.

## What changed
- Operations preview: "Spot saved" (saved, not active/closed, any current stage) and "Photos/videos to review" (received, no office review, not closed) counts are clickable filters that combine with source/eligibility/search; stage totals unchanged.
- Templates hub reads the existing registers (moved verbatim to `src/lib/template-catalog.ts`) and renderers; email samples moved verbatim to `src/lib/step3-email-samples.ts`. Only the selected entry is mounted. Emails show in a fully sandboxed frame (exact HTML, links inert). Mitti "Check & connect" runs only on press (existing guarded function). Compliance "Approve & activate" is the existing guarded action, drafts only; approved versions immutable. PIESA/PIISA/Ready Check register entries link to Mitti entries instead of copies.

## Verification
- 71 focused tests pass across 10 files (new `tests/templates-hub.test.ts`, preview flags, email parity, partner templates, owner paperwork, nav). `tsgo` clean; harness `build OK`. Retired-term scan: 27 existing warnings, 0 customer-visible. Full `./tests/` run exceeded the 5-minute limit and was not completed.
- Isolated browser fixtures (`tests/templates-hub.html`, `tests/operations-preview.html` via `vite.portal-browser.config.ts`, port 4178): desktop 1280 and phone 390 — selected template visible at top of page (y=150 desktop, y=252 phone), correct content after Email→Mitti→Compliance changes, no horizontal overflow, no page errors, zero save/approve/send/connect calls. Preview flag tiles filter correctly at both widths.
- Signed-out: `/admin/templates` and `/admin/operations-preview` redirect to `/auth?next=…`.

## Unresolved (auth)
- Authenticated admin GET/PostgREST load of `/admin/operations-preview` and `/admin/templates` NOT verified: no session for the requesting user; minting the TEST admin session needs user approval, unavailable in this run. Non-admin denial also not browser-tested (source guard only: `_authenticated/admin.tsx` redirects non-admins to `/home`; server functions call `requireAdmin`).

## Rollback by file
Delete: `src/routes/_authenticated/admin.templates.tsx`, `src/components/portal/template-hub.tsx`, `src/lib/template-hub.core.ts`, `tests/templates-hub.test.ts`, `tests/templates-hub.browser.tsx`, `tests/templates-hub.html`, `tests/templates-hub-stubs.ts`.
Restore from baseline: `src/lib/office-nav.ts`, `src/components/portal/office.tsx`, `src/components/portal/AppShell.tsx`, `src/routes/_authenticated/admin.communications.tsx`, `src/routes/_authenticated/admin.compliance.tsx`, `src/components/portal/mitti-forms.tsx`, `src/routes/step3-email-preview.tsx`, `tests/step3-email-parity.test.ts`, `src/lib/operations-preview.core.ts`, `src/components/portal/OperationsPreview.tsx`, `tests/operations-preview.test.ts`, `vite.portal-browser.config.ts`, `tests/portal-browser-serverfn-stub.ts`, `tests/portal-browser-router-stub.tsx`, `tests/portal-browser-functions-stub.ts`; then delete `src/lib/template-catalog.ts` and `src/lib/step3-email-samples.ts`.
