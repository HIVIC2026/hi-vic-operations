-- Additive worker token hardening. No invitations are sent and no old signatures rewritten.
CREATE TABLE public.worker_access_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invite_id uuid REFERENCES public.partner_worker_invites(id),
 event_type text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER worker_access_attempts_immutable BEFORE UPDATE OR DELETE ON public.worker_access_attempts
 FOR EACH ROW EXECUTE FUNCTION public.launch_event_immutable();
CREATE TABLE public.worker_access_budgets (
 key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'), bucket timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 1, PRIMARY KEY(key_hash,bucket)
);
ALTER TABLE public.worker_access_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_access_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_access_attempts,public.worker_access_budgets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.worker_access_attempts TO authenticated;
CREATE POLICY worker_attempts_office_read ON public.worker_access_attempts FOR SELECT TO authenticated USING (public.is_admin());

CREATE FUNCTION public.consume_worker_access_budget(_key text,_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF _key !~ '^[a-f0-9]{64}$' OR _limit NOT BETWEEN 1 AND 120 THEN RETURN false; END IF;
 INSERT INTO public.worker_access_budgets(key_hash,bucket) VALUES(_key,date_trunc('minute',now()))
 ON CONFLICT(key_hash,bucket) DO UPDATE SET requests=worker_access_budgets.requests+1 RETURNING requests INTO n;
 RETURN n<=_limit;
END $$;

CREATE FUNCTION public.guard_signed_worker_invite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.used_at IS NOT NULL THEN RAISE EXCEPTION 'Signed worker invitation is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER signed_worker_invite_immutable BEFORE UPDATE OR DELETE ON public.partner_worker_invites FOR EACH ROW EXECUTE FUNCTION public.guard_signed_worker_invite();

CREATE FUNCTION public.consume_worker_invite(_hash text,_submission jsonb,_declarations jsonb,_ip text,_agent text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inv public.partner_worker_invites; worker uuid; contact text; phone text; submitted_phone text;
BEGIN
 SELECT * INTO inv FROM public.partner_worker_invites WHERE token_hash=_hash FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.worker_access_attempts(event_type) VALUES('invite_rejected'); RETURN false;
 END IF;
 IF inv.used_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at<=now()
    OR inv.expires_at>inv.created_at+interval '14 days' OR inv.is_test THEN
  INSERT INTO public.worker_access_attempts(invite_id,event_type) VALUES(inv.id,'invite_rejected'); RETURN false;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND is_active AND onboarding_status='approved') THEN
  INSERT INTO public.worker_access_attempts(invite_id,event_type) VALUES(inv.id,'invite_business_unavailable'); RETURN false;
 END IF;
 contact=lower(trim(coalesce(inv.invitee_contact,'')));
 phone=regexp_replace(contact,'[^0-9]','','g');
 submitted_phone=regexp_replace(coalesce(_submission->>'mobile',''),'[^0-9]','','g');
 IF phone LIKE '61%' THEN phone='0'||substring(phone FROM 3); END IF;
 IF submitted_phone LIKE '61%' THEN submitted_phone='0'||substring(submitted_phone FROM 3); END IF;
 IF contact='' OR (contact<>lower(trim(_submission->>'email')) AND (phone='' OR phone<>submitted_phone)) THEN
  INSERT INTO public.worker_access_attempts(invite_id,event_type) VALUES(inv.id,'invite_identity_mismatch'); RETURN false;
 END IF;
 IF inv.trade_role NOT IN ('electrician','installer') OR nullif(trim(_submission->>'signed_name'),'') IS NULL THEN RETURN false; END IF;
 -- Lock identity keys as well as the invitation, including two different invites.
 PERFORM pg_advisory_xact_lock(hashtext(lower(trim(_submission->>'email'))));
 IF inv.trade_role='electrician' THEN PERFORM pg_advisory_xact_lock(hashtext('licence:'||upper(trim(_submission->>'licence_number')))); END IF;
 IF EXISTS(SELECT 1 FROM public.partner_workers WHERE removed_at IS NULL AND
   (lower(email)=lower(trim(_submission->>'email')) OR
    (inv.trade_role='electrician' AND upper(trim(licence_number))=upper(trim(_submission->>'licence_number'))))) THEN
  INSERT INTO public.worker_access_attempts(invite_id,event_type) VALUES(inv.id,'invite_duplicate_identity'); RETURN false;
 END IF;
 -- Worker, signature and invite use commit or roll back together. Never reset used_at.
 INSERT INTO public.partner_workers(business_id,full_legal_name,email,mobile,trade_role,licence_number,qualification,added_by,approval_status)
 VALUES(inv.business_id,trim(_submission->>'full_legal_name'),lower(trim(_submission->>'email')),_submission->>'mobile',inv.trade_role,
   CASE WHEN inv.trade_role='electrician' THEN _submission->>'licence_number' ELSE NULL END,
   CASE WHEN inv.trade_role='installer' THEN _submission->>'qualification' ELSE NULL END,inv.created_by,'pending') RETURNING id INTO worker;
 UPDATE public.partner_worker_invites SET used_at=now(),worker_id=worker,signed_name=_submission->>'signed_name',
  signed_ip=_ip,signed_user_agent=_agent,declarations=_declarations WHERE id=inv.id;
 INSERT INTO public.worker_access_attempts(invite_id,event_type) VALUES(inv.id,'invite_consumed');
 RETURN true;
END $$;

-- Only new invitations must have the full bounds; old records are preserved.
CREATE FUNCTION public.check_worker_token_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.token_hash !~ '^[a-f0-9]{64}$' OR NEW.expires_at<=NEW.created_at OR
  NEW.expires_at>NEW.created_at + (CASE WHEN TG_TABLE_NAME='partner_worker_invites' THEN interval '14 days' ELSE interval '30 days' END)
 THEN RAISE EXCEPTION 'Invalid token lifetime'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER worker_invite_lifetime BEFORE INSERT ON public.partner_worker_invites FOR EACH ROW EXECUTE FUNCTION public.check_worker_token_lifetime();
CREATE TRIGGER worker_job_link_lifetime BEFORE INSERT ON public.worker_job_links FOR EACH ROW EXECUTE FUNCTION public.check_worker_token_lifetime();

CREATE FUNCTION public.repend_worker_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.full_legal_name,NEW.email,NEW.mobile,NEW.licence_number,NEW.qualification,NEW.trade_role)
 IS DISTINCT FROM ROW(OLD.full_legal_name,OLD.email,OLD.mobile,OLD.licence_number,OLD.qualification,OLD.trade_role) THEN
  NEW.approval_status='pending'; NEW.approved_at=NULL; NEW.approved_by=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER worker_identity_reapproval BEFORE UPDATE ON public.partner_workers FOR EACH ROW EXECUTE FUNCTION public.repend_worker_identity();

REVOKE ALL ON FUNCTION public.consume_worker_access_budget(text,integer),public.consume_worker_invite(text,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_worker_access_budget(text,integer),public.consume_worker_invite(text,jsonb,jsonb,text,text) TO service_role;