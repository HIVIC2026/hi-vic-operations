-- ===== Owner Authority =====
create type public.authority_status as enum ('not_requested','sent','viewed','accepted','declined','expired','revoked');
create type public.assistance_requirement as enum ('none','interpreter','support_understanding','both');

alter table public.workflow_settings add column if not exists authority_validity_months integer not null default 3;

create table public.owner_authorities (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  owner_id uuid not null references public.owners(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  version integer not null,
  status public.authority_status not null default 'sent',
  wording_version text not null,
  wording_snapshot text not null,
  scope_snapshot text not null,
  ap_legal_entity text not null default 'DC Construction Solutions trading as Home Insulation Victoria',
  owner_full_name text not null,
  owner_email text,
  owner_phone text,
  property_address text not null,
  confirmed_over_18 boolean,
  confirmed_owner_or_authorised boolean,
  assistance_requirement public.assistance_requirement,
  acceptance_method text,
  signature_name text,
  ip_address text,
  user_agent text,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  viewed_at timestamptz,
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  expires_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  expired_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  document_path text,
  document_sha256 text,
  event_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, version)
);
create index owner_authorities_job_idx on public.owner_authorities(job_id, version desc);

grant select on public.owner_authorities to authenticated;
grant all on public.owner_authorities to service_role;
alter table public.owner_authorities enable row level security;
create policy admin_all on public.owner_authorities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy owner_read on public.owner_authorities for select to authenticated using (public.is_job_owner(job_id, auth.uid()));

-- Immutability: snapshot & acceptance evidence can never change once written; rows can't be deleted.
create or replace function public.guard_owner_authority()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'owner_authorities are permanent records'; end if;
  if new.job_id <> old.job_id or new.owner_id <> old.owner_id or new.property_id <> old.property_id
     or new.version <> old.version or new.wording_version <> old.wording_version
     or new.wording_snapshot <> old.wording_snapshot or new.scope_snapshot <> old.scope_snapshot
     or new.ap_legal_entity <> old.ap_legal_entity or new.owner_full_name <> old.owner_full_name
     or new.property_address <> old.property_address or new.requested_at <> old.requested_at then
    raise exception 'authority snapshot is immutable – issue a new version instead';
  end if;
  if old.accepted_at is not null and (
       new.accepted_at is distinct from old.accepted_at or new.expires_at is distinct from old.expires_at
    or new.confirmed_over_18 is distinct from old.confirmed_over_18
    or new.confirmed_owner_or_authorised is distinct from old.confirmed_owner_or_authorised
    or new.assistance_requirement is distinct from old.assistance_requirement
    or new.signature_name is distinct from old.signature_name or new.ip_address is distinct from old.ip_address
    or new.user_agent is distinct from old.user_agent or new.acceptance_method is distinct from old.acceptance_method
    or new.accepted_by is distinct from old.accepted_by
    or (old.document_sha256 is not null and new.document_sha256 is distinct from old.document_sha256)) then
    raise exception 'accepted authority evidence is immutable';
  end if;
  if old.status in ('declined','revoked','expired') and new.status <> old.status then
    raise exception 'authority in a terminal state cannot change status – issue a new version';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger owner_authorities_guard before update or delete on public.owner_authorities
  for each row execute function public.guard_owner_authority();

