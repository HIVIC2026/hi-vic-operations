import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.HIVIC_PGLITE_MODULE ?? new URL('../outlook-candidate/local-deps/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url).href);
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const payload = read('0214-reviewed.sql');
const apply = read('0214-apply-transaction.sql');
const preflight = read('0214-preflight.sql');
const hash = text => createHash('sha256').update(text).digest('hex');
assert.equal(Buffer.byteLength(payload), 946);
assert.equal(hash(payload), '9524ea1570ab34a512704e8d764c1a67d5d35a0c1f5edf31bc2af027a4022450');
assert.equal(apply.split('-- BEGIN REVIEWED MIGRATION PAYLOAD\n')[1].split('-- END REVIEWED MIGRATION PAYLOAD')[0], payload);

const fixture = `
CREATE TYPE public.evidence_category AS ENUM ('before_ceiling_space', 'completed_installation');
CREATE TYPE public.evidence_status AS ENUM ('outstanding', 'verified', 'not_required');
CREATE TABLE public.evidence_requirements (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  category public.evidence_category NOT NULL,
  label text NOT NULL,
  status public.evidence_status NOT NULL DEFAULT 'outstanding',
  UNIQUE (job_id, category)
);
CREATE TABLE public.evidence_files (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES public.evidence_requirements(id)
);
ALTER TABLE public.evidence_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_read ON public.evidence_requirements FOR SELECT USING (true);
INSERT INTO public.evidence_requirements (id,job_id,category,label,status)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','before_ceiling_space','Existing evidence','verified');
INSERT INTO public.evidence_files (id,requirement_id)
VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
`;
const databases = [];
async function dbFixture() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(fixture);
  return db;
}
async function rows(db, sql) { return (await db.query(sql)).rows; }
async function snapshot(db) {
  return {
    columns: await rows(db, `SELECT attname,atttypid::regtype::text AS type,attnotnull,atthasdef FROM pg_attribute WHERE attrelid='public.evidence_requirements'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`),
    requirements: await rows(db, `SELECT * FROM public.evidence_requirements ORDER BY id`),
    files: await rows(db, `SELECT * FROM public.evidence_files ORDER BY id`),
    constraints: await rows(db, `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.evidence_requirements'::regclass,'public.evidence_files'::regclass) ORDER BY conname`),
    indexes: await rows(db, `SELECT indexrelid::regclass::text AS name,indisunique,indisvalid,indisready,pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid='public.evidence_requirements'::regclass ORDER BY name`),
    security: await rows(db, `SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.evidence_requirements'::regclass`),
    policies: await rows(db, `SELECT polname,polcmd,polroles,pg_get_expr(polqual,polrelid) AS qual FROM pg_policy WHERE polrelid='public.evidence_requirements'::regclass ORDER BY polname`),
  };
}
const checks = [];
async function check(name, action) {
  const result = await action();
  checks.push({ name, passed: true, ...(result ?? {}) });
  process.stdout.write(`PASS ${name}\n`);
}
async function errorCode(db, sql, expected) {
  try { await db.exec(sql); assert.fail(`Expected SQLSTATE ${expected}`); }
  catch (error) { assert.equal(error.code, expected); return error.code; }
}

