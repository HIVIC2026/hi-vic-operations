CREATE TABLE public.property_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','partial','error')),
  ruleset_version text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  reference_date date NOT NULL,
  reference_date_basis text NOT NULL DEFAULT 'today',
  address_hash text,
  result text CHECK (result IN ('likely_eligible','needs_onsite_confirmation','does_not_appear_eligible')),
  result_reason text,
  next_action text,
  completeness_pct integer,
  is_stale boolean NOT NULL DEFAULT false,
  stale_reason text,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id)
);
CREATE INDEX ON public.property_intelligence_runs (job_id, started_at DESC);

CREATE TABLE public.property_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.property_intelligence_runs(id) ON DELETE SET NULL,
  fact_key text NOT NULL,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  check_status text NOT NULL DEFAULT 'unknown' CHECK (check_status IN ('pass','review','fail','unknown','info')),
  source_type text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  source_record_id text,
  source_date date,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  confidence text NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('very_high','high','medium','low','unknown')),
  evidence_kind text NOT NULL DEFAULT 'inferred' CHECK (evidence_kind IN ('direct','inferred','none')),
  note text,
  raw_snapshot jsonb,
  raw_hash text,
  is_current boolean NOT NULL DEFAULT true,
  is_stale boolean NOT NULL DEFAULT false,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.property_facts (job_id, fact_key) WHERE is_current;

CREATE TABLE public.property_area_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.property_intelligence_runs(id) ON DELETE SET NULL,
  tier text NOT NULL CHECK (tier IN ('A','B','C','D','E','F')),
  method text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  document_id uuid REFERENCES public.documents(id),
  gross_m2 numeric,
  excluded_m2 numeric,
  net_m2 numeric,
  confidence text NOT NULL CHECK (confidence IN ('very_high','high','medium','low','unknown')),
  notes text,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.property_area_estimates (job_id);

CREATE TABLE public.property_source_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.property_intelligence_runs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','no_match','error','timeout','not_configured','skipped')),
  latency_ms integer,
  http_status integer,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.piesa_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  piesa_record_id uuid NOT NULL REFERENCES public.piesa_records(id),
  recipient text NOT NULL CHECK (recipient IN ('owner','installer')),
  delivered_at timestamptz NOT NULL,
  method text NOT NULL,
  document_id uuid REFERENCES public.documents(id),
  notes text,
  recorded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.esc_notification_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_note text,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.esc_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id),
  version integer NOT NULL DEFAULT 1,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  installation_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  premises_address text NOT NULL,
  owner_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_assignment_id uuid REFERENCES public.customer_assignments(id),
  consent_template_version text,
  consent_signed_at timestamptz,
  config_version text,
  payload_version text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text,
  status text NOT NULL DEFAULT 'not_ready' CHECK (status IN ('not_ready','configuration_required','ready','pending_submission','sent','accepted','error','stale','cancelled')),
  due_by timestamptz NOT NULL,
  sent_at timestamptz,
  submission_method text,
  submission_reference text,
  submitted_by uuid REFERENCES public.profiles(id),
  response jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esc_sent_needs_reference CHECK (status NOT IN ('sent','accepted') OR (sent_at IS NOT NULL AND submission_reference IS NOT NULL AND submission_method IS NOT NULL))
);
CREATE INDEX ON public.esc_notifications (job_id, created_at DESC);

ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS esc_consent_version text;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS esc_consent_signed_at timestamptz;

GRANT SELECT ON public.property_intelligence_runs, public.property_facts, public.property_area_estimates, public.property_source_checks, public.piesa_deliveries, public.esc_notification_config, public.esc_notifications TO authenticated;
GRANT ALL ON public.property_intelligence_runs, public.property_facts, public.property_area_estimates, public.property_source_checks, public.piesa_deliveries, public.esc_notification_config, public.esc_notifications TO service_role;

ALTER TABLE public.property_intelligence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_area_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_source_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piesa_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esc_notification_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esc_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read intelligence runs" ON public.property_intelligence_runs FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read property facts" ON public.property_facts FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read area estimates" ON public.property_area_estimates FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read source checks" ON public.property_source_checks FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Job parties read PIESA deliveries" ON public.piesa_deliveries FOR SELECT TO authenticated USING (public.can_access_job(job_id));
CREATE POLICY "Admins read ESC config" ON public.esc_notification_config FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read ESC notifications" ON public.esc_notifications FOR SELECT TO authenticated USING (public.is_admin());