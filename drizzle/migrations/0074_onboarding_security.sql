-- 0079: public onboarding security (start limits, staff-issued test/office links, verified insurance files).
-- STAGED ONLY. Additive; modifies no existing rows.

CREATE TABLE public.onboarding_start_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint_hash text NOT NULL CHECK (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  trade text NOT NULL CHECK (trade IN ('rec','installer')),
  kind text NOT NULL CHECK (kind IN ('visitor','network')),
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz, cleared_by uuid, clearance_id bigint
);
CREATE INDEX onboarding_start_attempts_fp ON public.onboarding_start_attempts (fingerprint_hash, created_at);
GRANT ALL ON public.onboarding_start_attempts TO service_role;
ALTER TABLE public.onboarding_start_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read start attempts" ON public.onboarding_start_attempts FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.onboarding_start_attempts TO authenticated;

CREATE TABLE public.onboarding_authorisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  trade text NOT NULL CHECK (trade IN ('rec','installer')),
  purpose text NOT NULL CHECK (purpose IN ('qa_test','office_recovery')),
  allow_incomplete_sign boolean NOT NULL DEFAULT false,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 5),
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  issued_by uuid NOT NULL,
  note text,
  revoked_at timestamptz, revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose = 'qa_test' OR allow_incomplete_sign = false)
);
GRANT ALL ON public.onboarding_authorisations TO service_role;
GRANT SELECT ON public.onboarding_authorisations TO authenticated;
ALTER TABLE public.onboarding_authorisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read onboarding authorisations" ON public.onboarding_authorisations FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE public.onboarding_authorisation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  authorisation_id uuid REFERENCES public.onboarding_authorisations(id),
  event text NOT NULL CHECK (event IN ('issued','used','refused_expired','refused_revoked','refused_used_up','refused_wrong_trade','refused_unknown','revoked','expired')),
  actor uuid, application_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.onboarding_authorisation_events TO service_role;
GRANT SELECT ON public.onboarding_authorisation_events TO authenticated;
ALTER TABLE public.onboarding_authorisation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read onboarding authorisation events" ON public.onboarding_authorisation_events FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER onboarding_authorisation_events_immutable BEFORE UPDATE OR DELETE ON public.onboarding_authorisation_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

ALTER TABLE public.rec_onboarding_applications
  ADD COLUMN authorisation_id uuid REFERENCES public.onboarding_authorisations(id),
  ADD COLUMN allow_incomplete_sign boolean NOT NULL DEFAULT false,
  ADD COLUMN contact_hash text,
  ADD COLUMN insurance_file_type text CHECK (insurance_file_type IN ('pdf','png','jpg')),
  ADD COLUMN insurance_file_bytes integer,
  ADD COLUMN insurance_file_sha256 text,
  ADD COLUMN insurance_verified_at timestamptz,
  ADD COLUMN insurance_scan_result text;
CREATE INDEX rec_onboarding_contact_draft ON public.rec_onboarding_applications (contact_hash, partner_type) WHERE status = 'draft';

-- Test mode can only come from a staff-issued qa_test authorisation for the same trade, and never changes later.
-- Insurance evidence only counts once a server-verified file sits outside quarantine.
CREATE FUNCTION public.guard_onboarding_trust() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE a record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.test_mode OR NEW.allow_incomplete_sign THEN
      SELECT * INTO a FROM public.onboarding_authorisations WHERE id = NEW.authorisation_id;
      IF a.id IS NULL OR a.purpose <> 'qa_test' OR a.trade <> NEW.partner_type THEN RAISE EXCEPTION 'Test mode requires a staff-issued test link'; END IF;
      IF NEW.allow_incomplete_sign AND NOT a.allow_incomplete_sign THEN RAISE EXCEPTION 'Test link does not allow incomplete signing'; END IF;
      IF NOT NEW.test_mode THEN RAISE EXCEPTION 'Incomplete signing is only for test applications'; END IF;
    END IF;
  ELSE
    IF NEW.test_mode IS DISTINCT FROM OLD.test_mode OR NEW.authorisation_id IS DISTINCT FROM OLD.authorisation_id OR NEW.allow_incomplete_sign IS DISTINCT FROM OLD.allow_incomplete_sign THEN
      RAISE EXCEPTION 'Test mode cannot be changed after an application starts';
    END IF;
  END IF;
  IF NEW.insurance_certificate_path IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.insurance_certificate_path IS DISTINCT FROM OLD.insurance_certificate_path) THEN
    IF NEW.insurance_certificate_path LIKE 'quarantine/%' OR NEW.insurance_verified_at IS NULL OR NEW.insurance_file_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Insurance file has not been verified';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rec_onboarding_trust BEFORE INSERT OR UPDATE ON public.rec_onboarding_applications FOR EACH ROW EXECUTE FUNCTION public.guard_onboarding_trust();

