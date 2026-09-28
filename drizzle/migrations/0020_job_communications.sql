CREATE TABLE public.job_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','internal')),
  channel text NOT NULL CHECK (channel IN ('portal','email','sms','phone','note','system','whatsapp','other')),
  sender_user_id uuid,
  sender_text text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  body text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'manual',
  provider_message_id text,
  provider_thread_id text,
  sent_at timestamptz,
  received_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'recorded' CHECK (delivery_status IN ('recorded','queued','sent','delivered','failed','blocked_prelaunch','received')),
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('customer','trade','internal')),
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_event text,
  source_reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_communications_provider_msg ON public.job_communications(provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX job_communications_job ON public.job_communications(job_id, created_at);
GRANT SELECT ON public.job_communications TO authenticated;
GRANT ALL ON public.job_communications TO service_role;
ALTER TABLE public.job_communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin reads communications" ON public.job_communications FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "owner reads customer communications" ON public.job_communications FOR SELECT TO authenticated
  USING (visibility = 'customer' AND public.is_job_owner(job_id, auth.uid()));
CREATE POLICY "trade reads trade communications" ON public.job_communications FOR SELECT TO authenticated
  USING (visibility = 'trade' AND public.job_assignment_role(job_id, auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.guard_job_communication()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'job communications are permanent records'; end if;
  if new.job_id <> old.job_id or new.direction <> old.direction or new.channel <> old.channel or new.body <> old.body
     or new.subject is distinct from old.subject or new.recipients <> old.recipients or new.sender_text is distinct from old.sender_text
     or new.visibility <> old.visibility or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'job communication content is immutable – only delivery status may change';
  end if;
  new.updated_at = now();
  return new;
end $function$;
CREATE TRIGGER job_communications_guard BEFORE UPDATE OR DELETE ON public.job_communications FOR EACH ROW EXECUTE FUNCTION public.guard_job_communication();