# Test 0071–0073 in a throwaway local database

The draft shared the live database, so it changed nothing. It also couldn't see the ZIP. All of this work now runs inside a temporary area here. The live app, the live database and the project files stay untouched until you've reviewed the results.

## Steps
1. **Temporary database:** start a throwaway local PostgreSQL, add the minimal roles and helper pieces the migrations expect (authenticated, anon, service_role and a stub auth schema), and apply migrations 0001–0070 to rebuild the current structure. If that rebuild fails, stop and report.
2. **Migrations, one at a time:** apply 0071, then 0072, then 0073, using the SQL from the patch unchanged. For each, report in one line:
   - whether it applied cleanly
   - objects created or altered
   - grants changed
   - RLS policies changed
   - any warning or error

   Stop at the first failure and report the database state at that point.
3. **Verify:**
   - the launch tables exist
   - each control's default mode is OFF
   - the service-role write grants are revoked
   - a direct mode change is refused, and the same change through the audited function succeeds and writes an audit row
4. **Merged code, in a temporary copy:** copy the current project, apply the patch file by file, and merge the 4 newer files by hand (calculator, register-interest, coverage, installer invoices). Then run the full tests (baseline 835 pass / 3 known fails), the stage-gate, external-boundary and PostgreSQL tests (against the throwaway database), the typecheck and the build.
5. **Report:** migration results, test numbers, the 4 merges and any new issues, plus a verdict.

## Hold point
- The project, the draft and live stay unchanged. Nothing is accepted, applied to live or published until you approve.
- A local rebuild proves the structure, not live data. Where it differs from live, I'll say so.
