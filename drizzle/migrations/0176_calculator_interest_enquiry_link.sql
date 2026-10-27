alter table public.calculator_interests add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.calculator_interests add column if not exists intake_error text;
create index if not exists calculator_interests_job_idx on public.calculator_interests (job_id);