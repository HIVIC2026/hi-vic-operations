-- Outer safety wrapper; the reviewed 946-byte migration is embedded unchanged below.
-- Run only after the repository/function compatibility review and existing schema preflight pass.
-- Use a runner that stops on error and rolls back; for a persistent session, issue ROLLBACK on any error.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.evidence_requirements IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  target_table regclass := to_regclass('public.evidence_requirements');
  replacement_index regclass := to_regclass('public.evidence_requirements_job_category_area_key');
  old_key pg_constraint%ROWTYPE;
  job_att smallint;
  category_att smallint;
  index_ok boolean := false;
  kind "char";
BEGIN
  IF target_table IS NULL THEN RAISE EXCEPTION '0214: evidence_requirements is missing'; END IF;
  SELECT attnum INTO job_att FROM pg_attribute WHERE attrelid=target_table AND attname='job_id' AND NOT attisdropped AND attnotnull;
  SELECT attnum INTO category_att FROM pg_attribute WHERE attrelid=target_table AND attname='category' AND NOT attisdropped AND attnotnull;
  IF job_att IS NULL OR category_att IS NULL THEN RAISE EXCEPTION '0214: expected non-null job/category columns are missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=target_table AND attname='area_key' AND NOT attisdropped
      AND (atttypid <> 'text'::regtype OR attnotnull OR atthasdef)
  ) THEN RAISE EXCEPTION '0214: existing area_key is not nullable text without a default'; END IF;

  SELECT * INTO old_key FROM pg_constraint
    WHERE conrelid=target_table AND conname='evidence_requirements_job_id_category_key';
  IF old_key.oid IS NOT NULL AND
    (old_key.contype <> 'u' OR old_key.condeferrable OR NOT old_key.convalidated
      OR cardinality(old_key.conkey) <> 2 OR NOT old_key.conkey @> ARRAY[job_att,category_att]::smallint[])
  THEN RAISE EXCEPTION '0214: existing named constraint has an unexpected definition'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid=target_table AND contype='u'
      AND conname <> 'evidence_requirements_job_id_category_key'
      AND cardinality(conkey)=2 AND conkey @> ARRAY[job_att,category_att]::smallint[]
  ) THEN RAISE EXCEPTION '0214: another job/category unique constraint requires review'; END IF;

  IF replacement_index IS NOT NULL THEN
    SELECT relkind INTO kind FROM pg_class WHERE oid=replacement_index;
    IF kind <> 'i' THEN RAISE EXCEPTION '0214: replacement index name belongs to a different object'; END IF;

  SELECT i.indrelid = target_table AND i.indisunique AND i.indisvalid AND i.indisready
    AND am.amname = 'btree' AND i.indnkeyatts = 3 AND i.indnatts = 3 AND i.indpred IS NULL
    AND pg_get_indexdef(i.indexrelid, 1, true) = 'job_id'
    AND pg_get_indexdef(i.indexrelid, 2, true) = 'category'
    AND pg_get_indexdef(i.indexrelid, 3, true) = $expr$COALESCE(area_key, ''::text)$expr$
  INTO index_ok
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_am am ON am.oid = c.relam
  WHERE i.indexrelid = replacement_index;

    IF NOT coalesce(index_ok,false) THEN RAISE EXCEPTION '0214: existing replacement index is wrong or invalid'; END IF;
  ELSIF old_key.oid IS NULL THEN
    RAISE EXCEPTION '0214: neither expected original constraint nor verified replacement index exists';
  END IF;

  -- Reject an additional unfiltered two-column unique index, which would still prevent per-area rows.
  IF EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indrelid=target_table AND i.indisunique
      AND i.indnkeyatts=2 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND (i.indkey[0]=job_att AND i.indkey[1]=category_att OR i.indkey[0]=category_att AND i.indkey[1]=job_att)
      AND i.indexrelid <> coalesce(old_key.conindid,0::oid)
  ) THEN RAISE EXCEPTION '0214: another job/category unique index requires review'; END IF;
END
$guard$;

-- BEGIN REVIEWED MIGRATION PAYLOAD
-- 0214 — per-ceiling-area evidence requirements (installer two-route repair, 20 Oct 2026).
-- STATUS: authored + practice-tested on PGlite (tests/ready-check-areas-db.test.ts). NOT applied live. Release prerequisite
-- for saving Ready Check ceiling areas. Additive: existing rows keep area_key NULL; no backfill.
-- Job-level uniqueness is unchanged for area_key NULL rows (one row per job+category), so existing inserts behave the same.
ALTER TABLE public.evidence_requirements ADD COLUMN IF NOT EXISTS area_key text;
COMMENT ON COLUMN public.evidence_requirements.area_key IS 'Ready Check ceiling area key (ready_check_observations areas.v1); NULL = job-level requirement';
ALTER TABLE public.evidence_requirements DROP CONSTRAINT IF EXISTS evidence_requirements_job_id_category_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_requirements_job_category_area_key ON public.evidence_requirements (job_id, category, (coalesce(area_key, '')));
-- END REVIEWED MIGRATION PAYLOAD

DO $verify$
DECLARE
  target_table regclass := 'public.evidence_requirements'::regclass;
  replacement_index regclass := to_regclass('public.evidence_requirements_job_category_area_key');
  index_ok boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=target_table AND attname='area_key'
      AND NOT attisdropped AND atttypid='text'::regtype AND NOT attnotnull AND NOT atthasdef
  ) THEN RAISE EXCEPTION '0214: final area_key definition is wrong'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid=target_table AND conname='evidence_requirements_job_id_category_key'
  ) THEN RAISE EXCEPTION '0214: old uniqueness constraint remains'; END IF;

  SELECT i.indrelid = target_table AND i.indisunique AND i.indisvalid AND i.indisready
    AND am.amname = 'btree' AND i.indnkeyatts = 3 AND i.indnatts = 3 AND i.indpred IS NULL
    AND pg_get_indexdef(i.indexrelid, 1, true) = 'job_id'
    AND pg_get_indexdef(i.indexrelid, 2, true) = 'category'
    AND pg_get_indexdef(i.indexrelid, 3, true) = $expr$COALESCE(area_key, ''::text)$expr$
  INTO index_ok
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_am am ON am.oid = c.relam
  WHERE i.indexrelid = replacement_index;

  IF NOT coalesce(index_ok,false) THEN RAISE EXCEPTION '0214: final replacement index is wrong or invalid'; END IF;
END
$verify$;

-- Notification is delivered only on successful COMMIT.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Catalog readback: no customer rows are read or changed.
SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS data_type, a.attnotnull, a.atthasdef
FROM pg_attribute a WHERE a.attrelid='public.evidence_requirements'::regclass AND a.attname='area_key' AND NOT a.attisdropped;
SELECT i.indisunique, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i WHERE i.indexrelid=to_regclass('public.evidence_requirements_job_category_area_key');