-- Rolling-window start limiter. Keys are HMACs made with a server-held secret (never raw IP/UA/cookie).
-- 'visitor' = per first-party browser identifier (3/15 min, 5/24 h); 'network' = per IP+trade, a wider
-- backstop (12/15 min, 20/24 h) so clearing cookies can't bypass limits while a shared office isn't blocked.
-- Serialised per key so parallel bursts cannot overshoot. Uncleared rows are kept 30 days; cleared rows are kept permanently with their clearance.
CREATE FUNCTION public.consume_onboarding_start(_fp text, _trade text, _kind text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n15 int; n24 int; ok boolean; l15 int; l24 int;
BEGIN
  IF _fp !~ '^[a-f0-9]{64}$' OR _trade NOT IN ('rec','installer') OR _kind NOT IN ('visitor','network') THEN RETURN false; END IF;
  IF _kind = 'visitor' THEN l15 := 3; l24 := 5; ELSE l15 := 12; l24 := 20; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_start:' || _kind || ':' || _fp, 0));
  DELETE FROM public.onboarding_start_attempts WHERE created_at < now() - interval '30 days' AND cleared_at IS NULL;
  SELECT count(*) FILTER (WHERE created_at > now() - interval '15 minutes'), count(*) INTO n15, n24
    FROM public.onboarding_start_attempts WHERE fingerprint_hash = _fp AND kind = _kind AND allowed AND cleared_at IS NULL AND created_at > now() - interval '24 hours';
  ok := n15 < l15 AND n24 < l24;
  INSERT INTO public.onboarding_start_attempts(fingerprint_hash, trade, kind, allowed) VALUES (_fp, _trade, _kind, ok);
  RETURN ok;
END $$;
REVOKE ALL ON FUNCTION public.consume_onboarding_start(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_onboarding_start(text, text, text) TO service_role;

-- Atomically consume a staff-issued link. Row-locked, so a replayed/parallel use can't exceed max_uses.
CREATE FUNCTION public.consume_onboarding_authorisation(_hash text, _trade text)
RETURNS TABLE(id uuid, purpose text, allow_incomplete_sign boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.onboarding_authorisations; ev text;
BEGIN
  SELECT * INTO a FROM public.onboarding_authorisations o WHERE o.token_hash = _hash FOR UPDATE;
  IF a.id IS NULL THEN ev := 'refused_unknown';
  ELSIF a.revoked_at IS NOT NULL THEN ev := 'refused_revoked';
  ELSIF a.expires_at <= now() THEN ev := 'refused_expired';
  ELSIF a.uses >= a.max_uses THEN ev := 'refused_used_up';
  ELSIF a.trade <> _trade THEN ev := 'refused_wrong_trade';
  END IF;
  IF ev IS NOT NULL THEN
    INSERT INTO public.onboarding_authorisation_events(authorisation_id, event) VALUES (a.id, ev);
    RETURN;
  END IF;
  UPDATE public.onboarding_authorisations o SET uses = o.uses + 1 WHERE o.id = a.id;
  INSERT INTO public.onboarding_authorisation_events(authorisation_id, event) VALUES (a.id, 'used');
  RETURN QUERY SELECT a.id, a.purpose, a.allow_incomplete_sign;
END $$;
REVOKE ALL ON FUNCTION public.consume_onboarding_authorisation(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_onboarding_authorisation(text, text) TO service_role;

-- Staff revocation of an UNUSED link. Atomic with use: a link already used (or revoked) is refused.
CREATE FUNCTION public.revoke_onboarding_authorisation(_id uuid, _actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.onboarding_authorisations;
BEGIN
  IF _actor IS NULL THEN RETURN false; END IF;
  SELECT * INTO a FROM public.onboarding_authorisations o WHERE o.id = _id FOR UPDATE;
  IF a.id IS NULL OR a.revoked_at IS NOT NULL OR a.uses > 0 THEN RETURN false; END IF;
  UPDATE public.onboarding_authorisations o SET revoked_at = now(), revoked_by = _actor WHERE o.id = _id;
  INSERT INTO public.onboarding_authorisation_events(authorisation_id, event, actor) VALUES (_id, 'revoked', _actor);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.revoke_onboarding_authorisation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_onboarding_authorisation(uuid, uuid) TO service_role;

-- Records one 'expired' audit event for each unused, unrevoked link past expiry (idempotent).
CREATE FUNCTION public.record_expired_onboarding_authorisations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  INSERT INTO public.onboarding_authorisation_events(authorisation_id, event)
    SELECT o.id, 'expired' FROM public.onboarding_authorisations o
    WHERE o.expires_at <= now() AND o.uses = 0 AND o.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.onboarding_authorisation_events e WHERE e.authorisation_id = o.id AND e.event = 'expired');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.record_expired_onboarding_authorisations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expired_onboarding_authorisations() TO service_role;

-- ---------- Audited office clearing of a start-limit block ----------
-- Clearing never deletes attempts: it marks the blocking rows cleared and writes an immutable clearance.
CREATE TABLE public.onboarding_limit_clearances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint_hash text NOT NULL CHECK (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  trade text NOT NULL CHECK (trade IN ('rec','installer')),
  kind text NOT NULL CHECK (kind IN ('visitor','network')),
  attempts_cleared integer NOT NULL CHECK (attempts_cleared > 0),
  actor uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.onboarding_limit_clearances TO service_role;
GRANT SELECT ON public.onboarding_limit_clearances TO authenticated;
ALTER TABLE public.onboarding_limit_clearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read limit clearances" ON public.onboarding_limit_clearances FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER onboarding_limit_clearances_immutable BEFORE UPDATE OR DELETE ON public.onboarding_limit_clearances FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- Current blocks (24 h window) by hashed key only.
CREATE FUNCTION public.list_onboarding_start_blocks()
RETURNS TABLE(fingerprint_hash text, trade text, kind text, recent_15m int, recent_24h int, refused int, last_attempt timestamptz, blocked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.fingerprint_hash, a.trade, a.kind,
    (count(*) FILTER (WHERE a.allowed AND a.created_at > now() - interval '15 minutes'))::int,
    (count(*) FILTER (WHERE a.allowed))::int,
    (count(*) FILTER (WHERE NOT a.allowed))::int,
    max(a.created_at),
    (count(*) FILTER (WHERE a.allowed AND a.created_at > now() - interval '15 minutes')) >= CASE a.kind WHEN 'visitor' THEN 3 ELSE 12 END
      OR (count(*) FILTER (WHERE a.allowed)) >= CASE a.kind WHEN 'visitor' THEN 5 ELSE 20 END
  FROM public.onboarding_start_attempts a
  WHERE a.cleared_at IS NULL AND a.created_at > now() - interval '24 hours'
  GROUP BY a.fingerprint_hash, a.trade, a.kind
  HAVING count(*) FILTER (WHERE NOT a.allowed) > 0
     OR (count(*) FILTER (WHERE a.allowed)) >= CASE a.kind WHEN 'visitor' THEN 5 ELSE 20 END
     OR (count(*) FILTER (WHERE a.allowed AND a.created_at > now() - interval '15 minutes')) >= CASE a.kind WHEN 'visitor' THEN 3 ELSE 12 END
  ORDER BY max(a.created_at) DESC LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.list_onboarding_start_blocks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_onboarding_start_blocks() TO service_role;

-- Clears exactly one hashed key for one trade. Refuses blank reason, missing actor, or no matching active rows.
CREATE FUNCTION public.clear_onboarding_start_block(_fp text, _trade text, _kind text, _actor uuid, _reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int; cid bigint;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'An authenticated office user is required'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _fp !~ '^[a-f0-9]{64}$' OR _trade NOT IN ('rec','installer') OR _kind NOT IN ('visitor','network') THEN RAISE EXCEPTION 'Invalid limit record'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_start:' || _kind || ':' || _fp, 0));
  SELECT count(*) INTO n FROM public.onboarding_start_attempts
    WHERE fingerprint_hash = _fp AND trade = _trade AND kind = _kind AND cleared_at IS NULL AND created_at > now() - interval '24 hours';
  IF n = 0 THEN RAISE EXCEPTION 'No active limit for this record and trade'; END IF;
  INSERT INTO public.onboarding_limit_clearances(fingerprint_hash, trade, kind, attempts_cleared, actor, reason)
    VALUES (_fp, _trade, _kind, n, _actor, btrim(_reason)) RETURNING id INTO cid;
  UPDATE public.onboarding_start_attempts SET cleared_at = now(), cleared_by = _actor, clearance_id = cid
    WHERE fingerprint_hash = _fp AND trade = _trade AND kind = _kind AND cleared_at IS NULL AND created_at > now() - interval '24 hours';
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.clear_onboarding_start_block(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_onboarding_start_block(text, text, text, uuid, text) TO service_role;

-- ---------- Quarantined insurance uploads: tracked, validated once, cleaned after 24 h ----------
CREATE TABLE public.onboarding_quarantine_uploads (
  path text PRIMARY KEY CHECK (path ~ '^quarantine/(rec|installer)-onboarding/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  application_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued','validating','accepted','rejected','deleting','deleted')),
  bytes bigint,
  issued_at timestamptz NOT NULL DEFAULT now(),
  claim_until timestamptz,
  resolved_at timestamptz,
  cleanup_run_id bigint
);
CREATE INDEX onboarding_quarantine_uploads_state ON public.onboarding_quarantine_uploads (state, issued_at);
GRANT ALL ON public.onboarding_quarantine_uploads TO service_role;
GRANT SELECT ON public.onboarding_quarantine_uploads TO authenticated;
ALTER TABLE public.onboarding_quarantine_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read quarantine uploads" ON public.onboarding_quarantine_uploads FOR SELECT TO authenticated USING (public.is_admin());

-- Accepted and deleted are final: no later claim, validation or cleanup can touch them.
CREATE FUNCTION public.guard_quarantine_upload() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Quarantine upload records are permanent'; END IF;
  IF OLD.state IN ('accepted','deleted') THEN RAISE EXCEPTION 'Upload record is final'; END IF;
  IF NEW.path IS DISTINCT FROM OLD.path OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN RAISE EXCEPTION 'Upload identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER onboarding_quarantine_uploads_guard BEFORE UPDATE OR DELETE ON public.onboarding_quarantine_uploads FOR EACH ROW EXECUTE FUNCTION public.guard_quarantine_upload();

CREATE TABLE public.onboarding_upload_cleanup_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger text NOT NULL CHECK (trigger IN ('rejected','abandoned','superseded','signed','office')),
  actor uuid,
  files_removed integer NOT NULL,
  bytes_removed bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.onboarding_upload_cleanup_runs TO service_role;
GRANT SELECT ON public.onboarding_upload_cleanup_runs TO authenticated;
ALTER TABLE public.onboarding_upload_cleanup_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read upload cleanup runs" ON public.onboarding_upload_cleanup_runs FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER onboarding_upload_cleanup_runs_immutable BEFORE UPDATE OR DELETE ON public.onboarding_upload_cleanup_runs FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- Starts validation of one issued upload for its own application. Only one validator can win.
CREATE FUNCTION public.begin_quarantine_validation(_path text, _app uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE public.onboarding_quarantine_uploads SET state = 'validating', claim_until = now() + interval '10 minutes'
    WHERE path = _path AND application_id = _app AND state = 'issued' AND issued_at > now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 1;
END $$;
-- Ends validation: accepted (moved to final storage) or rejected (bytes failed; to be deleted).
CREATE FUNCTION public.finish_quarantine_validation(_path text, _app uuid, _accepted boolean, _bytes bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE public.onboarding_quarantine_uploads SET state = CASE WHEN _accepted THEN 'accepted' ELSE 'rejected' END,
      bytes = _bytes, claim_until = NULL, resolved_at = now()
    WHERE path = _path AND application_id = _app AND state = 'validating';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 1;
END $$;
-- Claims uploads to delete: rejected, abandoned >24 h, stalled claims, or (with _app) every unaccepted upload of one application.
CREATE FUNCTION public.claim_quarantine_cleanup(_limit int, _app uuid DEFAULT NULL)
RETURNS TABLE(path text, application_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY UPDATE public.onboarding_quarantine_uploads q SET state = 'deleting', claim_until = now() + interval '5 minutes'
    WHERE q.path IN (
      SELECT c.path FROM public.onboarding_quarantine_uploads c
      WHERE (_app IS NULL OR c.application_id = _app) AND (
        c.state = 'rejected'
        OR (c.state = 'issued' AND (_app IS NOT NULL OR c.issued_at <= now() - interval '24 hours'))
        OR (c.state IN ('validating','deleting') AND c.claim_until < now()))
      ORDER BY c.issued_at LIMIT greatest(1, least(_limit, 200)) FOR UPDATE SKIP LOCKED)
    RETURNING q.path, q.application_id;
END $$;
-- Records deletion of claimed uploads and one audit run. Replay-safe: already-deleted paths count zero.
CREATE FUNCTION public.finish_quarantine_cleanup(_paths text[], _bytes bigint[], _trigger text, _actor uuid DEFAULT NULL) RETURNS TABLE(run_id bigint, files int, bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rid bigint; n int; b bigint;
BEGIN
  WITH input AS (SELECT p, coalesce(x, 0) AS x FROM unnest(_paths, _bytes) AS u(p, x))
  SELECT count(*), coalesce(sum(i.x), 0) INTO n, b FROM input i JOIN public.onboarding_quarantine_uploads q ON q.path = i.p AND q.state = 'deleting';
  IF n = 0 THEN RETURN QUERY SELECT NULL::bigint, 0, 0::bigint; RETURN; END IF;
  INSERT INTO public.onboarding_upload_cleanup_runs(trigger, actor, files_removed, bytes_removed) VALUES (_trigger, _actor, n, b) RETURNING id INTO rid;
  UPDATE public.onboarding_quarantine_uploads q SET state = 'deleted', claim_until = NULL, resolved_at = now(), cleanup_run_id = rid,
      bytes = coalesce(q.bytes, (SELECT coalesce(x,0) FROM unnest(_paths, _bytes) AS u(p, x) WHERE p = q.path LIMIT 1))
    WHERE q.path = ANY(_paths) AND q.state = 'deleting';
  RETURN QUERY SELECT rid, n, b;
END $$;
REVOKE ALL ON FUNCTION public.begin_quarantine_validation(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_quarantine_validation(text, uuid, boolean, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_quarantine_cleanup(int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_quarantine_cleanup(text[], bigint[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_quarantine_validation(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_quarantine_validation(text, uuid, boolean, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_quarantine_cleanup(int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_quarantine_cleanup(text[], bigint[], text, uuid) TO service_role;
