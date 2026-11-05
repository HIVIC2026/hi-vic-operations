-- APPLIED LIVE 5 Nov 2026 ~21:25 AEDT (Jo: "Yes get rid of it" / "Everything except licence").
-- Before: any change to name, email, mobile, licence number, qualification or trade put a partner worker back to
-- approval_status 'pending' (drizzle 0072 repend_worker_identity). Jo hit this adding an email to an approved electrician.
-- After: only a licence number change re-pends. Trigger worker_identity_reapproval is unchanged; only the function body.
-- Rollback: 0234_reapproval_licence_only.rollback.sql (the 0072 body).
CREATE OR REPLACE FUNCTION public.repend_worker_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Jo 5 Nov 2026: only a licence number change sends a person back to office approval.
 -- Name, email, mobile, qualification and trade edits keep the existing approval.
 IF NEW.licence_number IS DISTINCT FROM OLD.licence_number THEN
  NEW.approval_status='pending'; NEW.approved_at=NULL; NEW.approved_by=NULL;
 END IF;
 RETURN NEW;
END $$;
