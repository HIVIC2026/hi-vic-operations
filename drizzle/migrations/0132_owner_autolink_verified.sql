CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  update public.owners o set user_id = new.id
   where o.user_id is null and lower(o.email) = lower(new.email)
     and exists (select 1 from public.jobs j join public.owner_link_codes c on c.job_id = j.id
                  where j.owner_id = o.id and c.channel = 'email' and c.verified_at is not null);
  if found then
    insert into public.user_roles (user_id, role) values (new.id, 'owner') on conflict do nothing;
  end if;
  return new;
end $function$;