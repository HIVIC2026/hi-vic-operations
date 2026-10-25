-- Decision 293 (Jo 25 Oct 2026): the electrician's "A5 – Electrical fixes" Mitti template id. NULL = not set up: the
-- portal raises the job-level "Fixes form not set up" office item when a fixes visit is booked and the electrician
-- records the fixes on the portal job page instead (the existing fallback). The id is written only by
-- connectMittiForm("fixes") after validateTemplate passes on the live template definition (same rule as the other
-- mitti_*_template_id columns). Idempotent (`add column if not exists`); never changes a value already saved.
-- Pending: proven on PGlite (tests/mitti-fixes-template-practice-db.test.ts), then live with Jo's go-ahead.
alter table public.workflow_settings
  add column if not exists mitti_fixes_template_id text;
comment on column public.workflow_settings.mitti_fixes_template_id is 'Decision 293: Mitti template id of "A5 – Electrical fixes" (electrician, later-visit repair work). NULL = not set up (portal fallback page).';
