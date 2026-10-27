-- Data-only, Jo 27 Oct 03:52 UTC. Existing normal offer preferences; no global setting or identity changes.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.businesses WHERE id IN (
    '62956b54-2e44-4c96-a156-33949b20fa82','820cf08a-504c-4016-b07e-635b54742d1a','a7f317a7-0450-47d0-8ddd-b4426cdc8aa5',
    '02ce14a9-6e48-441e-80b7-edd0c729b3cc','1edd44a4-0cc5-41d6-8ed4-e94d375835a6','3d84ca8e-091a-4257-8b20-15e2b3889a72',
    '17e9b9ea-abc4-40e4-9588-c9e7c504d30a','46a9e02a-94f1-4d1c-a89e-74f1cafdacc7','17793408-bf5c-4ddd-9bec-64199f64f9fb',
    '9f84440c-d075-4f7e-8cb3-169aa2e19ccd','39347df9-b8e7-48ae-949d-6e408671b812','6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f',
    '4beba4a5-e03b-4af8-9d24-3196249f8632'
  ) AND position('[TEST PARTNER]' in coalesce(onboarding_notes,'')) > 0) <> 13 THEN
    RAISE EXCEPTION 'STOP: expected exactly thirteen existing marked TEST businesses';
  END IF;
END $$;
WITH before_rows AS MATERIALIZED (
  SELECT * FROM public.businesses WHERE id IN (
    '62956b54-2e44-4c96-a156-33949b20fa82','820cf08a-504c-4016-b07e-635b54742d1a','a7f317a7-0450-47d0-8ddd-b4426cdc8aa5',
    '02ce14a9-6e48-441e-80b7-edd0c729b3cc','1edd44a4-0cc5-41d6-8ed4-e94d375835a6','3d84ca8e-091a-4257-8b20-15e2b3889a72',
    '17e9b9ea-abc4-40e4-9588-c9e7c504d30a','46a9e02a-94f1-4d1c-a89e-74f1cafdacc7','17793408-bf5c-4ddd-9bec-64199f64f9fb',
    '9f84440c-d075-4f7e-8cb3-169aa2e19ccd','39347df9-b8e7-48ae-949d-6e408671b812','6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f',
    '4beba4a5-e03b-4af8-9d24-3196249f8632'
  ) AND (accepting_new_jobs IS DISTINCT FROM false OR receives_hivic_leads IS DISTINCT FROM false)
), changed AS (
  UPDATE public.businesses b SET accepting_new_jobs=false, receives_hivic_leads=false
  FROM before_rows old WHERE b.id=old.id RETURNING b.id
)
INSERT INTO public.admin_config_events(event_type,summary,details)
SELECT 'trade_taking_new_jobs', old.name || ': paused new offers — Jo asked, 27 Oct 2026',
  jsonb_build_object('business_id',old.id,'taking',false,'receives_hivic_leads',false,
    'before',jsonb_build_object('accepting_new_jobs',old.accepting_new_jobs,'receives_hivic_leads',old.receives_hivic_leads),
    'reason','Jo asked, 27 Oct 2026 03:52 UTC; TEST trades only; preserve logins and TEST journeys',
    'requested_by','Jo','execution','authorised data-only change')
FROM before_rows old JOIN changed c ON c.id=old.id;
COMMIT;