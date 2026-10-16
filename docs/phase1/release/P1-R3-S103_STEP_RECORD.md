# P1-R3-S103 — STEP RECORD

**Step:** P1-R3-S103 · **Agent:** R3 — Application & Integration Engineer
**Baseline:** `e121da4aa6755c2d696c94a859c5f5b33b86f61b` (S102 final correction)
**Branch:** `r3/p1-s103-office-rules` · **Worktree:** `../wt-r3-p1-s103-office-rules`
**Report:** `docs/phase1/release/P1-R3-S103_OFFICE_CONFIGURABLE_AUTOMATIC_SENDING.md`

---

## Isolation

- Worktree created from `e121da4aa6755c2d696c94a859c5f5b33b86f61b`; HEAD verified before any change.
- No frozen RC1 worktree and no R1/R2/R6 worktree was modified.
- `node_modules` symlinked (shared dependency install), as in S102.
- Temporary build caches created by the IDE safe-delete guard (`.nitro_prev_s103*`, `.output_prev_s103*`)
  were moved to `../.s103-build-caches/` and are outside every worktree. Pre-existing caches from S93/S102
  were left untouched.

---

## Work performed

1. **Investigation first** (per instruction) — Office UI and navigation, Save My Spot screens, filtering
   components, settings/configuration storage, roles/permissions, audit mechanism, automatic sending entry
   point, the S102 gates, and the CRM schema/enum values. Recorded in report §2.
2. **Implementation plan derived from the repository** — reused `workflow_settings` singleton + `jsonb`
   (the `sms_message_switches` precedent), `requireAdmin`, `admin_config_events`, the existing settings-page
   pattern, and the existing single route selector. No new customer classification, no repurposed column.
3. **Pure core** `save-spot-rules.core.ts` — validation, AND/OR matching, mandatory lifecycle exclusions.
4. **Server layer** `save-spot-rules.server.ts` — fail-closed reader, save preparation, the selection gate,
   the read-only preview.
5. **Server functions** `save-spot-rules.functions.ts` — four admin-only functions with audit.
6. **Office screen** `/admin/save-my-spot-rules` + navigation registration.
7. **Live integration** into `maybeAutoRouteLeadEmail → offer_spot → sendSaveMySpot`.
8. **Proposed migration** 0206 (SQL + rollback), **not applied**, plus the `types.ts` declaration.
9. **Tests** — 64 focused tests; four existing automatic-send suites updated to seed an explicitly enabled
   document (no assertion weakened).
10. **Verification** — isolated regression, TypeScript, build, client-bundle scan.
11. **Documentation** — this record and the report.

---

## Decisions made (and why)

| Decision | Rationale |
|---|---|
| One `jsonb` column on the existing singleton, not a new table | `workflow_settings` has no generic config mechanism; both existing `jsonb` columns are owned by other features; one column is the smallest safe change and mirrors `sms_message_switches`. |
| `enabled` inside the document, not a second column | One atomic write: the rules and their on/off state can never disagree. |
| Default `'{}'` = not configured = never auto-send | Makes the feature fail closed before the migration is applied, with no separate "off" flag to forget. |
| `activatedAt` re-stamped on every off→on transition | A rule change can never sweep a historical backlog. |
| Gate does **not** re-check COM-04 / consent / idempotency / test boundary | `sendOne` owns them and runs immediately afterwards. Re-implementing them would duplicate one safety rulebook and change the `route`/`reason` values S102 guarantees. Nothing is weakened — the rules cannot bypass them. |
| S102 coverage gate runs **before** the configured filters | A configured postcode match must never substitute for proven coverage (proven by test). |
| Preview calls `automaticLeadEmail`, not a second route rulebook | One selector, so preview cannot drift from the automatic router. |
| Admin-wide authorisation | No narrower role exists; documented rather than inventing a permission subsystem (report §9). |
| Real bug found and fixed during testing: `areaUnknown` used `!row.estimated_area_unknown`, which is true for every recorded area | Caught by the preview totals test; fixed to `row.estimated_area_unknown === true \|\| !(Number(area) > 0)`. |

---

## Safety limits honoured

- **No real send.** Every send-path assertion is `ZERO provider calls` (`globalThis.fetch` stubbed and counted).
- **No COM-04 switch enabled.** No switch value was changed in application code; the test fixtures set
  values in an in-memory mock only.
- **No production write.** Reads against the UAT container were schema inspection only
  (`information_schema.columns`); no migration was applied.
- **No migration applied.** 0206 is a staged proposal in `docs/pending-migrations/`.
- **No push, merge or deploy.** Local commit on the isolated branch only.
- **No new customer classification.** All filter values come from existing recorded vocabularies.
- **No unrelated workflow change.** The only behavioural change to an existing path is one added gate
  before `sendSaveMySpot`; `sendOne` and every manual path are untouched.
- **No weakening of S101/S102.** The S102 coverage and test-recipient boundaries are intact; all four
  affected existing suites pass with their original `route`/`reason` expectations.

---

## Test and build results

| Check | Result |
|---|---|
| `tests/p1-r3-s103-office-automatic-sending-rules.test.ts` | **64 pass / 0 fail** |
| `tests/p1-r3-s102-com04-dual-mode.test.ts` | 36 / 0 |
| `tests/com06-t05-t07.test.ts` | 7 / 0 |
| `tests/save-spot-uncertain-delivery.test.ts` | 31 / 0 |
| `tests/s20r01-automatic-enquiry-emails.test.ts` | 21 / 0 |
| `bun ./scripts/test-isolated.ts 8` (authoritative harness) | **340 files · 3418 pass · 0 fail** |
| `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | clean |
| `bun run build` | success (client, SSR, Nitro) |
| Client-bundle secret scan | clean (only the pre-existing env *variable name*, byte-identical to baseline) |

Note: raw `bun test tests/` is not used — it produces known false failures from shared-process
Happy-DOM/PGlite conflicts. `scripts/test-isolated.ts` is the authoritative harness.

---

## Open items for the owner

1. **Approve / apply 0206.** Until then automatic Save My Spot sending is blocked everywhere by design.
2. **A separate COM-04 activation decision.** This step is configuration capability only and does not
   authorise any delivery.
3. **Confirm the 500-row preview bound** is acceptable for Office planning.
4. **Confirm admin-wide authorisation** is the intended audience for this screen.
5. **Post-apply end-to-end verification** has not been performed (it requires 1 and 2 first).

See report §12 (proposed migrations) and §13 (release blockers).