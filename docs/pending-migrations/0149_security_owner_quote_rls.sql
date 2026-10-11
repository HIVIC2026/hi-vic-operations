-- Local security patch, 10 Oct 2026.
-- Owner auth auto-linking must require a confirmed auth email and an owner email-code proof.
-- Homeowners must not see queued/held/draft quotes or their line items through direct Supabase queries.

CREATE OR REPLACE FUNCTION public.link_confirmed_owner_account(_user_id uuid, _email text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if _email is null or length(trim(_email)) = 0 then
    return false;
  end if;

  update public.owners o set user_id = _user_id
   where o.user_id is null and lower(o.email) = lower(_email)
     and exists (select 1 from public.jobs j join public.owner_link_codes c on c.job_id = j.id
                  where j.owner_id = o.id and c.channel = 'email' and c.verified_at is not null);

  if found then
    insert into public.user_roles (user_id, role) values (_user_id, 'owner') on conflict do nothing;
    return true;
  end if;

  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.link_confirmed_owner_account(new.id, new.email);
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles p
       set email = new.email
     where p.id = new.id and (p.email is distinct from new.email);

    perform public.link_confirmed_owner_account(new.id, new.email);
  end if;

  return new;
end $function$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_confirmed();

CREATE OR REPLACE FUNCTION public.owner_quote_released(
  _status public.quote_status,
  _release_state text,
  _sent_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT _status = ANY (ARRAY['accepted'::public.quote_status, 'declined'::public.quote_status])
      OR (
        _status = 'issued'::public.quote_status
        AND (_release_state IS NULL OR _release_state = 'released')
      )
$$;

CREATE OR REPLACE FUNCTION public.quote_visible_to_current_user(
  _job_id uuid,
  _kind public.quote_kind,
  _status public.quote_status,
  _release_state text,
  _sent_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin()
      OR (public.is_job_owner(_job_id, auth.uid()) AND public.owner_quote_released(_status, _release_state, _sent_at))
      OR (_kind = 'installation'::public.quote_kind AND _status = 'accepted'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'installer')
      OR (_kind = 'rectification'::public.quote_kind AND _status <> 'superseded'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'electrician')
$$;

DROP POLICY IF EXISTS quote_visibility ON public.quotes;
CREATE POLICY quote_visibility ON public.quotes FOR SELECT TO authenticated
  USING (public.quote_visible_to_current_user(job_id, kind, status, release_state, sent_at));

DROP POLICY IF EXISTS quote_items_visibility ON public.quote_items;
CREATE POLICY quote_items_visibility ON public.quote_items FOR SELECT TO authenticated
  USING (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_items.quote_id
        and public.quote_visible_to_current_user(q.job_id, q.kind, q.status, q.release_state, q.sent_at)
    )
  );

REVOKE ALL ON FUNCTION public.owner_quote_released(public.quote_status, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_visible_to_current_user(uuid, public.quote_kind, public.quote_status, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_quote_released(public.quote_status, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_visible_to_current_user(uuid, public.quote_kind, public.quote_status, text, timestamptz) TO authenticated;
