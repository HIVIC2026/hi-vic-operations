-- Launch blocker Task 8 (QA 7 Nov 2026) — DATA FIX, PROPOSAL ONLY, NOT APPLIED. Jo approves before it runs live.
-- Installers (and electricians' no-login links) can read every NON-internal workflow_events row on their jobs (RLS
-- "job_access_non_internal", drizzle 0000). Older history rows carry the owner's price ("Invoice raised … 4321.00 inc
-- GST", quote accepted {"total_inc_gst":4321}, …). The code now writes these internal (xero.server, portal.functions,
-- repeat-piesa.server); this marks the existing ones internal too. Nothing else changes: summary/details untouched, no
-- row deleted; the office still sees every row. workflow_events is append-only (trigger workflow_events_immutable), so
-- the trigger is switched off for this one UPDATE only, inside one transaction (same as drizzle 0195).
-- Read back first — the number of rows this will hide from trades (run on its own):
-- PREVIEW: SELECT count(*)::int AS n FROM public.workflow_events WHERE internal = false AND ((event_type = 'invoice_created_local' AND (summary ILIKE '%inc GST%' OR details ? 'total_inc_gst')) OR (event_type = 'QUOTE_ACCEPTED' AND details ? 'total_inc_gst') OR (event_type = 'rectification_scope_approved' AND summary ILIKE '%inc GST%') OR (event_type = 'deposit_paid' AND (summary LIKE 'Safety check payment confirmed in Xero (%' OR details ? 'amount_paid')) OR (event_type = 'repeat_piesa_accepted' AND summary ILIKE '%inc GST%') OR (event_type = 'rectification_item_priced' AND details ? 'unit_price_inc_gst') OR (event_type = 'installer_quoted_answer' AND summary LIKE 'Installer quoted $%'));
-- Proven on PGlite by tests/trade-history-no-prices.test.ts (real policy text + trigger). Re-running is a no-op.
BEGIN;
ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable;
UPDATE public.workflow_events SET internal = true
WHERE internal = false AND ((event_type = 'invoice_created_local' AND (summary ILIKE '%inc GST%' OR details ? 'total_inc_gst')) OR (event_type = 'QUOTE_ACCEPTED' AND details ? 'total_inc_gst') OR (event_type = 'rectification_scope_approved' AND summary ILIKE '%inc GST%') OR (event_type = 'deposit_paid' AND (summary LIKE 'Safety check payment confirmed in Xero (%' OR details ? 'amount_paid')) OR (event_type = 'repeat_piesa_accepted' AND summary ILIKE '%inc GST%') OR (event_type = 'rectification_item_priced' AND details ? 'unit_price_inc_gst') OR (event_type = 'installer_quoted_answer' AND summary LIKE 'Installer quoted $%'));
ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;
COMMIT;
