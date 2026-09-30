CREATE TABLE public.customer_communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  version text NOT NULL,
  subject text NOT NULL,
  body_markdown text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  regulated_copy_locked boolean NOT NULL DEFAULT false,
  source_note text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  UNIQUE(template_key, version)
);
GRANT SELECT, INSERT, UPDATE ON public.customer_communication_templates TO authenticated;
GRANT ALL ON public.customer_communication_templates TO service_role;
ALTER TABLE public.customer_communication_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read customer communication templates"
ON public.customer_communication_templates FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can create customer communication drafts"
ON public.customer_communication_templates FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid() AND status = 'draft');
COMMENT ON TABLE public.customer_communication_templates IS 'Immutable-version customer communication review drafts and approvals; delivery renderers remain code-controlled until an approved version is explicitly integrated.';