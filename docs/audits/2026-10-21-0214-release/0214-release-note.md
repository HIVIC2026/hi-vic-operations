# 0214 release prerequisite: bounded preflight and atomic apply

Reviewed source: `1fb7a89d522490a14c88ff6bfa539ab76af7d1b3`, `docs/pending-migrations/0214_evidence_requirement_area_key.sql`.

The payload in `0214-reviewed.sql` is unchanged: **946 bytes**, SHA256 **`9524ea1570ab34a512704e8d764c1a67d5d35a0c1f5edf31bc2af027a4022450`**. The apply wrapper embeds those exact bytes. Do not replace the migration with a separately reconstructed version.

This is a routine additive schema repair, subject to the specific compatibility checks below. It adds nullable `area_key`, preserves existing records and IDs, and replaces job/category uniqueness with job/category/coalesced-area uniqueness. It changes no RLS policy, grants, table data, or accepted quote terms. A NULL job-level key remains unique. An empty key collides with NULL; application validation rejects empty keys.

## 1. Bounded repository compatibility review

Run from the current project root. These commands inspect code and SQL only. They select at most 64 relevant files, show candidate counts, and cap displayed matches at 20 per file. A count above 20 requires a bounded follow-up in that exact file; the display cap is not evidence that no other match exists. Search errors are failures, not empty results.

```bash
set -euo pipefail
hivic_req_filelist=$(mktemp)
trap 'rm -f "$hivic_req_filelist"' EXIT
if rg -l -0 --glob '*.{ts,tsx,js,mjs,cjs,sql}' \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!build/**' \
  --glob '!coverage/**' --glob '!tmp/**' --glob '!tests/**' \
  'evidence_requirements' . > "$hivic_req_filelist"; then
  :
else
  hivic_rg_status=$?
  if [ "$hivic_rg_status" -ne 1 ]; then exit "$hivic_rg_status"; fi
fi
mapfile -d '' hivic_req_files < "$hivic_req_filelist"
printf 'Evidence requirement candidate files: %s\n' "${#hivic_req_files[@]}"
if [ "${#hivic_req_files[@]}" -eq 0 ] || [ "${#hivic_req_files[@]}" -gt 64 ]; then
  printf 'STOP: confirm repository scope or narrow the candidate set explicitly.\n'
  exit 1
fi
printf '%s\n' "${hivic_req_files[@]}"
hivic_req_pattern='(?i)onConflict|on\s+conflict|\.upsert\s*\(|\.(single|maybeSingle)\s*\(|\.update\s*\(|\.delete\s*\(|\bupdate\s+("?public"?\s*\.\s*)?"?evidence_requirements"?|\bdelete\s+from\s+("?public"?\s*\.\s*)?"?evidence_requirements"?|\bwhere\b[^\n]{0,200}\bcategory\b|evidence_requirements_job_id_category_key'
rg -n --count-matches -U "$hivic_req_pattern" "${hivic_req_files[@]}" || [ "$?" -eq 1 ]
rg -n -U --max-count 20 -B 2 -A 4 "$hivic_req_pattern" "${hivic_req_files[@]}" || [ "$?" -eq 1 ]
rg -n --count-matches 'evidence_requirements' "${hivic_req_files[@]}" || [ "$?" -eq 1 ]
rg -n --max-count 20 'evidence_requirements' "${hivic_req_files[@]}" || [ "$?" -eq 1 ]
```

Review the evidence-table query chains represented by these matches, including any helper called by them. Required conclusions:

- No active `ON CONFLICT (job_id, category)` (either column order), named old-constraint conflict target, or PostgREST `onConflict: 'job_id,category'` remains. PostgreSQL rejects the old explicit target with **42P10** after 0214. Existing plain inserts and targetless `ON CONFLICT DO NOTHING` remain compatible.
- A job-level single-row lookup, update, or delete by job/category must explicitly constrain `area_key IS NULL`; area actions must use a requirement ID or exact area key. Existing multi-row reads must intentionally handle the new per-area rows. Do not assume every category match is a defect; identify the intended row set.
- Historical migrations are history, but the installed function definitions they created are still relevant. In the reviewed base schema, `seed_job_requirements()` uses plain INSERT and is compatible. Verify the installed definition and any later replacement using the next preflight.

## 2. Read-only installed-schema preflight

Use the existing securely configured database connection. `0214-preflight.sql` starts a read-only transaction with a 5-second lock timeout and a 30-second statement timeout. It returns only database identity, relevant schema metadata, dependency names, and installed public routine signatures/review flags. It does not return customer rows or routine bodies.

