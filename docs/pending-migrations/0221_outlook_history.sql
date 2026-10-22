-- 0221: Outlook history capture — folder-agnostic live streams, resumable historical catch-up,
-- per-job linking of one original message, and attachment preservation.
-- PENDING ONLY: proven on the practice (PGlite) database via tests/helpers/outlook-recovery-harness.ts
-- before any live apply. The previous release keeps running on the old cursor columns until the app
-- release that reads these; the old columns are never deleted, only marked deprecated.

-- 1) Sync state: folder-agnostic live cursors (mail moved to Archive or custom folders is still seen,
--    because the pull is no longer per-folder) plus separate cursors for the operator-set historical catch-up.
ALTER TABLE public.outlook_sync_state
  ADD COLUMN IF NOT EXISTS all_inbound_cursor timestamptz,
  ADD COLUMN IF NOT EXISTS all_inbound_next_link text,
  ADD COLUMN IF NOT EXISTS all_outbound_cursor timestamptz,
  ADD COLUMN IF NOT EXISTS all_outbound_next_link text,
  ADD COLUMN IF NOT EXISTS catchup_from timestamptz,
  ADD COLUMN IF NOT EXISTS catchup_inbound_cursor timestamptz,
  ADD COLUMN IF NOT EXISTS catchup_inbound_next_link text,
  ADD COLUMN IF NOT EXISTS catchup_outbound_cursor timestamptz,
  ADD COLUMN IF NOT EXISTS catchup_outbound_next_link text;

COMMENT ON COLUMN public.outlook_sync_state.inbox_cursor IS 'DEPRECATED: replaced by all_inbound_cursor (folder-agnostic mailbox stream)';
COMMENT ON COLUMN public.outlook_sync_state.sent_cursor IS 'DEPRECATED: replaced by all_outbound_cursor (folder-agnostic mailbox stream)';
COMMENT ON COLUMN public.outlook_sync_state.inbox_next_link IS 'DEPRECATED: replaced by all_inbound_next_link';
COMMENT ON COLUMN public.outlook_sync_state.sent_next_link IS 'DEPRECATED: replaced by all_outbound_next_link';
COMMENT ON COLUMN public.outlook_sync_state.catchup_from IS 'Office-set start of the historical catch-up; cleared automatically once both catch-up streams are exhausted';

