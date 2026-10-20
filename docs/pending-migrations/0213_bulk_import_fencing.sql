BEGIN;
-- Applied live 20 Oct 2026 as drizzle 0156_0213_bulk_import_fencing (sequence 0213).
-- LOCAL CANDIDATE. Assign a sequence after concurrent builds; apply only after current-schema PGlite proof.
-- A claim token is checked under the batch/row lock in every write transaction. No expired worker may finish,
-- release, attach documents or modify a successor's job. Closed rows/batches retain their existing history.
ALTER TABLE public.bulk_import_rows
  ADD COLUMN IF NOT EXISTS confirm_claim_token uuid,
  ADD COLUMN IF NOT EXISTS confirm_snapshot jsonb;

-- Bulk UI reads/writes use checked service-role server functions. Raw tables contain other customers' contacts/prices.
-- Remove every raw privilege, including broader live TRUNCATE/REFERENCES/TRIGGER grants, so field members
-- cannot bypass the active-boss/Office history check or the guarded write path. Keep service_role grants intact.
REVOKE ALL ON public.bulk_import_batches, public.bulk_import_rows FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bulk_import_access(_business uuid, _actor uuid, _work boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.businesses%ROWTYPE; office boolean;
BEGIN
  PERFORM 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin' FOR SHARE;
  office := FOUND;
  IF NOT office THEN
    PERFORM 1 FROM public.business_members WHERE business_id = _business AND user_id = _actor
      AND member_role = 'business_admin' AND active IS TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an active business admin can manage this upload'; END IF;
  END IF;
  SELECT * INTO b FROM public.businesses WHERE id = _business FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload business not found'; END IF;
  IF _work THEN
    PERFORM 1 FROM public.business_members WHERE business_id = _business AND active IS TRUE AND member_role = 'business_admin' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This installer business has no active business admin to own the job'; END IF;
    IF b.business_type <> 'eec_installer' OR b.is_active IS NOT TRUE OR b.onboarding_status <> 'approved' THEN
      RAISE EXCEPTION 'The installer business is not currently approved and active';
    END IF;
    -- Same expiry boundary as credentialState in pilot.core (end of the recorded day at +10:00).
    PERFORM 1 FROM public.business_credentials WHERE business_id = _business AND critical IS TRUE
      AND expires_at IS NOT NULL AND (expires_at::text || 'T23:59:59+10:00')::timestamptz < clock_timestamp() FOR SHARE;
    IF FOUND THEN RAISE EXCEPTION 'A critical partner credential has expired'; END IF;
  END IF;
END $$;

-- The job/path idempotency key already exists in production as documents_external_source_uniq.
-- A conflict is successful only after the exact job, kind and stored path are read back.
CREATE OR REPLACE FUNCTION public._bulk_import_document(_job uuid, _business uuid, _actor uuid, _file jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE did uuid; matches bigint; stored text := _file->>'storedPath'; prefix text := 'partners/' || _business::text || '/imports/';
BEGIN
  IF stored IS NULL OR left(stored,length(prefix)) <> prefix OR stored ~ '(^|/)\.\.?(/|$)|[\\?#%]' THEN RAISE EXCEPTION 'The stored file is outside this business upload scope'; END IF;
  SELECT count(*), min(id::text)::uuid INTO matches,did FROM public.documents WHERE job_id = _job AND kind = 'installer_import' AND storage_path = stored;
  IF matches > 1 THEN RAISE EXCEPTION 'This file already has ambiguous job document records; Office must review them'; END IF;
  IF matches = 1 THEN RETURN did; END IF;
  INSERT INTO public.documents(job_id,kind,title,original_name,mime_type,storage_path,source_system,external_id,uploaded_by)
    VALUES(_job,'installer_import',_file->>'name',left(_file->>'originalPath',300),_file->>'mime',stored,'bulk_import',stored,_actor)
    ON CONFLICT DO NOTHING RETURNING id INTO did;
  IF did IS NULL THEN
    SELECT id INTO did FROM public.documents WHERE job_id = _job AND kind = 'installer_import' AND storage_path = stored AND source_system = 'bulk_import' AND external_id = stored;
    IF did IS NULL THEN RAISE EXCEPTION 'A different document owns this import key; the file was not attached'; END IF;
  END IF;
  RETURN did;
END $$;

CREATE OR REPLACE FUNCTION public._bulk_import_quote_complete(_job uuid, _quote uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quotes%ROWTYPE; j public.jobs%ROWTYPE; total numeric; n bigint; price_n bigint; ap_n bigint; piesa_n bigint; invalid_n bigint;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = _quote AND job_id = _job;
  SELECT * INTO j FROM public.jobs WHERE id = _job;
  IF q.id IS NULL OR q.kind <> 'installation' OR q.status NOT IN ('draft','issued','accepted') OR q.partner_business_id IS DISTINCT FROM j.originating_installer_business_id THEN RETURN false; END IF;
  SELECT count(*), COALESCE(sum(line_total_inc_gst),0), count(*) FILTER(WHERE code = 'INSTALLER_PRICE'),
    count(*) FILTER(WHERE code = 'AP_FEE'),count(*) FILTER(WHERE code = 'PIESA'),
    count(*) FILTER(WHERE code IS NULL OR code NOT IN ('INSTALLER_PRICE','AP_FEE','PIESA') OR quantity IS DISTINCT FROM 1 OR unit <> 'flat'
      OR unit_price_inc_gst IS DISTINCT FROM line_total_inc_gst OR line_total_inc_gst IS NULL
      OR (code = 'INSTALLER_PRICE' AND line_total_inc_gst IS DISTINCT FROM j.installer_quoted_price_inc_gst))
    INTO n,total,price_n,ap_n,piesa_n,invalid_n FROM public.quote_items WHERE quote_id = _quote;
  RETURN COALESCE(n IN (2,3) AND price_n = 1 AND ap_n = 1 AND invalid_n = 0
    AND piesa_n = CASE WHEN j.electrician_choice IN ('preferred','nominated','installer_own') THEN 0 ELSE 1 END
    AND round(total,2) = round(q.subtotal_inc_gst,2)
    AND round(q.subtotal_inc_gst - q.veec_discount_inc_gst,2) = round(q.customer_total_inc_gst,2),false);
END $$;

CREATE OR REPLACE FUNCTION public.finish_bulk_import_row(_row uuid, _actor uuid, _token uuid, _quote jsonb, _files jsonb, _owner_link jsonb, _audit jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; j public.jobs%ROWTYPE; q public.quotes%ROWTYPE;
  qi public.quote_items%ROWTYPE; qid uuid; qcount bigint; f jsonb; m jsonb; entry jsonb; expected text; permission jsonb;
  link_created boolean := false; quoted boolean := false; not_attached jsonb := '[]'::jsonb; attached jsonb := '[]'::jsonb;
BEGIN
  r := public._bulk_import_claimed(_row, _actor, _token);
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = r.batch_id;
  SELECT * INTO j FROM public.jobs WHERE id = r.job_id FOR UPDATE;
  IF j.id IS NULL OR j.external_enquiry_id IS DISTINCT FROM 'bulk:' || _row::text OR j.channel <> 'installer_sourced'
    OR j.originating_installer_business_id IS DISTINCT FROM b.business_id OR j.business_unit IS DISTINCT FROM 'hivic'
    OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL THEN RAISE EXCEPTION 'This job is outside the active upload scope'; END IF;
  PERFORM 1 FROM public.job_assignments a JOIN public.business_members m ON m.business_id = a.business_id AND m.user_id = a.user_id
    WHERE a.job_id = j.id AND a.role = 'installer' AND a.active IS TRUE AND a.business_id = b.business_id
      AND m.member_role = 'business_admin' AND m.active IS TRUE FOR SHARE OF a,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'The current installer assignment is no longer an active business admin'; END IF;
  IF r.confirm_snapshot IS NULL THEN RAISE EXCEPTION 'The importer intake snapshot is missing'; END IF;
  permission := COALESCE(NULLIF(r.confirm_snapshot->'extracted'->'owner_consent','null'::jsonb), b.summary->'permission');
  IF permission IS NULL OR permission = 'false'::jsonb OR nullif(permission->>'confirmed_by','') IS NULL OR nullif(permission->>'confirmed_at','') IS NULL THEN RAISE EXCEPTION 'The submitted owner contact permission is missing'; END IF;
  -- Every matched file must have one explicit result. A supported file without a verified stored copy cannot finish.
  IF jsonb_typeof(_files) IS DISTINCT FROM 'array' OR jsonb_array_length(_files) <> jsonb_array_length(r.matched_files) THEN RAISE EXCEPTION 'The complete file verification result is required'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(r.matched_files) LOOP
    SELECT value INTO f FROM jsonb_array_elements(_files) WHERE value->>'originalPath' = m->>'path';
    IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(_files) WHERE value->>'originalPath' = m->>'path') <> 1 THEN RAISE EXCEPTION 'A matched file is missing or ambiguous'; END IF;
    IF f->>'omitted' = 'unsupported_type' THEN not_attached := not_attached || jsonb_build_array(m->>'path'); CONTINUE; END IF;
    SELECT value INTO entry FROM jsonb_array_elements(b.file_manifest) WHERE value->>'path' = m->>'path';
    IF (SELECT count(*) FROM jsonb_array_elements(b.file_manifest) WHERE value->>'path' = m->>'path') > 1 THEN RAISE EXCEPTION 'An original upload path is ambiguous'; END IF;
    expected := COALESCE(entry->>'stored_path',CASE WHEN m->>'how' = 'added' THEN m->>'path' ELSE NULL END);
    IF expected IS NULL OR expected IS DISTINCT FROM f->>'storedPath' OR f->>'mime' IS NULL THEN RAISE EXCEPTION 'A required file has no verified stored copy'; END IF;
    PERFORM public._bulk_import_document(j.id,b.business_id,_actor,f);
    attached := attached || jsonb_build_array(m->>'path');
  END LOOP;
  IF r.import_stage = 'quoted' THEN
    SELECT count(*), min(id::text)::uuid INTO qcount,qid FROM public.quotes WHERE job_id = j.id AND option_code = 'INSTALLER_A1';
    IF qcount > 1 THEN RAISE EXCEPTION 'More than one earlier import quote exists; Office must review them'; END IF;
    IF qid IS NOT NULL THEN
      IF NOT public._bulk_import_quote_complete(j.id,qid) THEN RAISE EXCEPTION 'The earlier quote is incomplete or inconsistent. Office must repair it separately; its recorded prices have been retained'; END IF;
      quoted := true;
    ELSIF _quote IS NOT NULL AND _quote <> 'null'::jsonb THEN
      IF EXISTS(SELECT 1 FROM public.quotes WHERE job_id = j.id AND status IN ('issued','accepted')) THEN RAISE EXCEPTION 'An issued quote already exists; Office must review this upload'; END IF;
      q := jsonb_populate_record(NULL::public.quotes,_quote->'header');
      IF q.status IS DISTINCT FROM 'draft' OR q.option_code IS DISTINCT FROM 'INSTALLER_A1' OR q.partner_business_id IS DISTINCT FROM b.business_id THEN RAISE EXCEPTION 'Only a draft for this installer business may be added'; END IF;
      INSERT INTO public.quotes(job_id,kind,option_label,option_code,status,subtotal_inc_gst,gst_amount,veec_discount_inc_gst,discount_note,
        customer_total_inc_gst,created_by,partner_business_id,release_state,release_hold_reason)
      VALUES(j.id,q.kind,q.option_label,q.option_code,'draft',q.subtotal_inc_gst,q.gst_amount,q.veec_discount_inc_gst,q.discount_note,
        q.customer_total_inc_gst,_actor,b.business_id,q.release_state,q.release_hold_reason) RETURNING id INTO qid;
      FOR qi IN SELECT * FROM jsonb_populate_recordset(NULL::public.quote_items,_quote->'lines') LOOP
        INSERT INTO public.quote_items(quote_id,code,description,quantity,unit,unit_price_inc_gst,line_total_inc_gst,is_other,explanation,sort)
          VALUES(qid,qi.code,qi.description,qi.quantity,qi.unit,qi.unit_price_inc_gst,qi.line_total_inc_gst,qi.is_other,qi.explanation,qi.sort);
      END LOOP;
      IF NOT public._bulk_import_quote_complete(j.id,qid) THEN RAISE EXCEPTION 'The quote header and lines do not agree; no quote was saved'; END IF;
      quoted := true;
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.owner_eligibility_links WHERE job_id = j.id) THEN
    IF COALESCE(_owner_link->>'token_hash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'A hashed owner link is required'; END IF;
    INSERT INTO public.owner_eligibility_links(job_id,business_id,token_hash,created_by,expires_at)
      VALUES(j.id,b.business_id,_owner_link->>'token_hash',_actor,(_owner_link->>'expires_at')::timestamptz);
    link_created := true;
  END IF;
  -- Independent recovery: a pre-existing confirmation event never masks missing contact-permission history.
  IF NOT EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id = j.id AND event_type = 'bulk_import_confirmed') THEN
    INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details)
      VALUES(j.id,_actor,'bulk_import_confirmed','Job created from installer bulk upload (row ' || (r.row_index + 1)::text || ')',
        COALESCE(_audit,'{}'::jsonb) || jsonb_build_object('batch_id',b.id,'row_id',_row,'draft_quote',quoted,'attached_files',attached,'files_not_attached',not_attached));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id = j.id AND event_type = 'bulk_import_contact_permission') THEN
    INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details)
      VALUES(j.id,(permission->>'confirmed_by')::uuid,'bulk_import_contact_permission',permission->>'wording',permission || jsonb_build_object('batch_id',b.id));
  END IF;
  UPDATE public.jobs SET last_activity_at = clock_timestamp() WHERE id = j.id;
  UPDATE public.bulk_import_rows SET status = 'confirmed',confirm_claim_token = NULL,confirm_lease_until = NULL,confirm_error = NULL WHERE id = _row;
  RETURN jsonb_build_object('quoted',quoted,'ownerLinkCreated',link_created,'attached',attached,'notAttached',not_attached);
