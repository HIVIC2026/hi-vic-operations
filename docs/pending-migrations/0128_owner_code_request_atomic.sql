-- Security review H (merges with item 8): the hourly owner code-request limit is checked and the code row
-- inserted in one step under a per-job lock, so parallel requests can't both slip under the limit.
CREATE OR REPLACE FUNCTION public.issue_owner_link_code(_job uuid, _channel text, _masked text, _hash text, _expires timestamptz, _max integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('owner_link_codes:' || _job::text, 0));
  SELECT count(*) INTO n FROM public.owner_link_codes WHERE job_id = _job AND created_at >= now() - interval '1 hour';
  IF n >= _max THEN RETURN NULL; END IF;
  INSERT INTO public.owner_link_codes (job_id, channel, destination_masked, code_hash, expires_at)
    VALUES (_job, _channel, _masked, _hash, _expires) RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.issue_owner_link_code(uuid, text, text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_owner_link_code(uuid, text, text, text, timestamptz, integer) TO service_role;
