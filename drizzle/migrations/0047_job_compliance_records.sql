CREATE TABLE public.job_compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  record_key text NOT NULL CHECK (record_key IN ('life_support_plan','assignment_copy_to_consumer','installer_safety_assessment','pre_install_consumer_docs','co_payment_paid','completion_consumer_docs')),
  occurred_at timestamptz NOT NULL,
  reference text,
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_compliance_records_job_idx ON public.job_compliance_records(job_id, record_key);
GRANT SELECT ON public.job_compliance_records TO authenticated;
GRANT ALL ON public.job_compliance_records TO service_role;
ALTER TABLE public.job_compliance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read compliance records" ON public.job_compliance_records FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE OR REPLACE FUNCTION public.block_compliance_record_changes() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Compliance records are permanent'; END $$;
CREATE TRIGGER job_compliance_records_immutable BEFORE UPDATE OR DELETE ON public.job_compliance_records FOR EACH ROW EXECUTE FUNCTION public.block_compliance_record_changes();