END $$;

CREATE OR REPLACE FUNCTION public.close_bulk_import_batch(_batch uuid, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bulk_import_batches%ROWTYPE; pending bigint; counts jsonb;
BEGIN
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = _batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload not found'; END IF;
  PERFORM public._bulk_import_access(b.business_id,_actor,true);
  SELECT count(*) FILTER(WHERE status = 'pending'),jsonb_build_object('found',count(*),'added',count(*) FILTER(WHERE status = 'confirmed' AND job_id IS NOT NULL),
    'skipped',count(*) FILTER(WHERE status = 'skipped'),'pending',count(*) FILTER(WHERE status = 'pending'),'needsRepair',count(*) FILTER(WHERE status = 'confirmed' AND job_id IS NULL))
    INTO pending,counts FROM public.bulk_import_rows WHERE batch_id = _batch;
  IF b.status = 'analysed' AND pending = 0 THEN UPDATE public.bulk_import_batches SET status = 'confirmed',confirmed_at = clock_timestamp() WHERE id = _batch; END IF;
  RETURN counts;
END $$;

CREATE OR REPLACE FUNCTION public.bulk_import_batch_counts(_batches uuid[], _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bulk_import_batches%ROWTYPE; result jsonb := '{}'::jsonb; counts jsonb;
BEGIN
  IF COALESCE(array_length(_batches,1),0) > 50 THEN RAISE EXCEPTION 'Too many upload histories requested'; END IF;
  FOR b IN SELECT * FROM public.bulk_import_batches WHERE id = ANY(_batches) LOOP
    PERFORM public._bulk_import_access(b.business_id,_actor,false);
    SELECT jsonb_build_object('found',count(*),'added',count(*) FILTER(WHERE status = 'confirmed' AND job_id IS NOT NULL),
      'skipped',count(*) FILTER(WHERE status = 'skipped'),'pending',count(*) FILTER(WHERE status = 'pending'),'needsRepair',count(*) FILTER(WHERE status = 'confirmed' AND job_id IS NULL))
      INTO counts FROM public.bulk_import_rows WHERE batch_id = b.id;
    result := result || jsonb_build_object(b.id::text,counts);
  END LOOP;
  RETURN result;
END $$;

-- Repairs append their own immutable history. They never reopen or rewrite an old confirmed batch/row.
CREATE TABLE public.bulk_import_attachment_repairs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),row_id uuid NOT NULL REFERENCES public.bulk_import_rows(id),
  job_id uuid NOT NULL REFERENCES public.jobs(id),business_id uuid NOT NULL REFERENCES public.businesses(id),
  original_path text NOT NULL,storage_path text NOT NULL,document_id uuid NOT NULL REFERENCES public.documents(id),
  actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(row_id,storage_path));
