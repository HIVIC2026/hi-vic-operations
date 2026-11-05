-- Undo 2026-11-05_test_office_give.sql: allocate_in_house_batch_job refuses every qa_office actor and every qa_test job
-- again, exactly as before. Proven on PGlite by tests/test-office-give-practice-db.test.ts.
DO $$
DECLARE body text; head text; tail text;
BEGIN
  SELECT pg_get_functiondef('public.allocate_in_house_batch_job(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO body;
  IF position('TEST office Give (Jo 5 Nov 2026)' IN body)=0 THEN RETURN; END IF; -- not applied
  head := $new$  -- TEST office Give (Jo 5 Nov 2026): a qa_office actor (never also admin) may give only a qa_test job to a TEST partner.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin') THEN RAISE EXCEPTION 'Office only'; END IF;
    PERFORM 1 FROM public.businesses WHERE id=_business
      AND position('[TEST PARTNER]' IN COALESCE(onboarding_notes,''))>0
      AND trim(COALESCE(email,'')) ~* '^[^@[:space:]]+@hivic-test\.example$' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The TEST office can only give TEST jobs to TEST installers'; END IF;
    PERFORM 1 FROM public.jobs WHERE id=_job AND source='qa_test';
    IF NOT FOUND THEN RAISE EXCEPTION 'The TEST office can only give TEST jobs to TEST installers'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin') THEN
    RAISE EXCEPTION 'Office only';
  END IF;$new$;
  tail := $new$  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL
    AND CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN (source='qa_test' AND qa_archived_at IS NULL) ELSE source<>'qa_test' END FOR UPDATE;$new$;
  IF position(head IN body)=0 OR position(tail IN body)=0 THEN RAISE EXCEPTION 'Unexpected batch function body'; END IF;
  body := replace(body, head, $old$  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    RAISE EXCEPTION 'Office only';
  END IF;$old$);
  body := replace(body, tail, $old$  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test' FOR UPDATE;$old$);
  EXECUTE body;
END $$;
