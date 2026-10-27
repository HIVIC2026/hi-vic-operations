-- NOT APPLIED. Depends on qa-office-foundation.sql. No login until ALL office entrypoints are proven.
-- First scoped layer: job graph reads and existing recorded-only office actions. Global quarantine stays.
CREATE OR REPLACE FUNCTION public.qa_office_reserved_email(_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(btrim(_email) ~* '^[^@[:space:]]+@hivic-test[.]example$', false)
$$;

CREATE OR REPLACE FUNCTION public.qa_office_business_allowed(_business uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT public.is_qa_office()) AND EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = _business
      AND public.qa_office_reserved_email(b.email)
      AND coalesce(b.onboarding_notes,'') LIKE '%[TEST PARTNER]%'
      AND (b.signer_email IS NULL OR public.qa_office_reserved_email(b.signer_email))
      AND CASE WHEN b.contact_people IS NULL THEN true
        WHEN jsonb_typeof(b.contact_people) <> 'array' THEN false
        ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b.contact_people) c WHERE NOT public.qa_office_reserved_email(c->>'email')) END
      AND NOT EXISTS (SELECT 1 FROM public.partner_workers w LEFT JOIN public.profiles p ON p.id=w.profile_id
        WHERE w.business_id=b.id AND (NOT public.qa_office_reserved_email(w.email)
          OR (w.profile_id IS NOT NULL AND NOT public.qa_office_reserved_email(p.email))))
      AND NOT EXISTS (SELECT 1 FROM public.business_members m LEFT JOIN public.profiles p ON p.id=m.user_id
        WHERE m.business_id=b.id AND NOT public.qa_office_reserved_email(p.email))
      AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.originating_installer_business_id=b.id AND j.source IS DISTINCT FROM 'qa_test')
      AND NOT EXISTS (SELECT 1 FROM public.job_assignments a JOIN public.jobs j ON j.id=a.job_id
        WHERE a.business_id=b.id AND j.source IS DISTINCT FROM 'qa_test')
      AND NOT EXISTS (SELECT 1 FROM public.partner_offers o JOIN public.jobs j ON j.id=o.job_id
        WHERE o.business_id=b.id AND j.source IS DISTINCT FROM 'qa_test')
      AND NOT EXISTS (SELECT 1 FROM public.bookings k JOIN public.jobs j ON j.id=k.job_id
        WHERE k.business_id=b.id AND j.source IS DISTINCT FROM 'qa_test')
  )
$$;

CREATE OR REPLACE FUNCTION public.qa_office_job_allowed(_job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT public.is_qa_office()) AND EXISTS (
    SELECT 1 FROM public.jobs j JOIN public.owners o ON o.id=j.owner_id
      JOIN public.properties p ON p.id=j.property_id
    WHERE j.id=_job AND j.source='qa_test' AND j.deleted_at IS NULL AND j.qa_archived_at IS NULL
      AND p.owner_id=j.owner_id AND public.qa_office_reserved_email(o.email)
      AND (o.user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles u WHERE u.id=o.user_id AND public.qa_office_reserved_email(u.email)))
      AND (j.originating_installer_user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles u WHERE u.id=j.originating_installer_user_id AND public.qa_office_reserved_email(u.email)))
      AND (j.originating_installer_business_id IS NULL OR public.qa_office_business_allowed(j.originating_installer_business_id))
      AND (p.managed_by_business_id IS NULL OR public.qa_office_business_allowed(p.managed_by_business_id))
      AND NOT EXISTS (SELECT 1 FROM public.jobs other WHERE (other.owner_id=j.owner_id OR other.property_id=j.property_id) AND other.source IS DISTINCT FROM 'qa_test')
      AND NOT EXISTS (SELECT 1 FROM public.properties other WHERE other.owner_id=j.owner_id AND EXISTS (
        SELECT 1 FROM public.jobs real WHERE real.property_id=other.id AND real.source IS DISTINCT FROM 'qa_test'))
      AND NOT EXISTS (SELECT 1 FROM public.job_assignments a LEFT JOIN public.profiles u ON u.id=a.user_id
        WHERE a.job_id=j.id AND ((a.business_id IS NOT NULL AND NOT public.qa_office_business_allowed(a.business_id))
          OR (a.user_id IS NOT NULL AND NOT public.qa_office_reserved_email(u.email))))
      AND NOT EXISTS (SELECT 1 FROM public.partner_offers x WHERE x.job_id=j.id AND NOT public.qa_office_business_allowed(x.business_id))
      AND NOT EXISTS (SELECT 1 FROM public.bookings k LEFT JOIN public.profiles u ON u.id=k.contractor_id
        WHERE k.job_id=j.id AND ((k.business_id IS NOT NULL AND NOT public.qa_office_business_allowed(k.business_id))
          OR (k.contractor_id IS NOT NULL AND NOT public.qa_office_reserved_email(u.email))))
      AND NOT EXISTS (SELECT 1 FROM public.assessments a LEFT JOIN public.profiles u ON u.id=a.assessor_id
        WHERE a.job_id=j.id AND a.assessor_id IS NOT NULL AND NOT public.qa_office_reserved_email(u.email))
      AND NOT EXISTS (SELECT 1 FROM public.ceiling_measurements m LEFT JOIN public.profiles u ON u.id=m.measurer_id
        WHERE m.job_id=j.id AND m.measurer_id IS NOT NULL AND NOT public.qa_office_reserved_email(u.email))
  )
