
-- ============ ENUMS ============
create type public.app_role as enum ('admin','electrician','installer','owner','property_manager');
create type public.job_stage as enum ('new_enquiry','eligibility_review','awaiting_electrician','assessment_booking','assessment_booked','assessment_complete','rectification_required','awaiting_owner_rectification_approval','rectification_scheduling','rectification_booked','ready_for_installer_quotes','awaiting_quote_acceptance','installation_scheduling','installation_booked','evidence_outstanding','ap_review','ready_for_veec','complete','cancelled','on_hold');
create type public.eligibility_outcome as enum ('likely_eligible','needs_onsite_confirmation','does_not_appear_eligible');
create type public.occupancy_type as enum ('owner_occupied','rental');
create type public.assignment_role as enum ('electrician','installer','property_manager');
create type public.business_type as enum ('accredited_provider','rec','eec_installer','property_manager','other');
create type public.access_difficulty as enum ('easy','moderate','difficult');
create type public.pass_fail as enum ('pending','pass','fail');
create type public.quote_kind as enum ('installation','rectification');
create type public.quote_status as enum ('draft','issued','accepted','declined','superseded');
create type public.booking_kind as enum ('assessment','rectification','installation');
create type public.booking_status as enum ('proposed','confirmed','completed','cancelled');
create type public.evidence_status as enum ('outstanding','uploaded','verified','rejected','not_required');
create type public.evidence_category as enum ('measurement','existing_insulation_r_value','before_ceiling_space','access_manhole','product_evidence','installation_progress','completed_installation','piesa_signoff','rectification_completion','installer_declaration');
create type public.sync_status as enum ('not_synced','pending','synced','error');
create type public.rate_card_kind as enum ('installer','electrical');

-- ============ IDENTITY ============
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type public.business_type not null,
  abn text,
  licence_number text,
  phone text, email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key,              -- = auth user id
  full_name text,
  email text,
  phone text,
  business_id uuid references public.businesses(id) on delete set null,
  licence_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- ============ CUSTOMERS / PROPERTIES ============
create table public.owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index owners_email_uq on public.owners (lower(email)) where email is not null;

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete restrict,
  managed_by_business_id uuid references public.businesses(id) on delete set null, -- property manager (post-MVP)
  address_line text not null,
  suburb text, state text not null default 'VIC', postcode text,
  occupancy public.occupancy_type,
  is_residential boolean,           -- enriched/verified by HIVIC
  year_built int,                   -- enriched
  enrichment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ SETTINGS ============
create table public.workflow_settings (
  id int primary key default 1 check (id = 1),
  piesa_install_window_days int not null default 30,
  urgency_amber_days int not null default 10,
  urgency_red_days int not null default 3,
  min_building_age_years int not null default 5,
  updated_at timestamptz not null default now()
);

-- ============ JOBS ============
create sequence public.job_number_seq start 1001;
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique default ('HV-' || nextval('public.job_number_seq')::text),
  property_id uuid not null references public.properties(id) on delete restrict,
  owner_id uuid not null references public.owners(id) on delete restrict,
  stage public.job_stage not null default 'new_enquiry',
  prior_stage public.job_stage,        -- used when on hold
  -- enquiry (as supplied by customer)
  source text not null default 'base44',
  external_enquiry_id text unique,
  estimated_area_m2 numeric(8,2),
  estimated_area_unknown boolean not null default false,
  life_support boolean not null default false,
  -- eligibility (gate 1)
  eligibility_outcome public.eligibility_outcome,
  eligibility_reason text,
  next_action text,
  eligibility_set_by uuid references public.profiles(id),
  eligibility_set_at timestamptz,
  -- lifecycle
  installation_completed_at timestamptz,
  hold_reason text,
  cancelled_reason text,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.jobs(stage);
create index on public.jobs(owner_id);

create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.assignment_role not null,
  business_id uuid references public.businesses(id),
  active boolean not null default true,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
);
create unique index job_assignments_active_uq on public.job_assignments(job_id, role) where active;
create index on public.job_assignments(user_id) where active;

