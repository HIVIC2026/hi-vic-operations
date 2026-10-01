# Draft migration run: 0071, 0072, 0073

The "Launch-control parity" draft is already working on this, with its own isolated database. This plan adds your conditions to that work.

## In the draft only
1. Apply 0071, then 0072, then 0073, one at a time and in order, using the original SQL unchanged.
2. Report one line per migration:
   - whether it applied cleanly
   - objects created or altered
   - grants changed
   - RLS policies changed
   - any warning or error
3. If a migration fails, stop there. Report what the draft database looks like at that point. No workarounds.
4. After all three, check in the draft database:
   - the launch tables exist
   - each control's default mode is OFF
   - the inherited service-role write grants are revoked
   - a direct change to a mode is refused, and the same change succeeds only through the audited function, which writes an audit row
5. Run the full test suite on the merged code (baseline 835 pass / 3 known fails), along with the focused stage-gate, external-boundary and PostgreSQL tests, the typecheck and the build.

## Hold point
- Do not accept the draft into live. You review the migration results and test numbers first.
- No publishing, sending, charging, lodging or turning on automation.
