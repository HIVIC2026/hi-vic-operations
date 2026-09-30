DROP POLICY IF EXISTS "read_businesses" ON public.businesses;
CREATE POLICY "admins and members read businesses"
ON public.businesses
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.business_id = businesses.id
  )
);

DROP POLICY IF EXISTS "read_settings" ON public.workflow_settings;
CREATE POLICY "admins read workflow settings"
ON public.workflow_settings
FOR SELECT
TO authenticated
USING (public.is_admin());