-- ============ ASSESSMENT (gate 2) ============
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  assessor_id uuid references public.profiles(id),
  status text not null default 'in_progress' check (status in ('in_progress','complete')),
  measured_area_m2 numeric(8,2),
  insulation_present boolean,
  existing_r_value numeric(4,2),
  removal_required boolean,
  removal_m2 numeric(8,2),
  access_difficulty public.access_difficulty,
  downlights_qty int, downlights_type text, downlights_upgrade_qty int,
  exhaust_fans_qty int, exhaust_fans_clearance_qty int,
  hazards text,
  switchboard_condition text check (switchboard_condition in ('ok','upgrade_required')),
  rcds_present boolean, rcds_required_qty int,
  life_support_confirmed boolean,
  piesa_outcome public.pass_fail not null default 'pending',
  notes text,
  assessed_on date,
  completed_at timestamptz,
  external_mitti_id text unique,
  mitti_sync_status public.sync_status not null default 'not_synced',
  mitti_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.piesa_records (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  kind text not null default 'initial' check (kind in ('initial','post_rectification','reassessment')),
  outcome public.pass_fail not null,
  completed_date date not null,
  signed_off_by uuid references public.profiles(id),
  external_mitti_id text,
  is_current boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create unique index piesa_current_uq on public.piesa_records(job_id) where is_current;

-- ============ PRICING ============
create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  kind public.rate_card_kind not null,
  business_id uuid references public.businesses(id),
  name text not null,
  version int not null,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, business_id, version)
);
create table public.rate_card_items (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.rate_cards(id) on delete cascade,
  code text not null,
  description text not null,
  category text not null,          -- product | removal | travel | electrical
  unit text not null check (unit in ('m2','each','flat')),
  unit_price_ex_gst numeric(10,2) not null,
  r_value numeric(4,2),
  sort int not null default 0,
  unique (rate_card_id, code)
);
create table public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  gst_rate numeric(5,4) not null default 0.10,
  ap_margin_pct numeric(5,4) not null default 0.12,
  ap_fee_ex_gst numeric(10,2) not null default 150,
  veec_credit_per_m2_inc_gst numeric(10,2) not null default 11,
  access_loadings jsonb not null default '{"easy":1.0,"moderate":1.1,"difficult":1.25}'::jsonb,
  installer_option_codes text[] not null default array['R3_5_BATTS','R4_BATTS','R5_BATTS'],
  is_active boolean not null default true,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.rectification_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete cascade,
  rate_code text,                  -- null for "Other"
  description text not null,
  quantity numeric(8,2) not null default 1,
  is_other boolean not null default false,
  other_unit_price_inc_gst numeric(10,2),  -- only for Other items, proposed by electrician
  explanation text,
  added_by uuid references public.profiles(id),
  status text not null default 'required' check (status in ('required','completed','removed')),
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind public.quote_kind not null,
  option_label text not null,
  option_code text,
  status public.quote_status not null default 'issued',
  version int not null default 1,
  rate_card_id uuid references public.rate_cards(id),
  pricing_settings_id uuid references public.pricing_settings(id),
  prices_include_gst boolean not null default true,
  subtotal_inc_gst numeric(10,2) not null,
  gst_amount numeric(10,2) not null,
  veec_discount_inc_gst numeric(10,2) not null default 0,
  customer_total_inc_gst numeric(10,2) not null,
  manually_adjusted boolean not null default false,
  created_by uuid references public.profiles(id),
  accepted_at timestamptz, accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.quotes(job_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  code text,
  description text not null,
  quantity numeric(8,2) not null,
  unit text not null,
  unit_price_inc_gst numeric(10,2) not null,
  line_total_inc_gst numeric(10,2) not null,
  is_other boolean not null default false,
  explanation text,
  sort int not null default 0
);

-- internal cost/margin: ADMIN ONLY
create table public.quote_internals (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  cost_ex_gst numeric(10,2) not null,
  ap_margin_ex_gst numeric(10,2) not null default 0,
  ap_fee_ex_gst numeric(10,2) not null default 0,
  calc_snapshot jsonb not null default '{}'::jsonb
);

create table public.quote_adjustments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  adjusted_by uuid not null references public.profiles(id),
  reason text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- ============ SCHEDULING / COMMS ============
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind public.booking_kind not null,
  contractor_id uuid references public.profiles(id),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  status public.booking_status not null default 'confirmed',
  booked_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);
