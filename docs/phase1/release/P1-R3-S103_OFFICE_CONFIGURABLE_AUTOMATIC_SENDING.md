# P1-R3-S103 — Office-Configurable Automatic Save My Spot Sending Rules

**Project:** Home Insulation Victoria · **Phase:** Phase 1 · **Round:** RC1
**Step:** P1-R3-S103 · **Agent:** R3 — Application & Integration Engineer
**Baseline:** `e121da4aa6755c2d696c94a859c5f5b33b86f61b` (S102 final correction)
**Branch / worktree:** `r3/p1-s103-office-rules` · `../wt-r3-p1-s103-office-rules` (isolated; no R1/R2/R6 or frozen RC1 worktree touched)
**Status:** implemented, tested, documented. **Nothing was sent, no switch was turned on, no migration was applied, nothing was pushed, merged or deployed.**

---

## 1. Scope and the one rule that shapes the whole design

The Office can now decide **which enquiries are eligible for an automatic Save My Spot email** without a
code change. That is the whole feature.

The design constraint that follows from the owner instruction "additional restrictions only":

> The configurable rules can only ever **remove** enquiries from the set the automatic router already
> considers. They can never add one, and they can never switch delivery on.

Everything below is a consequence of that sentence: fail-closed defaults, no historical backlog, the
postcode filter sitting *behind* the S102 coverage gate, and COM-04 deliberately left to the sender.

---

## 2. Investigation (what actually exists in this repository)

### 2.1 Office UI and navigation

| Finding | Location |
|---|---|
| Office routes are file-based, all under `/admin/*` | `src/routes/_authenticated/admin.*.tsx` (~45 pages) |
| Pages are thin shells: `createFileRoute` + `useServerFn` → `@/lib/*.functions.ts` | `src/routes/_authenticated/admin.pricing.tsx:11` |
| One navigation map for every Office page | `src/lib/office-nav.ts` (`SECTION_TABS`, `OFFICE_TOOLS`, `OFFICE_HEADINGS`, `sectionFor`, `tabActive`) |
| Navigation shell renders the tabs | `src/components/portal/office.tsx` (`OfficeTopBar`, `AvatarMenu`) |
| Page guard convention | `src/routes/_authenticated/admin.pricing.tsx:24-27` — `useMe().roles.includes("admin")` |

**Reused as-is**: `Section` (`src/components/portal/panels.tsx:34`), `Checkbox`, `Switch`, `Input`,
`Button`, `useMe`, `useAction`, `useServerFn`, `AppShell`.

### 2.2 Save My Spot management screens

`/admin/hot-leads` (bulk spot emails) and `/admin/launch-campaign` (saved-spot campaign) exist and are
registered in `OFFICE_TOOLS`. Neither is a *rules* screen. The new screen was registered under
**Settings → "Automatic sending rules"** (`src/lib/office-nav.ts:46`), which is where every other
Office-configurable setting already lives.

### 2.3 Existing settings / configuration storage

| Table | Pattern | Reusable? |
|---|---|---|
| `workflow_settings` | **singleton row `id = 1`**; ~46 columns, mostly scalars, plus `office_time_limits jsonb` and `sms_message_switches jsonb` | **Yes — chosen** |
| `retail_estimator_settings` | versioned + `is_current`, written by SQL `publish_owner_prices` | No (pricing only) |
| `esc_notification_config` | versioned + `is_active`/`approved` | No (ESC only) |
| `customer_delivery_settings` | singleton `id = 1`, service-role only, no UI | No (provider secrets) |
| `pricing_settings` | versioned, one column | No |

There is **no generic key/value config table and no settings API**. The `jsonb` column precedent on the
same singleton row (`sms_message_switches`) is the closest existing shape, so S103 uses it (see §5).

### 2.4 Roles and permissions

- Frontend roles: `admin | electrician | installer | owner | property_manager` (`src/hooks/use-me.ts:6`).
- **Authoritative server-side check**: `requireAdmin(sb)` → `sb.rpc("is_admin")` (`src/lib/workflow.server.ts:90-94`),
  used by 58+ `*.functions.ts`, including every other communications setting
  (`setDispatchMode`, `connectMittiForm`, `setOwnerPrices`).
- `requireJobRole` is job-scoped and irrelevant here.
- **There is no narrower "communications settings" role** in this codebase, and no per-setting
  permission. The only narrow-permission precedent is `ap-fee.core.ts`'s env allow-list for the AP fee.
  S103 therefore uses `requireAdmin` and **documents the insufficiency** (§9) rather than inventing a
  permission subsystem.

