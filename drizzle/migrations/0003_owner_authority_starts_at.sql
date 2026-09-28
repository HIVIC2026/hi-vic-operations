alter table public.owner_authorities add column if not exists starts_at timestamptz;
update public.owner_authorities set starts_at = accepted_at where starts_at is null and accepted_at is not null;
create or replace function public.guard_owner_authority_start()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.starts_at is not null and new.starts_at is distinct from old.starts_at then
    raise exception 'accepted authority evidence is immutable';
  end if;
  return new;
end $$;
create trigger owner_authorities_guard_start before update on public.owner_authorities
  for each row execute function public.guard_owner_authority_start();