$$;

REVOKE ALL ON FUNCTION public.qa_office_reserved_email(text),public.qa_office_business_allowed(uuid),public.qa_office_job_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qa_office_reserved_email(text),public.qa_office_business_allowed(uuid),public.qa_office_job_allowed(uuid) TO authenticated,service_role;

-- Separate SELECT-only policies. Existing admin policies and helper semantics are untouched.
DO $$ DECLARE t text; predicate text; BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','owners','properties','businesses','job_assignments','partner_offers','bookings',
    'assessments','ceiling_measurements','quotes','quote_items','quote_internals','invoices','workflow_events',
    'documents','evidence_files','evidence_requirements','job_communications','office_snoozes'] LOOP
    predicate := CASE t
      WHEN 'jobs' THEN '(SELECT public.qa_office_job_allowed(id))'
      WHEN 'owners' THEN 'EXISTS (SELECT 1 FROM public.jobs j WHERE j.owner_id=id AND public.qa_office_job_allowed(j.id))'
      WHEN 'properties' THEN 'EXISTS (SELECT 1 FROM public.jobs j WHERE j.property_id=id AND public.qa_office_job_allowed(j.id))'
      WHEN 'businesses' THEN '(SELECT public.qa_office_business_allowed(id))'
      WHEN 'quote_items' THEN 'EXISTS (SELECT 1 FROM public.quotes q WHERE q.id=quote_id AND public.qa_office_job_allowed(q.job_id))'
      WHEN 'quote_internals' THEN 'EXISTS (SELECT 1 FROM public.quotes q WHERE q.id=quote_id AND public.qa_office_job_allowed(q.job_id))'
      ELSE '(SELECT public.qa_office_job_allowed(job_id))' END;
    -- Quarantine ALL is replaced by SELECT scope plus an unchanged deny-all write quarantine.
    EXECUTE format('DROP POLICY qa_office_quarantine ON public.%I',t);
    EXECUTE format('CREATE POLICY qa_office_scope ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text=''qa_office'') OR %s)',t,predicate);
    EXECUTE format('CREATE POLICY qa_office_read ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_qa_office()) AND %s)',t,predicate);
    EXECUTE format('CREATE POLICY qa_office_insert_denied ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text=''qa_office''))',t);
    EXECUTE format('CREATE POLICY qa_office_update_denied ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text=''qa_office'')) WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text=''qa_office''))',t);
    EXECUTE format('CREATE POLICY qa_office_delete_denied ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text=''qa_office''))',t);
  END LOOP;
END $$;