### 2.5 Audit

`admin_config_events` — append-only, `actor_id / event_type / summary / details jsonb / created_at`.
There is **no shared audit helper**; every server fn inserts inline, non-blocking
(`.then(() => null, () => null)`). S103 follows that exact convention (`save-spot-rules.functions.ts`).

### 2.6 Automatic sending entry point

```
postintake.server.ts
  → maybeAutoRouteLeadEmail            (src/lib/lead-email-routing.server.ts)
      → selectLeadEmailRoute / automaticLeadEmail   (src/lib/enquiry-groups.core.ts)  ← THE single selector
      → offer_spot branch:
          syncStep3
          serviceCoverageEstablished                (S102, service-coverage.server.ts)
          ★ automaticSaveSpotGate                   (S103, save-spot-rules.server.ts)
          sendSaveMySpot → sendOne                  (hot-leads-send.server.ts) ← owns COM-04, consent,
                                                            opt-out, idempotency, uncertain delivery,
                                                            templates, S102 test-recipient boundary
```

`maybeAutoSendSaveSpot` in `hot-leads-send.server.ts` is the legacy/no-caller helper and was **not**
used, per the instruction to integrate into the live path.

### 2.7 S102 gates that had to survive

| Gate | Location | Status in S103 |
|---|---|---|
| Service-coverage (positive signal only) | `service-coverage.server.ts` | Untouched; runs **before** the rules and can never be replaced by a configured postcode |
| Test-recipient boundary | `comms-test-recipient.core.ts` | Untouched; still validated inside `sendOne` |

### 2.8 CRM fields actually used (nothing invented)

| Concept | Field / source |
|---|---|
| Eligibility | `jobs.eligibility_outcome` (`likely_eligible` / `needs_onsite_confirmation` / `does_not_appear_eligible`) |
| Existing insulation | `properties.enrichment → base44.raw.answers.existing_insulation` via `normaliseInsulation` → `none / present / unknown` |
| Ceiling area | `jobs.estimated_area_m2` + `jobs.estimated_area_unknown` (existing intake invariant, 0 < area ≤ 5000) |
| Postcode | `properties.postcode` (fallback `indicative_estimates.postcode`, status `current`) |
| Coverage | `veu_location_variables.postcode` |
| Job status | `jobs.stage`; selectable set = the existing `ENQUIRY_STAGES` enquiry stages |
| Enquiry date | `jobs.created_at` |
| Consent / opt-out / duplicate | `owner_contact_consents`, `customer_email_optouts`, `customer_email_sends` (purpose `existing_leads_launch_v1`) |

---

## 3. Field mapping delivered

| Filter | Type | Values | Notes |
|---|---|---|---|
| **A. Eligibility** | multi-select (OR) | the 3 recorded `eligibility_outcome` values | unknown value ⇒ validation error |
| **B. Existing Insulation** | multi-select (OR) | `none` / `present` / `unknown` | the owner's own answer only, never inferred |
| **C. Ceiling Area** | optional min **and** max + explicit "include unknown area" | `jobs.estimated_area_m2` | bounds inclusive; unknown excluded unless ticked |
| **D. Postcode** | specific list **or** inclusive range | `properties.postcode` | 4-digit validated; **never** bypasses the S102 gate |
| **E. Job Status** | multi-select (OR) | `new_enquiry`, `eligibility_review`, `preliminary_estimate_ready`, `ready_check_ready_to_schedule` | closed / on-hold / retired stages are not offered and cannot be configured |
| **F. Enquiry Date** | last 1 / 3 / 7 days or custom `YYYY-MM-DD` range | `jobs.created_at` | a missing date never matches |

Combination: **AND across categories, OR inside a category**. Individual filters can be switched on and
off. There is no rule-expression language, no script, no raw SQL, no free-text condition.

---

## 4. Mandatory safety rules (never configurable, never bypassable)

Enforced in code, outside the configuration:

1. COM-04 master switch and the Save My Spot secondary switch — `realSendingOn()` in `sendOne`
2. Owner contact consent — `hasCurrentOwnerContactConsent` in `sendOne`
3. Opt-out / suppression
4. Duplicate prevention and once-per-home idempotency (`customer_email_sends.idempotency_key`)
5. Uncertain-delivery protection (`delivered_unrecorded`, never auto-retried)
6. Approved templates only
7. Mandatory eligibility exclusions — the existing single selector `automaticLeadEmail`
8. **S102 service-area coverage gate**
9. **S102 test-recipient boundary**
10. Sender permissions (`requireAdmin` on every function)
11. Mandatory lifecycle exclusion — `LIFECYCLE_EXCLUDED_STAGES` in the core module, plus "no historical
    backlog" (`activated_at`)

