-- Decision 246 (Jo, 24 Oct 2026): the two automatic-offer switches, shown and saved under Office › Settings › Switches.
-- BOTH OFF by default: with a switch off the office picks the installer / electrician as today (decisions 49, 157, 220).
-- The offer logic that reads them is the backend's (auto-offers); the office page only renders and persists them.
-- Pending: proven on the practice database (tests/office-settings-switches.pglite.test.ts) before any live run;
-- the code fails closed (switch shown off and not editable) while the columns are missing.
alter table public.workflow_settings
  add column if not exists auto_installer_offers boolean not null default false,
  add column if not exists auto_electrician_offers boolean not null default false;
