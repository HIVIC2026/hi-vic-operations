
alter type public.job_stage add value if not exists 'awaiting_deposit_payment' after 'awaiting_owner_rectification_approval';

create type public.payment_status as enum ('invoice_not_created','invoice_created','deposit_due','deposit_paid','balance_due','fully_paid','overdue','xero_sync_error');

alter table public.owners add column if not exists xero_contact_id text;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  quote_id uuid not null unique references public.quotes(id) on delete restrict,
  kind public.quote_kind not null,
  status public.payment_status not null default 'invoice_not_created',
  -- Xero mapping (Xero is the system of record)
  xero_contact_id text,
  xero_invoice_id text unique,
  xero_invoice_number text,
  xero_reference text,
  xero_online_url text,
  -- amounts, all inc GST
  total_inc_gst numeric(10,2) not null,
  deposit_pct numeric(5,4) not null default 0.5,
  deposit_amount numeric(10,2) not null,
  deposit_due_date date not null default current_date,
  deposit_paid_amount numeric(10,2) not null default 0,
  deposit_paid_at timestamptz,
  balance_amount numeric(10,2) not null,
  balance_due_date date,               -- = scheduled installation date
  total_paid numeric(10,2) not null default 0,
  -- sync
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.invoices(job_id);
create trigger t_invoices before update on public.invoices for each row execute function public.touch_updated_at();

create table public.payment_overrides (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  gate text not null check (gate in ('deposit')),
  reason text not null check (length(reason) >= 5),
  overridden_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.invoices, public.payment_overrides to authenticated;
grant all on public.invoices, public.payment_overrides to service_role;
alter table public.invoices enable row level security;
alter table public.payment_overrides enable row level security;
create policy "admin_all" on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all" on public.payment_overrides for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "owner_read" on public.invoices for select to authenticated using (public.is_job_owner(job_id, auth.uid()));
create policy "trade_read" on public.invoices for select to authenticated using (public.job_assignment_role(job_id, auth.uid()) is not null);

-- Central derived payment state (time-dependent parts computed at read time)
create or replace view public.invoice_payment_state with (security_invoker = true) as
select i.*,
  (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')) as deposit_cleared,
  case
    when i.status in ('invoice_not_created','xero_sync_error') then i.status
    when i.total_paid >= i.total_inc_gst then 'fully_paid'::public.payment_status
    when i.deposit_paid_at is null and i.deposit_due_date < current_date - 7 then 'overdue'::public.payment_status
    when i.deposit_paid_at is null then 'deposit_due'::public.payment_status
    when i.balance_due_date is not null and i.balance_due_date < current_date then 'overdue'::public.payment_status
    when i.balance_due_date is not null and i.balance_due_date <= current_date then 'balance_due'::public.payment_status
    else 'deposit_paid'::public.payment_status end as effective_status
from public.invoices i;
grant select on public.invoice_payment_state to authenticated;
grant all on public.invoice_payment_state to service_role;

create or replace view public.job_overview with (security_invoker = true) as
select j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support,
       j.last_activity_at, j.created_at, j.hold_reason,
       pr.id as property_id,
       concat_ws(', ', pr.address_line, pr.suburb, pr.state || ' ' || coalesce(pr.postcode,'')) as property_address,
       o.id as owner_id, o.full_name as owner_name, o.phone as owner_phone, o.email as owner_email,
       ea.user_id as electrician_id, ep.full_name as electrician_name,
       ia.user_id as installer_id, ip.full_name as installer_name,
       d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
       (select p.effective_status::text from public.invoice_payment_state p where p.job_id = j.id order by p.created_at desc limit 1) as payment_status
from public.jobs j
join public.properties pr on pr.id = j.property_id
join public.owners o on o.id = j.owner_id
left join public.job_assignments ea on ea.job_id = j.id and ea.active and ea.role = 'electrician'
left join public.profiles ep on ep.id = ea.user_id
left join public.job_assignments ia on ia.job_id = j.id and ia.active and ia.role = 'installer'
left join public.profiles ip on ip.id = ia.user_id
left join public.job_piesa_deadlines d on d.job_id = j.id;