The Office screen renders this list read-only, next to the filters.

---

## 5. Storage design (and the proposed migration — NOT applied)

### Chosen shape

One document in one proposed column on the existing singleton:

```
workflow_settings.save_my_spot_auto_rules  jsonb NOT NULL DEFAULT '{}'::jsonb
{
  "version": 1,
  "enabled": false,
  "activatedAt": null,
  "updatedAt": "...",
  "updatedBy": "...",
  "rules": { "eligibility": {...}, "insulation": {...}, "ceilingArea": {...},
             "postcode": {...}, "jobStatus": {...}, "enquiryDate": {...} }
}
```

### Why existing storage is not sufficient

- `workflow_settings` is a singleton of scalars plus two `jsonb` switches. There is no generic config
  table, no settings API, and no versioning to reuse.
- Both existing `jsonb` columns are owned by other features (`office_time_limits`, `sms_message_switches`).
  Writing Save-My-Spot rules into either would couple two unrelated safety controls, so a corrupt SMS
  switch could silently disable or enable customer-email selection.
- A new table would work but would need its own singleton/versioning/audit contract for exactly one
  document.

### Smallest safe schema change — **one column**

`docs/pending-migrations/0206_save_my_spot_auto_rules.sql` (+ `.rollback.sql`), **proposed only**:

```sql
ALTER TABLE workflow_settings
ADD COLUMN IF NOT EXISTS save_my_spot_auto_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
```

- Idempotent (`IF NOT EXISTS`), default `'{}'` = **not configured**.
- `enabled` lives *inside* the document so a save is atomic; there is no window where the rules and
  their on/off state disagree.
- `updatedAt` / `updatedBy` travel with the document rather than relying on the shared
  `workflow_settings.updated_at`.

### Pre-migration behaviour (safe by construction)

Until 0206 is applied, `select("save_my_spot_auto_rules")` errors → `readAutomaticRules()` returns
`unreadable` → `automaticSaveSpotGate` blocks with `rules_unavailable`. **Automatic Save My Spot sending
is therefore fully disabled by default in every environment until the migration is approved and applied,
and the Office screen says so.** No localStorage, no in-browser authoritative copy.

### Approval required

Per `docs/pending-migrations/README_DO_NOT_APPLY.md`, applying 0206 is an operator decision under the
project lead's controlled procedure (production identity check, recoverable backup, baseline check,
one transaction per migration, post-apply verification, rollback ready, stop on unexpected results).
**S103 did not apply it.** The column is declared in `src/integrations/supabase/types.ts` (Row/Insert/
Update) so the code compiles; that mirrors the existing convention where `save_my_spot_real_send_enabled`
is declared while its migration is staged.

---

## 6. Office screen

`src/routes/_authenticated/admin.save-my-spot-rules.tsx`, registered at
`src/lib/office-nav.ts:46` (Settings → "Automatic sending rules").

Sections:

1. **Automatic selection** — one on/off switch, with an explicit warning that it is separate from COM-04
   and cannot start sending. Shows whether rules are saved and when.
2. **Filters** — the six categories, each with an enable checkbox and plain-language hints. Disabled
   categories collapse. No technical vocabulary.
3. **Rules that always apply** — the read-only mandatory list.
4. **Preview matching customers** — see §7.

Save / discard; a save never sends. Guarded client-side by the standard `useMe().roles` check, and
authorised server-side by `requireAdmin`.

---

## 7. Preview Matching Customers (read-only)

`previewAutomaticSaveSpotMatching()` in `save-spot-rules.server.ts`, exposed through an admin-only
server fn.

Reports four totals, in the order the owner asked for:

| Total | Meaning |
|---|---|
| **Match the filters** | the configured filters pass |
| **Excluded by a mandatory rule** | matched the filters but a mandatory control excludes it |
| **Needs office review** | mandatory controls would allow it, but a configured filter cannot be decided because a record is missing |
| **Finally eligible** | matches the filters **and** every mandatory rule |

(plus a `rule_excluded` count for definite filter mismatches, and the paginated list.)

Row fields: job number, eligibility, insulation, postcode, job status, enquiry date, outcome + plain-English
reason. 25 rows per page.