ALTER TABLE public.bulk_import_attachment_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bulk_import_attachment_repairs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.bulk_import_attachment_repairs TO service_role;
CREATE TRIGGER bulk_import_attachment_repairs_immutable BEFORE UPDATE OR DELETE ON public.bulk_import_attachment_repairs
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();

CREATE OR REPLACE FUNCTION public.repair_bulk_import_attachment(_row uuid, _actor uuid, _file jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; j public.jobs%ROWTYPE; rid uuid; did uuid; original text := _file->>'originalPath'; expected text; bid uuid;
BEGIN
  IF public.has_role(_actor,'admin') IS NOT TRUE THEN RAISE EXCEPTION 'Only Office can repair completed upload files'; END IF;
  SELECT batch_id INTO bid FROM public.bulk_import_rows WHERE id = _row;
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = bid FOR UPDATE;
  SELECT * INTO r FROM public.bulk_import_rows WHERE id = _row FOR UPDATE;
  IF b.id IS NULL OR r.id IS NULL OR b.status <> 'confirmed' OR r.status <> 'confirmed' OR r.job_id IS NULL THEN RAISE EXCEPTION 'This is not a completed upload job'; END IF;
  PERFORM public._bulk_import_access(b.business_id,_actor,true);
  SELECT * INTO j FROM public.jobs WHERE id = r.job_id FOR UPDATE;
  IF j.id IS NULL OR j.external_enquiry_id IS DISTINCT FROM 'bulk:' || _row::text OR j.originating_installer_business_id IS DISTINCT FROM b.business_id OR j.channel <> 'installer_sourced' OR j.business_unit IS DISTINCT FROM 'hivic' OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL THEN RAISE EXCEPTION 'This job is outside the active upload business'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(r.matched_files) WHERE value->>'path' = original) <> 1 THEN RAISE EXCEPTION 'This file is not recorded on the historical customer'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(b.file_manifest) WHERE value->>'path' = original) > 1 THEN RAISE EXCEPTION 'The historical original path is ambiguous'; END IF;
  SELECT value->>'stored_path' INTO expected FROM jsonb_array_elements(b.file_manifest) WHERE value->>'path' = original;
  IF expected IS NULL THEN SELECT value->>'path' INTO expected FROM jsonb_array_elements(r.matched_files) WHERE value->>'path' = original AND value->>'how' = 'added'; END IF;
  IF expected IS NULL OR expected IS DISTINCT FROM _file->>'storedPath' THEN RAISE EXCEPTION 'The historical file has no verified stored copy'; END IF;
  SELECT id INTO rid FROM public.bulk_import_attachment_repairs WHERE row_id = _row AND storage_path = expected;
  IF rid IS NOT NULL THEN RETURN rid; END IF;
  did := public._bulk_import_document(j.id,b.business_id,_actor,_file);
  INSERT INTO public.bulk_import_attachment_repairs(row_id,job_id,business_id,original_path,storage_path,document_id,actor_id)
    VALUES(_row,j.id,b.business_id,original,expected,did,_actor) RETURNING id INTO rid;
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(j.id,_actor,'bulk_import_attachment_repaired',
    'A missing upload file was attached separately; the original upload history was retained',jsonb_build_object('repair_id',rid,'row_id',_row,'original_path',original,'storage_path',expected,'document_id',did),true);
  RETURN rid;
