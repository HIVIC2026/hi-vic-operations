# Installer pages Part 1 · F. My business and Team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Team page where the boss (or Jo) adds people without an email, marks each one Lead or Crew (only Leads get Mitti), electrician bosses are asked for licences, and My business warns about a missing or expired electrical licence and cover under $5m, with plain words and a short electrician "How it works".

**Architecture:** One pending migration makes `partner_workers.email` optional and limits `worker_role` to `lead`/`crew`, proven on PGlite only. Pure rules (`crewRoleOf`, `workerEmailKey`, `mittiEmailFor`, `teamMittiLine`, `businessNext`) live in the existing core files. Mitti invite, removal and visit allocation read Lead/Crew from those rules. The old `/partner/workers` "Your staff" page is deleted and its address redirects to Team.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun:test, PGlite (`tests/helpers/pglite-installer.ts`).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md`, section F only (F1–F9).

## Open questions for Jo (proposed answer in brackets, built that way unless Jo says otherwise)

1. People already on a team: Lead or Crew? [Lead, so nobody loses Mitti. `worker_role` null reads as Lead.]
2. Should a Ready Check also need a CII-cleared Lead? Today anyone listed can get one. [Yes. It's done in Mitti, so it must be a Lead, and F5 says every installer needs CII.]
3. People the boss adds directly don't sign the worker sign-up declarations. Is that OK? [Yes. The privacy notice and CII link still go to each person.]
4. Is the $5m cover check for electricians only, or installers too? [Electricians only, matching decision 415.]
5. Is Lead/Crew for installer staff only? [Yes. Electrician staff all keep Mitti as today.]
6. Where does Jo switch Lead/Crew? [Partners › People, one button per installer.]
7. Is the electrician guide wording in Task 9 OK? [Jo approves the exact copy before it's built.]

## Global Constraints

- Only F1–F9. Nothing from sections A–E or G is done here. The PIISA crew picker Lead (D5/D6) is not changed.
- No live SQL. The migration is written to `docs/pending-migrations/` and proven on PGlite. Going live is a separate step that Jo approves, and it starts with a read-only check that live `worker_role` holds only null/`lead`/`crew`.
- An empty or missing email never matches another person. Certificate, approval and Mitti lookups go by worker id, or by `workerEmailKey` (`no-email:<id>` when blank).
- Mitti stays office-run: `MITTI_AUTO_INVITE_ENABLED` is unchanged and the office invites by hand. Switching someone to Crew raises one office item to remove them from Mitti.
- Lead/Crew changes take effect straight away. They don't re-pend approval: `worker_role` is not in `repend_worker_identity`.
- The look stays the same. Use the existing M7 kit classes only.
- Server functions use the literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain.

## Review Focus

1. Two people with no email in one business → neither picks up the other's CII. Test: Task 2 `workerEmailKey never matches across blank emails`.
2. Lead switched to Crew → no Mitti invite, no Ready Check or install allocation, and one office "remove from Mitti" item. Tests: Task 3 `crew never gets Mitti` and `switch to crew raises one office item`.
3. Lead without their own email → the Mitti lookup uses the business office email. Crew → no lookup at all. Test: Task 3 `mittiEmailFor`.
4. `/partner/workers` and `/partner/workers?sample=1` land on Team and are never a 404 or demo page. Test: Task 6 `workers redirects to Team`.
5. Electrician business: a missing or expired licence comes before bank and agreement. Cover under $5m warns unless they work under a REC. Test: Task 7 `electrician licence and cover`.

---

### Task 1: Migration — email optional, Lead/Crew column (PGlite proof only)

**Files:**
- Create: `docs/pending-migrations/0229_team_lead_crew.sql`, `docs/pending-migrations/0229_team_lead_crew.rollback.sql`
- Test: `tests/team-lead-crew-db.test.ts`

**Interfaces:** Produces `partner_workers.email text NULL` and `partner_workers.worker_role text NULL CHECK (worker_role IN ('lead','crew'))`, named `partner_workers_worker_role_check`.

- [ ] **Step 1: Write the failing test** using `installerDb()`. Cases: (a) before the migration, inserting an installer with `email = NULL` is refused; (b) after `MIGRATION`, two `email = NULL` installers in the same business both insert; (c) `worker_role = 'boss'` is refused, while `'lead'`, `'crew'` and NULL are accepted; (d) an approved worker changed from lead to crew stays `approval_status = 'approved'`; (e) running the migration twice is a no-op; (f) `ROLLBACK` raises `team_lead_crew:null_emails` while a null email exists, and after those rows are deleted it restores `email NOT NULL` and drops the check (the `worker_role` column stays, because it already exists live).
- [ ] **Step 2: Run it, expect FAIL.** Run: `bun test tests/team-lead-crew-db.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 3: Write the migration.** It does: `ALTER COLUMN email DROP NOT NULL`, then `ADD COLUMN IF NOT EXISTS worker_role text`, then a `DO $$` block that adds `partner_workers_worker_role_check` only if it's missing. It also adds a `COMMENT ON COLUMN ... worker_role` with the text "Jo 27–28 Oct 2026: lead = uses Mitti; crew = no Mitti. NULL reads as lead." The rollback is a `DO $$` that raises `team_lead_crew:null_emails` if any email is null, then sets `NOT NULL` and `DROP CONSTRAINT IF EXISTS`.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-lead-crew-db.test.ts tests/installer-sign-activation.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add docs/pending-migrations/0229_team_lead_crew*.sql tests/team-lead-crew-db.test.ts
git commit -m "db(pending): optional worker email + lead/crew role, proven on PGlite"
```

### Task 2: Pure Lead/Crew and no-email rules; every email reader null-safe

**Files:**
- Modify: `src/lib/worker-compliance.core.ts` (add rules), `src/integrations/supabase/types.ts` (`partner_workers` Row `email: string | null`, Insert/Update `email?: string | null`)
- Modify (null-safe, found by `bunx tsc --noEmit`): `src/lib/worker-compliance.functions.ts` (`officeVerifyEec`), `src/lib/worker-approval.server.ts`, `src/lib/prestart.server.ts`, `src/lib/trade-access.functions.ts`, `src/lib/mitti-invite.server.ts` (`loadPerson` cert lookup), `src/lib/trade-view.server.ts` (team rows), plus any other file tsc reports
- Test: `tests/team-no-email.test.ts`

**Interfaces (produces):**
- `export type CrewRole = "lead" | "crew";`
- `export function crewRoleOf(w: { trade_role: string; worker_role?: string | null }): CrewRole | null`. It returns null for non-installers, `"crew"` only when `worker_role === "crew"`, and otherwise `"lead"`.
- `export function workerEmailKey(w: { id: string; email: string | null }): string`. It returns the trimmed lower-case email, or `` `no-email:${w.id}` `` when the email is blank.

- [ ] **Step 1: Write the failing test.** It covers `crewRoleOf` for null, lead, crew and electrician. It includes `workerEmailKey never matches across blank emails`: two ids with `""` and `null` give different keys, and neither equals `""`. It also reads the source and checks that `worker-approval.server.ts` and `worker-compliance.functions.ts` contain `workerEmailKey(` and no longer contain `w.email.trim()`. Finally it checks that `trade-access.functions.ts` refuses a blank email with `"Add an email for this person first."` before any lookup.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-no-email.test.ts`.
- [ ] **Step 3: Implement** the two rules, then update `types.ts`. Run `bunx tsc --noEmit` and fix every new `email` null error in two ways: use `workerEmailKey(w)` wherever a key is stored or compared (`worker_email` inserts, cert `.or(...)` filters, which use `worker_id` only when the email is blank), and add an early plain refusal wherever a real address is needed (portal login). Team rows pass `email: w.email ?? null`.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-no-email.test.ts tests/worker-compliance.test.ts tests/worker-auto-approve.test.ts tests/worker-auto-approve-db.test.ts`, then `bunx tsc --noEmit`, which should show no new errors.
- [ ] **Step 5: Commit**

```bash
git add src/lib src/integrations/supabase/types.ts tests/team-no-email.test.ts
git commit -m "feat(team): lead/crew + no-email rules; email lookups never match a blank email"
```

### Task 3: Mitti and visit allocation follow Lead/Crew

**Files:**
- Modify: `src/lib/mitti-invite.core.ts`, `src/lib/mitti-invite.server.ts`, `src/lib/visit-allocation.core.ts`, `src/lib/visit-allocation.server.ts`, `src/lib/office-partners.core.ts`, `src/lib/office-partners.server.ts`
- Test: `tests/mitti-invite.core.test.ts`, `tests/visit-allocation.test.ts`, `tests/office-build-b.core.test.ts`, `tests/mitti-invite.server.test.ts`

**Interfaces:**
- `InvitePerson` and `RemovalPerson` gain `crew: boolean`. `inviteEligibility` returns `"Crew don't use Mitti — only Leads."` when `crew` is true. `mittiRemovalStep` treats a crew person like a removed one (it no longer skips with "Still active in the portal").
- `export async function onCrewRoleChanged(workerId: string, role: CrewRole, actorId: string | null, opts?: Opts): Promise<{ action: string; reason?: string }>`. Switching to `lead` calls `onPartnerPersonApproved`. Switching to `crew` with the switch ON runs the removal flow. With the switch OFF, if any Mitti user is known (a prior record or the profile's `mitti_user_id`), it records ONE `mitti_access_failed` with `` `${name} is now Crew — remove them from Mitti by hand.` `` and otherwise skips.
- `loadPerson`: `email = w.email ?? (crew ? null : businesses.email)`, so a Lead without their own email uses the business office email.
- `export function mittiEmailFor(c: { email: string | null; workerRole: CrewRole | null }, businessEmail: string | null): string | null` returns null for crew, and otherwise the person's email falling back to `businessEmail`.
- `AllocationCandidate` gains `workerRole?: CrewRole | null`. `ALLOCATION_REASON.crew = "Crew don't use Mitti — pick a Lead."` and `ALLOCATION_REASON.ciiReadyCheck = "Needs a checked CII certificate first."` `allocationBlocker` checks in this order: removed → crew (both visits) → Ready Check: installer not CII-cleared → `ciiReadyCheck` (open question 2) → install rules as today.
- `visit-allocation.server`: select `worker_role` and `businesses.email`, and look up Mitti with `mittiEmailFor(...)`.
- `PersonFacts` gains `crew?: boolean`. For crew, `personRow` gives `mittiLabel = "Crew · no Mitti"` and never `invite_mitti`.

- [ ] **Step 1: Write failing tests.** Add `crew never gets Mitti` (eligibility reason, removal step = deactivate/fail, not skip) and `switch to crew raises one office item` (server test, switch off, profile has `mitti_user_id`: exactly one `mitti_access_failed`, and calling it again adds none). Add `mittiEmailFor` (own email, office email fallback, crew → null). Update the old Ready Check test: `sparky` is still allowed for a Ready Check, a crew installer is refused, and an uncleared installer is refused with `ciiReadyCheck`. Add a `personRow` crew label test.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/mitti-invite.core.test.ts tests/mitti-invite.server.test.ts tests/visit-allocation.test.ts tests/office-build-b.core.test.ts`.
- [ ] **Step 3: Implement** as described above. Update the decision 161 comment at the top of `visit-allocation.core.ts`.
- [ ] **Step 4: Run, expect PASS.** Run the same command plus `bun test tests/allocation-hardening-db.test.ts tests/piesa-allocation-db.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/lib tests
git commit -m "feat(team): only Leads get Mitti; crew switch raises office remove-from-Mitti item"
```

### Task 4: Team server — add without email, set Lead/Crew, plain login ask

**Files:**
- Modify: `src/lib/trade-view.core.ts`, `src/lib/trade-view.server.ts`, `src/lib/trade-view.functions.ts`
- Test: `tests/trade-business-m7.test.ts`, `tests/installer-states.test.ts`, create `tests/team-add-person.test.ts`

**Interfaces:**
- `TeamMemberView` gains `workerRole: CrewRole | null; mittiRecorded: boolean`. The second one is true when the worker has a `mitti_user_linked`/`mitti_user_invited`/`mitti_invite_linked`/`mitti_user_reactivated`/`mitti_invite_office_done` record.
- `export function teamMittiLine(m: Pick<TeamMemberView, "role" | "workerRole" | "mittiLogin" | "mittiRecorded">): string` gives one of: `"Crew · no Mitti"`, `"Lead · Mitti ✓"`, `"Lead · Mitti to re-check"`, `"Lead · office adding to Mitti"`. It drops the `"Lead · "` prefix when `workerRole` is null (electricians). `teamFactsLine` uses it in place of the old Mitti text.
- `TEAM_RULE = "Every installer, Lead and Crew, needs a CII certificate checked by our office before going on a job. Only Leads use Mitti, so only a Lead can be given a Ready Check or an install day."`
- `TEAM_ADD_SHEET` becomes `{ title: "Add a team member", bodyInstaller: "Email and mobile can wait. We'll check their CII certificate before they go on a job.", bodyElectrician: "Email and mobile can wait. Each electrician needs a current electrical licence.", name: "Full name", licence: "Electrical licence number", role: "Lead or Crew", lead: "Lead · uses Mitti", crew: "Crew · no Mitti", mobile: "Mobile (optional)", email: "Email (optional)", button: "Add to team", cancel: "Cancel" }`. The invite-link fields and `inviteTextLine`/`inviteContact` stay only while `field.business_.team.tsx` uses them (removed in Task 5).
- `TEAM_LOGIN = { button: "Ask the office to send a login", asked: "Asked the office. They'll send the login." }`
- `export async function tradeAddTeamPerson(userId: string, p: { name: string; workerRole: CrewRole; mobile: string | null; email: string | null; licenceNumber: string | null }): Promise<{ workerId: string }>`. It needs the boss (`bossOrThrow`). `trade_role` comes from `c.kind`. For installers it sets `qualification: installerQualification({})`, `certification_status: "unverified"` and `worker_role`. For electricians it requires `licenceNumber` ("Add their electrical licence number.") and sets `worker_role: null`. It also sets `approval_status: "pending"` and `added_by: userId`, and uses `crewMobileInput` for the mobile. Error `23502` gives "Adding someone without an email needs the office's database update first." and `23505` gives "Someone with that email is already on your team."
- `export async function tradeSetCrewRole(userId: string, workerId: string, role: CrewRole, office: boolean): Promise<{ ok: true }>`. It's allowed for the boss of that business or for the office. It refuses non-installers. It writes `worker_role`, appends `admin_config_events` `team_worker_role_set`, then `onCrewRoleChanged(...).catch(log)`.
- Server fns: `addTeamPerson` and `setTeamCrewRole`. The second one sets `office` from `context.supabase.rpc("is_admin")`.

- [ ] **Step 1: Write failing tests.** Update the pinned `TEAM_RULE` and `teamFactsLine` expectations in `trade-business-m7.test.ts`. Rewrite the `TEAM_ADD_SHEET` assertions in `installer-states.test.ts`. In `team-add-person.test.ts`: `teamMittiLine` for all four states. Source checks: `tradeAddTeamPerson` derives `trade_role` from `c.kind` and never hard-codes `"installer"`; `tradeSetCrewRole` calls `onCrewRoleChanged`; `tradeRequestLoginInvite` still only raises `tradeChangeRequest`.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/trade-business-m7.test.ts tests/installer-states.test.ts tests/team-add-person.test.ts`.
- [ ] **Step 3: Implement** as described above. `tradeBusiness` selects `worker_role` and reads the Mitti records for its worker ids.
- [ ] **Step 4: Run, expect PASS.** Same command, then `bunx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/lib tests
git commit -m "feat(team): add people without email, Lead/Crew switch, plain login-ask words"
```

### Task 5: One Team page (screens) + office Lead/Crew switch

**Files:**
- Modify: `src/routes/_authenticated/field.business_.team.tsx`, `src/routes/_authenticated/field.business.tsx`, `src/components/portal/partner-people.tsx`, `src/lib/office-partners.server.ts` (pass `workerRole`)
- Test: `tests/team-page.test.ts` (source-reading, house style)

- [ ] **Step 1: Write the failing test.** The Team route: does not import `createWorkerInvite`; uses `addTeamPerson`, `setTeamCrewRole`, `TEAM_LOGIN.button`, `TEAM_RULE` and `CertLinkInline`; shows the licence field only when `data.kind === "electrician"`, and the Lead/Crew choice only for installers; carries over Remove using the existing `removeWorker`; and its intro no longer says "Everyone listed here can be given a Ready Check". `field.business.tsx`: "Add a team member" links to `/field/business/team` and never to `/partner/workers`. `partner-people.tsx`: installer rows show a Lead/Crew button that calls `setTeamCrewRole`.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-page.test.ts`.
- [ ] **Step 3: Implement.** The installer intro on Team = `TEAM_RULE`, and the electrician intro = `TEAM_ADD_SHEET.bodyElectrician`. Each row shows a "Make Crew"/"Make Lead" button (installers only). The add sheet uses the fields from Task 4, and once an installer is added it shows `CertLinkInline` for them. The `TEAM_RULE` paragraph under the list is removed, so the rule shows once.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-page.test.ts tests/installer-states.test.ts tests/business-owner-only.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/field.business_.team.tsx src/routes/_authenticated/field.business.tsx src/components/portal/partner-people.tsx src/lib/office-partners.server.ts tests/team-page.test.ts
git commit -m "feat(team): one Team page with Lead/Crew, add without email; office switch on People"
```

### Task 6: Remove "Your staff" and its demo mode; keep the old address

**Files:**
- Delete: `src/routes/_authenticated/partner.workers.tsx`, `src/components/portal/worker-invites.tsx`
- Modify: `src/components/portal/workers.tsx` (delete `WorkerForm`, `WorkerStatus`, `WorkerRemoveButton` and keep `WorkerLinksPanel`), `src/lib/worker-invite.core.ts` (delete `workerListQueryKey`, `workerInviteQueryKey`), `src/lib/legacy-links.core.ts` (`PARTNER.workers = { to: "/field/business/team" }`), `src/routeTree.gen.ts` (regenerated)
- Test: `tests/legacy-links.test.ts`, `tests/worker-cert-onboarding.test.ts`, `tests/worker-invite.test.ts`

- [ ] **Step 1: Write failing tests.** Add `workers redirects to Team`: `partnerLegacyTarget("workers")` and `partnerLegacyTarget("workers", { sample: "1" })` both equal `{ to: "/field/business/team" }`, and `existsSync("src/routes/_authenticated/partner.workers.tsx")` is false. In `worker-cert-onboarding.test.ts`, point `teamPage` at `field.business_.team.tsx` and expect `CertLinkInline` in place of the literal "Create certificate link". Remove the query-key lines from `worker-invite.test.ts`.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/legacy-links.test.ts tests/worker-cert-onboarding.test.ts tests/worker-invite.test.ts`.
- [ ] **Step 3: Implement.** Make the deletions and the redirect, then run `bun run build` to regenerate `routeTree.gen.ts`. Leave `route-guards.ts` `BOSS_ONLY` and the `trade-work.tsx` tab highlight alone, because the role check still runs before the redirect.
- [ ] **Step 4: Run, expect PASS.** Same command plus `bun test tests/add-job-legacy-entry.test.ts tests/legacy-path-retired.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add -A src/routes src/components/portal src/lib/worker-invite.core.ts src/lib/legacy-links.core.ts src/routeTree.gen.ts tests
git commit -m "chore(team): remove Your staff page and demo mode; /partner/workers opens Team"
```

### Task 7: NEXT panel — electrical licence, $5m cover, usual-electrician text

**Files:**
- Modify: `src/lib/trade-view.core.ts` (`BusinessNextFacts`, `businessNext`), `src/lib/trade-view.server.ts` (facts)
- Test: `tests/trade-business-m7.test.ts`

**Interfaces:** `BusinessNextFacts` gains `electrician?: { licenceExpires: string | null; plCover: number | null; worksUnderRec: boolean }`.
- The server fills it only for `c.kind === "electrician"`. `licenceExpires` = `latestExpiry(credentials, "electrical_licence")`, or the current earliest worker `licence_expires_on` if there isn't one. `plCover` = `businesses.public_liability_cover_amount`. `worksUnderRec` = the signed application's `data.works_under_rec === true` (via `partner_activations.application_id`).
- Order after the public liability expiry: licence missing → `{ title: "We don't have your electrical licence on file", sub: "Upload your current licence so offers keep coming.", button: "Upload licence", to: "/field/business/insurance" }`; licence expired → `{ title: "Your electrical licence has expired", sub: "Expired <dayMonth>. No new offers until the renewed licence is uploaded.", button: "Upload renewed licence", ... }`; then, unless `worksUnderRec`, `plCover == null || plCover < MIN_REC_PL_COVER` → `{ title: "Your public liability cover must be at least $5 million", sub: "Upload a certificate showing $5 million or more.", button: "Upload insurance", ... }`; then bank and the rest as today.
- The installer usual-electrician sub becomes `"Their name and licence number. We use them on your jobs once they're an approved electrician with us."`

- [ ] **Step 1: Write failing tests.** Add `electrician licence and cover`: missing licence beats missing bank; expired licence wording; cover 2,000,000 warns; a null cover warns; `worksUnderRec` skips the cover check; an installer never gets the licence or cover panel. The usual-electrician sub must not match `/price/i`.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/trade-business-m7.test.ts`.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run, expect PASS.** Same command, then `bunx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts tests/trade-business-m7.test.ts
git commit -m "feat(business): warn on missing/expired electrical licence and cover under \$5m"
```

### Task 8: Usual electrician page — no price, one name for the licence

**Files:**
- Modify: `src/routes/_authenticated/field.business_.electrician.tsx`, `src/lib/trade-view.core.ts` (`usualElectricianLine`), `src/components/trade/usual-electrician.tsx` (only if "REC number" appears)
- Test: `tests/usual-electrician-no-price.test.ts`, `tests/trade-business-m7.test.ts`

- [ ] **Step 1: Write failing tests.** `usualElectricianLine({ name: "Sam Lee", licence: "28841" })` gives `"Sam Lee · Licence 28841"` (update both pinned tests). The route source doesn't match `/charge|price/i`, and the visible text has no `REC number`.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/usual-electrician-no-price.test.ts tests/trade-business-m7.test.ts`.
- [ ] **Step 3: Implement.** Intro: `"The electrician who usually does the safety check on your jobs. We use them once they're an approved electrician with us; otherwise we send our own."` Footnote: `"Declared by you, not checked by us."` Update the route comment so it no longer mentions a price.
- [ ] **Step 4: Run, expect PASS.** Same command.
- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/field.business_.electrician.tsx src/lib/trade-view.core.ts src/components/trade/usual-electrician.tsx tests
git commit -m "fix(business): usual electrician page drops price wording; 'licence number' only"
```

### Task 9: Short "How it works" for electricians (copy for Jo to approve)

**Files:**
- Modify: `src/lib/trade-view.core.ts`, `src/routes/_authenticated/field.guide.tsx`, `src/routes/_authenticated/field.business.tsx`
- Test: `tests/electrician-guide.test.ts`

**Exact copy (Jo approves before Step 3):**

```ts
export const ELECTRICIAN_GUIDE_STEPS = [
  { title: "Take the job", body: "We text and email you each offer. Accept it in My work if you can do it." },
  { title: "Book the PIESA", body: "Offer the owner 3 times for the Pre Insulation Electrical Safety Assessment (PIESA). It's booked once they pick one." },
  { title: "Do the PIESA in Mitti", body: "Fill in the PIESA form on site and take the photos in Mitti. If fixes are needed, add your price for them on the form. Press Complete when it's finished." },
  { title: "Fixes, if needed", body: "If the owner says yes to the fixes, book a time with them, do the work and fill in the fixes form in Mitti. Press Complete when done." },
] as const;
export const ELECTRICIAN_GUIDE_WORDS = {
  eyebrow: "Electrician guide",
  title: "How every job works",
  sub: "One minute. Four steps and getting paid.",
  paidTitle: "Getting paid",
  paidBody: "We pay your agreed rate 7 days after we approve your completed form. A form that isn't finished can't be paid.",
  back: "Back to My work",
} as const;
```

- [ ] **Step 1: Write the failing test.** The two constants equal the copy above. `field.guide.tsx` loads `getTradeBusiness` and renders `ELECTRICIAN_GUIDE_STEPS` when `kind === "electrician"`, and leaves `GUIDE_STEPS` unchanged otherwise. On `field.business.tsx` the guide row sub is `"One minute: every job and getting paid"` for electricians and the same as today for installers. `bun scripts/scan-retired-terms.ts` passes on the new copy.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/electrician-guide.test.ts`.
- [ ] **Step 3: Implement.** In the electrician branch, the page uses `TradeShell installer={false}`, without `NoFormNoPay` or the photos/pay lines.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/electrician-guide.test.ts tests/installer-states.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/routes/_authenticated/field.guide.tsx src/routes/_authenticated/field.business.tsx tests/electrician-guide.test.ts
git commit -m "feat(guide): short How it works for electricians"
```

### Task 10: Record the rule and verify everything

**Files:**
- Modify: `src/config/workflow-decisions.ts` (`partnerPeople.leadCrew`), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` (one line), `src/lib/AGENTS.md` (amend the decision 161 and Mitti access lines: only Leads, and the Ready Check needs a CII-cleared Lead)

- [ ] **Step 1:** Add `leadCrew: { by: "Jo 27–28 Oct 2026", installerRoles: ["lead", "crew"], mittiOnlyFor: "lead", leadNoEmailUses: "business_office_email", changeableBy: ["office", "business_owner"], effect: "immediate", everyInstallerNeedsCii: true, officeInvitesMittiByHand: true }`, plus the matching one-line rules in the two docs.
- [ ] **Step 2: Run the full checks**

Run: `bun run test` · Expected: all pass, no new failures.
Run: `bunx tsc --noEmit` · Expected: no new errors.
Run: `bun scripts/scan-retired-terms.ts` · Expected: ends `0 customer-visible (failing).`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/workflow-decisions.ts docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md src/lib/AGENTS.md
git commit -m "docs: record Lead/Crew and Mitti-for-Leads rule (Jo 27–28 Oct 2026)"
```

Going live (separate, Jo-approved): a read-only check of live `worker_role` values, then apply `0229_team_lead_crew.sql`, then push and check Team on the TEST businesses on a phone and a computer.