### Zero side effects — proven

The preview never calls a sender, never reserves an idempotency key, never writes a delivery record,
never changes a status and never triggers a workflow. It is read-only by construction and by test
(`writes === []`, `fetchCalls === 0`, `customer_email_sends` untouched).

### Same logic as real sending, side effects separated

Both the live gate and the preview call:

- `readAutomaticRules()` — the same fail-closed reader
- `candidateFacts()` — the same recorded-facts reader
- `lifecycleExclusion()` — the same mandatory lifecycle exclusion
- `automaticLeadEmail()` — **the one existing route selector**, not a second rulebook
- `serviceCoverageEstablished` — the same S102 coverage signal (bulk postcode read in the preview)
- `matchAutomaticRules()` — the same pure matcher

The only difference is that the preview stops before the sender. The preview additionally *reports* the
sender-side controls (COM-04 switches, delivery configuration, consent, opt-out, existing send) so the
Office sees the whole picture; the live gate deliberately leaves those to `sendOne` (§8).

Preview scope: the most recent `PREVIEW_SCAN_LIMIT = 500` non-deleted enquiries that have an official
Gate 1 decision source. This is a bound, not an exhaustive history.

---

## 8. Integration into the live automatic path

`src/lib/lead-email-routing.server.ts`, inside the `offer_spot` branch, immediately after the existing
S102 coverage gate and immediately before `sendSaveMySpot`:

```ts
const { automaticSaveSpotGate } = await import("./save-spot-rules.server");
const gate = await automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true });
if (!gate.allowed) return { route: "none", sent: false, reason: gate.reason };
```

### Gate order (fixed)

1. configuration readable + valid — **fail closed**
2. automatic selection enabled — **default DISABLED**
3. job facts readable — fail closed
4. mandatory lifecycle exclusion
5. enquiry created at/after `activatedAt` — no historical backlog
6. the existing single-route selector chose `offer_spot`
7. S102 service-coverage gate
8. the configured filters

### Missing / invalid / unreadable configuration ⇒ DO NOT AUTO-SEND

`missing`, `invalid`, `unreadable`, an unsupported `version`, or `enabled !== true` all return
`allowed: false`. Tested for each case, including the "column does not exist" error that a not-yet-applied
0206 produces.

### What the gate deliberately does NOT do

COM-04, consent, opt-out/suppression, idempotency, uncertain-delivery protection, approved templates,
the test-recipient boundary and sender permissions stay in `sendOne` and run immediately afterwards,
before any provider call. Re-implementing them in the gate would duplicate one safety rulebook **and**
would change the `route` / `reason` values S102 already guarantees (e.g. COM-04 off must still surface
`route: "offer_spot", reason: "Sending is switched off."`). The gate is a *selection* gate; the sender
remains the *safety* gate. Nothing is weakened: the rules cannot bypass any of them.

### No historical backlog

`activatedAt` is stamped when automatic selection is switched **off → on** and preserved while it stays
on. An enquiry created before `activatedAt` is never auto-selected, so changing a rule can never sweep
previously untouched enquiries. There is also no re-scan worker and no catch-up job: the rules only apply
at the moment an enquiry qualifies, which is where the automatic router already runs.

### Delivery authorisation

Turning automatic selection on **does not authorise delivery**. It only makes newly qualifying enquiries
*eligible*; the COM-04 master switch and the Save My Spot secondary switch must still be on separately,
and every sender guard still applies.

---

## 9. Permissions and audit

**Server-side enforcement**: every one of the four server functions calls `requireAdmin(context.supabase)`
before doing anything. Behaviourally tested by invoking the handlers with an `is_admin`-false context:
all four reject with `WorkflowError("Admin only.")` and nothing is written. The `createServerFn` chain is
unwrapped in the test so this is a real behavioural proof, not a source-text assertion (a source-text
assertion is also kept as a regression guard).

**Audit**: every save appends one `admin_config_events` row —
`event_type: "save_my_spot_auto_rules"`, `actor_id: <context.userId>` (timestamp is the row's
`created_at`), `summary` in plain English, and `details: { previous_config, new_config, activated_at }`.
An audit failure never blocks the save, matching `setDispatchMode` / `connectMittiForm`.

**Documented insufficiency (not invented away)**: the platform has no per-setting permission and no
"communications settings" role. `requireAdmin` is therefore the authorisation boundary, identical to every
other communications setting. S103 does **not** create a new role, an ACL table, or an env allow-list. If
the business later needs "an Office manager may edit rules but not owner prices", that is a separate
owner-approved decision; the pattern to copy is `ap-fee.core.ts`.

