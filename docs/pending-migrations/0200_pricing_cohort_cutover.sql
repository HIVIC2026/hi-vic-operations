-- STAGED — DO NOT APPLY AUTOMATICALLY. Jo 12 Oct 2026: new pricing ($99 inc GST Ready Check, R5 $33/m² inc GST)
-- with exact protection for every job that saved its spot before the cutover.
-- Part A (schema, additive, inert): installs the fee column, cohort tables and functions. Changes NO prices.
-- Part B (activation) is a separate explicit call: SELECT public.activate_pricing_cutover(<actor>, <reason>);

-- A1. Ready Check fee per settings version. Every existing version stays 0 (free) — old versions are never edited otherwise.
ALTER TABLE public.retail_estimator_settings ADD COLUMN IF NOT EXISTS ready_check_fee_inc_gst numeric(10,2) NOT NULL DEFAULT 0;

-- A2. Single cutover record (at most one active).
CREATE TABLE public.pricing_cutover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutover_at timestamptz NOT NULL DEFAULT now(),
  legacy_settings_id uuid NOT NULL REFERENCES public.retail_estimator_settings(id),
  new_settings_id uuid NOT NULL REFERENCES public.retail_estimator_settings(id),
  protected_count integer NOT NULL,
  protected_md5 text NOT NULL,
  actor_id uuid NOT NULL, reason text NOT NULL,
  rolled_back_at timestamptz, rolled_back_by uuid, rollback_reason text
);
CREATE UNIQUE INDEX pricing_cutover_one_active ON public.pricing_cutover ((true)) WHERE rolled_back_at IS NULL;

-- A3. Read-only backup of the original saved-spot fields at cutover (review copy; never updated).
CREATE TABLE public.saved_spot_price_backup (
  cutover_id uuid NOT NULL REFERENCES public.pricing_cutover(id),
  response_id uuid NOT NULL, job_id uuid NOT NULL, spot_saved_at timestamptz, saved_estimate_id uuid,
  saved_total numeric, saved_veu_discount numeric, saved_gross_total numeric, saved_area_m2 numeric,
  saved_insulation text, saved_estimate_url text, backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cutover_id, response_id)
);

