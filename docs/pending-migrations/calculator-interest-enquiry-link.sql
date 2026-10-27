-- Jo 27 Oct: a calculator registration starts the normal website enquiry journey. Each registration row records the
-- enquiry (job) it created or matched. Additive, nullable; existing rows stay unlinked (no backfill until Jo decides).
-- Proven on PGlite: tests/calculator-interest-link-practice-db.test.ts.
alter table public.calculator_interests add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.calculator_interests add column if not exists intake_error text;
create index if not exists calculator_interests_job_idx on public.calculator_interests (job_id);
