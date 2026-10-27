-- Jo 27 Oct 10:46: TEST Bravo only. No offer flags, approvals, Alpha or HV-1554 changes.
DO $$
DECLARE b uuid := '820cf08a-504c-4016-b07e-635b54742d1a';
        actor uuid := '36b849de-1cde-425c-a05d-623f8985bbd6';
        worker uuid := 'b7261046-0000-4000-8000-000000000001';
        cert uuid := 'b7261046-0000-4000-8000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id=b AND name='TEST Bravo Insulation'
    AND email='qa.installer.bravo@hivic-test.example' AND onboarding_notes LIKE '%[TEST PARTNER]%')
    THEN RAISE EXCEPTION 'SAFETY STOP: TEST Bravo identity mismatch'; END IF;
  INSERT INTO public.partner_workers (id,business_id,profile_id,trade_role,full_legal_name,email,qualification,approval_status,certification_status,added_by,worker_role)
    VALUES (worker,b,'c1a8f7d0-d425-47e5-b050-6f79194729b5','installer','TEST Bravo Insulation','qa.installer.bravo@hivic-test.example','Cert III','pending','unverified',actor,'lead')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.partner_worker_certifications (id,worker_id,worker_email,status,certificate_number,issuer,evidence_source,evidence_note,recorded_by)
    VALUES (cert,worker,'qa.installer.bravo@hivic-test.example','verified','TEST-BRAVO-CII-2026','TEST ONLY','certificate_sighted','Synthetic TEST certificate authorised by Jo 27 Oct; not a real qualification.',actor)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.worker_certification_levels (id,certification_id,worker_email,level,expires_on,recorded_by)
    VALUES ('b7261046-0000-4000-8000-000000000003',cert,'qa.installer.bravo@hivic-test.example','full','2028-10-27',actor)
    ON CONFLICT (id) DO NOTHING;
  UPDATE public.partner_workers SET certification_status='verified', certification=jsonb_build_object('verification_id',cert,'test_certificate',true)
    WHERE id=worker AND business_id=b AND email='qa.installer.bravo@hivic-test.example';
  INSERT INTO public.business_credentials (id,business_id,kind,label,number,issuer,expires_at,critical,created_by,verification,verified_by,verified_at)
    VALUES ('b7261046-0000-4000-8000-000000000004',b,'installer_certification','TEST Bravo Full certificate','TEST-BRAVO-CII-2026','TEST ONLY','2028-10-27',true,actor,'verified',actor,now()),
           ('b7261046-0000-4000-8000-000000000005',b,'public_liability_insurance','TEST Bravo insurance','TEST-BRAVO-PLI-2026','TEST ONLY','2028-10-27',true,actor,'verified',actor,now())
    ON CONFLICT (id) DO NOTHING;
  UPDATE public.businesses SET service_postcodes=ARRAY(SELECT DISTINCT unnest(coalesce(service_postcodes,ARRAY[]::text[]) || ARRAY['3199'])),coverage_verified_at=coalesce(coverage_verified_at,now()) WHERE id=b;
END $$;