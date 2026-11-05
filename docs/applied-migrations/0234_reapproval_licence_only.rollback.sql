-- Rollback for 0234: restores the drizzle 0072 body (any identity change re-pends approval).
CREATE OR REPLACE FUNCTION public.repend_worker_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.full_legal_name,NEW.email,NEW.mobile,NEW.licence_number,NEW.qualification,NEW.trade_role)
 IS DISTINCT FROM ROW(OLD.full_legal_name,OLD.email,OLD.mobile,OLD.licence_number,OLD.qualification,OLD.trade_role) THEN
  NEW.approval_status='pending'; NEW.approved_at=NULL; NEW.approved_by=NULL;
 END IF;
 RETURN NEW;
END $$;
