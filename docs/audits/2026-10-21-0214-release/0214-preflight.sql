-- Read-only, bounded preflight for HIVIC migration 0214. No table data or routine bodies are returned.
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Confirm the configured connection is the intended HIVIC database before continuing.
SELECT current_database() AS database_name, current_user AS database_role;

SELECT c.oid::regclass AS relation, c.relkind, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c WHERE c.oid = to_regclass('public.evidence_requirements');

SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null, a.atthasdef AS has_default
FROM pg_attribute a
WHERE a.attrelid = to_regclass('public.evidence_requirements')
  AND a.attnum > 0 AND NOT a.attisdropped
  AND a.attname IN ('id', 'job_id', 'category', 'area_key')
ORDER BY a.attnum;

-- Review all uniqueness/primary-key definitions on this one table.
SELECT c.conname, c.contype, c.condeferrable, c.convalidated,
  pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint c
WHERE c.conrelid = to_regclass('public.evidence_requirements') AND c.contype IN ('u', 'p')
ORDER BY c.conname;

-- Include the expected name even if it belongs to the wrong table or is not an index.
SELECT c.oid::regclass AS object_name, c.relkind,
  i.indrelid::regclass AS indexed_table, i.indisunique, i.indisvalid, i.indisready,
  CASE WHEN c.relkind IN ('i', 'I') THEN pg_get_indexdef(c.oid) END AS definition
FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.oid = to_regclass('public.evidence_requirements_job_category_area_key')
   OR i.indrelid = to_regclass('public.evidence_requirements')
ORDER BY c.relname;

-- The backing index's normal INTERNAL dependency is excluded. Any other dependency needs review.
WITH old_key AS (
  SELECT oid, conindid FROM pg_constraint
  WHERE conrelid = to_regclass('public.evidence_requirements')
    AND conname = 'evidence_requirements_job_id_category_key'
)
SELECT d.deptype, pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object,
  count(*) OVER () AS total_dependencies
FROM pg_depend d JOIN old_key k ON
  (d.refclassid = 'pg_constraint'::regclass AND d.refobjid = k.oid)
  OR (d.refclassid = 'pg_class'::regclass AND d.refobjid = k.conindid)
WHERE NOT (d.classid = 'pg_class'::regclass AND d.objid = k.conindid AND d.deptype = 'i')
ORDER BY dependent_object
LIMIT 100;

-- Materialize the kind filter so pg_get_functiondef is never called on an aggregate.
-- Inspect routine definitions internally, but return only names/signatures and review flags.
WITH routines AS MATERIALIZED (
  SELECT p.oid, format('%I.%I(%s)', n.nspname, p.proname,
    pg_get_function_identity_arguments(p.oid)) AS routine_signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
), definitions AS MATERIALIZED (
  SELECT routine_signature, pg_get_functiondef(oid) AS body FROM routines
), flags AS (
  SELECT routine_signature,
    body ~* $rx$on[[:space:]]+conflict[[:space:]]*\([[:space:]]*"?job_id"?[[:space:]]*,[[:space:]]*"?category"?[[:space:]]*\)|on[[:space:]]+conflict[[:space:]]*\([[:space:]]*"?category"?[[:space:]]*,[[:space:]]*"?job_id"?[[:space:]]*\)$rx$ AS old_conflict_target,
    body ILIKE '%evidence_requirements_job_id_category_key%' AS old_constraint_reference,
    (body ~* $rx$(from|join)[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?evidence_requirements"?$rx$
      AND body ~* $rx$\mjob_id\M$rx$ AND body ~* $rx$\mcategory\M$rx$) AS category_read_needs_scope_review,
    (body ~* $rx$update[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?evidence_requirements"?$rx$
      AND body ~* $rx$\mcategory\M$rx$) AS category_update_needs_scope_review
  FROM definitions
  WHERE body ILIKE '%evidence_requirements%'
)
SELECT routine_signature, old_conflict_target, old_constraint_reference,
  category_read_needs_scope_review, category_update_needs_scope_review,
  count(*) OVER () AS total_candidate_routines
FROM flags
ORDER BY routine_signature
LIMIT 100;
COMMIT;
