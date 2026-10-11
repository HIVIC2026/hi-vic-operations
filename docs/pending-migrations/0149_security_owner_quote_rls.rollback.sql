-- Rollback for 0149_security_owner_quote_rls.sql  (STAGED — DO NOT APPLY without Jo's written approval).
--
-- APPLICATION (forward) INSTRUCTIONS: see 0149_security_owner_quote_rls.sql header.
-- ROLLBACK INSTRUCTIONS:
--   Run this file to restore the exact pre-0149 state:
--     * quote_visibility policy -> restored to the 0126 definition.
--     * quote_items_visibility policy -> removed (did not exist before 0149).
--     * quote_visible_to_current_user / owner_quote_released -> removed (introduced by 0149).
--     * handle_new_user -> restored to the 0133 (verified-only autolink) definition.
--     * handle_user_email_confirmed + on_auth_user_email_confirmed trigger -> removed (introduced by 0149).
--     * link_confirmed_owner_account -> removed (introduced by 0149).
--   Safe: touches only policies/functions/triggers; no business data is modified.
--   After rollback, owners again fall back to the pre-0149 (0126) visibility behaviour.

BEGIN;

-- 1) Quote visibility: restore the 0126 policy and drop the 0149 additions.
DROP POLICY IF EXISTS quote_items_visibility ON public.quote_items;
DROP POLICY IF EXISTS quote_visibility ON public.quotes;
CREATE POLICY quote_visibility ON public.quotes FOR SELECT TO authenticated
  USING ((public.is_job_owner(job_id, auth.uid()) AND status = ANY (ARRAY['issued'::public.quote_status, 'accepted'::public.quote_status, 'declined'::public.quote_status]))
    OR (kind = 'rectification'::public.quote_kind AND public.job_assignment_role(job_id, auth.uid()) = 'electrician'::public.assignment_role)
    OR (kind = 'installation'::public.quote_kind AND status = 'accepted'::public.quote_status AND public.job_assignment_role(job_id, auth.uid()) = 'installer'::public.assignment_role));

-- 2) Drop the quote-visibility helper functions introduced by 0149.
DROP FUNCTION IF EXISTS public.quote_visible_to_current_user(uuid, public.quote_kind, public.quote_status, text, timestamptz);
DROP FUNCTION IF EXISTS public.owner_quote_released(public.quote_status, text, timestamptz);

-- 3) Owner auto-linking: remove the email-confirmed trigger path introduced by 0149.
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP FUNCTION IF EXISTS public.handle_user_email_confirmed();
DROP FUNCTION IF EXISTS public.link_confirmed_owner_account(uuid, text);

-- 4) Restore handle_new_user to the pre-0149 (0133) verified-only autolink definition.
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

COMMIT;
