# Carry sign-up electricians (Rapid, Matthews) - one-off data fix, NOT a schema change

Jo, 29 Oct 2026. Approved installers who named "I have my own electrician" at sign-up before this change never had that electrician saved as their usual electrician. This saves it, and links that sign-up's electrician nominations to the business. Sends nothing (the invite sweep sends on its next tick).

Expected today: Rapid Insulation -> Viking Electrical Services Aus PTY LTD (rec 38603); Matthews Insulation -> Tudor Electrical.

Script (same result): `bun ./scripts/carry-signup-electricians.ts --dry-run`, then without `--dry-run`. Run only after Jo says yes.

## (a) Check first - read only (should list only Rapid and Matthews)

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
)
select business_id, business, application_id,
       nullif(btrim(coalesce(nullif(btrim(main->>'business_name'), ''), main->>'name')), '') as name,
       nullif(btrim(coalesce(nullif(btrim(main->>'rec_number'), ''), main->>'licence_number')), '') as licence,
       nullif(lower(btrim(main->>'email')), '') as email,
       nullif(regexp_replace(coalesce(main->>'mobile', ''), '\s+', '', 'g'), '') as phone
from src;
```

## (b) Save the usual electrician (one event per business)

```sql
insert into public.admin_config_events (actor_id, event_type, summary, details)
select null, 'installer_usual_electrician_saved', 'Usual electrician saved from installer sign-up on approval',
       jsonb_build_object('business_id', s.business_id, 'source', 'installer_signup',
         'electrician', jsonb_build_object('name', s.name, 'licence', s.licence, 'email', s.email, 'phone', s.phone))
from (
  select b.id as business_id,
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
) x
cross join lateral (
  select x.business_id,
         nullif(btrim(coalesce(nullif(btrim(x.main->>'business_name'), ''), x.main->>'name')), '') as name,
         nullif(btrim(coalesce(nullif(btrim(x.main->>'rec_number'), ''), x.main->>'licence_number')), '') as licence,
         nullif(lower(btrim(x.main->>'email')), '') as email,
         nullif(regexp_replace(coalesce(x.main->>'mobile', ''), '\s+', '', 'g'), '') as phone
) s
where s.name is not null and s.licence is not null;
```

## (c) Link the sign-up's electrician nominations to the business

```sql
update public.electrician_nominations n
set nominating_business_id = pa.business_id
from public.partner_activations pa
join public.businesses b on b.id = pa.business_id and b.onboarding_status = 'approved'
join public.rec_onboarding_applications a on a.id = pa.application_id
where n.installer_application_id = pa.application_id
  and n.nominating_business_id is null
  and a.data->>'electrician_choice' = 'have'
  and jsonb_typeof(a.data->'preferred_electricians') = 'array'
  and jsonb_array_length(a.data->'preferred_electricians') > 0;
```

Check afterwards: re-run (a) (should return no rows) and
`select event_type, details->>'business_id', details->'electrician'->>'name' from public.admin_config_events where event_type = 'installer_usual_electrician_saved' and details->>'source' = 'installer_signup';`

## (d) Undo

```sql
-- remove the two sign-up events (replace the ids with the business ids from (a))
delete from public.admin_config_events
where event_type = 'installer_usual_electrician_saved' and details->>'source' = 'installer_signup'
  and details->>'business_id' in ('<rapid business id>', '<matthews business id>');
-- unlink the nominations (same two businesses)
update public.electrician_nominations set nominating_business_id = null
where nominating_business_id in ('<rapid business id>', '<matthews business id>') and installer_application_id is not null;
```
