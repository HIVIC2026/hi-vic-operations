-- 0222: email-based preliminary Save My Spot (Jo, 22 Oct 2026). PENDING – not applied to production.
-- 1) A dedicated secure-link purpose for the no-estimate preliminary invitation.
-- 2) The Office one-pile enquiry pager also includes authenticated manual (portal-source) enquiries.
--    Original source stays 'portal'; the enquiries join the same single pile, never a second one.
-- Run after 0160 (office_enquiry_page) and 0218 (exclusive piles). Sync/automation is base44-only and
-- unchanged: portal-source enquiries never trigger automatic media requests or campaign emails.

-- 1) Allow the preliminary (no-estimate) customer link purpose.
ALTER TABLE public.customer_estimate_links DROP CONSTRAINT customer_estimate_links_purpose_check;
ALTER TABLE public.customer_estimate_links ADD CONSTRAINT customer_estimate_links_purpose_check CHECK (purpose IN ('step3_estimate', 'ready_check_times', 'preliminary_save_spot'));

-- 2) Office one pile: include manual portal-source enquiries in the same views and counts.
CREATE OR REPLACE FUNCTION public.office_enquiry_page(p_view text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 WITH scope AS (
 SELECT * FROM public.office_enquiry_index WHERE source IN ('base44','portal') AND channel='hivic_sourced' AND
 (p_search='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(lower(trim(p_search)), '\s+') term WHERE term<>'' AND strpos(lower(concat_ws(' ',owner_name,owner_email,owner_phone,property_address,job_number,external_enquiry_id)),term)>0))
 ), pending_photos AS (
 SELECT * FROM scope WHERE office_bucket='enquiry' AND media_to_review
 AND NOT spot_offered AND enquiry_status NOT IN ('offered_spot','spot_saved','ineligible')
 AND NOT spot_saved AND NOT removed AND deleted_at IS NULL AND NOT owner_progressed
 ), new_pile AS (
 SELECT * FROM scope WHERE office_bucket='enquiry' AND needs_first_response AND id NOT IN (SELECT id FROM pending_photos)
 ), filtered AS (
 SELECT * FROM scope WHERE CASE p_view
 WHEN 'removed' THEN office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR source='qa_test' OR contact_rank>1)
 WHEN 'ineligible' THEN office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL
 WHEN 'spot_saved' THEN office_bucket='active' AND spot_saved
 WHEN 'all' THEN office_bucket='enquiry'
 WHEN 'new' THEN id IN (SELECT id FROM new_pile)
 WHEN 'photos' THEN id IN (SELECT id FROM pending_photos)
 WHEN 'needs_attention' THEN office_bucket='enquiry' AND enquiry_status='needs_attention' AND NOT media_to_review AND id NOT IN (SELECT id FROM pending_photos) AND id NOT IN (SELECT id FROM new_pile)
 ELSE office_bucket='enquiry' AND enquiry_status=p_view AND id NOT IN (SELECT id FROM pending_photos) AND id NOT IN (SELECT id FROM new_pile) END
 ), n AS (SELECT count(*) AS total FROM filtered), paging AS (
 SELECT greatest(1,least(greatest(1,p_page),greatest(1,ceil(total/50.0)::integer))) AS page,total FROM n
 ), page_rows AS (SELECT f.* FROM filtered f ORDER BY created_at DESC,id ASC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM paging))
 SELECT jsonb_build_object('ids',coalesce((SELECT jsonb_agg(id ORDER BY created_at DESC,id ASC) FROM page_rows),'[]'::jsonb),'total',paging.total,'page',paging.page,'pageSize',50,'totalPages',greatest(1,ceil(paging.total/50.0)::integer),
 'counts',jsonb_build_object('all',(SELECT count(*) FROM scope WHERE office_bucket='enquiry'),'new',(SELECT count(*) FROM new_pile),'photos',(SELECT count(*) FROM pending_photos),'needs_attention',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='needs_attention' AND NOT media_to_review AND id NOT IN (SELECT id FROM pending_photos) AND id NOT IN (SELECT id FROM new_pile)),'offered_spot',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='offered_spot' AND id NOT IN (SELECT id FROM pending_photos) AND id NOT IN (SELECT id FROM new_pile)),'insulation_requested',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='insulation_requested' AND id NOT IN (SELECT id FROM pending_photos) AND id NOT IN (SELECT id FROM new_pile)),'spot_saved',(SELECT count(*) FROM scope WHERE office_bucket='active' AND spot_saved),'ineligible',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL),'removed',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR contact_rank>1))),
  'responses',jsonb_build_object('provider_confirmed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='provider_confirmed'),'recorded_only',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='recorded_only'),'uncertain',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='uncertain'),'unanswered',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none'),'unanswered_latest_failed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none' AND latest_attempt_status='failed'))) FROM paging;
$function$;