create index on public.bookings(job_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sender_id uuid references public.profiles(id),
  body text not null,
  channel text not null default 'portal' check (channel in ('portal','phone','sms','email')),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.messages(job_id);

create table public.reassignment_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  role public.assignment_role not null,
  requested_by uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'open' check (status in ('open','actioned','declined')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ EVIDENCE / DOCUMENTS ============
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null,
  title text not null,
  storage_path text not null,
  mime_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  category public.evidence_category not null,
  label text not null,
  gate text not null check (gate in ('assessment','electrical','installation')),
  responsible_role public.assignment_role,
  required boolean not null default true,
  status public.evidence_status not null default 'outstanding',
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  notes text,
  sort int not null default 0,
  unique (job_id, category)
);

create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.evidence_requirements(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create table public.declarations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('owner_consent','installer_declaration','electrician_declaration','ap_declaration')),
  declared_by uuid references public.profiles(id),
  statement text not null,
  declared_at timestamptz not null default now(),
  unique (job_id, kind)
);

-- ============ COMPLIANCE / VEEC ============
create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  check_key text not null,
  label text not null,
  blocking boolean not null default true,
  status public.pass_fail not null default 'pending',
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  notes text,
  sort int not null default 0,
  unique (job_id, check_key)
);

create table public.veec_lodgements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  quantity numeric(10,2),
  status text not null default 'not_submitted' check (status in ('not_submitted','submitted','approved','rejected')),
  submission_reference text,
  submitted_date date,
  notes text,
  updated_at timestamptz not null default now()
);

-- ============ AUDIT / SYNC ============
create table public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  from_stage public.job_stage,
  to_stage public.job_stage,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.workflow_events(job_id, created_at desc);

