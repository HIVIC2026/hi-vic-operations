-- CANDIDATE ONLY: allocate the next migration number after the concurrent installer work.
-- Do not run live until the practice database and complete application tests pass.
-- No historical message is backfilled into the new work queue.

ALTER TABLE public.outlook_sync_state
  ADD COLUMN IF NOT EXISTS expected_mailbox text,
  ADD COLUMN IF NOT EXISTS inbox_next_link text,
  ADD COLUMN IF NOT EXISTS sent_next_link text;

CREATE TABLE IF NOT EXISTS public.outlook_message_work (
  provider_message_id text PRIMARY KEY,
  mailbox text NOT NULL,
  message jsonb NOT NULL,
  route jsonb NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  message_at timestamptz NOT NULL,
  attachments_complete boolean NOT NULL DEFAULT false,
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (message->>'providerMessageId' = provider_message_id),
  CHECK (message->>'direction' IN ('inbound','outbound')),
  CHECK (route->>'kind' IN ('job','unmatched')),
  CHECK (jsonb_typeof(attachment_refs) = 'array')
);
ALTER TABLE public.outlook_message_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outlook_message_work FROM anon, authenticated;
GRANT ALL ON public.outlook_message_work TO service_role;
CREATE INDEX IF NOT EXISTS outlook_message_work_pending
  ON public.outlook_message_work (mailbox, created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION public.guard_outlook_message_work()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outlook processing history is permanent'; END IF;
  IF OLD.status='complete' OR NEW.provider_message_id<>OLD.provider_message_id
    OR NEW.mailbox<>OLD.mailbox OR NEW.message<>OLD.message OR NEW.route<>OLD.route
    OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.message_at<>OLD.message_at
    OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Outlook message identity and completed processing are immutable';
  END IF;
  NEW.updated_at=clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outlook_message_work_guard ON public.outlook_message_work;
CREATE TRIGGER outlook_message_work_guard BEFORE UPDATE OR DELETE ON public.outlook_message_work
  FOR EACH ROW EXECUTE FUNCTION public.guard_outlook_message_work();

-- Reserve only NEW provider messages. A legacy correspondence/review never becomes pending work.
CREATE OR REPLACE FUNCTION public.begin_outlook_message(_mailbox text, _message jsonb, _route jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w public.outlook_message_work%ROWTYPE; mid text:=_message->>'providerMessageId';
BEGIN
  IF coalesce(mid,'')='' OR coalesce(_mailbox,'')='' OR _route->>'kind' NOT IN ('job','unmatched') THEN
    RAISE EXCEPTION 'Invalid Outlook message';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outlook:'||mid,0));
  SELECT * INTO w FROM public.outlook_message_work WHERE provider_message_id=mid;
  IF FOUND THEN
    IF w.mailbox<>lower(_mailbox) THEN RAISE EXCEPTION 'Outlook mailbox identity changed'; END IF;
    RETURN jsonb_build_object('state',w.status,'work',to_jsonb(w));
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_communications WHERE provider='outlook' AND provider_message_id=mid)
    OR EXISTS (SELECT 1 FROM public.correspondence_reviews WHERE provider='outlook' AND provider_message_id=mid) THEN
    RETURN jsonb_build_object('state','legacy');
  END IF;
  INSERT INTO public.outlook_message_work(provider_message_id,mailbox,message,route,job_id,message_at,attachments_complete)
    VALUES(mid,lower(_mailbox),_message,_route,(_route->>'jobId')::uuid,(_message->>'at')::timestamptz,NOT coalesce((_message->>'hasAttachments')::boolean,false))
    RETURNING * INTO w;
  RETURN jsonb_build_object('state','pending','work',to_jsonb(w));
END $$;
REVOKE ALL ON FUNCTION public.begin_outlook_message(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_outlook_message(text,jsonb,jsonb) TO service_role;

-- Correspondence, review/closure, audit and completion commit together. An exception rolls all back.
CREATE OR REPLACE FUNCTION public.finish_outlook_message(_message_id text, _decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  w public.outlook_message_work%ROWTYPE; j public.jobs%ROWTYPE;
  m jsonb; r jsonb; comm uuid; review_id uuid; outcome jsonb;
  action text:=coalesce(_decision->>'action','none'); expected_stage text:=_decision->>'expectedStage';
  mid_at timestamptz; candidate_ids uuid[]; inserted integer;
BEGIN
  SELECT * INTO STRICT w FROM public.outlook_message_work WHERE provider_message_id=_message_id FOR UPDATE;
  IF w.status='complete' THEN RETURN coalesce(w.result,'{}'::jsonb)||jsonb_build_object('replayed',true); END IF;
  IF NOT w.attachments_complete THEN RAISE EXCEPTION 'Outlook attachment metadata is still pending'; END IF;
  m:=w.message; r:=w.route; mid_at:=(m->>'at')::timestamptz;
  IF action NOT IN ('none','flag','close') THEN RAISE EXCEPTION 'Invalid Outlook decision'; END IF;
  -- A manual import/assignment that won the race is already history; never re-close it.
  IF EXISTS (SELECT 1 FROM public.job_communications WHERE provider='outlook' AND provider_message_id=_message_id)
    OR EXISTS (SELECT 1 FROM public.correspondence_reviews WHERE provider='outlook' AND provider_message_id=_message_id) THEN
    outcome:=jsonb_build_object('duplicate',true);
  ELSIF r->>'kind'='unmatched' THEN
    SELECT coalesce(array_agg(v::uuid),'{}'::uuid[]) INTO candidate_ids
      FROM jsonb_array_elements_text(coalesce(r->'candidateJobIds','[]'::jsonb)) v;
    INSERT INTO public.correspondence_reviews(kind,provider,provider_message_id,provider_thread_id,
      candidate_job_ids,direction,from_address,recipients,subject,body,message_at,attachment_refs,reason)
    VALUES('unmatched','outlook',_message_id,m->>'threadId',candidate_ids,m->>'direction',m->>'from',
      coalesce(m->'to','[]'::jsonb)||coalesce(m->'cc','[]'::jsonb),m->>'subject',coalesce(m->>'body',''),
      mid_at,w.attachment_refs,r->>'reason') RETURNING id INTO review_id;
    outcome:=jsonb_build_object('unmatched',true,'reviewId',review_id);
  ELSE
    SELECT * INTO STRICT j FROM public.jobs WHERE id=(r->>'jobId')::uuid FOR UPDATE;
    IF j.deleted_at IS NOT NULL OR j.source='qa_test' THEN
      outcome:=jsonb_build_object('ignored',true);
    ELSE
      IF expected_stage IS NOT NULL AND j.stage::text<>expected_stage THEN
        RAISE EXCEPTION 'Job changed during Outlook processing; retry current facts' USING ERRCODE='40001';
      END IF;
      IF action='close' THEN
        IF m->>'direction'<>'inbound' OR expected_stage IS NULL OR coalesce(_decision->>'reason','')=''
          OR _decision->>'inboxCompleteThrough' IS NULL OR mid_at>(_decision->>'inboxCompleteThrough')::timestamptz THEN
          RAISE EXCEPTION 'Invalid Outlook closure';
        END IF;
        -- Re-check under the job lock; the server also checks these reads before making its pure decision.
        IF EXISTS (SELECT 1 FROM public.job_communications c WHERE c.job_id=j.id
          AND c.direction='inbound' AND c.received_at>mid_at)
          OR EXISTS (SELECT 1 FROM public.outlook_message_work later WHERE later.job_id=j.id
            AND later.message->>'direction'='inbound' AND later.message_at>mid_at) THEN
          RAISE EXCEPTION 'Later correspondence needs review before closure' USING ERRCODE='40001';
        END IF;
      END IF;
      INSERT INTO public.job_communications(job_id,direction,channel,sender_text,recipients,subject,body,
        provider,provider_message_id,provider_thread_id,sent_at,received_at,delivery_status,visibility,
        attachment_refs,source_event,source_reference,created_by)
      VALUES(j.id,m->>'direction','email',CASE WHEN coalesce(m->>'fromName','')<>''
          THEN (m->>'fromName')||' <'||coalesce(m->>'from','')||'>' ELSE m->>'from' END,
        coalesce(m->'to','[]'::jsonb)||coalesce(m->'cc','[]'::jsonb),m->>'subject',coalesce(nullif(m->>'body',''),'(no text)'),
        'outlook',_message_id,m->>'threadId',CASE WHEN m->>'direction'='outbound' THEN mid_at END,
        CASE WHEN m->>'direction'='inbound' THEN mid_at END,
        CASE WHEN m->>'direction'='inbound' THEN 'received' ELSE 'sent' END,'customer',w.attachment_refs,
        'outlook_sync:'||(r->>'how'),m->>'internetMessageId',NULL) RETURNING id INTO comm;
      IF action='flag' THEN
        IF _decision->>'kind' NOT IN ('possible_not_proceeding','not_proceeding_progressed') THEN
          RAISE EXCEPTION 'Invalid Outlook review kind';
        END IF;
        INSERT INTO public.correspondence_reviews(kind,provider,provider_message_id,provider_thread_id,
          job_id,communication_id,direction,from_address,recipients,subject,body,message_at,attachment_refs,reason,suggested_reason)
        VALUES(_decision->>'kind','outlook',_message_id,m->>'threadId',j.id,comm,m->>'direction',m->>'from',
          coalesce(m->'to','[]'::jsonb)||coalesce(m->'cc','[]'::jsonb),m->>'subject',coalesce(m->>'body',''),mid_at,
          w.attachment_refs,_decision->>'reason',_decision->>'suggestedReason');
      ELSIF action='close' THEN
        UPDATE public.jobs SET stage='cancelled',prior_stage=j.stage,cancelled_reason=_decision->>'reason',
          next_action='Closed — customer not proceeding (from their email)',last_activity_at=clock_timestamp()
          WHERE id=j.id AND stage=j.stage;
        GET DIAGNOSTICS inserted=ROW_COUNT;
        IF inserted<>1 THEN RAISE EXCEPTION 'Outlook closure was not saved'; END IF;
        INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,from_stage,to_stage,internal)
        VALUES(j.id,NULL,'stage_changed','Closed: '||(_decision->>'reason'),
          jsonb_build_object('source','outlook_sync','communication_id',comm,'phrase',_decision->>'phrase',
            'outlook_work_id',_message_id,'inbox_complete_through',_decision->>'inboxCompleteThrough'),j.stage,'cancelled',false);
      END IF;
      outcome:=jsonb_build_object('stored',true,'communicationId',comm,'closed',action='close','flagged',action='flag');
    END IF;
  END IF;
  UPDATE public.outlook_message_work SET status='complete',result=outcome,last_error=NULL
    WHERE provider_message_id=_message_id;
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.finish_outlook_message(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_outlook_message(text,jsonb) TO service_role;

-- Explicit Office confirmation only. This does not authenticate or sync Outlook.
CREATE OR REPLACE FUNCTION public.confirm_outlook_mailbox(_mailbox text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.outlook_sync_state%ROWTYPE;
BEGIN
  IF _actor IS NULL OR _mailbox !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Mailbox and Office actor are required';
  END IF;
  SELECT * INTO STRICT s FROM public.outlook_sync_state WHERE id=1 FOR UPDATE;
  IF (s.mailbox IS NOT NULL AND lower(s.mailbox)<>lower(_mailbox))
    OR (s.expected_mailbox IS NOT NULL AND lower(s.expected_mailbox)<>lower(_mailbox)) THEN
    RAISE EXCEPTION 'Changing an existing sync mailbox requires a separate reviewed migration';
  END IF;
  IF s.expected_mailbox IS NULL THEN
    UPDATE public.outlook_sync_state SET expected_mailbox=lower(_mailbox),updated_at=clock_timestamp() WHERE id=1;
    INSERT INTO public.admin_config_events(actor_id,event_type,summary,details)
      VALUES(_actor,'outlook_mailbox_confirmed','Office confirmed the Outlook mailbox for correspondence sync',
        jsonb_build_object('mailbox',lower(_mailbox)));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.confirm_outlook_mailbox(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_outlook_mailbox(text,uuid) TO service_role;