END $$;



CREATE OR REPLACE FUNCTION public._bulk_import_claimed(_row uuid, _actor uuid, _token uuid)
RETURNS public.bulk_import_rows LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; bid uuid;
BEGIN
  SELECT batch_id INTO bid FROM public.bulk_import_rows WHERE id = _row;
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = bid FOR UPDATE;
  IF NOT FOUND OR b.status <> 'analysed' THEN RAISE EXCEPTION 'This upload is permanent history or is not ready'; END IF;
  PERFORM public._bulk_import_access(b.business_id, _actor, true);
  SELECT * INTO r FROM public.bulk_import_rows WHERE id = _row AND batch_id = bid FOR UPDATE;
  IF r.status <> 'pending' OR r.confirm_claim_token IS DISTINCT FROM _token OR _token IS NULL
    OR r.confirm_lease_until IS NULL OR r.confirm_lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'This confirmation claim is no longer current; refresh the upload';
  END IF;
  PERFORM set_config('app.bulk_import_row', _row::text, true);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.guard_bulk_import_row_writer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.bulk_import_row', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'Bulk customer changes require the guarded upload action';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER bulk_import_row_writer BEFORE UPDATE OR DELETE ON public.bulk_import_rows
FOR EACH ROW EXECUTE FUNCTION public.guard_bulk_import_row_writer();

