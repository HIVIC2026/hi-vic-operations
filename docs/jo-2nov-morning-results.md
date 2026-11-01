# Jo 2 Nov morning decisions — results

No settings, secrets, live records, database changes, sends or publishing. SELECTORS_VERIFIED remains untouched/off.

1. Owner deposit receipt is email only. Request/reminder texts unchanged; receipt assertions now require zero SMS.
2. Both requested Book blockers use Jo's exact wording.
3. Installer Team addition asks for required DOB; private identity storage and atomic creation are pending in `docs/pending-migrations/2026-11-02_private_worker_birth_dates.sql`. HIV office person row shows DOB beside ESC registration and Needs me says Register {name} with ESC, clearing on registration. Practice database proves HIV office/own business admin reads and refuses the other business user. Existing worker qualification initialization retained. **Pending SQL is not applied: adding installers now explains that the private-details database update is required, rather than saving DOB unsafely.** Existing people without recorded DOB are shown as Not recorded; no backfill or edit-existing-DOB workflow was added. Own-business admin access is authorized by RLS; DOB is not returned on ordinary Team lists.
4. Post-lodged swaps record urgent office work with exact alert text and regenerate ESC update work. Pre-notice swaps record history but no extra flag/alert. Hold begins at scheduled install instant, not the start of that calendar day. Related before/after-notice fixture tests and SIM pass; providers captured only.
5. Repo guide `docs/official-forms/ESC-Ceiling-Insulation-Activity-Guide-v1.2-20261001.docx` §3.3.3 says: “Accredited persons may update a notification record if: the scheduled installation date and time has not passed; the original installation notification has not been withdrawn. The notification identification (ID) stays the same when a notification record is updated.” Updatable fields include “scheme participant (lead installer)”. Therefore unchanged-start Lead-only updates do not require a new 24-hour window. Changed-start/new-notice rules remain. Same-ID update preserves the original sent timestamp; robot remains selectors-gated and office still updates manually. Guide revision is 1 Oct v1.2; the separate 30 July announcement was not independently checked. Pure robot plan and captured queue checks pass; supervised external robot run NOT RUN.

## Test evidence

- Red-first booking/receipt and registry tests failed before fixes.
- Final focused identity/PGlite/core/error checks: 11 pass, 0 fail.
- Booking server: 7 pass, 0 fail (before/after-lodged swap capture included).
- Final SIM: 14 pass, 0 fail, 5 existing TODOs; not a complete whole-job proof.
- Trade-business speed: 15 pass; role/crew: 13 pass; both zero failures.
- Complete isolated comparison: baseline 1002 files, 10068 pass / 243 fail / 5 TODO, 97 failing files. Final 1006 files, 10077 pass / 243 fail / 5 TODO, same 97 failing files. **No new failing files.** Both exclude register-interest-validation and save-spot-uncertain-delivery known stallers identically.
- Four intermediate new fixture failures were repaired/rechecked, then entire suite rerun: SIM expectation, Team error mapping, trade view parity/speed, role-switch parity. No snapshot rewrite.
- Automatic final checks: build OK. No authenticated live UI/mutation/delivery verification under no-live-change/no-send restrictions.

Changed implementation files: deposit-request.server, in-house-booking.core/server/notices.server, worker-identity.core/server, trade-view.core/server/functions, office-partners.server, office-needs.server, esc.core/server, esc-registry-robot.core/server, field.business_.team route, partner-people component. Tests and pending SQL accompany these; existing Task 7/SIM expectations changed for the new receipt/timing rules. Failed-file names can be reproduced from the full isolated suite; the set is unchanged from tonight's start.