create table public.external_sync_logs (
  id uuid primary key default gen_random_uuid(),
  system text not null,          -- base44 | mitti
  direction text not null check (direction in ('inbound','outbound')),
  entity_type text not null,
  entity_id uuid,
  status public.sync_status not null,
  payload jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- audit log is append-only
create or replace function public.prevent_mutation() returns trigger language plpgsql as $$
begin raise exception 'workflow_events is append-only'; end $$;
create trigger workflow_events_immutable before update or delete on public.workflow_events
for each row execute function public.prevent_mutation();

-- ============ HELPER FUNCTIONS ============
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
$$;

create or replace function public.job_assignment_role(_job uuid, _user uuid)
returns public.assignment_role language sql stable security definer set search_path = public as $$
  select role from public.job_assignments where job_id = _job and user_id = _user and active limit 1
$$;

create or replace function public.is_job_owner(_job uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j join public.owners o on o.id = j.owner_id
                 where j.id = _job and o.user_id = _user)
$$;

create or replace function public.can_access_job(_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.job_assignment_role(_job, auth.uid()) is not null
      or public.is_job_owner(_job, auth.uid())
$$;

-- caller's relationship to a job: admin | electrician | installer | property_manager | owner | null
create or replace function public.my_job_role(_job uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'admin'
    when public.job_assignment_role(_job, auth.uid()) is not null then public.job_assignment_role(_job, auth.uid())::text
    when public.is_job_owner(_job, auth.uid()) then 'owner'
    else null end
$$;

create or replace function public.shares_job_with(_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.jobs j
    left join public.owners o on o.id = j.owner_id
    where public.can_access_job(j.id)
      and (o.user_id = _profile or exists (select 1 from public.job_assignments a where a.job_id = j.id and a.user_id = _profile and a.active))
  )
$$;

-- ============ CENTRAL PIESA DEADLINE RULE ============
-- Single place: deadline = current PIESA completed_date + workflow_settings.piesa_install_window_days
create or replace view public.job_piesa_deadlines with (security_invoker = true) as
select j.id as job_id,
       p.completed_date as piesa_date,
       p.outcome as piesa_outcome,
       (p.completed_date + s.piesa_install_window_days) as install_deadline,
       ((p.completed_date + s.piesa_install_window_days) - current_date) as days_remaining,
       case
         when p.completed_date is null or j.installation_completed_at is not null
              or j.stage in ('complete','cancelled') then null
         when (p.completed_date + s.piesa_install_window_days) - current_date < 0 then 'expired'
         when (p.completed_date + s.piesa_install_window_days) - current_date <= s.urgency_red_days then 'red'
         when (p.completed_date + s.piesa_install_window_days) - current_date <= s.urgency_amber_days then 'amber'
         else 'green' end as urgency,
       (p.completed_date is not null and j.installation_completed_at is null
        and (p.completed_date + s.piesa_install_window_days) < current_date) as piesa_expired
from public.jobs j
cross join public.workflow_settings s
left join public.piesa_records p on p.job_id = j.id and p.is_current;

create or replace view public.job_overview with (security_invoker = true) as
select j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support,
       j.last_activity_at, j.created_at, j.hold_reason,
       pr.id as property_id,
       concat_ws(', ', pr.address_line, pr.suburb, pr.state || ' ' || coalesce(pr.postcode,'')) as property_address,
       o.id as owner_id, o.full_name as owner_name, o.phone as owner_phone, o.email as owner_email,
       ea.user_id as electrician_id, ep.full_name as electrician_name,
       ia.user_id as installer_id, ip.full_name as installer_name,
       d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired
from public.jobs j
join public.properties pr on pr.id = j.property_id
join public.owners o on o.id = j.owner_id
left join public.job_assignments ea on ea.job_id = j.id and ea.active and ea.role = 'electrician'
left join public.profiles ep on ep.id = ea.user_id
left join public.job_assignments ia on ia.job_id = j.id and ia.active and ia.role = 'installer'
left join public.profiles ip on ip.id = ia.user_id
left join public.job_piesa_deadlines d on d.job_id = j.id;

-- ============ JOB TEMPLATES (evidence + compliance) ============
create or replace function public.seed_job_requirements() returns trigger
language plpgsql security definer set search_path = public as $$
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
    (new.id,'owner_consent','Owner consent recorded',true,2),
    (new.id,'participant_eligibility','Participant eligibility',true,3),
    (new.id,'electrical_assessment','Electrical assessment / PIESA pass',true,4),
    (new.id,'rectification','Rectification complete (if required)',true,5),
    (new.id,'installer_eligibility','Installer eligibility',true,6),
    (new.id,'product_eligibility','Product eligibility',true,7),
    (new.id,'installation_evidence','Installation evidence verified',true,8),
    (new.id,'declarations','Declarations complete',true,9),
    (new.id,'qa','QA review',true,10);
  insert into public.veec_lodgements (job_id) values (new.id);
  return new;
end $$;
create trigger jobs_seed_requirements after insert on public.jobs
for each row execute function public.seed_job_requirements();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_jobs before update on public.jobs for each row execute function public.touch_updated_at();
create trigger t_assess before update on public.assessments for each row execute function public.touch_updated_at();
create trigger t_props before update on public.properties for each row execute function public.touch_updated_at();
create trigger t_owners before update on public.owners for each row execute function public.touch_updated_at();
create trigger t_profiles before update on public.profiles for each row execute function public.touch_updated_at();

-- ============ NEW USER HANDLING ============
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  -- bootstrap: first user becomes HI VIC admin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  -- link homeowner records by email
  update public.owners set user_id = new.id where user_id is null and lower(email) = lower(new.email);
  if found then
    insert into public.user_roles (user_id, role) values (new.id, 'owner') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ GRANTS ============
grant usage on schema public to authenticated;
do $$
declare t text;
begin
  foreach t in array array['businesses','profiles','user_roles','owners','properties','workflow_settings','jobs','job_assignments','assessments','piesa_records','rate_cards','rate_card_items','pricing_settings','rectification_items','quotes','quote_items','quote_internals','quote_adjustments','bookings','messages','reassignment_requests','documents','evidence_requirements','evidence_files','declarations','compliance_checks','veec_lodgements','workflow_events','external_sync_logs']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admin_all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;
grant select on public.job_overview, public.job_piesa_deadlines to authenticated;
grant all on public.job_overview, public.job_piesa_deadlines to service_role;
grant usage on sequence public.job_number_seq to service_role, authenticated;

-- ============ READ POLICIES (writes go through server-side workflow using service role) ============
create policy "self_read" on public.profiles for select to authenticated using (id = auth.uid() or public.shares_job_with(id));
create policy "self_roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "read_businesses" on public.businesses for select to authenticated using (true);
create policy "read_settings" on public.workflow_settings for select to authenticated using (true);

create policy "owner_or_assignee" on public.owners for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.jobs j where j.owner_id = owners.id and public.job_assignment_role(j.id, auth.uid()) is not null));
create policy "job_access" on public.properties for select to authenticated using (
  exists (select 1 from public.jobs j where j.property_id = properties.id and public.can_access_job(j.id)));

create policy "job_access" on public.jobs for select to authenticated using (public.can_access_job(id));
do $$
declare t text;
begin
  foreach t in array array['job_assignments','assessments','piesa_records','rectification_items','bookings','reassignment_requests','documents','evidence_requirements','evidence_files','declarations']
  loop
    execute format('create policy "job_access" on public.%I for select to authenticated using (public.can_access_job(job_id))', t);
  end loop;
end $$;

create policy "job_access_non_internal" on public.messages for select to authenticated
  using (public.can_access_job(job_id) and not internal);
create policy "job_access_non_internal" on public.workflow_events for select to authenticated
  using (public.can_access_job(job_id) and not internal);

-- quotes: owner sees issued/accepted/declined; electrician sees rectification; installer sees accepted installation
create policy "quote_visibility" on public.quotes for select to authenticated using (
  (public.is_job_owner(job_id, auth.uid()) and status in ('issued','accepted','declined'))
  or (kind = 'rectification' and public.job_assignment_role(job_id, auth.uid()) = 'electrician')
  or (kind = 'installation' and status = 'accepted' and public.job_assignment_role(job_id, auth.uid()) = 'installer'));
create policy "quote_items_visibility" on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id));
-- rate_cards, rate_card_items, pricing_settings, quote_internals, quote_adjustments,
-- compliance_checks, veec_lodgements, external_sync_logs: admin only (admin_all policy)

