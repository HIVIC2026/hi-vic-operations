CREATE TABLE public.external_action_modes (
  action_type text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','manual_approval','automatic')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  reason text NOT NULL DEFAULT 'Pre-launch: no execution authorised'
);
INSERT INTO public.external_action_modes(action_type) VALUES
 ('customer_email'),('customer_sms'),('partner_notifications'),('worker_notifications'),
 ('booking_messages'),('quote_packages'),('consent_requests'),('piesa_requests'),
 ('signature_requests'),('completion_packages'),('xero_invoice_creation'),
 ('xero_due_date_updates'),('mitti_actions'),('esc_submission'),('veec_submission');

CREATE TABLE public.external_action_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  source_event_id uuid NOT NULL REFERENCES public.workflow_events(id),
  event_type text NOT NULL,
  action_type text NOT NULL REFERENCES public.external_action_modes(action_type),
  target_ref text NOT NULL,
  delivery_basis text NOT NULL,
  template_version text NOT NULL,
  payload_ref text NOT NULL,
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 10 AND 500),
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','waiting','ready_for_approval','approved','processing','completed','failed','cancelled','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz,
  approved_at timestamptz, approved_by uuid REFERENCES public.profiles(id),
  lease_id uuid, lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  last_attempt_at timestamptz, last_error_code text,
  completed_ref text, completed_at timestamptz,
  cancelled_at timestamptz, cancel_reason text,
  superseded_by uuid REFERENCES public.external_action_outbox(id),
  UNIQUE(job_id,action_type,target_ref,template_version,facts_hash),
  CHECK ((status = 'processing') = (lease_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (status <> 'completed' OR (completed_ref IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status NOT IN ('approved','processing','completed') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE INDEX external_action_queue ON public.external_action_outbox(status,due_at);
CREATE TABLE public.external_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid REFERENCES public.external_action_outbox(id),
  action_type text REFERENCES public.external_action_modes(action_type),
  event_type text NOT NULL, actor_id uuid REFERENCES public.profiles(id),
  at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION public.launch_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'launch audit records are immutable'; END $$;
CREATE TRIGGER external_action_events_immutable BEFORE UPDATE OR DELETE ON public.external_action_events
 FOR EACH ROW EXECUTE FUNCTION public.launch_event_immutable();

ALTER TABLE public.external_action_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_action_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_action_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_action_modes,public.external_action_outbox,public.external_action_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.external_action_modes,public.external_action_outbox,public.external_action_events TO authenticated;
CREATE POLICY launch_modes_admin_read ON public.external_action_modes FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY launch_outbox_admin_read ON public.external_action_outbox FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY launch_events_admin_read ON public.external_action_events FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.external_action_modes,public.external_action_outbox,public.external_action_events TO service_role;

CREATE FUNCTION public.set_external_action_mode(_action text,_mode text,_actor uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_mode text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
 IF length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF _mode NOT IN ('off','manual_approval') THEN RAISE EXCEPTION 'Automatic mode unavailable until individual launch evidence gates are implemented and reviewed'; END IF;
 SELECT mode INTO old_mode FROM public.external_action_modes WHERE action_type=_action FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown action'; END IF;
 IF old_mode = _mode THEN RETURN; END IF;
 UPDATE public.external_action_modes SET mode=_mode,updated_at=now(),updated_by=_actor,reason=_reason WHERE action_type=_action;
 INSERT INTO public.external_action_events(action_type,event_type,actor_id,details)
 VALUES(_action,'mode_changed',_actor,jsonb_build_object('from',old_mode,'to',_mode,'reason',_reason));
END $$;

CREATE FUNCTION public.enqueue_external_action(_job uuid,_event uuid,_action text,_target text,_basis text,_version text,_payload text,_facts text,_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE out_id uuid; ev_type text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=_job AND source IS DISTINCT FROM 'qa_test' AND stage NOT IN ('cancelled','complete','on_hold')) THEN RAISE EXCEPTION 'External work suppressed for inactive or test job'; END IF;
 SELECT event_type INTO ev_type FROM public.workflow_events WHERE id=_event AND job_id=_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source event must belong to this job'; END IF;
 IF _target !~ '^[a-z_]+:[a-zA-Z0-9_-]+$' OR _payload !~ '^[a-z_]+:[a-zA-Z0-9_-]+$' THEN RAISE EXCEPTION 'Use private record references, never secret URLs'; END IF;
 IF length(trim(_basis))=0 OR length(trim(_version))=0 THEN RAISE EXCEPTION 'Delivery basis and version required'; END IF;
 INSERT INTO public.external_action_outbox(job_id,source_event_id,event_type,action_type,target_ref,delivery_basis,template_version,payload_ref,facts_hash,idempotency_key,last_error_code)
 VALUES(_job,_event,ev_type,_action,_target,_basis,_version,_payload,_facts,_key,'EXECUTION_NOT_RELEASED')
 ON CONFLICT(job_id,action_type,target_ref,template_version,facts_hash) DO NOTHING RETURNING id INTO out_id;
 IF out_id IS NULL THEN
  SELECT id INTO out_id FROM public.external_action_outbox WHERE job_id=_job AND action_type=_action AND target_ref=_target AND template_version=_version AND facts_hash=_facts;
  RETURN out_id;
 END IF;
 INSERT INTO public.external_action_events(outbox_id,action_type,event_type) VALUES(out_id,_action,'candidate_prepared');
 RETURN out_id;
END $$;

CREATE FUNCTION public.review_external_action(_id uuid,_actor uuid,_operation text,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.external_action_outbox;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
 IF length(trim(_reason))<5 THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO r FROM public.external_action_outbox WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR r.status IN ('completed','cancelled','superseded','processing') THEN RAISE EXCEPTION 'Cannot change this action'; END IF;
 IF _operation='cancel' THEN
  UPDATE public.external_action_outbox SET status='cancelled',cancelled_at=now(),cancel_reason=_reason,approved_by=NULL,approved_at=NULL WHERE id=_id;
 ELSIF _operation='retry_review' THEN
  IF r.last_error_code IN ('DELIVERY_UNKNOWN','PERMANENT_CONSENT','PERMANENT_CONFIG','PERMANENT_VALIDATION') THEN RAISE EXCEPTION 'Reconcile permanent or uncertain outcome; do not retry'; END IF;
 IF r.attempt_count>=5 THEN RAISE EXCEPTION 'Retry limit reached'; END IF;
 UPDATE public.external_action_outbox SET status='blocked',last_error_code='RECHECK_REQUIRED',approved_by=NULL,approved_at=NULL WHERE id=_id;
 ELSE RAISE EXCEPTION 'Unsupported operation'; END IF;
 INSERT INTO public.external_action_events(outbox_id,action_type,event_type,actor_id,details)
 VALUES(_id,r.action_type,_operation,_actor,jsonb_build_object('reason',_reason,'previous_status',r.status));
END $$;

CREATE FUNCTION public.invalidate_external_candidates() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE jid uuid; r record;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN jid=NEW.id; ELSE jid=NEW.job_id; END IF;
 FOR r IN UPDATE public.external_action_outbox SET
   status=CASE WHEN status='processing' THEN 'failed' ELSE 'superseded' END,
   last_error_code=CASE WHEN status='processing' THEN 'DELIVERY_UNKNOWN' ELSE 'FACTS_CHANGED' END,
   lease_id=NULL,lease_until=NULL,approved_by=NULL,approved_at=NULL
   WHERE job_id=jid AND status IN ('blocked','waiting','ready_for_approval','approved','processing','failed') RETURNING id,action_type
 LOOP
  INSERT INTO public.external_action_events(outbox_id,action_type,event_type,details)
  VALUES(r.id,r.action_type,'facts_invalidated',jsonb_build_object('table',TG_TABLE_NAME));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER launch_job_changed AFTER UPDATE OF stage,owner_id,property_id ON public.jobs FOR EACH ROW WHEN(OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION public.invalidate_external_candidates();
CREATE TRIGGER launch_booking_changed AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.invalidate_external_candidates();
CREATE TRIGGER launch_assignment_changed AFTER INSERT OR UPDATE ON public.job_assignments FOR EACH ROW EXECUTE FUNCTION public.invalidate_external_candidates();
CREATE TRIGGER launch_measurement_changed AFTER INSERT OR UPDATE ON public.ceiling_measurements FOR EACH ROW EXECUTE FUNCTION public.invalidate_external_candidates();
CREATE TRIGGER launch_consent_changed AFTER INSERT ON public.owner_contact_consents FOR EACH ROW EXECUTE FUNCTION public.invalidate_external_candidates();

REVOKE ALL ON FUNCTION public.set_external_action_mode(text,text,uuid,text),public.enqueue_external_action(uuid,uuid,text,text,text,text,text,text,text),public.review_external_action(uuid,uuid,text,text),public.invalidate_external_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_external_action_mode(text,text,uuid,text),public.enqueue_external_action(uuid,uuid,text,text,text,text,text,text,text),public.review_external_action(uuid,uuid,text,text) TO service_role;