-- Decision 246 (Jo 24 Oct 2026): automatic offers by coverage, two switches, both OFF until Jo turns them on
-- (Settings › Switches). The code reads them fail-closed: while these columns are missing every automatic offer is
-- off and the office picks as today. Idempotent (`add column if not exists`) so the Settings build may add the same
-- columns first. Pending: proven on PGlite (tests/auto-offer-switches-practice-db.test.ts), then live with Jo's go.
alter table public.workflow_settings
  add column if not exists auto_installer_offers boolean not null default false;
alter table public.workflow_settings
  add column if not exists auto_electrician_offers boolean not null default false;
