# Mitti forms A1–A5

The questions each Mitti form asks are defined in code and shown on the office Templates page (More › Templates › Mitti forms):

- A1 Ready Check — installer's own customer: `src/lib/mitti-forms.core.ts` `FORMS.ready_check_priced` · prompt `docs/MITTI_READY_CHECK_PRICE_PROMPT.md` · published copy `tests/fixtures/mitti-ready-check/a1-published-r35.json`
- A2 Ready Check — our lead: `FORMS.ready_check` · prompt `docs/MITTI_READY_CHECK_ONE_PROMPT.md` · published copy `tests/fixtures/mitti-ready-check/a2-published-r13.json`
- A3 Install day: `src/lib/install-day.core.ts` `INSTALL_DAY_QUESTIONS` · prompt `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` · published copy `tests/fixtures/a3-published-2026-10-25-read-first.json`
- A4 Electrical safety check (PIESA): `FORMS.piesa` · prompt `docs/MITTI_PIESA_BUILD_PROMPT.md`
- A5 Electrical fixes: `src/lib/fixes-day.core.ts` `FIXES_DAY_QUESTIONS` · prompt `docs/MITTI_FIXES_FORM_PROMPT.md`
