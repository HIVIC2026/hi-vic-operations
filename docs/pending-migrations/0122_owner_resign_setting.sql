-- Gate D: whether the owner must sign again after install even with no material change (lawyer decision; default off).
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS owner_resign_after_install boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.workflow_settings.owner_resign_after_install IS 'When true, the owner signs the completed Activity 48 assignment after install; when false the quote-acceptance assignment applies unless facts changed materially.';
