-- Before-use rollback only. Stop scheduled/manual Outlook sync and revert dependent code first.
-- Refuses while the recovery queue or multi-job linking is in use: that is permanent history, and a
-- forward repair must be used instead of dropping it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.outlook_message_work)
    OR EXISTS (SELECT 1 FROM public.job_communications WHERE provider_message_id IS NOT NULL
               GROUP BY provider, provider_message_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Outlook history capture is already in use: preserve its queue and per-job linking';
  END IF;
END $$;

DROP INDEX IF EXISTS public.job_communications_job_provider_msg;
DROP INDEX IF EXISTS public.job_communications_provider_msg_other;
CREATE UNIQUE INDEX IF NOT EXISTS job_communications_provider_msg
  ON public.job_communications (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Restore the 0212 function bodies.
DROP FUNCTION IF EXISTS public.begin_outlook_message(text,jsonb,jsonb,boolean);
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

ALTER TABLE public.outlook_sync_state
  DROP COLUMN all_inbound_cursor,
  DROP COLUMN all_inbound_next_link,
  DROP COLUMN all_outbound_cursor,
  DROP COLUMN all_outbound_next_link,
  DROP COLUMN catchup_from,
  DROP COLUMN catchup_inbound_cursor,
  DROP COLUMN catchup_inbound_next_link,
  DROP COLUMN catchup_outbound_cursor,
  DROP COLUMN catchup_outbound_next_link;

ALTER TABLE public.outlook_message_work
  DROP COLUMN record_only;
