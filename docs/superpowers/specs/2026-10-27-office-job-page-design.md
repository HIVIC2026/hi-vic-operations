# Office job page: next step first (design, 27 Oct 2026)

Mock-up Jo approved to build: "Job page mock-up" canvas (Blocked / Ready / Waiting).

## Goal (Jo's words, 27 Oct)

Opening a job on the phone is to **see what to do next**. Top of page: the next step and **what's blocking it**. Everything else: **hide behind taps**.

## Scope

Presentation only, `/admin/jobs/$jobId` (`admin.jobs.$jobId.tsx`, `office-job.tsx`). No change to workflow, wording rules, prices, permissions, guards or server writes. One new read on page load (below), read-only.

## The page, top to bottom

1. **Header (short).** ‹ Jobs, the status pill, the existing warning pills (TEST, Life support, Install by, ESC notice due), HV number, owner name, suburb + postcode. A **Contact** button opens Call / Text / Email plus street, phone, email, source and "Last heard from us". The More menu stays.
2. **Next box.** Same `next` data as today: who, sentence, one button.
   - When `next.blocked` is set, a **"Can't be done yet"** box under the sentence shows the reason (today a small red line).
   - When the next step is **Choose installer**, the page also reads the existing `listChooseTrades` (read-only, the same call the Choose installer panel already makes). If no installer can be offered, the box says so with each installer's reason, the button turns grey, and a "See installers ›" link opens the Ready Check stage.
3. **Stages.** Six one-line rows (✓ done, numbered now/next), using the existing stage card data: title plus one summary line. Tapping a row shows that stage's existing lines and **Open full details**, which opens today's stage tools (`StageWorkspace`) unchanged.
4. **Folded sections** (closed by default, tap to open): **Money**, **Contact history**, **File**. Each row shows a short hint (e.g. "No invoice yet", "12", "0 documents"). Inside is today's component, unchanged. AI reply drafts stay visible when there are any, because they need action.

Desktop (≥1024px) keeps the same order, wider.

## States

- Page loading or error: unchanged (already honest).
- Installer check loading: the Next box shows the button as normal plus a small "Checking installers…" line; if the check fails it says "Couldn't check installers" and the button still works (today's behaviour).
- **Choose installer panel blank pop-up:** the panel returns nothing while loading or on error (`choose-installer.tsx` line 28). It will show "Loading installers…" or "Couldn't load installers · Try again" instead. Same data, no rule change.

## Links that must keep working

`#stage-<key>`, `?section=`, `#stage-money`, `#stage-contact`, `?act=cancel`: each opens the matching row or section.

## Testing

- Existing job page tests (`office-phase3`, `estimate`, `email-buttons`, `portal-qa-screen-rules`) pass as before (pre-existing failures unchanged).
- New tests: the blocked line shows only when every installer has a reason; hash links open the right row; folded sections start closed.
- Pictures at 390px and 1280px of the three mock-up states, compared to the mock-up.
