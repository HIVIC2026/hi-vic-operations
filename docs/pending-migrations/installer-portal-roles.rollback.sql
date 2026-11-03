-- Rollback for installer-portal-roles.sql. Office people lose access (kept as history, switched off); the checks go back to
-- how they were. The 'office' value stays in the assignment_role enum (Postgres cannot drop an enum value; it is harmless).
DROP FUNCTION IF EXISTS public.set_member_can_see_money(uuid,uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text);
UPDATE public.business_members SET active=false WHERE member_role='office';
ALTER TABLE public.business_members DROP CONSTRAINT IF EXISTS business_members_member_role_check;
ALTER TABLE public.business_members ADD CONSTRAINT business_members_member_role_check CHECK (member_role IN ('business_admin','member')) NOT VALID;
ALTER TABLE public.business_members DROP COLUMN IF EXISTS can_see_money;
ALTER TABLE public.partner_workers DROP CONSTRAINT IF EXISTS partner_workers_trade_role_needs_check;
ALTER TABLE public.partner_workers ADD CONSTRAINT partner_workers_trade_role_needs_check CHECK (
  (trade_role = 'electrician' AND licence_number IS NOT NULL) OR (trade_role = 'installer' AND qualification IS NOT NULL) OR trade_role = 'property_manager') NOT VALID;