-- Effective status (time-based expiry needs no cron) – security definer so trades see only the status.
create or replace function public.job_authority_status(_job uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.id is null then 'not_requested'
    when a.status = 'accepted' and a.expires_at < now() then 'expired'
    else a.status::text end
  from (select 1) x
  left join lateral (select * from public.owner_authorities where job_id = _job order by version desc limit 1) a on true
  where public.can_access_job(_job)
$$;
create or replace function public.job_authority_expires_at(_job uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select expires_at from public.owner_authorities where job_id = _job and public.can_access_job(_job) order by version desc limit 1
$$;

-- ===== Payments hardening =====
alter table public.invoices add column if not exists balance_paid_at timestamptz;
alter table public.invoices add column if not exists xero_invoice_status text;
alter table public.payment_overrides add column if not exists before_state jsonb;
alter table public.payment_overrides add column if not exists after_state jsonb;

create or replace function public.invoice_deposit_cleared(_inv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices i where i.id = _inv and public.can_access_job(i.job_id)
    and (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')))
$$;
-- Job-level deposit gate for display to trades (boolean only, no amounts).
create or replace function public.job_deposit_cleared(_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.invoice_deposit_cleared(i.id) from public.invoices i
    where i.job_id = _job and i.kind = 'installation' order by i.created_at desc limit 1), false)
  and public.can_access_job(_job)
$$;

-- Trades no longer read invoices at all; owners read only customer-facing columns.
drop policy if exists trade_read on public.invoices;
revoke select on public.invoices from authenticated;
grant select (id, job_id, quote_id, kind, status, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct,
  deposit_amount, deposit_due_date, deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date,
  balance_paid_at, total_paid, created_at, updated_at) on public.invoices to authenticated;

create view public.invoice_status with (security_invoker = true) as
select i.id, i.job_id, i.quote_id, i.kind, i.xero_invoice_number, i.xero_online_url, i.total_inc_gst, i.deposit_pct,
  i.deposit_amount, i.deposit_due_date, i.deposit_paid_amount, i.deposit_paid_at, i.balance_amount, i.balance_due_date,
  i.balance_paid_at, i.total_paid, i.created_at,
  public.invoice_deposit_cleared(i.id) as deposit_cleared,
  case
    when i.status in ('invoice_not_created','xero_sync_error') then i.status
    when i.total_paid >= i.total_inc_gst then 'fully_paid'::payment_status
    when i.deposit_paid_at is null and i.deposit_due_date < current_date - 7 then 'overdue'::payment_status
    when i.deposit_paid_at is null then 'deposit_due'::payment_status
    when i.balance_due_date is not null and i.balance_due_date < current_date then 'overdue'::payment_status
    when i.balance_due_date is not null and i.balance_due_date <= current_date then 'balance_due'::payment_status
    else 'deposit_paid'::payment_status end as effective_status
from public.invoices i;
grant select on public.invoice_status to authenticated;
comment on view public.invoice_payment_state is 'DEPRECATED: exposes internal Xero fields; replaced by invoice_status';

create or replace view public.job_overview with (security_invoker = true) as
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    concat_ws(', '::text, pr.address_line, pr.suburb, ((pr.state || ' '::text) || COALESCE(pr.postcode, ''::text))) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT p.effective_status::text FROM public.invoice_status p WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    public.job_authority_status(j.id) AS authority_status,
    public.job_authority_expires_at(j.id) AS authority_expires_at,
    public.job_deposit_cleared(j.id) AS deposit_cleared
   FROM jobs j
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id;

-- ===== Compliance: Valid Owner Authority blocking check =====
create or replace function public.seed_job_requirements()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.evidence_requirements (job_id, category, label, gate, responsible_role, required, sort) values
    (new.id,'measurement','Ceiling measurement evidence','assessment','electrician',true,1),
    (new.id,'existing_insulation_r_value','Existing insulation / R-value evidence','assessment','electrician',true,2),
    (new.id,'piesa_signoff','PIESA / electrical safety sign-off','electrical','electrician',true,3),
    (new.id,'rectification_completion','Rectification completion evidence','electrical','electrician',false,4),
    (new.id,'before_ceiling_space','Before: ceiling space','installation','installer',true,5),
    (new.id,'access_manhole','Access / manhole','installation','installer',true,6),
    (new.id,'product_evidence','Product evidence (labels/batch)','installation','installer',true,7),
    (new.id,'installation_progress','Installation progress','installation','installer',false,8),
    (new.id,'completed_installation','Completed installation','installation','installer',true,9),
    (new.id,'installer_declaration','Signed installer declaration','installation','installer',true,10);
  update public.evidence_requirements set status = 'not_required' where job_id = new.id and not required;
  insert into public.compliance_checks (job_id, check_key, label, blocking, sort) values
    (new.id,'eligibility','Property eligibility confirmed',true,1),
    (new.id,'owner_authority','Valid Owner Authority',true,2),
    (new.id,'owner_consent','Owner quote acceptance recorded',true,3),
    (new.id,'participant_eligibility','Participant eligibility',true,4),
    (new.id,'electrical_assessment','Electrical assessment / PIESA pass',true,5),
    (new.id,'rectification','Rectification complete (if required)',true,6),
    (new.id,'installer_eligibility','Installer eligibility',true,7),
    (new.id,'product_eligibility','Product eligibility',true,8),
    (new.id,'installation_evidence','Installation evidence verified',true,9),
    (new.id,'declarations','Declarations complete',true,10),
    (new.id,'qa','QA review',true,11);
  insert into public.veec_lodgements (job_id) values (new.id);
  return new;
end $function$;

insert into public.compliance_checks (job_id, check_key, label, blocking, sort)
select j.id, 'owner_authority', 'Valid Owner Authority', true, 2 from public.jobs j
where not exists (select 1 from public.compliance_checks c where c.job_id = j.id and c.check_key = 'owner_authority');
update public.compliance_checks set label = 'Owner quote acceptance recorded' where check_key = 'owner_consent';