# Carry sign-up electricians (Rapid, Matthews) - one-off data fix, NOT a schema change

Jo, 29 Oct 2026. Approved installers who named "I have my own electrician" at sign-up before this change never had that electrician saved as their usual electrician. This saves it, and links that sign-up's electrician nominations to the business. Sends nothing (the invite sweep sends on its next tick).

Expected today: Rapid Insulation -> Viking Electrical Services Aus PTY LTD (rec 38603); Matthews Insulation -> Tudor Electrical.

Script (same result): `bun ./scripts/carry-signup-electricians.ts --dry-run`, then without `--dry-run`. Run only after Jo says yes.

## (a) Check first - read only (should list only Rapid and Matthews)

Only businesses whose main electrician has a name and a licence (the same set (b) saves).

```sql
with src as (
  select b.id as business_id, b.name as business, a.id as application_id,
         coalesce((select e from jsonb_array_elements(a.data->'preferred_electricians') e where e->>'is_primary' = 'true' limit 1),
                  a.data->'preferred_electricians'->0) as main
  from public.businesses b
  join public.partner_activations pa on pa.business_id = b.id
  join public.rec_onboarding_applications a on a.id = pa.application_id
  where b.onboarding_status = 'approved'
    and a.data->>'electrician_choice' = 'have'
    and jsonb_typeof(a.data->'preferred_electricians') = 'array'
    and jsonb_array_length(a.data->'preferred_electricians') > 0
    and not exists (select 1 from public.admin_config_events ev
                    where ev.event_type = 'installer_usual_electrician_saved' and ev.details->>'business_id' = b.id::text)
), cand as (
  select src.business_id, src.business, src.application_id,
         nullif(btrim(coalesce(nullif(btrim(main->>'business_name'), ''), main->>'name')), '') as name,
         nullif(btrim(coalesce(nullif(btrim(main->>'rec_number'), ''), main->>'licence_number')), '') as licence,
         nullif(lower(btrim(main->>'email')), '') as email,
         nullif(regexp_replace(coalesce(main->>'mobile', ''), '\s+', '', 'g'), '') as phone
  from src
)
select * from cand where name is not null and licence is not null;
```

## (b) Save the usual electrician (one event per business; skips any business that already has one)

```sql
with src as (
  select b.id as business_id, b.name as business, a.id as application_id,
         coalesce((select e from jsonb_array_elements(a.data->'preferred_electricians') e where e->>'is_primary' = 'true' limit 1),
                  a.data->'preferred_electricians'->0) as main
  from public.businesses b
  join public.partner_activations pa on pa.business_id = b.id
  join public.rec_onboarding_applications a on a.id = pa.application_id
  where b.onboarding_status = 'approved'
    and a.data->>'electrician_choice' = 'have'
    and jsonb_typeof(a.data->'preferred_electricians') = 'array'
    and jsonb_array_length(a.data->'preferred_electricians') > 0
    and not exists (select 1 from public.admin_config_events ev
                    where ev.event_type = 'installer_usual_electrician_saved' and ev.details->>'business_id' = b.id::text)
), cand as (
  select src.business_id, src.business, src.application_id,
         nullif(btrim(coalesce(nullif(btrim(main->>'business_name'), ''), main->>'name')), '') as name,
         nullif(btrim(coalesce(nullif(btrim(main->>'rec_number'), ''), main->>'licence_number')), '') as licence,
         nullif(lower(btrim(main->>'email')), '') as email,
         nullif(regexp_replace(coalesce(main->>'mobile', ''), '\s+', '', 'g'), '') as phone
  from src
)
insert into public.admin_config_events (actor_id, event_type, summary, details)
select null, 'installer_usual_electrician_saved', 'Usual electrician saved from installer sign-up on approval',
       jsonb_build_object('business_id', business_id, 'source', 'installer_signup',
         'electrician', jsonb_build_object('name', name, 'licence', licence, 'email', email, 'phone', phone))
from cand where name is not null and licence is not null;
```

## (c) Link the sign-up's electrician nominations to the business

Same as the script: applies to every approved installer whose main sign-up electrician is valid (name and licence), whether or not a usual electrician was already saved. Only nominations with no business yet are touched. Test partners with no licence are left alone.

**Keep the ids this returns - (d) needs them.**

```sql
with src as (
  select b.id as business_id, b.name as business, a.id as application_id,
         coalesce((select e from jsonb_array_elements(a.data->'preferred_electricians') e where e->>'is_primary' = 'true' limit 1),
                  a.data->'preferred_electricians'->0) as main
  from public.businesses b
  join public.partner_activations pa on pa.business_id = b.id
  join public.rec_onboarding_applications a on a.id = pa.application_id
  where b.onboarding_status = 'approved'
    and a.data->>'electrician_choice' = 'have'
    and jsonb_typeof(a.data->'preferred_electricians') = 'array'
    and jsonb_array_length(a.data->'preferred_electricians') > 0
), cand as (
  select src.business_id, src.business, src.application_id,
         nullif(btrim(coalesce(nullif(btrim(main->>'business_name'), ''), main->>'name')), '') as name,
         nullif(btrim(coalesce(nullif(btrim(main->>'rec_number'), ''), main->>'licence_number')), '') as licence,
         nullif(lower(btrim(main->>'email')), '') as email,
         nullif(regexp_replace(coalesce(main->>'mobile', ''), '\s+', '', 'g'), '') as phone
  from src
)
update public.electrician_nominations n
set nominating_business_id = c.business_id
from cand c
where c.name is not null and c.licence is not null
  and n.installer_application_id = c.application_id
  and n.nominating_business_id is null
returning n.id, c.business;
```

Check afterwards: re-run (a) (should return no rows) and
`select details->>'business_id', details->'electrician'->>'name' from public.admin_config_events where event_type = 'installer_usual_electrician_saved' and details->>'source' = 'installer_signup';`

## (d) Undo

```sql
-- remove the sign-up events for the two businesses (by name)
delete from public.admin_config_events
where event_type = 'installer_usual_electrician_saved' and details->>'source' = 'installer_signup'
  and details->>'business_id' in (select id::text from public.businesses
                                  where name ilike 'Rapid Insulation%' or name ilike 'Matthews Insulation%');
-- unlink ONLY the nominations (c) returned (paste those ids)
update public.electrician_nominations set nominating_business_id = null
where id in ('<ids returned by (c)>');
```
