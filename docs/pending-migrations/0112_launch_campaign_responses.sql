-- Launch campaign owner responses and desktop insulation checks.
-- Public owner actions are handled only by token-checked server functions; the table itself is office-only.
CREATE TABLE public.lead_campaign_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_link_id uuid NOT NULL REFERENCES public.customer_estimate_links(id) ON DELETE CASCADE,
  campaign text NOT NULL DEFAULT 'existing_leads_launch_v1' CHECK (campaign = 'existing_leads_launch_v1'),
  spot_saved_at timestamptz,
  opted_out_at timestamptz,
  video_requested boolean NOT NULL DEFAULT false,
  media_received_at timestamptz,
  desk_check_status text NOT NULL DEFAULT 'not_needed' CHECK (desk_check_status IN ('not_needed','pending','looks_eligible','not_eligible','needs_onsite_check')),
  desk_check_reason text,
  desk_checked_at timestamptz,
  desk_checked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (spot_saved_at IS NULL OR opted_out_at IS NULL),
  CHECK ((desk_check_status IN ('not_needed','pending')) = (desk_checked_at IS NULL)),
  CHECK (desk_check_status <> 'not_eligible' OR length(trim(coalesce(desk_check_reason, ''))) >= 3)
);

GRANT SELECT, UPDATE ON public.lead_campaign_responses TO authenticated;
GRANT ALL ON public.lead_campaign_responses TO service_role;

ALTER TABLE public.lead_campaign_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_campaign_responses_admin_select ON public.lead_campaign_responses
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY lead_campaign_responses_admin_update ON public.lead_campaign_responses
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX lead_campaign_responses_spot_idx
  ON public.lead_campaign_responses (spot_saved_at ASC)
  WHERE spot_saved_at IS NOT NULL AND opted_out_at IS NULL;
CREATE INDEX lead_campaign_responses_desk_idx
  ON public.lead_campaign_responses (media_received_at ASC)
  WHERE desk_check_status = 'pending';
