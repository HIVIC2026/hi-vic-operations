-- Jo 4 Nov 2026: A2 retail prices for top-ups, R6.0 and R7.0 (left BLANK for Jo to fill in; a blank needed price holds
-- the quote for office review) and the Settings switch "Top-ups can count old insulation towards R5.0" (ON by default).
ALTER TABLE public.retail_estimator_settings
  ADD COLUMN IF NOT EXISTS topup_inc_gst_per_m2 numeric(10,2) CHECK (topup_inc_gst_per_m2 IS NULL OR topup_inc_gst_per_m2 > 0),
  ADD COLUMN IF NOT EXISTS r6_install_inc_gst_per_m2 numeric(10,2) CHECK (r6_install_inc_gst_per_m2 IS NULL OR r6_install_inc_gst_per_m2 > 0),
  ADD COLUMN IF NOT EXISTS r7_install_inc_gst_per_m2 numeric(10,2) CHECK (r7_install_inc_gst_per_m2 IS NULL OR r7_install_inc_gst_per_m2 > 0);
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS topups_count_existing_insulation boolean NOT NULL DEFAULT true;
-- Jo 4 Nov follow-up: the owner-price publisher carries the three new prices forward (blank stays blank; $0 refused).
CREATE OR REPLACE FUNCTION public.publish_owner_prices(_actor uuid, _prices jsonb, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cur public.retail_estimator_settings; nxt integer; k text;
  allowed text[] := ARRAY['r5_install_inc_gst_per_m2','removal_inc_gst_per_m2','piesa_assessment_inc_gst','ap_management_inc_gst','access_moderate_multiplier','access_difficult_multiplier','veec_buy_price','max_discount_metro_inc_gst','max_discount_regional_inc_gst','topup_inc_gst_per_m2','r6_install_inc_gst_per_m2','r7_install_inc_gst_per_m2'];
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Who made the change is required'; END IF;
  IF coalesce(length(trim(_reason)),0) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  FOR k IN SELECT jsonb_object_keys(_prices) LOOP
    IF NOT k = ANY(allowed) THEN RAISE EXCEPTION 'Unknown price %', k; END IF;
    IF (_prices->>k)::numeric <= 0 THEN RAISE EXCEPTION 'Price % must be above zero', k; END IF;
  END LOOP;
  IF (_prices ? 'access_moderate_multiplier' AND (_prices->>'access_moderate_multiplier')::numeric < 1)
     OR (_prices ? 'access_difficult_multiplier' AND (_prices->>'access_difficult_multiplier')::numeric < 1) THEN
    RAISE EXCEPTION 'Access loadings cannot be below 1';
  END IF;
  SELECT * INTO cur FROM public.retail_estimator_settings WHERE is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No current owner prices'; END IF;
  SELECT coalesce(max(version),0)+1 INTO nxt FROM public.retail_estimator_settings;
  UPDATE public.retail_estimator_settings SET is_current = false WHERE id = cur.id;
  INSERT INTO public.retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst,
    ap_management_inc_gst, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier, indicative_veec_value,
    veec_value_source_label, veec_value_source_url, veec_value_checked_at, minimum_customer_copayment_inc_gst, spec_version, spec_source_url,
    notes, created_by, veec_buy_price, max_discount_metro_inc_gst, max_discount_regional_inc_gst,
    topup_inc_gst_per_m2, r6_install_inc_gst_per_m2, r7_install_inc_gst_per_m2)
  VALUES (nxt, true,
    coalesce((_prices->>'r5_install_inc_gst_per_m2')::numeric, cur.r5_install_inc_gst_per_m2),
    coalesce((_prices->>'removal_inc_gst_per_m2')::numeric, cur.removal_inc_gst_per_m2),
    coalesce((_prices->>'piesa_assessment_inc_gst')::numeric, cur.piesa_assessment_inc_gst),
    coalesce((_prices->>'ap_management_inc_gst')::numeric, cur.ap_management_inc_gst),
    cur.access_standard_multiplier,
    coalesce((_prices->>'access_moderate_multiplier')::numeric, cur.access_moderate_multiplier),
    coalesce((_prices->>'access_difficult_multiplier')::numeric, cur.access_difficult_multiplier),
    cur.indicative_veec_value, cur.veec_value_source_label, cur.veec_value_source_url, cur.veec_value_checked_at,
    cur.minimum_customer_copayment_inc_gst, cur.spec_version, cur.spec_source_url, trim(_reason), _actor,
    coalesce((_prices->>'veec_buy_price')::numeric, cur.veec_buy_price),
    coalesce((_prices->>'max_discount_metro_inc_gst')::numeric, cur.max_discount_metro_inc_gst),
    coalesce((_prices->>'max_discount_regional_inc_gst')::numeric, cur.max_discount_regional_inc_gst),
    coalesce((_prices->>'topup_inc_gst_per_m2')::numeric, cur.topup_inc_gst_per_m2),
    coalesce((_prices->>'r6_install_inc_gst_per_m2')::numeric, cur.r6_install_inc_gst_per_m2),
    coalesce((_prices->>'r7_install_inc_gst_per_m2')::numeric, cur.r7_install_inc_gst_per_m2));
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (_actor, 'owner_prices_changed', 'Owner prices changed (version ' || nxt || ')',
    jsonb_build_object('from_version', cur.version, 'to_version', nxt, 'changes', _prices, 'reason', trim(_reason)));
  RETURN nxt;
END $function$;