try {
  await check('exact payload embedded unchanged', async () => ({ bytes: Buffer.byteLength(payload), sha256: hash(payload) }));

  await check('bounded read-only preflight detects legacy public callers without emitting bodies', async () => {
    const db = await dbFixture();
    await db.exec(`
      CREATE FUNCTION public.fixture_legacy_conflict() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.evidence_requirements (id,job_id,category,label)
        VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','before_ceiling_space','fixture')
        ON CONFLICT (job_id, category) DO NOTHING;
      END $$;
      CREATE FUNCTION public.fixture_legacy_reversed() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.evidence_requirements (id,job_id,category,label)
        VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','before_ceiling_space','fixture')
        ON CONFLICT ("category", "job_id") DO NOTHING;
      END $$;
      CREATE FUNCTION public.fixture_named_conflict() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.evidence_requirements (id,job_id,category,label)
        VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','before_ceiling_space','fixture')
        ON CONFLICT ON CONSTRAINT evidence_requirements_job_id_category_key DO NOTHING;
      END $$;
      CREATE FUNCTION public.fixture_category_read(job_id uuid, category public.evidence_category) RETURNS bigint LANGUAGE sql AS $$
        SELECT count(*) FROM "public"."evidence_requirements" r WHERE r.job_id=$1 AND r.category=$2;
      $$;
      CREATE FUNCTION public.fixture_category_update(job_id uuid, category public.evidence_category) RETURNS void LANGUAGE sql AS $$
        UPDATE "public"."evidence_requirements" SET label='fixture' WHERE evidence_requirements.job_id=$1 AND evidence_requirements.category=$2;
      $$;
      CREATE FUNCTION public.fixture_safe_insert() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.evidence_requirements (id,job_id,category,label)
        VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','before_ceiling_space','DO_NOT_RETURN_ROUTINE_BODY');
      END $$;
      CREATE SCHEMA fixture_private;
      CREATE FUNCTION fixture_private.fixture_hidden() RETURNS text LANGUAGE sql AS $$ SELECT 'evidence_requirements PRIVATE_ROUTINE_BODY'::text $$;
    `);
    const before = await snapshot(db);
    const output = await db.exec(preflight);
    assert.deepEqual(await snapshot(db), before);
    const routineRows = output.flatMap(result => result.rows ?? []).filter(row => 'routine_signature' in row);
    assert.equal(routineRows.length, 6);
    const find = name => routineRows.find(row => row.routine_signature.startsWith(`public.${name}(`));
    assert.equal(find('fixture_legacy_conflict').old_conflict_target, true);
    assert.equal(find('fixture_legacy_reversed').old_conflict_target, true);
    assert.equal(find('fixture_named_conflict').old_constraint_reference, true);
    assert.equal(find('fixture_category_read').category_read_needs_scope_review, true);
    assert.equal(find('fixture_category_update').category_update_needs_scope_review, true);
    assert.equal(find('fixture_safe_insert').old_conflict_target, false);
    assert.ok(routineRows.every(row => row.total_candidate_routines === 6));
    assert.doesNotMatch(JSON.stringify(output), /DO_NOT_RETURN_ROUTINE_BODY|PRIVATE_ROUTINE_BODY|CREATE FUNCTION/);
    return { matching_public_routines: routineRows.length, private_routine_excluded: true };
  });

  await check('apply and reapply preserve records, linked files and RLS while supporting areas', async () => {
    const db = await dbFixture();
    const before = await snapshot(db);
    await db.exec(apply);
    const first = await snapshot(db);
    assert.deepEqual(first.requirements, before.requirements.map(row => ({ ...row, area_key: null })));
    assert.deepEqual(first.files, before.files);
    assert.deepEqual(first.security, before.security);
    assert.deepEqual(first.policies, before.policies);
    assert.deepEqual(first.constraints.filter(row => row.conname !== 'evidence_requirements_job_id_category_key'), before.constraints.filter(row => row.conname !== 'evidence_requirements_job_id_category_key'));
    assert.equal(first.constraints.some(row => row.conname === 'evidence_requirements_job_id_category_key'), false);
    await db.exec(apply);
    assert.deepEqual(await snapshot(db), first);
    await db.exec(`INSERT INTO public.evidence_requirements (id,job_id,category,label,area_key) VALUES
      ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','before_ceiling_space','Main','main'),
      ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','before_ceiling_space','Garage','garage')`);
    const insert = key => `INSERT INTO public.evidence_requirements (id,job_id,category,label,area_key) VALUES ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','before_ceiling_space','Duplicate',${key})`;
    const codes = {
      duplicate_job: await errorCode(db, insert('NULL'), '23505'),
      duplicate_area: await errorCode(db, insert("'main'"), '23505'),
      empty_collides_with_null: await errorCode(db, insert("''"), '23505'),
      old_conflict_target: await errorCode(db, `${insert('NULL')} ON CONFLICT (job_id,category) DO NOTHING`, '42P10'),
    };
    await db.exec(`${insert('NULL')} ON CONFLICT DO NOTHING`);
    assert.equal((await rows(db, 'SELECT count(*) AS count FROM public.evidence_requirements'))[0].count, 3);
    return { applied_twice: true, error_codes: codes, area_rows_plus_original: 3 };
  });

  await check('wrong existing replacement index aborts before any schema or data change', async () => {
    const db = await dbFixture();
    await db.exec('CREATE INDEX evidence_requirements_job_category_area_key ON public.evidence_requirements(job_id)');
    const before = await snapshot(db);
    await assert.rejects(db.exec(apply), /existing replacement index is wrong or invalid/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await snapshot(db), before);
    return { original_unique_constraint_preserved: true, existing_row_and_file_preserved: true };
  });

  await check('forced error after reviewed DDL atomically rolls back the added column and dropped constraint', async () => {
    const db = await dbFixture();
    const before = await snapshot(db);
    const forced = apply.replace('-- END REVIEWED MIGRATION PAYLOAD', "-- END REVIEWED MIGRATION PAYLOAD\nDO $forced$ BEGIN RAISE EXCEPTION 'fixture forced post-DDL failure'; END $forced$;");
    await assert.rejects(db.exec(forced), /fixture forced post-DDL failure/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await snapshot(db), before);
    return { column_addition_rolled_back: true, original_unique_constraint_restored: true, row_and_file_preserved: true };
  });

  const proof = {
    kind: 'isolated PGlite execution; no live SQL or real accounts',
    payload_bytes: Buffer.byteLength(payload),
    payload_sha256: hash(payload),
    preflight_sha256: hash(preflight),
    apply_wrapper_sha256: hash(apply),
    passed: checks.length,
    failed: 0,
    checks,
    limits: ['Minimal original-schema fixture, not a copy of the live database.', 'Does not establish live caller compatibility, lock availability or deployed PostgREST schema-cache readiness.'],
  };
  writeFileSync(new URL('verification.json', import.meta.url), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: checks.length, failed: 0, proof: fileURLToPath(new URL('verification.json', import.meta.url)) })}\n`);
} finally {
  await Promise.all(databases.map(db => db.close()));
}