---

## 10. Tests

`tests/p1-r3-s103-office-automatic-sending-rules.test.ts` — **64 tests, all passing**, in-memory Supabase
mock (same harness as the S102 focused tests), `globalThis.fetch` stubbed and counted, no network, no
provider, no production access, fictional data only.

| # | Area | Proves |
|---|---|---|
| 1 | rule creation & validation | blank set is valid; non-object rejected; enabled filter with no values rejected; disabled filter is harmless |
| 2 | persistence | version, actor, timestamp and a fresh activation recorded |
| 3 | editing / re-saving | editing while enabled keeps the original activation (no accidental reset) |
| 4 | missing configuration | `{}` and "no saved rules" ⇒ no automatic send |
| 5 | invalid configuration | unknown version, unknown rule value, missing `rules` ⇒ no automatic send |
| 6 | unreadable configuration | column/select error ⇒ no automatic send |
| 7 | multiple filter combinations | AND across categories, OR within; every failing category reported |
| 8 | unknown field values | unknown outcome / insulation / stage / window / non-numeric area are errors, never dropped |
| 9 | ceiling-area boundaries | min and max inclusive; unknown excluded by default, included only when ticked |
| 10 | postcode filtering | specific list, inclusive range, unknown postcode never matches |
| 11 | date filtering | last 1 / 3 / 7 days and a custom range; missing date never matches |
| 12 | stage filtering | only the selected existing enquiry stages; closed / on-hold / retired never configurable |
| 13 | eligibility filtering | recorded outcomes only |
| 14 | insulation filtering | the owner's own answer only, never inferred |
| 15 | mandatory safety non-disableable | lifecycle, S102 coverage, unreadable coverage table, "postcode filter does not bypass coverage", COM-04 still stops the send, non-`offer_spot` route |
| 16 | Office permission enforcement | all four server fns call `requireAdmin`; four `createServerFn` exports |
| 17 | unauthorised changes blocked | non-admin rejects on load / save / validate / preview, with zero writes |
| 18 | admin save audit | actor, previous config and new config recorded in `admin_config_events` |
| 19 | saving never sends | no provider call, no `customer_email_sends` reservation |
| 20 | preview zero side effects | `writes === []`, `fetchCalls === 0`, no send rows created |
| 21 | preview totals | matching / mandatory-excluded / needs-review / eligible exactly counted on 4 fixtures |
| 22 | preview ↔ auto consistency | the same job is eligible in the preview iff the live gate allows it |
| 23 | auto selection disabled | gate blocks; preview reports the reason rather than hiding it |
| 24 | no historical backlog | older enquiries blocked; re-activation re-stamps; newer enquiries selected |
| 25 | no duplicates | an existing Save-My-Spot send is a mandatory exclusion in the preview |
| 26 | opt-out | never eligible |
| 27 | unreadable mandatory records | nothing reported eligible (fail closed) |
| 28 | pagination | 25 per page, disjoint pages, page bounds reported |
| 29 | no real provider calls | every send-path test asserts `fetchCalls === 0` |
| 30 | manual sending unaffected | Office `sendSaveMySpot` is untouched by the rules and is not blocked by them |

### Regression: existing automatic-send suites

The new gate is **stricter by default**, so the four suites that drive the live automatic `offer_spot`
path were updated to seed an explicitly **enabled** S103 document with **no extra filters** (i.e. no
additional restriction), preserving every existing S101/S102 expectation:

- `tests/p1-r3-s102-com04-dual-mode.test.ts` (settings helper)
- `tests/com06-t05-t07.test.ts`
- `tests/save-spot-uncertain-delivery.test.ts`
- `tests/s20r01-automatic-enquiry-emails.test.ts`

No S101/S102 assertion was weakened, deleted or relaxed. The "COM-04 off" and "coverage not established"
expectations still pass with their original `route` and `reason` values.

### Verification run

| Check | Result |
|---|---|
| Focused S103 suite | **64 pass / 0 fail** |
| S102 focused suite | 36 / 0 |
| COM-06 T05–T07 | 7 / 0 |
| Save-spot uncertain delivery | 31 / 0 |
| S20-R01 automatic enquiry emails | 21 / 0 |
| Full isolated regression (`bun ./scripts/test-isolated.ts 8`) | **340 files · 3418 pass · 0 fail** |
| TypeScript (`tsc --noEmit -p tsconfig.json`) | **clean** |
| Build (`bun run build`) | **success** (client, SSR, Nitro) |
| Client-bundle secret scan | only the pre-existing `import.meta.env.SUPABASE_SERVICE_ROLE_KEY` *variable name* in dead code — byte-identical to the baseline bundle; no secret value |