CREATE OR REPLACE FUNCTION public.claim_bulk_import_row(_row uuid, _actor uuid, _token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; bid uuid;
BEGIN
  IF _token IS NULL THEN RAISE EXCEPTION 'A confirmation token is required'; END IF;
  SELECT batch_id INTO bid FROM public.bulk_import_rows WHERE id = _row;
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = bid FOR UPDATE;
  IF NOT FOUND OR b.status <> 'analysed' THEN RAISE EXCEPTION 'This upload can no longer be confirmed'; END IF;
  PERFORM public._bulk_import_access(b.business_id, _actor, true);
  SELECT * INTO r FROM public.bulk_import_rows WHERE id = _row FOR UPDATE;
  IF r.status <> 'pending' THEN RETURN NULL; END IF;
  IF r.confirm_lease_until > clock_timestamp() THEN RETURN NULL; END IF;
  PERFORM set_config('app.bulk_import_row', _row::text, true);
  UPDATE public.bulk_import_rows SET confirm_claim_token = _token, confirm_lease_until = clock_timestamp() + interval '5 minutes'
    WHERE id = _row RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.release_bulk_import_row(_row uuid, _actor uuid, _token uuid, _error text, _skip boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE;
BEGIN
  r := public._bulk_import_claimed(_row, _actor, _token);
  IF _skip AND r.job_id IS NOT NULL THEN RAISE EXCEPTION 'A started job cannot be silently skipped; finish or review that job'; END IF;
  UPDATE public.bulk_import_rows SET status = CASE WHEN _skip THEN 'skipped' ELSE 'pending' END,
    confirm_claim_token = NULL, confirm_lease_until = NULL, confirm_error = CASE WHEN _skip THEN NULL ELSE left(_error, 500) END
    WHERE id = _row;
END $$;

CREATE OR REPLACE FUNCTION public.edit_bulk_import_row(_row uuid, _actor uuid, _expected jsonb, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; bid uuid; k text;
BEGIN
  SELECT batch_id INTO bid FROM public.bulk_import_rows WHERE id = _row;
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = bid FOR UPDATE;
  IF NOT FOUND OR b.status <> 'analysed' THEN RAISE EXCEPTION 'This upload is permanent history'; END IF;
  PERFORM public._bulk_import_access(b.business_id, _actor, true);
  SELECT * INTO r FROM public.bulk_import_rows WHERE id = _row FOR UPDATE;
  IF r.status <> 'pending' OR r.confirm_lease_until > clock_timestamp() THEN RAISE EXCEPTION 'This customer is finished or confirmation is in progress'; END IF;
  IF _expected IS NULL OR _patch IS NULL THEN RAISE EXCEPTION 'The reviewed customer revision is required'; END IF;
  FOR k IN SELECT jsonb_object_keys(_expected) LOOP
    IF (to_jsonb(r) -> k) IS DISTINCT FROM (_expected -> k) THEN RAISE EXCEPTION 'This customer changed; refresh before saving'; END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT k = ANY(ARRAY['extracted','matched_files','import_stage','electrician_plan','sort_result','sort_reasons','duplicate_note']) THEN RAISE EXCEPTION 'Unsupported review change'; END IF;
    IF r.job_id IS NOT NULL AND k <> 'matched_files' THEN RAISE EXCEPTION 'This job has started; its intake details are frozen for retry'; END IF;
  END LOOP;
  PERFORM set_config('app.bulk_import_row', _row::text, true);
  UPDATE public.bulk_import_rows SET
    extracted = CASE WHEN _patch ? 'extracted' THEN _patch->'extracted' ELSE extracted END,
    matched_files = CASE WHEN _patch ? 'matched_files' THEN _patch->'matched_files' ELSE matched_files END,
    import_stage = CASE WHEN _patch ? 'import_stage' THEN _patch->>'import_stage' ELSE import_stage END,
    electrician_plan = CASE WHEN _patch ? 'electrician_plan' THEN NULLIF(_patch->'electrician_plan','null'::jsonb) ELSE electrician_plan END,
    sort_result = CASE WHEN _patch ? 'sort_result' THEN _patch->>'sort_result' ELSE sort_result END,
    sort_reasons = CASE WHEN _patch ? 'sort_reasons' THEN _patch->'sort_reasons' ELSE sort_reasons END,
    duplicate_note = CASE WHEN _patch ? 'duplicate_note' THEN _patch->>'duplicate_note' ELSE duplicate_note END
    WHERE id = _row RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.set_bulk_import_plan(_batch uuid, _actor uuid, _plan jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bulk_import_batches%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = _batch FOR UPDATE;
  IF NOT FOUND OR b.status <> 'analysed' THEN RAISE EXCEPTION 'This upload is permanent history'; END IF;
  PERFORM public._bulk_import_access(b.business_id, _actor, true);
  IF EXISTS(SELECT 1 FROM public.bulk_import_rows WHERE batch_id = _batch AND confirm_lease_until > clock_timestamp()) THEN
    RAISE EXCEPTION 'Confirmation is in progress; refresh before changing the plan';
  END IF;
  UPDATE public.bulk_import_batches SET electrician_plan = _plan WHERE id = _batch;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_bulk_import_job(_row uuid, _actor uuid, _token uuid, _job_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.bulk_import_rows%ROWTYPE; b public.bulk_import_batches%ROWTYPE; j public.jobs%ROWTYPE; ji public.jobs%ROWTYPE;
  e jsonb; p jsonb; oid uuid; pid uuid; boss uuid; resumed boolean; n public.electrician_nominations%ROWTYPE;
  eb public.businesses%ROWTYPE; ncount bigint; wanted text; existing_choice text;
BEGIN
  r := public._bulk_import_claimed(_row, _actor, _token);
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = r.batch_id;
  e := COALESCE(r.confirm_snapshot->'extracted', r.extracted);
  p := COALESCE(NULLIF(r.confirm_snapshot->'electrician_plan','null'::jsonb), NULLIF(r.electrician_plan,'null'::jsonb), b.electrician_plan, '{"mode":"hivic"}'::jsonb);
  SELECT * INTO j FROM public.jobs WHERE external_enquiry_id = 'bulk:' || _row::text FOR UPDATE;
  resumed := FOUND;
  IF resumed THEN
    IF (r.job_id IS NOT NULL AND r.job_id <> j.id) OR j.channel <> 'installer_sourced'
      OR j.originating_installer_business_id IS DISTINCT FROM b.business_id OR j.business_unit IS DISTINCT FROM 'hivic'
      OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL THEN RAISE EXCEPTION 'The earlier job does not belong to this active upload scope'; END IF;
  ELSE
    IF r.job_id IS NOT NULL THEN RAISE EXCEPTION 'This row points to another job; Office must review it'; END IF;
    ji := jsonb_populate_record(NULL::public.jobs, _job_input);
    IF ji.source IS NULL OR ji.stage IS NULL OR ji.source NOT IN ('bulk_import','qa_test') OR ji.stage::text NOT IN ('ready_check_ready_to_schedule','ready_check_complete','on_hold') THEN RAISE EXCEPTION 'Invalid importer source or stage'; END IF;
    IF r.import_stage = 'installed' AND ji.stage::text <> 'on_hold' THEN RAISE EXCEPTION 'Installed uploads are history only'; END IF;
    -- Preserve the existing same-business-only owner conflict recovery. Never overwrite owner details.
    BEGIN
      INSERT INTO public.owners(full_name,email,phone) VALUES(COALESCE(e->>'full_name','Unknown'),nullif(lower(btrim(e->>'email')),''),e->>'phone') RETURNING id INTO oid;
    EXCEPTION WHEN unique_violation THEN
      SELECT o.id INTO oid FROM public.owners o JOIN public.jobs old ON old.owner_id = o.id
        WHERE old.channel = 'installer_sourced' AND old.originating_installer_business_id = b.business_id
          AND lower(o.email) = lower(btrim(e->>'email')) ORDER BY old.id LIMIT 1;
      IF oid IS NULL THEN RAISE EXCEPTION 'This email belongs to another customer record; Office must review it'; END IF;
    END;
    INSERT INTO public.properties(owner_id,address_line,suburb,postcode,state)
      VALUES(oid,e->>'address_line',e->>'suburb',e->>'postcode','VIC') RETURNING id INTO pid;
    INSERT INTO public.jobs(owner_id,property_id,stage,source,business_unit,installer_led,channel,originating_installer_business_id,
      originating_installer_user_id,external_enquiry_id,installer_site_check,installer_site_check_date,installer_quoted,
      installer_quoted_price_inc_gst,installer_price_includes,next_action)
    VALUES(oid,pid,ji.stage,ji.source,'hivic',true,'installer_sourced',b.business_id,_actor,'bulk:' || _row::text,
      ji.installer_site_check,ji.installer_site_check_date,ji.installer_quoted,ji.installer_quoted_price_inc_gst,ji.installer_price_includes,ji.next_action)
    RETURNING * INTO j;
  END IF;
  -- An Office uploader is never assigned as an installer. Use the current business boss for the assignment.
  SELECT user_id INTO boss FROM public.business_members WHERE business_id = b.business_id AND active IS TRUE AND member_role = 'business_admin'
    ORDER BY (user_id = _actor) DESC, user_id LIMIT 1 FOR SHARE;
  IF boss IS NULL THEN RAISE EXCEPTION 'This installer business has no active business admin to own the job'; END IF;
  IF EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.job_id = j.id AND a.role = 'installer' AND a.active IS TRUE AND NOT EXISTS(SELECT 1 FROM public.business_members m WHERE m.business_id = b.business_id AND m.user_id = a.user_id AND m.active IS TRUE AND m.member_role = 'business_admin')) THEN RAISE EXCEPTION 'The earlier installer assignment is no longer an active business admin; Office must review it'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.job_assignments WHERE job_id = j.id AND role = 'installer' AND active IS TRUE AND business_id = b.business_id) THEN
    IF EXISTS(SELECT 1 FROM public.job_assignments WHERE job_id = j.id AND role = 'installer') THEN RAISE EXCEPTION 'The earlier installer assignment changed; Office must review it'; END IF;
    INSERT INTO public.job_assignments(job_id,user_id,role,business_id,assigned_by) VALUES(j.id,boss,'installer',b.business_id,_actor);
  END IF;
  IF COALESCE((e->>'area_m2')::numeric,0) > 0
    AND NOT EXISTS(SELECT 1 FROM public.ceiling_measurements WHERE job_id = j.id AND external_source = 'bulk_import' AND external_id = _row::text) THEN
    IF EXISTS(SELECT 1 FROM public.ceiling_measurements WHERE job_id = j.id AND is_current IS TRUE) THEN RAISE EXCEPTION 'An earlier measurement exists; Office must review it before finishing this upload'; END IF;
    INSERT INTO public.ceiling_measurements(job_id,source_role,status,is_current,supplied_area_m2,measured_area_m2,measured_by_business_id,
      provenance,external_source,external_id,raw_snapshot,review_flags)
      VALUES(j.id,'installer','needs_review',true,(e->>'area_m2')::numeric,(e->>'area_m2')::numeric,b.business_id,
      'installer_supplied_provisional','bulk_import',_row::text,jsonb_build_object('row_id',_row,'import_stage',r.import_stage,'supplied',e),
      '["Imported installer measurement requires office acceptance"]'::jsonb);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id = j.id AND event_type = 'bulk_import_electrician_recorded') THEN
    existing_choice := j.electrician_choice;
    IF COALESCE(p->>'mode','hivic') <> 'mine' THEN
      wanted := 'hivic_organise';
      IF existing_choice IS NOT NULL AND existing_choice <> wanted THEN RAISE EXCEPTION 'The earlier electrician arrangement changed; Office must review it'; END IF;
    ELSIF nullif(p->>'business_id','') IS NOT NULL THEN
      SELECT * INTO eb FROM public.businesses WHERE id = (p->>'business_id')::uuid AND is_active IS TRUE AND onboarding_status = 'approved' FOR SHARE;
      IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.partner_relationships WHERE installer_business_id = b.business_id AND electrician_business_id = eb.id AND active IS TRUE) THEN RAISE EXCEPTION 'That electrician is not currently one of this installer business approved electricians'; END IF;
      wanted := 'preferred';
      SELECT count(*) INTO ncount FROM public.electrician_nominations WHERE job_id = j.id;
      IF ncount = 0 THEN
        INSERT INTO public.electrician_nominations(job_id,business_id,nominating_business_id,nominated_by,nominated_for,contact_name,business_name,email,phone,status)
          VALUES(j.id,eb.id,b.business_id,_actor,'installer',COALESCE(eb.trading_name,eb.name),eb.name,eb.email,eb.phone,'approved');
      ELSIF ncount <> 1 OR NOT EXISTS(SELECT 1 FROM public.electrician_nominations WHERE job_id = j.id AND business_id = eb.id AND nominating_business_id = b.business_id AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'The earlier electrician nomination changed; Office must review it';
      END IF;
    ELSIF nullif(p->>'nomination_id','') IS NOT NULL THEN
      SELECT * INTO n FROM public.electrician_nominations WHERE id = (p->>'nomination_id')::uuid AND nominating_business_id = b.business_id AND job_id IS NULL AND ended_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'That electrician nomination is no longer available to this business'; END IF;
      wanted := 'nominated';
      SELECT count(*) INTO ncount FROM public.electrician_nominations WHERE job_id = j.id;
      IF ncount = 0 THEN
        INSERT INTO public.electrician_nominations(job_id,business_id,nominating_business_id,nominated_by,nominated_for,contact_name,business_name,email,phone,licence_number,rec_number,status)
          VALUES(j.id,n.business_id,b.business_id,_actor,n.nominated_for,n.contact_name,n.business_name,n.email,n.phone,n.licence_number,n.rec_number,n.status);
      ELSIF ncount <> 1 OR NOT EXISTS(SELECT 1 FROM public.electrician_nominations WHERE job_id = j.id AND nominating_business_id = b.business_id AND email IS NOT DISTINCT FROM n.email AND business_id IS NOT DISTINCT FROM n.business_id AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'The earlier electrician nomination changed; Office must review it';
      END IF;
    ELSE RAISE EXCEPTION 'Choose the electrician before confirming';
    END IF;
    IF existing_choice IS NOT NULL AND existing_choice <> wanted THEN RAISE EXCEPTION 'The earlier electrician arrangement changed; Office must review it'; END IF;
    UPDATE public.jobs SET electrician_choice = (jsonb_populate_record(NULL::public.jobs,jsonb_build_object('electrician_choice',wanted))).electrician_choice WHERE id = j.id;
    INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
      VALUES(j.id,_actor,'bulk_import_electrician_recorded','Electrician choice recorded from bulk upload',jsonb_build_object('row_id',_row,'electrician_plan',p),true);
  END IF;
  UPDATE public.bulk_import_rows SET job_id = j.id, confirm_snapshot = COALESCE(confirm_snapshot,
    jsonb_build_object('extracted',e,'import_stage',r.import_stage,'electrician_plan',p)), confirm_lease_until = clock_timestamp() + interval '5 minutes'
    WHERE id = _row;
  RETURN jsonb_build_object('job',jsonb_build_object('id',j.id,'job_number',j.job_number),'resumed',resumed);
END $$;

-- Draft analysis is also atomic: interrupted retries cannot duplicate rows or bypass the writer guard.
CREATE OR REPLACE FUNCTION public.guard_confirmed_bulk_import()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'bulk_import_batches' THEN parent_status := OLD.status;
  ELSE SELECT status INTO parent_status FROM public.bulk_import_batches WHERE id = OLD.batch_id; END IF;
  IF parent_status IN ('confirmed','discarded') AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Confirmed or discarded bulk uploads are permanent history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION public.save_bulk_import_analysis(_batch uuid, _actor uuid, _rows jsonb, _summary jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bulk_import_batches%ROWTYPE; rid uuid;
BEGIN
  SELECT * INTO b FROM public.bulk_import_batches WHERE id = _batch FOR UPDATE;
  IF NOT FOUND OR b.status <> 'draft' THEN RAISE EXCEPTION 'This upload was already analysed or confirmed'; END IF;
  PERFORM public._bulk_import_access(b.business_id,_actor,true);
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'The complete analysed customers are required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bulk_import_rows WHERE batch_id = _batch AND (status <> 'pending' OR job_id IS NOT NULL OR confirm_claim_token IS NOT NULL)) THEN RAISE EXCEPTION 'This upload already has saved work; Office must review it'; END IF;
  FOR rid IN SELECT id FROM public.bulk_import_rows WHERE batch_id = _batch FOR UPDATE LOOP
    PERFORM set_config('app.bulk_import_row',rid::text,true);
    DELETE FROM public.bulk_import_rows WHERE id = rid;
  END LOOP;
  INSERT INTO public.bulk_import_rows(batch_id,row_index,extracted,matched_files,match_confidence,sort_result,sort_reasons,missing_evidence,duplicate_note,import_stage)
    SELECT _batch,r.row_index,r.extracted - 'owner_consent',r.matched_files,r.match_confidence,r.sort_result,r.sort_reasons,r.missing_evidence,r.duplicate_note,r.import_stage
    FROM jsonb_populate_recordset(NULL::public.bulk_import_rows,_rows) r;
  UPDATE public.bulk_import_batches SET status = 'analysed',summary = _summary WHERE id = _batch;
END $$;

CREATE OR REPLACE FUNCTION public.renew_bulk_import_row(_row uuid, _actor uuid, _token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._bulk_import_claimed(_row,_actor,_token);
  UPDATE public.bulk_import_rows SET confirm_lease_until = clock_timestamp() + interval '5 minutes' WHERE id = _row;
END $$;

-- Helpers are service-only too: none can be invoked directly by a logged-in browser.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY(ARRAY[
    '_bulk_import_access','_bulk_import_claimed','_bulk_import_document','_bulk_import_quote_complete','claim_bulk_import_row',
    'release_bulk_import_row','edit_bulk_import_row','set_bulk_import_plan','prepare_bulk_import_job','finish_bulk_import_row',
    'close_bulk_import_batch','bulk_import_batch_counts','repair_bulk_import_attachment','save_bulk_import_analysis','renew_bulk_import_row']) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;

COMMIT;