-- ============ SEED (development only) ============
insert into public.workflow_settings (id) values (1);

insert into public.businesses (id, name, business_type, abn, licence_number) values
 ('00000000-0000-0000-0000-0000000000a1','DC Construction Solutions (HI VIC)','accredited_provider','12 345 678 901',null),
 ('00000000-0000-0000-0000-0000000000b1','Spark Right Electrical','rec','98 765 432 100','REC-23456'),
 ('00000000-0000-0000-0000-0000000000c1','Cosy Ceilings Installers','eec_installer','55 444 333 222',null);

insert into public.rate_cards (id, kind, business_id, name, version) values
 ('00000000-0000-0000-0000-000000000c01','installer','00000000-0000-0000-0000-0000000000c1','Cosy Ceilings 2026 v1',1),
 ('00000000-0000-0000-0000-000000000e01','electrical',null,'HI VIC Electrical Rates v1',1);
insert into public.rate_card_items (rate_card_id, code, description, category, unit, unit_price_ex_gst, r_value, sort) values
 ('00000000-0000-0000-0000-000000000c01','R3_5_BATTS','R3.5 ceiling batts supply & install','product','m2',16.00,3.5,1),
 ('00000000-0000-0000-0000-000000000c01','R4_BATTS','R4.0 ceiling batts supply & install','product','m2',19.00,4.0,2),
 ('00000000-0000-0000-0000-000000000c01','R5_BATTS','R5.0 ceiling batts supply & install','product','m2',24.00,5.0,3),
 ('00000000-0000-0000-0000-000000000c01','REMOVAL','Removal & disposal of existing insulation','removal','m2',9.00,null,4),
 ('00000000-0000-0000-0000-000000000c01','TRAVEL','Travel / site establishment','travel','flat',120.00,null,5),
 ('00000000-0000-0000-0000-000000000e01','CALLOUT','Electrical call-out','electrical','flat',120.00,null,1),
 ('00000000-0000-0000-0000-000000000e01','DOWNLIGHT_UPGRADE','Downlight upgrade to IC-4 LED','electrical','each',65.00,null,2),
 ('00000000-0000-0000-0000-000000000e01','RCD_INSTALL','Install RCD','electrical','each',180.00,null,3),
 ('00000000-0000-0000-0000-000000000e01','SWITCHBOARD_UPGRADE','Switchboard upgrade','electrical','flat',1450.00,null,4),
 ('00000000-0000-0000-0000-000000000e01','EXHAUST_CLEARANCE','Exhaust fan clearance guard','electrical','each',45.00,null,5);
insert into public.pricing_settings (version) values (1);

insert into public.owners (id, full_name, email, phone) values
 ('00000000-0000-0000-0000-00000000f001','Sarah Nguyen','sarah.nguyen@example.com','0412 111 222'),
 ('00000000-0000-0000-0000-00000000f002','Michael Brown','michael.brown@example.com','0413 222 333'),
 ('00000000-0000-0000-0000-00000000f003','Priya Patel','priya.patel@example.com','0414 333 444'),
 ('00000000-0000-0000-0000-00000000f004','Tom Walsh','tom.walsh@example.com','0415 444 555'),
 ('00000000-0000-0000-0000-00000000f005','Grace Lee','grace.lee@example.com','0416 555 666'),
 ('00000000-0000-0000-0000-00000000f006','Daniel Rossi','daniel.rossi@example.com','0417 666 777');