-- A4. Per-job frozen price version. One row per job, immutable.
CREATE TABLE public.job_pricing_cohorts (
  job_id uuid PRIMARY KEY,
  cohort text NOT NULL CHECK (cohort IN ('legacy_saved_spot','current')),
  cutover_id uuid NOT NULL REFERENCES public.pricing_cutover(id),
  settings_id uuid NOT NULL REFERENCES public.retail_estimator_settings(id),
  settings_version integer NOT NULL,
  r5_install_inc_gst_per_m2 numeric(10,2) NOT NULL, removal_inc_gst_per_m2 numeric(10,2) NOT NULL,
  piesa_assessment_inc_gst numeric(10,2) NOT NULL, ap_management_inc_gst numeric(10,2) NOT NULL,
  ready_check_fee_inc_gst numeric(10,2) NOT NULL,
  spot_saved_at timestamptz, saved_total numeric, saved_gross_total numeric, saved_veu_discount numeric, saved_area_m2 numeric,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_cutover, public.saved_spot_price_backup, public.job_pricing_cohorts TO authenticated;
GRANT ALL ON public.pricing_cutover, public.saved_spot_price_backup, public.job_pricing_cohorts TO service_role;
ALTER TABLE public.pricing_cutover ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_spot_price_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_pricing_cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read cutover" ON public.pricing_cutover FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read backup" ON public.saved_spot_price_backup FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read cohorts" ON public.job_pricing_cohorts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_pricing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Pricing cohort and backup records are permanent'; END $$;
CREATE TRIGGER job_pricing_cohorts_immutable BEFORE UPDATE OR DELETE ON public.job_pricing_cohorts FOR EACH ROW EXECUTE FUNCTION public.guard_pricing_immutable();
CREATE TRIGGER saved_spot_price_backup_immutable BEFORE UPDATE OR DELETE ON public.saved_spot_price_backup FOR EACH ROW EXECUTE FUNCTION public.guard_pricing_immutable();

-- A5. After an active cutover, a new save gets the new-version snapshot at save time (inside the save transaction).
CREATE OR REPLACE FUNCTION public.assign_pricing_cohort_on_save() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pricing_cutover; s public.retail_estimator_settings;
BEGIN
  IF NEW.spot_saved_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.spot_saved_at IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.pricing_cutover WHERE rolled_back_at IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;               -- pre-cutover saves are swept up by the activation
  IF EXISTS (SELECT 1 FROM public.job_pricing_cohorts WHERE job_id = NEW.job_id) THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.retail_estimator_settings WHERE id = c.new_settings_id;
  INSERT INTO public.job_pricing_cohorts (job_id, cohort, cutover_id, settings_id, settings_version, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2,
    piesa_assessment_inc_gst, ap_management_inc_gst, ready_check_fee_inc_gst, spot_saved_at, saved_total, saved_gross_total, saved_veu_discount, saved_area_m2)
  VALUES (NEW.job_id, 'current', c.id, s.id, s.version, s.r5_install_inc_gst_per_m2, s.removal_inc_gst_per_m2, s.piesa_assessment_inc_gst,
    s.ap_management_inc_gst, s.ready_check_fee_inc_gst, NEW.spot_saved_at, NEW.saved_total, NEW.saved_gross_total, NEW.saved_veu_discount, NEW.saved_area_m2);
  RETURN NEW;
END $$;
CREATE TRIGGER lead_campaign_responses_pricing_cohort AFTER INSERT OR UPDATE OF spot_saved_at ON public.lead_campaign_responses
  FOR EACH ROW EXECUTE FUNCTION public.assign_pricing_cohort_on_save();

-- B. Atomic activation. Locks saves, backs up and snapshots EVERY saved spot by spot_saved_at, then creates the new
-- version (not current — legacy row stays is_current so any unconverted reader keeps legacy prices) and the cutover record.
CREATE OR REPLACE FUNCTION public.activate_pricing_cutover(_actor uuid, _reason text, _expected_md5 text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.retail_estimator_settings; nxt integer; new_id uuid; cid uuid; n integer; h text;
BEGIN
  IF _actor IS NULL OR coalesce(length(trim(_reason)),0) < 3 THEN RAISE EXCEPTION 'Actor and reason required'; END IF;
  LOCK TABLE public.lead_campaign_responses IN SHARE ROW EXCLUSIVE MODE;      -- no save can commit mid-cutover
  IF EXISTS (SELECT 1 FROM public.pricing_cutover WHERE rolled_back_at IS NULL) THEN RAISE EXCEPTION 'Pricing cutover already active'; END IF;
  SELECT * INTO cur FROM public.retail_estimator_settings WHERE is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No current owner prices'; END IF;
  SELECT count(*), md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY job_id, spot_saved_at), '')) INTO n, h FROM (
    SELECT job_id, spot_saved_at, saved_estimate_id, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation, saved_estimate_url
    FROM public.lead_campaign_responses WHERE spot_saved_at IS NOT NULL AND saved_total IS NOT NULL AND saved_gross_total IS NOT NULL AND saved_area_m2 IS NOT NULL
    ORDER BY job_id, spot_saved_at) t;
  IF _expected_md5 IS NOT NULL AND h <> _expected_md5 THEN RAISE EXCEPTION 'Saved-spot fingerprint changed (got % rows, %); re-review before cutover', n, h; END IF;
  SELECT coalesce(max(version),0)+1 INTO nxt FROM public.retail_estimator_settings;
  INSERT INTO public.retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst,
    ap_management_inc_gst, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier, indicative_veec_value,
    veec_value_source_label, veec_value_source_url, veec_value_checked_at, minimum_customer_copayment_inc_gst, spec_version, spec_source_url,
    notes, created_by, veec_buy_price, max_discount_metro_inc_gst, max_discount_regional_inc_gst, ready_check_fee_inc_gst)
  VALUES (nxt, false, 33, cur.removal_inc_gst_per_m2, cur.piesa_assessment_inc_gst, cur.ap_management_inc_gst, cur.access_standard_multiplier,
    cur.access_moderate_multiplier, cur.access_difficult_multiplier, cur.indicative_veec_value, cur.veec_value_source_label, cur.veec_value_source_url,
    cur.veec_value_checked_at, cur.minimum_customer_copayment_inc_gst, cur.spec_version, cur.spec_source_url,
    'New pricing (Jo 12 Oct 2026): R5 $30/m² + GST = $33 inc GST; Ready Check $99 inc GST. ' || trim(_reason), _actor, cur.veec_buy_price,
    cur.max_discount_metro_inc_gst, cur.max_discount_regional_inc_gst, 99)
  RETURNING id INTO new_id;
  INSERT INTO public.pricing_cutover (legacy_settings_id, new_settings_id, protected_count, protected_md5, actor_id, reason)
  VALUES (cur.id, new_id, (SELECT count(DISTINCT job_id) FROM public.lead_campaign_responses WHERE spot_saved_at IS NOT NULL), h, _actor, trim(_reason)) RETURNING id INTO cid;
  INSERT INTO public.saved_spot_price_backup (cutover_id, response_id, job_id, spot_saved_at, saved_estimate_id, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation, saved_estimate_url)
  SELECT cid, id, job_id, spot_saved_at, saved_estimate_id, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation, saved_estimate_url
  FROM public.lead_campaign_responses WHERE spot_saved_at IS NOT NULL;
  -- Every saved spot (complete or not) is protected; earliest save per job is the cohort anchor.
  INSERT INTO public.job_pricing_cohorts (job_id, cohort, cutover_id, settings_id, settings_version, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2,
    piesa_assessment_inc_gst, ap_management_inc_gst, ready_check_fee_inc_gst, spot_saved_at, saved_total, saved_gross_total, saved_veu_discount, saved_area_m2)
  SELECT DISTINCT ON (r.job_id) r.job_id, 'legacy_saved_spot', cid, cur.id, cur.version, cur.r5_install_inc_gst_per_m2, cur.removal_inc_gst_per_m2,
    cur.piesa_assessment_inc_gst, cur.ap_management_inc_gst, 0, r.spot_saved_at, r.saved_total, r.saved_gross_total, r.saved_veu_discount, r.saved_area_m2
  FROM public.lead_campaign_responses r WHERE r.spot_saved_at IS NOT NULL ORDER BY r.job_id, r.spot_saved_at
  ON CONFLICT (job_id) DO NOTHING;   -- an earlier snapshot (from a rolled-back cutover) always wins
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (_actor, 'pricing_cutover_activated', 'New pricing version ' || nxt || ' activated; saved spots protected',
    jsonb_build_object('cutover_id', cid, 'legacy_version', cur.version, 'new_version', nxt, 'protected_md5', h, 'reason', trim(_reason)));
  RETURN cid;
END $$;

-- Rollback (defined): stops new pricing for future reads; cohort/backup rows stay as permanent history.
CREATE OR REPLACE FUNCTION public.rollback_pricing_cutover(_actor uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _actor IS NULL OR coalesce(length(trim(_reason)),0) < 3 THEN RAISE EXCEPTION 'Actor and reason required'; END IF;
  UPDATE public.pricing_cutover SET rolled_back_at = now(), rolled_back_by = _actor, rollback_reason = trim(_reason) WHERE rolled_back_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active pricing cutover'; END IF;
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details) VALUES (_actor, 'pricing_cutover_rolled_back', 'Pricing cutover rolled back', jsonb_build_object('reason', trim(_reason)));
END $$;

REVOKE ALL ON FUNCTION public.activate_pricing_cutover(uuid, text, text), public.rollback_pricing_cutover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_pricing_cutover(uuid, text, text), public.rollback_pricing_cutover(uuid, text) TO service_role;
