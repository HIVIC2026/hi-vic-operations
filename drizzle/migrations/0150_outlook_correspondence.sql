-- 0207: Outlook correspondence sync — sync cursor + Office review queue (unmatched / possible-decline).
-- Message storage reuses public.job_communications; its existing partial unique index
-- job_communications_provider_msg (provider, provider_message_id) keeps each Outlook message stored once.
-- Server-only tables: reached through admin-checked server functions with the service role.

CREATE UNIQUE INDEX IF NOT EXISTS job_communications_provider_msg
  ON public.job_communications (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.outlook_sync_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  backfill_from timestamptz NOT NULL DEFAULT '2026-10-01T00:00:00+11:00',
  inbox_cursor timestamptz,
  sent_cursor timestamptz,
  mailbox text,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.outlook_sync_state TO service_role;
ALTER TABLE public.outlook_sync_state ENABLE ROW LEVEL SECURITY;
INSERT INTO public.outlook_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.correspondence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('unmatched', 'possible_not_proceeding', 'not_proceeding_progressed')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'closed_job', 'dismissed')),
  provider text NOT NULL DEFAULT 'outlook',
  provider_message_id text NOT NULL,
  provider_thread_id text,
  job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  communication_id uuid REFERENCES public.job_communications(id) ON DELETE RESTRICT,
  candidate_job_ids uuid[] NOT NULL DEFAULT '{}',
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  body text NOT NULL DEFAULT '',
  message_at timestamptz,
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL,
  suggested_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_message_id, kind)
);
GRANT ALL ON public.correspondence_reviews TO service_role;
ALTER TABLE public.correspondence_reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS correspondence_reviews_open ON public.correspondence_reviews (status, created_at DESC);
