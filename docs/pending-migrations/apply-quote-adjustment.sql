-- Quote edits save whole: items, totals, held/draft change and the adjustment record in ONE transaction.
-- Service-role only. Pending: prove on PGlite, apply live only when Jo says yes.
-- p_items       [{id, quantity, unit_price_inc_gst, line_total_inc_gst}]
-- p_totals      {subtotal_inc_gst, gst_amount, veec_discount_inc_gst, customer_total_inc_gst, manually_adjusted, [veec_count, veec_unit_value_inc_gst]}
-- p_release     null, or {status, release_state, release_hold_reason, sent_at}
-- p_adjustment  {adjusted_by, reason, before_snapshot}
-- Raises 'version_conflict' when the quote moved since p_expected_version, 'quote_item_not_found' for a line that is not on the quote.
CREATE FUNCTION public.apply_quote_adjustment(
  p_quote_id uuid, p_expected_version int, p_items jsonb, p_totals jsonb, p_release jsonb, p_adjustment jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  it jsonb;
  n int;
  new_version int;
  after_row jsonb;
BEGIN
  UPDATE public.quotes q SET
    subtotal_inc_gst = (p_totals->>'subtotal_inc_gst')::numeric,
    gst_amount = (p_totals->>'gst_amount')::numeric,
    veec_discount_inc_gst = (p_totals->>'veec_discount_inc_gst')::numeric,
    customer_total_inc_gst = (p_totals->>'customer_total_inc_gst')::numeric,
    manually_adjusted = COALESCE((p_totals->>'manually_adjusted')::boolean, q.manually_adjusted),
    veec_count = CASE WHEN p_totals ? 'veec_count' THEN (p_totals->>'veec_count')::int ELSE q.veec_count END,
    veec_unit_value_inc_gst = CASE WHEN p_totals ? 'veec_unit_value_inc_gst' THEN (p_totals->>'veec_unit_value_inc_gst')::numeric ELSE q.veec_unit_value_inc_gst END,
    status = CASE WHEN p_release IS NOT NULL AND p_release ? 'status' THEN (p_release->>'status')::public.quote_status ELSE q.status END,
    release_state = CASE WHEN p_release IS NOT NULL AND p_release ? 'release_state' THEN p_release->>'release_state' ELSE q.release_state END,
    release_hold_reason = CASE WHEN p_release IS NOT NULL AND p_release ? 'release_hold_reason' THEN p_release->>'release_hold_reason' ELSE q.release_hold_reason END,
    sent_at = CASE WHEN p_release IS NOT NULL AND p_release ? 'sent_at' THEN (p_release->>'sent_at')::timestamptz ELSE q.sent_at END,
    version = q.version + 1
  WHERE q.id = p_quote_id AND q.version = p_expected_version
  RETURNING q.version INTO new_version;
  IF new_version IS NULL THEN
    RAISE EXCEPTION 'version_conflict';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    UPDATE public.quote_items SET
      quantity = (it->>'quantity')::numeric,
      unit_price_inc_gst = (it->>'unit_price_inc_gst')::numeric,
      line_total_inc_gst = (it->>'line_total_inc_gst')::numeric
    WHERE id = (it->>'id')::uuid AND quote_id = p_quote_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'quote_item_not_found'; END IF;
  END LOOP;

  SELECT to_jsonb(q) || jsonb_build_object('quote_items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort, i.id) FROM public.quote_items i WHERE i.quote_id = q.id), '[]'::jsonb))
    INTO after_row FROM public.quotes q WHERE q.id = p_quote_id;

  INSERT INTO public.quote_adjustments (quote_id, adjusted_by, reason, before_snapshot, after_snapshot)
  VALUES (p_quote_id, (p_adjustment->>'adjusted_by')::uuid, p_adjustment->>'reason', p_adjustment->'before_snapshot', after_row);

  RETURN jsonb_build_object('ok', true, 'version', new_version, 'after', after_row);
END $$;
REVOKE ALL ON FUNCTION public.apply_quote_adjustment(uuid, int, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_quote_adjustment(uuid, int, jsonb, jsonb, jsonb, jsonb) TO service_role;