---

## 11. Limitations

1. **The feature is inert until 0206 is approved and applied.** Until then the column read fails and every
   automatic Save My Spot send is blocked. This is deliberate (fail-closed), but it means the Office
   screen shows "Automatic sending rules could not be read from settings" until the migration lands.
2. **Preview is bounded** to the 500 most recent decided enquiries. It is not an exhaustive historical
   report and is not a backfill tool.
3. **Preview does not simulate the sender.** It reports the mandatory *selection* controls plus consent,
   opt-out, delivery configuration and duplicate history. The remaining sender-side checks (secure link
   exists, current price exists, spot not already saved, no-size real-send hold, template approval) are
   evaluated at send time and are not modelled in the preview.
4. **Authorisation is admin-wide.** No narrower role exists (see §9). Documented, not invented.
5. **`activatedAt` is a single timestamp**, so an off→on transition is the only way to exclude older
   enquiries. There is no separate "apply to enquiries from" control; if the business wants one, that is
   an owner-approved change.
6. **Only automatic sending is configurable.** Office manual sending, Group B invitations, ineligible
   emails, follow-ups and the Ready Check invitation are untouched.
7. **No per-rule audit trail beyond the document.** `admin_config_events` keeps every save's previous and
   new configuration, which is the existing audit mechanism; there is no versioned rule history table.

---

## 12. Proposed migrations (owner approval required)

| File | Status | Effect |
|---|---|---|
| `docs/pending-migrations/0206_save_my_spot_auto_rules.sql` | **PROPOSED — NOT APPLIED** | adds `workflow_settings.save_my_spot_auto_rules jsonb NOT NULL DEFAULT '{}'` |
| `docs/pending-migrations/0206_save_my_spot_auto_rules.rollback.sql` | **PROPOSED — NOT APPLIED** | drops the column; readers then fail closed again |

Nothing else in the schema was changed. No existing column was repurposed.

---

## 13. Release blockers

| # | Blocker | Owner decision needed |
|---|---|---|
| 1 | **0206 is not applied.** Automatic Save My Spot sending is blocked in every environment until it is. | Approve and apply 0206 under the controlled procedure in `README_DO_NOT_APPLY.md` |
| 2 | **COM-04 switches remain OFF** and are unchanged by this step. Nothing will be delivered even after 0206. | A separate, explicit activation decision for the COM-04 master + Save My Spot secondary switches |
| 3 | **No end-to-end evidence of a real automatic send.** Every send assertion in this step is `ZERO provider calls`. | Run the live verification job after 1 and 2 are approved |
| 4 | **Preview cannot be validated against a production-sized dataset** before 0206 is applied. | Confirm the 500-row preview bound is acceptable |
| 5 | **Authorisation is admin-wide.** | Confirm that is the intended audience, or approve a narrower permission (a separate decision) |

---

## 14. Files changed

**New**
- `src/lib/save-spot-rules.core.ts` — pure types, defaults, validation, AND/OR matching, lifecycle exclusions, descriptions
- `src/lib/save-spot-rules.server.ts` — fail-closed reader, `prepareRulesForSave`, `automaticSaveSpotGate`, read-only preview
- `src/lib/save-spot-rules.functions.ts` — four admin-only server functions (load / save / validate / preview) + audit
- `src/routes/_authenticated/admin.save-my-spot-rules.tsx` — the Office screen
- `tests/p1-r3-s103-office-automatic-sending-rules.test.ts` — 64 focused tests
- `docs/pending-migrations/0206_save_my_spot_auto_rules.sql` + `.rollback.sql` — **proposal only**

**Modified**
- `src/lib/lead-email-routing.server.ts` — the gate in the live `offer_spot` branch
- `src/lib/service-coverage.server.ts` — exported `SERVICE_AREA_REASON` (string value unchanged)
- `src/lib/office-nav.ts` — Settings → "Automatic sending rules"
- `src/integrations/supabase/types.ts` — the proposed column in Row/Insert/Update
- `src/routeTree.gen.ts` — generated (new route)
- `src/lib/AGENTS.md` — architecture rule
- 4 existing test files — explicit enabled S103 document (no assertion weakened)