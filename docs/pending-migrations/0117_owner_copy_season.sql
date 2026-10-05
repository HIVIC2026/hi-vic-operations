-- Office toggle for owner-facing seasonal wording. Default summer ("cooler" lines).
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS owner_copy_season text NOT NULL DEFAULT 'summer'
  CHECK (owner_copy_season IN ('summer', 'winter'));
