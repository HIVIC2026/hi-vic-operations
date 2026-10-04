-- Bulk installer import (slim): batches of installer-supplied jobs uploaded in one go.
-- Installer portal and office (on behalf) both use these tables. Nothing customer-facing is sent.

CREATE TABLE public.bulk_import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  created_by uuid not null,
  on_behalf boolean not null default false, -- true when the office uploads for the installer
  status text not null default 'draft' check (status in ('draft','analysed','confirmed','discarded')),
  list_filename text,
  file_manifest jsonb not null default '[]'::jsonb, -- [{path,name,type,size,folder,gps_lat,gps_lng,taken_at}]
  summary jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.bulk_import_batches TO authenticated;
GRANT ALL ON public.bulk_import_batches TO service_role;
ALTER TABLE public.bulk_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin full access" ON public.bulk_import_batches FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "installer members manage own batches" ON public.bulk_import_batches FOR ALL TO authenticated
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

CREATE TABLE public.bulk_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bulk_import_batches(id) on delete cascade,
  row_index integer not null,
  extracted jsonb not null default '{}'::jsonb, -- {full_name,email,phone,address_line,suburb,postcode,area_m2,existing_insulation,access,notes,price_inc_gst}
  matched_files jsonb not null default '[]'::jsonb, -- [{path,name,how}]
  match_confidence text check (match_confidence in ('high','low','none')),
  sort_result text check (sort_result in ('ready_to_quote','needs_visit','office_review')),
  sort_reasons jsonb not null default '[]'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb, -- official Ready Check evidence still needed (install-day task list source)
  duplicate_note text, -- set when the address/email already exists in the portal
  status text not null default 'pending' check (status in ('pending','confirmed','skipped')),
  job_id uuid references public.jobs(id),
  created_at timestamptz not null default now()
);
CREATE INDEX bulk_import_rows_batch ON public.bulk_import_rows(batch_id);
GRANT SELECT, INSERT, UPDATE ON public.bulk_import_rows TO authenticated;
GRANT ALL ON public.bulk_import_rows TO service_role;
ALTER TABLE public.bulk_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin full access" ON public.bulk_import_rows FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "installer members manage own rows" ON public.bulk_import_rows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bulk_import_batches b WHERE b.id = batch_id AND public.is_business_member(b.business_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bulk_import_batches b WHERE b.id = batch_id AND public.is_business_member(b.business_id)));