-- TEST office Give (Jo 5 Nov 2026). APPLIED live 5 Nov 2026 ~16:40 AEDT (Jo OK). Proven on PGlite by tests/test-office-give-practice-db.test.ts.
-- Undo: 2026-11-05_test_office_give.rollback.sql.
--
-- allocate_in_house_batch_job is the one atomic writer behind Choose installer "Give to installer". Today it refuses any
-- qa_office actor ('Office only') and locks only source<>'qa_test' jobs, so the nightly TEST journey can never be given.
-- After this change:
--   * an admin actor (no qa_office role) is EXACTLY as before: real jobs only, qa_test jobs stay 'Job unavailable';
--   * a qa_office actor (never also admin) may give ONLY a qa_test job, and ONLY to a TEST partner: the business carries
--     the [TEST PARTNER] mark AND a reserved TEST email (@hivic-test.example). Anything else is refused before any write.
-- Every other guard (quick-taps yes, saved spot, opt-out, coverage, approved installer, one-installer lock) is unchanged.
-- The app checks the same rules first (in-house-batch.functions.ts / testGiveBlocker); this is the database backstop.
DO $$
DECLARE body text;
BEGIN
  SELECT pg_get_functiondef('public.allocate_in_house_batch_job(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO body;
  IF position('TEST office Give (Jo 5 Nov 2026)' IN body)>0 THEN RETURN; END IF; -- already applied
  IF position($old$  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    RAISE EXCEPTION 'Office only';
  END IF;$old$ IN body)=0
    OR position($old$  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test' FOR UPDATE;$old$ IN body)=0 THEN
    RAISE EXCEPTION 'Unexpected batch function body';
  END IF;
  body := replace(body, $old$  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    RAISE EXCEPTION 'Office only';
  END IF;$old$, $new$  -- TEST office Give (Jo 5 Nov 2026): a qa_office actor (never also admin) may give only a qa_test job to a TEST partner.
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
  END IF;$new$);
  body := replace(body, $old$  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test' FOR UPDATE;$old$,
    $new$  SELECT * INTO job_row FROM public.jobs WHERE id=_job AND deleted_at IS NULL
    AND CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN (source='qa_test' AND qa_archived_at IS NULL) ELSE source<>'qa_test' END FOR UPDATE;$new$);
  EXECUTE body;
END $$;
