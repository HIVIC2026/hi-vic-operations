-- Rollback for owners-email-not-unique.sql. Refuses while two owner rows share an email (decision 282 data would be
-- destroyed by a merge): keep the migration in that case. Otherwise restores the baseline partial unique index.
do $$
begin
  if exists (select 1 from public.owners where email is not null group by lower(email) having count(*) > 1) then
    raise exception 'owners share an email; keep owners-email-not-unique.sql applied';
  end if;
end $$;
drop index if exists public.owners_email_idx;
create unique index if not exists owners_email_uq on public.owners (lower(email)) where email is not null;