-- 2) One original message may be linked to every confirmed relevant job; it is still stored only once
--    per job. Replaces the global per-message unique index.
DROP INDEX IF EXISTS public.job_communications_provider_msg;
CREATE UNIQUE INDEX IF NOT EXISTS job_communications_job_provider_msg
  ON public.job_communications (job_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- 3) begin_outlook_message: the route may carry several confirmed job ids (a legacy single jobId is
--    still accepted for rows reserved by the previous release). Attachment metadata is now always
--    fetched, so an email whose only attachment is an inline image is never missed.
CREATE OR REPLACE FUNCTION public.begin_outlook_message(_mailbox text, _message jsonb, _route jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w public.outlook_message_work%ROWTYPE; mid text:=_message->>'providerMessageId'; jid uuid;
BEGIN
  IF coalesce(mid,'')='' OR coalesce(_mailbox,'')='' OR _route->>'kind' NOT IN ('job','unmatched') THEN
    RAISE EXCEPTION 'Invalid Outlook message';
  END IF;
  IF _route->>'kind'='job' THEN
    IF jsonb_typeof(_route->'jobIds')='array' AND jsonb_array_length(_route->'jobIds')>0 THEN
      SELECT (v)::uuid INTO jid FROM jsonb_array_elements_text(_route->'jobIds') v LIMIT 1;
    ELSIF coalesce(_route->>'jobId','')<>'' THEN
      jid:=(_route->>'jobId')::uuid;
    ELSE
      RAISE EXCEPTION 'Outlook route has no job';
    END IF;
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
    VALUES(mid,lower(_mailbox),_message,_route,jid,(_message->>'at')::timestamptz,false)
    RETURNING * INTO w;
  RETURN jsonb_build_object('state','pending','work',to_jsonb(w));
END $$;
REVOKE ALL ON FUNCTION public.begin_outlook_message(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_outlook_message(text,jsonb,jsonb) TO service_role;

-- 4) finish_outlook_message: stores the one original message on every confirmed job (dedupe per job),
--    keeps unmatched mail in the Office review queue, and applies close/flag decisions only to a
--    single-job route. Correspondence, review/closure, audit and completion commit together.
CREATE OR REPLACE FUNCTION public.finish_outlook_message(_message_id text, _decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  w public.outlook_message_work%ROWTYPE; j public.jobs%ROWTYPE;
  m jsonb; r jsonb; job_ids uuid[]; comm uuid; first_comm uuid; review_id uuid; outcome jsonb;
  action text:=coalesce(_decision->>'action','none'); expected_stage text:=_decision->>'expectedStage';
  mid_at timestamptz; candidate_ids uuid[]; inserted integer; jid uuid;
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
    IF jsonb_typeof(r->'jobIds')='array' THEN
      SELECT coalesce(array_agg(v::uuid),'{}'::uuid[]) INTO job_ids FROM jsonb_array_elements_text(r->'jobIds') v;
    ELSIF coalesce(r->>'jobId','')<>'' THEN
      job_ids:=ARRAY[(r->>'jobId')::uuid];
    ELSE
      RAISE EXCEPTION 'Outlook route has no job';
    END IF;
    IF coalesce(array_length(job_ids,1),0)=0 THEN RAISE EXCEPTION 'Outlook route has no job'; END IF;
    IF action IN ('flag','close') AND array_length(job_ids,1)<>1 THEN
      RAISE EXCEPTION 'Outlook decisions require a single confirmed job';
    END IF;
    inserted:=0; first_comm:=NULL;
    FOREACH jid IN ARRAY job_ids LOOP
      comm:=NULL;
      SELECT * INTO STRICT j FROM public.jobs WHERE id=jid FOR UPDATE;
      IF j.deleted_at IS NOT NULL OR j.source='qa_test' THEN CONTINUE; END IF;
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
        'outlook_sync:'||(r->>'how'),m->>'internetMessageId',NULL)
      ON CONFLICT (job_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
      RETURNING id INTO comm;
      IF comm IS NOT NULL THEN
        inserted:=inserted+1;
        first_comm:=coalesce(first_comm,comm);
      END IF;
    END LOOP;
    IF inserted=0 THEN
      outcome:=jsonb_build_object('duplicate',true);
    ELSIF action='flag' THEN
      IF _decision->>'kind' NOT IN ('possible_not_proceeding','not_proceeding_progressed') THEN
        RAISE EXCEPTION 'Invalid Outlook review kind';
      END IF;
      INSERT INTO public.correspondence_reviews(kind,provider,provider_message_id,provider_thread_id,
        job_id,communication_id,direction,from_address,recipients,subject,body,message_at,attachment_refs,reason,suggested_reason)
      VALUES(_decision->>'kind','outlook',_message_id,m->>'threadId',job_ids[1],first_comm,m->>'direction',m->>'from',
        coalesce(m->'to','[]'::jsonb)||coalesce(m->'cc','[]'::jsonb),m->>'subject',coalesce(m->>'body',''),mid_at,
        w.attachment_refs,_decision->>'reason',_decision->>'suggestedReason');
      outcome:=jsonb_build_object('stored',true,'communicationId',first_comm,'closed',false,'flagged',true);
    ELSIF action='close' THEN
      UPDATE public.jobs SET stage='cancelled',prior_stage=j.stage,cancelled_reason=_decision->>'reason',
        next_action='Closed — customer not proceeding (from their email)',last_activity_at=clock_timestamp()
        WHERE id=job_ids[1] AND stage=expected_stage::job_stage;
      GET DIAGNOSTICS inserted=ROW_COUNT;
      IF inserted<>1 THEN RAISE EXCEPTION 'Outlook closure was not saved'; END IF;
      INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,from_stage,to_stage,internal)
      VALUES(job_ids[1],NULL,'stage_changed','Closed: '||(_decision->>'reason'),
        jsonb_build_object('source','outlook_sync','communication_id',first_comm,'phrase',_decision->>'phrase',
          'outlook_work_id',_message_id,'inbox_complete_through',_decision->>'inboxCompleteThrough'),expected_stage::job_stage,'cancelled',false);
      outcome:=jsonb_build_object('stored',true,'communicationId',first_comm,'closed',true,'flagged',false);
    ELSE
      outcome:=jsonb_build_object('stored',true,'communicationId',first_comm,'closed',false,'flagged',false);
    END IF;
  END IF;
  UPDATE public.outlook_message_work SET status='complete',result=outcome,last_error=NULL
    WHERE provider_message_id=_message_id;
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.finish_outlook_message(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_outlook_message(text,jsonb) TO service_role;
