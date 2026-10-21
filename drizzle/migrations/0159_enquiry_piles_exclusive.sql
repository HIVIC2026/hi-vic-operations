CREATE OR REPLACE FUNCTION public.office_enquiry_page(p_view text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 WITH scope AS (
 SELECT * FROM public.office_enquiry_index WHERE source='base44' AND channel='hivic_sourced' AND
 (p_search='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(lower(trim(p_search)), '\s+') term WHERE term<>'' AND strpos(lower(concat_ws(' ',owner_name,owner_email,owner_phone,property_address,job_number,external_enquiry_id)),term)>0))
 ), pending_photos AS (
 SELECT * FROM scope WHERE office_bucket='enquiry' AND media_to_review
 AND NOT spot_offered AND enquiry_status NOT IN ('offered_spot','spot_saved','ineligible')
 AND NOT spot_saved AND NOT removed AND deleted_at IS NULL AND NOT owner_progressed
 ), filtered AS (
 SELECT * FROM scope WHERE CASE p_view
 WHEN 'removed' THEN office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR source='qa_test' OR contact_rank>1)
 WHEN 'ineligible' THEN office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL
 WHEN 'spot_saved' THEN office_bucket='active' AND spot_saved
 WHEN 'all' THEN office_bucket='enquiry'
 WHEN 'new' THEN office_bucket='enquiry' AND needs_first_response
 WHEN 'photos' THEN id IN (SELECT id FROM pending_photos)
 WHEN 'needs_attention' THEN office_bucket='enquiry' AND enquiry_status='needs_attention' AND NOT media_to_review AND id NOT IN (SELECT id FROM pending_photos)
 ELSE office_bucket='enquiry' AND enquiry_status=p_view AND id NOT IN (SELECT id FROM pending_photos) END
 ), n AS (SELECT count(*) AS total FROM filtered), paging AS (
 SELECT greatest(1,least(greatest(1,p_page),greatest(1,ceil(total/50.0)::integer))) AS page,total FROM n
 ), page_rows AS (SELECT f.* FROM filtered f ORDER BY created_at DESC,id ASC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM paging))
 SELECT jsonb_build_object('ids',coalesce((SELECT jsonb_agg(id ORDER BY created_at DESC,id ASC) FROM page_rows),'[]'::jsonb),'total',paging.total,'page',paging.page,'pageSize',50,'totalPages',greatest(1,ceil(paging.total/50.0)::integer),
 'counts',jsonb_build_object('all',(SELECT count(*) FROM scope WHERE office_bucket='enquiry'),'new',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND needs_first_response),'photos',(SELECT count(*) FROM pending_photos),'needs_attention',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='needs_attention' AND NOT media_to_review AND id NOT IN (SELECT id FROM pending_photos)),'offered_spot',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='offered_spot' AND id NOT IN (SELECT id FROM pending_photos)),'insulation_requested',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='insulation_requested' AND id NOT IN (SELECT id FROM pending_photos)),'spot_saved',(SELECT count(*) FROM scope WHERE office_bucket='active' AND spot_saved),'ineligible',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL),'removed',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR contact_rank>1))),
  'responses',jsonb_build_object('provider_confirmed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='provider_confirmed'),'recorded_only',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='recorded_only'),'uncertain',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='uncertain'),'unanswered',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none'),'unanswered_latest_failed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none' AND latest_attempt_status='failed'))) FROM paging;
$function$;