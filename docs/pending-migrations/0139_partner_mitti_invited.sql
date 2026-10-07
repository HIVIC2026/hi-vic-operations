ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited boolean NOT NULL DEFAULT false;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited_at timestamptz;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited_by uuid;
COMMENT ON COLUMN public.businesses.mitti_account_invited IS 'Office-only. When false, partners never see Mitti instructions.';
CREATE OR REPLACE FUNCTION public.guard_mitti_invited() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mitti_account_invited IS DISTINCT FROM OLD.mitti_account_invited
     AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the office can change the Mitti invite flag';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_mitti_invited ON public.businesses;
CREATE TRIGGER guard_mitti_invited BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.guard_mitti_invited();