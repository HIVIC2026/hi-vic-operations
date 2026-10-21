-- STAGED PROPOSAL ONLY — DO NOT APPLY.
-- Requires explicit notice/approval and a verified recoverable backup/PITR target.
-- Before any apply, verify both names are absent and record the live migration baseline.
-- Stop if either name already exists: IF NOT EXISTS does not verify its definition.
-- Do not register or change the Drizzle journal until an authorised controlled apply.
CREATE INDEX IF NOT EXISTS documents_job_id_kind_idx ON public.documents USING btree(job_id,kind);
CREATE INDEX IF NOT EXISTS evidence_files_job_id_idx ON public.evidence_files USING btree(job_id);