insert into public.properties (id, owner_id, address_line, suburb, postcode, occupancy, is_residential, year_built) values
 ('00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000f001','12 Wattle St','Preston','3072','owner_occupied',true,1985),
 ('00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000f002','7 Banksia Ct','Frankston','3199','rental',true,1996),
 ('00000000-0000-0000-0000-00000000d003','00000000-0000-0000-0000-00000000f003','45 Gum Rd','Ballarat','3350','owner_occupied',true,1978),
 ('00000000-0000-0000-0000-00000000d004','00000000-0000-0000-0000-00000000f004','3/88 High St','Geelong','3220','owner_occupied',true,2004),
 ('00000000-0000-0000-0000-00000000d005','00000000-0000-0000-0000-00000000f005','19 Lorikeet Ave','Bendigo','3550','rental',true,1990),
 ('00000000-0000-0000-0000-00000000d006','00000000-0000-0000-0000-00000000f006','201 Station St','Box Hill','3128','owner_occupied',null,null);

insert into public.jobs (id, property_id, owner_id, stage, estimated_area_m2, estimated_area_unknown, life_support, eligibility_outcome, eligibility_reason, next_action, external_enquiry_id) values
 ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000d006','00000000-0000-0000-0000-00000000f006','new_enquiry',null,true,false,null,null,'Review eligibility','b44-1001'),
 ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000f001','awaiting_electrician',120,false,false,'likely_eligible','Residential, built 1985, owner reports minimal insulation','Assign electrician','b44-1002'),
 ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000f002','assessment_booking',95,false,true,'needs_onsite_confirmation','Existing R-value unknown; life support flagged','Electrician to book measure-up','b44-1003'),
 ('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-00000000d003','00000000-0000-0000-0000-00000000f003','ready_for_installer_quotes',140,false,false,'likely_eligible','Residential, 1978, no insulation','Generate installer quotes','b44-1004'),
 ('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-00000000d004','00000000-0000-0000-0000-00000000f004','installation_scheduling',80,false,false,'likely_eligible','Residential, 2004','Installer to book installation','b44-1005'),
 ('00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-00000000d005','00000000-0000-0000-0000-00000000f005','eligibility_review',null,true,false,null,null,'Confirm building age & residential use','b44-1006');

insert into public.assessments (job_id, status, measured_area_m2, insulation_present, existing_r_value, removal_required, removal_m2, access_difficulty, downlights_qty, downlights_type, downlights_upgrade_qty, exhaust_fans_qty, exhaust_fans_clearance_qty, switchboard_condition, rcds_present, rcds_required_qty, life_support_confirmed, piesa_outcome, assessed_on, completed_at, mitti_sync_status) values
 ('00000000-0000-0000-0000-00000000a004','complete',138,false,null,false,0,'moderate',6,'IC-4 LED',0,2,0,'ok',true,0,false,'pass',current_date - 8, now() - interval '8 days','not_synced'),
 ('00000000-0000-0000-0000-00000000a005','complete',82,true,1.0,true,82,'easy',8,'Halogen',8,1,1,'ok',false,1,false,'pass',current_date - 26, now() - interval '26 days','not_synced');
insert into public.piesa_records (job_id, kind, outcome, completed_date) values
 ('00000000-0000-0000-0000-00000000a004','initial','pass',current_date - 8),
 ('00000000-0000-0000-0000-00000000a005','post_rectification','pass',current_date - 26);

insert into public.workflow_events (job_id, event_type, to_stage, summary) values
 ('00000000-0000-0000-0000-00000000a001','enquiry_received','new_enquiry','Enquiry received from website'),
 ('00000000-0000-0000-0000-00000000a002','enquiry_received','new_enquiry','Enquiry received from website'),
 ('00000000-0000-0000-0000-00000000a002','eligibility_set','awaiting_electrician','Eligibility: Likely Eligible'),
 ('00000000-0000-0000-0000-00000000a003','enquiry_received','new_enquiry','Enquiry received from website'),
 ('00000000-0000-0000-0000-00000000a004','assessment_completed','ready_for_installer_quotes','Assessment complete, PIESA pass, no rectification'),
 ('00000000-0000-0000-0000-00000000a005','piesa_recorded','installation_scheduling','Post-rectification PIESA passed; installer quote accepted'),
 ('00000000-0000-0000-0000-00000000a006','enquiry_received','eligibility_review','Enquiry received from website');