```bash
psql -X -v ON_ERROR_STOP=1 -f "$HIVIC_0214_DIR/0214-preflight.sql"
```

Set `HIVIC_0214_DIR` to the delivered package directory; do not put credentials into the command or its output. The already-configured migration executor can run the same SQL instead of psql.

Proceed only when the connection is the intended HIVIC database and these checks pass:

- The existing table and ID/job/category definitions match the expected schema. If `area_key` already exists, it must be nullable text with no default.
- The original named unique constraint is exactly job/category, nondeferrable and validated, or the verified replacement index is already installed. An unexplained missing original and missing replacement is a stop condition.
- No additional unfiltered unique job/category constraint or index remains to prohibit multiple areas. Review other unique definitions and every unexpected dependency on the original constraint/backing index. The original index's normal internal dependency is excluded from the report. Never add CASCADE.
- If the replacement name already exists, it must be a valid, ready, unique btree index on this table with exactly `(job_id, category, COALESCE(area_key, ''::text))`, no predicate and no included columns. A matching name alone is insufficient. The apply wrapper checks its structure before dropping the original constraint and checks again before COMMIT.
- Every returned public routine is accounted for. Flags identify old conflict targets, named-constraint references and category reads/updates requiring scope review; all other routines mentioning this table are also returned. Inspect flagged implementation privately as needed. The scan is a candidate review, not proof against arbitrarily constructed dynamic SQL. If either returned total exceeds 100, narrow and finish the review before applying.

## 3. Exact atomic application and readback

After the compatibility review and local area-regression tests pass, apply the wrapper using one connection. Keep area writes/publication gated until this succeeds: the area-save implementation writes its observation before creating requirements, so deploying writes ahead of this schema can leave an incomplete operation.

```bash
sha256sum "$HIVIC_0214_DIR/0214-reviewed.sql"
psql -X -v ON_ERROR_STOP=1 -f "$HIVIC_0214_DIR/0214-apply-transaction.sql"
```

The wrapper uses one explicit transaction, `lock_timeout = '5s'`, `statement_timeout = '30s'`, and a table lock to prevent schema/data races while uniqueness changes. It validates the old/new definitions, applies the exact reviewed payload, verifies the result, queues `NOTIFY pgrst, 'reload schema'`, and commits. The notification is delivered only on successful COMMIT. Catalog readback follows.

Any SQL error or timeout must stop execution. The transaction must roll back; in a persistent SQL session issue `ROLLBACK` immediately. `psql -X -v ON_ERROR_STOP=1` exits on error and closing its connection rolls back an open transaction. An executor that cannot guarantee same-connection transaction semantics and rollback must not split this script into independently committed statements. Resolve a blocked lock or unexpected schema explicitly; do not blindly retry or relax the guards.

After success, confirm the readback shows nullable text `area_key`, no old constraint, and the correct valid/ready unique index. Then make a bounded read through the app's existing configured PostgREST client, selecting `id,area_key` with `limit(0)`; this verifies schema-cache recognition without returning customer rows. A missing-column/schema-cache error remains a release blocker. Do not change authentication/RLS to force this check to pass.

Run the focused real-source local suite `bun test tests/ready-check-areas-db.test.ts` and the additional area/hold regressions supplied with the final corrections, then the normal build/type checks required by that correction bundle. The reviewed 11-test suite applies the real migration to PGlite and exercises the real area code; it mocks auth RPCs and is not a live RLS test. No broad portal run is required for this migration. Any separately required portal/Office run retains the existing `--personas rec,owner` exclusion; unavailable installer coverage remains explicit NOT_RUN.

## Local proof supplied

`verify-0214-atomic.mjs` executed against an isolated PGlite fixture: **5 passed, 0 failed**. `verification.json` records exact input hashes and results. Proof covers unchanged payload embedding; read-only public routine scan including quoted-schema/reversed/named-conflict cases with no routine body output; apply/reapply preserving original records, linked evidence files and RLS/policies; expected uniqueness and old-target 42P10 behavior; wrong existing index refusal; and an injected error after the reviewed DDL followed by ROLLBACK restoring the original schema, row and evidence link.

These local results establish SQL behavior in the fixture. The remote repository/installed-function compatibility check, live schema preflight, lock availability, actual apply outcome and PostgREST cache readback remain explicit remote checks. No live SQL was executed while preparing this package.
