# Installer pages Part 1 · F. My business and Team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Team page where the boss (or Jo) adds people without an email, marks each one Lead or Crew (only a Lead can run an install day; Crew get Mitti only if the office adds them), people added there sign the worker declarations by link before they can go on a job, electrician bosses are asked for licences, and My business warns about a missing or expired electrical licence and cover under $5m, with plain words and a short electrician "How it works".

**Architecture:** Built on the Lead/Crew code already on main from PR #59 (preflight ruling 1). `src/lib/worker-role.core.ts` stays the ONE place for the rules: `effectiveWorkerRole`, `workerEmailKey`, `sameWorkerEmail`, `certOrFilter`, `mittiEmailFor`, `roleSwitchMittiAction`. `setWorkerRole` (`worker-links.functions.ts`) stays the one switch, and `WorkerRoleSwitch` stays the one button on Team and Partners › People. This plan changes those to Jo's 29 Oct answers (null = Lead, Crew keeps Mitti), adds the install-day Lead and Ready Check gates, the Team add sheet and the signing link. One new pending migration, `0230_team_declarations_due.sql`, adds only `declarations_due`. The email change stays in the existing `0229_worker_email_optional.sql`. Signing reuses the existing `/join/<token>` completion link. The old `/partner/workers` "Your staff" page is deleted and its address redirects to Team.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun:test, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md`, section F only (F1–F9).

## Jo's answers (29 Oct 2026)

1. People already on a team start as Lead, so nobody loses Mitti. `worker_role` null reads as Lead. Approved.
2. Ready Checks: no Lead and no CII check is added for Ready Checks (the Mitti login gate is answer 7). F5 still stands: every installer, Lead and Crew, must be CII-certified (install days keep the CII check).
3. People the boss adds on the Team page MUST sign the 6 worker declarations (`workerDeclarations`, `WORKER_DECLARATIONS_VERSION`). They're added now with `declarations_due = true`, then get their own `/join/<token>` link (the existing completion link). Until they sign they can't be sent to any job: no visit allocation, no Ready Check, not in the install crew or Lead picker. No link until the boss adds a mobile or email. The boss copies the link and sends it themself, as the completion link works today. No new text or email is added. People already on teams are not affected (`declarations_due` defaults to false).
4. Jo switches Lead/Crew in Partners › People. Approved.
5. $5m cover check is for electricians only. Lead/Crew is for installer staff only (electrician staff keep Mitti as today). Proceeding as proposed.
6. Electrician guide copy in Task 9 approved exactly as written.
7. Crew CAN be sent to a Ready Check if they have a Mitti login (the office adds people to Mitti by hand, as today). The Ready Check gate is "has a Mitti login" (plus the existing CII and signed-declarations gates), not "is Lead". Crew without a Mitti login get the existing "Add them in Mitti first" refusal.
8. Switching someone from Lead to Crew does NOT remove their Mitti and does NOT raise an office item. Crew still can't be the install-day Lead (only Leads can be picked as Lead in plan D's Job-page picker); Crew can still be install crew members.
9. Only Leads are auto-eligible for Mitti invites, as before. The office still invites by hand and `MITTI_AUTO_INVITE_ENABLED` is unchanged. Crew get Mitti only if the office adds them.

## Already on main (PR #59, checked 29 Oct 2026) — reuse, don't re-create

- `worker-role.core.ts`: `WorkerRole`, `effectiveWorkerRole`, `workerEmailKey(e)` (blank → `""`, never matches), `sameWorkerEmail`, `certOrFilter`, `mittiEmailFor({ role, ownEmail, businessEmail })`, `roleSwitchMittiAction`, `canChangeWorkerRole`, `WORKER_ROLE_CHANGED_EVENT`.
- `setWorkerRole` (`worker-links.functions.ts`), `WorkerRoleSwitch` (`components/portal/worker-role-switch.tsx`), already on Team (`field.business_.team.tsx`) and Partners › People (`partner-people.tsx`).
- `InvitePerson.crew` + `CREW_SKIP` (`mitti-invite.core.ts`), `workerRolesFor` (`mitti-invite.server.ts`), `TeamMemberView.workerRole`, the office People `workerRole`.
- `saveWorker` already accepts a blank email. `docs/pending-migrations/0229_worker_email_optional.sql` (drops `email NOT NULL`, adds `partner_workers_email_not_blank`) with `tests/worker-email-optional-db.test.ts`.
- Tests: `tests/worker-role-crew.test.ts`, `tests/worker-role-crew-server.test.ts`.

What changes against Jo's answers: today a null role is Crew unless the person has Mitti access, and Lead → Crew deactivates Mitti (`onPartnerPersonDemoted`, `mittiRemovalStep` `demoted`). Task 2 changes both.

## Interfaces with plan D

- Plan D (`2026-10-28-installer-part1-d-todays-job.md`, Tasks 4–5) has ONE crew + Lead picker on the Job page. That picker reads `crewStaff` → `StaffOption`. This plan adds `StaffOption.workerRole?: WorkerRole | null` (from `effectiveWorkerRole`) and `StaffOption.declarationsDue?: boolean`. `crewSelectionProblems` refuses a Crew Lead (Task 3) and anyone with `declarationsDue` as Lead or crew member (Task 4b).
- Order: F runs before D (run order E, B, A, F, C, D, G). F's picker tests live in F's own files (`tests/team-lead-crew-picker.test.ts`, `tests/team-sign-declarations.test.ts`), never in D's `tests/installer-part1-d.test.ts`. D4 keeps these two checks when it rewrites the Lead branch. F changes no picker markup.

## Global Constraints

- Only F1–F9. Nothing from sections A–E or G is done here. Plan D owns the crew picker. F only adds the two `StaffOption` facts and their checks.
- One Lead/Crew rule: `effectiveWorkerRole`. One switch: `setWorkerRole` + `WorkerRoleSwitch`. One email key: `worker-role.core`'s `workerEmailKey`/`sameWorkerEmail`/`certOrFilter`. Never add a second copy.
- No live SQL. `0230_team_declarations_due.sql` is written to `docs/pending-migrations/` and proven on PGlite. Going live is a separate step Jo approves. It needs `0229` live first.
- Code that reads `declarations_due` (Task 4b) is not deployed until 0230 is live. If the branch must ship sooner, every read falls back with `isMissingDbObject` (`schema-compat.core.ts`) to "not due", the way plan A Task 6 does (preflight ruling 10).
- An empty or missing email never matches another person: lookups go by worker id, or through `certOrFilter`/`sameWorkerEmail`.
- Mitti stays office-run: `MITTI_AUTO_INVITE_ENABLED` is unchanged and the office invites by hand. Only Leads are auto-eligible for invites. Switching someone to Crew leaves their Mitti alone and raises no office item.
- Ready Check gate = has a Mitti login (plus the existing CII and signed-declarations gates), never "is Lead". Install-day Lead = Leads only.
- Lead/Crew changes take effect straight away. They don't re-pend approval: `worker_role` is not in `repend_worker_identity`.
- The look stays the same. Use the existing M7 kit classes only.
- Server functions use the literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain.
- Line numbers are hints; find edit points by text.

## Review Focus

1. Null role reads as Lead; switching to Crew keeps Mitti and records one `worker_role_changed` row only → Task 2 `null is Lead` and `switch to crew leaves Mitti alone`.
2. Crew is never the install Lead; Crew with a Mitti login can do a Ready Check, without one gets "Add them in Mitti first" → Task 3 `crew is never the install Lead`, `ready check needs a Mitti login, not Lead`.
3. Two people with no email never share a CII, notice or Mitti match → Task 2b `blank emails never match`.
4. Added on Team and not signed → refused for both visits and as Lead or crew; no link without a mobile or email; signing clears `declarations_due` once → Task 4b `unsigned people can't go on jobs`.
5. Electrician business: missing or expired licence comes before bank; cover under $5m warns unless under a REC → Task 7 `electrician licence and cover`.

---

### Task 1: Migration — `declarations_due` only (PGlite proof only)

**Files:**
- Create: `docs/pending-migrations/0230_team_declarations_due.sql`, `docs/pending-migrations/0230_team_declarations_due.rollback.sql`
- Test: `tests/team-declarations-due-db.test.ts`

**Interfaces:** Produces `partner_workers.declarations_due boolean NOT NULL DEFAULT false`, with `COMMENT ON COLUMN`: "Jo 29 Oct 2026: true = added on Team, must sign the worker declarations by link before any job." No email change (0229 has it) and no `worker_role` check (the existing one stays; preflight ruling 2).

- [ ] **Step 1: Write the failing test**

```ts
// Proves 0230 on PGlite after 0229 (nothing live). Table mirrors tests/worker-email-optional-db.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
const MIG = join(import.meta.dir, "..", "docs", "pending-migrations");
const read = (f: string) => readFileSync(join(MIG, f), "utf8");
const B1 = "10000000-0000-4000-8000-000000000001";
async function db() {
  const d = new PGlite();
  await d.exec(`CREATE TABLE public.partner_workers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, full_legal_name text NOT NULL, email text NOT NULL,
    mobile text, trade_role text NOT NULL, worker_role text CHECK (worker_role IS NULL OR worker_role = ANY (ARRAY['lead','crew'])),
    CONSTRAINT partner_workers_business_id_email_key UNIQUE (business_id, email));
    INSERT INTO partner_workers (business_id, full_legal_name, email, trade_role) VALUES ('${B1}', 'Old', 'old@biz.com.au', 'installer');`);
  await d.exec(read("0229_worker_email_optional.sql"));
  return d;
}
const add = (d: PGlite, name: string, role: string | null, due?: boolean) =>
  d.query(`INSERT INTO partner_workers (business_id, full_legal_name, email, trade_role, worker_role${due === undefined ? "" : ", declarations_due"}) VALUES ($1, $2, NULL, 'installer', $3${due === undefined ? "" : ", $4"})`, due === undefined ? [B1, name, role] : [B1, name, role, due]);

describe("0230 declarations_due (practice database)", () => {
  test("existing rows read false; a Team add can be true; safe to run twice", async () => {
    const d = await db(); const sql = read("0230_team_declarations_due.sql");
    await d.exec(sql); await d.exec(sql);
    await add(d, "New", "crew", true);
    expect((await d.query(`SELECT full_legal_name, declarations_due FROM partner_workers ORDER BY full_legal_name`)).rows).toEqual([{ full_legal_name: "New", declarations_due: true }, { full_legal_name: "Old", declarations_due: false }]);
  });
  test("the existing worker_role check allows only null, lead and crew; 0230 adds no second one", async () => {
    const d = await db(); await d.exec(read("0230_team_declarations_due.sql"));
    await add(d, "L", "lead"); await add(d, "C", "crew"); await add(d, "N", null);
    await expect(add(d, "B", "boss")).rejects.toThrow();
    const n = await d.query<{ n: number }>(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'partner_workers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%worker_role%'`);
    expect(n.rows[0]!.n).toBe(1);
    expect(read("0230_team_declarations_due.sql")).not.toMatch(/DROP NOT NULL|worker_role/);
  });
  test("rollback drops only declarations_due", async () => {
    const d = await db(); await d.exec(read("0230_team_declarations_due.sql")); await d.exec(read("0230_team_declarations_due.rollback.sql"));
    const cols = (await d.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'partner_workers'`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain("declarations_due");
    expect(cols).toContain("worker_role");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `bun test tests/team-declarations-due-db.test.ts`. Expected: FAIL (0230 files missing).
- [ ] **Step 3: Write the migration.** `ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS declarations_due boolean NOT NULL DEFAULT false;` plus the comment. Header: "Needs 0229 first. Safe to run twice. Not applied live until Jo approves." Rollback: `ALTER TABLE public.partner_workers DROP COLUMN IF EXISTS declarations_due;`.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-declarations-due-db.test.ts tests/worker-email-optional-db.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add docs/pending-migrations/0230_team_declarations_due*.sql tests/team-declarations-due-db.test.ts
git commit -m "db(pending): declarations_due for people added on Team, proven on PGlite"
```

### Task 2: Lead/Crew follows Jo — null is Lead, switching to Crew keeps Mitti

**Files:**
- Modify: `src/lib/worker-role.core.ts` (`effectiveWorkerRole`, `roleSwitchMittiAction`, header comment; delete `hasMittiAccessToday`, `emailStillUsedByAnotherLead` and `ACCESS_RECORDS` once grep shows no user)
- Modify: `src/lib/worker-links.functions.ts` (`setWorkerRole`: drop the `deactivate` branch; doc comment)
- Modify: `src/lib/mitti-invite.core.ts` (`CREW_SKIP` text; `RemovalPerson.demoted` and its branch and reason removed)
- Modify: `src/lib/mitti-invite.server.ts` (`loadPerson` and `workerRolesFor` call the new `effectiveWorkerRole`; `workerRolesFor` no longer reads Mitti records or profiles; delete `onPartnerPersonDemoted`)
- Test: `tests/worker-role-crew.test.ts`, `tests/worker-role-crew-server.test.ts`

**Interfaces:**
- `export function effectiveWorkerRole(p: { tradeRole: string; stored: string | null | undefined }): WorkerRole | null`. Non-installers → null; `"crew"` only when stored `"crew"`; otherwise `"lead"` (Jo answer 1).
- `export function roleSwitchMittiAction(from: WorkerRole, to: WorkerRole): "invite" | "none"`. Crew → Lead → `"invite"`; anything else → `"none"` (Jo answer 8).
- `CREW_SKIP = "Crew aren't invited automatically — the office adds them to Mitti by hand."` (Jo answer 9). `inviteEligibility` is otherwise unchanged.
- `workerRolesFor(workers)` keeps its signature and returns `effectiveWorkerRole` per worker.
- `setWorkerRole` keeps its input, permission check and its one `admin_config_events` row. To Lead runs `onPartnerPersonApproved`; to Crew does nothing in Mitti.

- [ ] **Step 1: Update the tests (they fail against today's code).** In `tests/worker-role-crew.test.ts` replace the "null counts as Crew…" test, the "(c)/(d) switching" test, the "(c) Lead → Crew deactivates…" test and the "(c) the seat is kept…" test with:

```ts
test("null counts as Lead (Jo 29 Oct answer 1); Crew only when stored", () => {
  expect(effectiveWorkerRole({ tradeRole: "installer", stored: null })).toBe("lead");
  expect(effectiveWorkerRole({ tradeRole: "installer", stored: undefined })).toBe("lead");
  expect(effectiveWorkerRole({ tradeRole: "installer", stored: "crew" })).toBe("crew");
  expect(effectiveWorkerRole({ tradeRole: "installer", stored: "lead" })).toBe("lead");
  expect(effectiveWorkerRole({ tradeRole: "electrician", stored: null })).toBeNull();
});
test("switching: to Lead invites; to Crew leaves Mitti alone (Jo answer 8)", () => {
  expect(roleSwitchMittiAction("crew", "lead")).toBe("invite");
  expect(roleSwitchMittiAction("lead", "crew")).toBe("none");
  expect(roleSwitchMittiAction("lead", "lead")).toBe("none");
  expect(readFileSync("src/lib/worker-links.functions.ts", "utf8")).not.toContain("onPartnerPersonDemoted");
  expect(readFileSync("src/lib/mitti-invite.core.ts", "utf8")).not.toContain("demoted");
});
test("crew never auto-invited (Jo answer 9)", () => {
  expect(CREW_SKIP).toBe("Crew aren't invited automatically — the office adds them to Mitti by hand.");
});
```

Drop `hasMittiAccessToday` and `emailStillUsedByAnotherLead` from the imports, and add `import { readFileSync } from "node:fs";`. Keep the "(a) the Mitti invite only invites Leads", "(b) … business's own email" and permission tests as they are.

In `tests/worker-role-crew-server.test.ts`: set the fixture worker `…a2` ("Cam Crew") to `worker_role: "crew"` so the switch test keeps its "Cam Crew: Crew → Lead" summary. Replace "a null-role person with no Mitti access is Crew…" with "a stored Crew is never searched or invited" (same assertions, `reason` = the new `CREW_SKIP`). Delete "a null-role person who already has Mitti access counts as Lead". Add `expect((await inv.workerRolesFor([{ id: "x", trade_role: "installer", worker_role: null, profile_id: null }])).get("x")).toBe("lead");`. Replace "Lead → Crew deactivates the Mitti user…" with:

```ts
test("switch to crew leaves Mitti alone", async () => {
  isAdmin = true;
  tables["admin_config_events"]!.push({ event_type: "mitti_user_invited", details: { worker_id: "00000000-0000-4000-8000-0000000000a1", email: "office@realinsul.com.au", mitti_user_id: "u1" } });
  expect(await setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a1", role: "crew" } })).toMatchObject({ changed: true, role: "crew" });
  expect(calls).toEqual([]);
  expect(events().map((e) => e["event_type"])).toEqual(["mitti_user_invited", "worker_role_changed"]);
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/worker-role-crew.test.ts tests/worker-role-crew-server.test.ts`.
- [ ] **Step 3: Implement** as in Interfaces. `grep -rn "hasMittiAccessToday\|emailStillUsedByAnotherLead\|onPartnerPersonDemoted\|demoted" src scripts` must be empty afterwards. Update the file header comment of `worker-role.core.ts` to "null = Lead (Jo 29 Oct); switching to Crew leaves Mitti alone".
- [ ] **Step 4: Run, expect PASS.** Same command plus `bun test tests/mitti-invite.core.test.ts tests/mitti-invite.server.test.ts tests/office-build-b.core.test.ts`, then `bunx tsc --noEmit` (no new errors).
- [ ] **Step 5: Commit**

```bash
git add src/lib/worker-role.core.ts src/lib/worker-links.functions.ts src/lib/mitti-invite.core.ts src/lib/mitti-invite.server.ts tests/worker-role-crew.test.ts tests/worker-role-crew-server.test.ts
git commit -m "feat(team): null role is Lead; switching to Crew keeps Mitti (Jo 29 Oct)"
```

### Task 2b: Email readers null-safe (types follow 0229)

**Files:**
- Modify: `src/integrations/supabase/types.ts` (`partner_workers` Row `email: string | null; declarations_due: boolean`, Insert/Update `email?: string | null; declarations_due?: boolean`)
- Modify (null-safe, found by `bunx tsc --noEmit`): `src/lib/trade-view.server.ts` (team rows) and any other file tsc reports
- Test: `tests/team-no-email.test.ts`

**Interfaces:** No new helpers. Every comparison uses `sameWorkerEmail`/`certOrFilter`; every stored key uses `workerEmailKey` plus `worker_id`. The portal login invite already refuses a blank email (`tradeAccessBlocker`: "This person needs a valid email."); keep it.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { certOrFilter, sameWorkerEmail, workerEmailKey } from "../src/lib/worker-role.core";
import { tradeAccessBlocker } from "../src/lib/trade-access.core";
const src = (p: string) => readFileSync(p, "utf8");
test("blank emails never match", () => {
  expect(sameWorkerEmail(null, null)).toBe(false);
  expect(sameWorkerEmail("", " ")).toBe(false);
  expect(workerEmailKey(null)).toBe("");
  expect(certOrFilter([{ id: "a", email: null }, { id: "b", email: "" }])).toBe("worker_id.in.(a,b)");
});
test("types follow 0229 and 0230; login invite still refuses a blank email", () => {
  const t = src("src/integrations/supabase/types.ts");
  const pw = t.slice(t.indexOf("partner_workers: {"), t.indexOf("Relationships", t.indexOf("partner_workers: {")));
  expect(pw.match(/email: string \| null/g)?.length).toBeGreaterThanOrEqual(1);
  expect(pw).toContain("declarations_due: boolean");
  const w = { removed_at: null, approval_status: "approved", email: null, trade_role: "electrician", certification_status: null };
  expect(tradeAccessBlocker(w as never, true)).toBe("This person needs a valid email.");
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-no-email.test.ts`. Expected: FAIL on the `types.ts` lines (the email lines already pass; they pin PR #59).
- [ ] **Step 3: Implement.** Update `types.ts`, run `bunx tsc --noEmit`, fix each new `email` null error with the existing helpers (never a new key function). Team rows pass `email: w.email ?? null`.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-no-email.test.ts tests/worker-role-crew.test.ts tests/worker-compliance.test.ts tests/worker-auto-approve.test.ts tests/worker-auto-approve-db.test.ts`, then `bunx tsc --noEmit` (no new errors).
- [ ] **Step 5: Commit**

```bash
git add src/lib src/integrations/supabase/types.ts tests/team-no-email.test.ts
git commit -m "fix(team): email readers null-safe; types follow the optional email"
```

### Task 3: Install-day Lead = Leads only; Ready Check goes by Mitti login

**Files:**
- Modify: `src/lib/visit-allocation.core.ts` (`AllocationCandidate.workerRole`, `ALLOCATION_REASON.crew`, `allocationBlocker`, decision 161 comment), `src/lib/visit-allocation.server.ts` (Mitti lookup email), `src/lib/piisa-a3.core.ts` (`StaffOption.workerRole`, `staffFromRecords`, `CREW_NOT_LEAD_MESSAGE`, `crewSelectionProblems`), `src/lib/piisa-a3.server.ts` (`crewStaff` selects `worker_role` and `businesses(email)`)
- Test: `tests/visit-allocation.test.ts`, create `tests/team-lead-crew-picker.test.ts`

**Interfaces:**
- `AllocationCandidate` gains `workerRole?: WorkerRole | null` and `businessEmail?: string | null`. `ALLOCATION_REASON.crew = "Crew can't be the install-day Lead — pick a Lead."` `allocationBlocker` order: removed → `ready_check` returns null (Jo answers 2 and 7; the Mitti login gate is the server's `addInMittiFirst`) → not installer → `workerRole === "crew"` → CII / White Card as today.
- `allocateVisit`: `lookupEmail` for a real job = `mittiEmailFor({ role: cand.workerRole ?? null, ownEmail: cand.email, businessEmail: cand.businessEmail }).email ?? ""` (TEST path unchanged). No Mitti user → `addInMittiFirst` refuses before anything is recorded, as today.
- `StaffOption.workerRole?: WorkerRole | null`, set in `staffFromRecords` with `effectiveWorkerRole({ tradeRole: w.trade_role, stored: w.worker_role })`.
- `export const CREW_NOT_LEAD_MESSAGE = "is Crew, so can't be the Lead. Make them Lead on the Team page first.";` `crewSelectionProblems` pushes `` `${lead.name} ${CREW_NOT_LEAD_MESSAGE}` `` when the chosen Lead has `workerRole === "crew"`. Crew members may be Lead or Crew.

- [ ] **Step 1: Write the failing tests.** Create `tests/team-lead-crew-picker.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { allocationBlocker, ALLOCATION_REASON } from "../src/lib/visit-allocation.core";
import { crewSelectionProblems, CREW_NOT_LEAD_MESSAGE } from "../src/lib/piisa-a3.core";
const src = (p: string) => readFileSync(p, "utf8");
const today = "2026-10-29";
const cleared = { workerId: "a", name: "Ann", tradeRole: "installer", email: null, mobile: "0412345678",
  clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } };

describe("crew is never the install Lead", () => {
  test("allocation", () => {
    expect(ALLOCATION_REASON.crew).toBe("Crew can't be the install-day Lead — pick a Lead.");
    expect(allocationBlocker("install", { ...cleared, workerRole: "crew" }, today)).toBe(ALLOCATION_REASON.crew);
    expect(allocationBlocker("install", { ...cleared, workerRole: "lead" }, today)).toBeNull();
    expect(allocationBlocker("install", { ...cleared, workerRole: null }, today)).toBeNull();
  });
  test("picker", () => {
    const s = (id: string, name: string, workerRole: "lead" | "crew") => ({ workerId: id, name, eec: `CII-${id}`, eecVerified: true, workerRole });
    const staff = [s("a", "Ann Crew", "crew"), s("b", "Bob Lead", "lead")];
    expect(crewSelectionProblems({ lead: "a", additional: [] }, staff).problems).toEqual([`Ann Crew ${CREW_NOT_LEAD_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [{ workerId: "a" }] }, staff).problems).toEqual([]);
  });
});
describe("ready check needs a Mitti login, not Lead", () => {
  test("crew and uncleared people pass the pure check; the server gate is the Mitti login", () => {
    expect(allocationBlocker("ready_check", { ...cleared, workerRole: "crew" }, today)).toBeNull();
    expect(allocationBlocker("ready_check", { ...cleared, clearance: null }, today)).toBeNull();
    const srv = src("src/lib/visit-allocation.server.ts");
    const fn = srv.slice(srv.indexOf("export async function allocateVisit"));
    expect(fn).toContain("mittiEmailFor(");
    expect(fn.indexOf("addInMittiFirst(")).toBeLessThan(fn.indexOf("VISIT_ALLOCATED_EVENT"));
    expect(src("src/lib/piisa-a3.server.ts")).toContain("worker_role");
  });
});
```

Adjust fixture fields to the real `AllocationCandidate`/`StaffOption` shapes if tsc complains; keep the assertions.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-lead-crew-picker.test.ts`.
- [ ] **Step 3: Implement** as in Interfaces. Update the decision 161 comment at the top of `visit-allocation.core.ts`: Ready Check = anyone still on the list with a Mitti login (Lead or Crew); install day = CII-cleared installers who are Leads.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-lead-crew-picker.test.ts tests/visit-allocation.test.ts tests/allocation-hardening-db.test.ts tests/piesa-allocation-db.test.ts tests/piisa-crew-ready-check.test.ts tests/piisa-crew-roster.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/visit-allocation.core.ts src/lib/visit-allocation.server.ts src/lib/piisa-a3.core.ts src/lib/piisa-a3.server.ts tests/team-lead-crew-picker.test.ts tests/visit-allocation.test.ts
git commit -m "feat(team): only Leads run install days; Ready Check goes by Mitti login"
```

### Task 4: Team server — add without email, plain login ask

**Files:**
- Modify: `src/lib/trade-view.core.ts`, `src/lib/trade-view.server.ts`, `src/lib/trade-view.functions.ts`
- Test: `tests/trade-business-m7.test.ts`, `tests/installer-states.test.ts`, create `tests/team-add-person.test.ts`

**Interfaces:**
- `TeamMemberView` keeps its existing `workerRole` and gains `mittiRecorded: boolean` (true when the worker has a `mitti_user_linked`/`mitti_user_invited`/`mitti_invite_linked`/`mitti_user_reactivated`/`mitti_invite_office_done` record).
- `export function teamMittiLine(m: Pick<TeamMemberView, "role" | "workerRole" | "mittiLogin" | "mittiRecorded">): string`. Prefix `"Lead · "` / `"Crew · "` from `workerRole`, none when null (electricians). `email_changed` → `${prefix}Mitti to re-check`; `linked` or `mittiRecorded` → `${prefix}Mitti ✓`; otherwise Crew → `"Crew · no Mitti"`, Lead → `"Lead · office adding to Mitti"`, electrician → `"Mitti login not set"`. `teamFactsLine` uses it in place of the old Mitti text.
- `TEAM_RULE = "Every installer, Lead and Crew, needs a CII certificate checked by our office. Only a Lead can run an install day. Crew can do Ready Checks once our office adds them to Mitti."`
- `TEAM_ADD_SHEET` becomes `{ title: "Add a team member", bodyInstaller: "Email and mobile can wait. They sign their declarations by link, and we check their CII certificate, before they go on a job.", bodyElectrician: "Email and mobile can wait. They sign their declarations by link before they go on a job. Each electrician needs a current electrical licence.", name: "Full name", licence: "Electrical licence number", role: "Lead or Crew", lead: "Lead · can run install days", crew: "Crew · can't lead an install day", mobile: "Mobile (optional)", email: "Email (optional)", button: "Add to team", cancel: "Cancel" }`. The invite-link fields and `inviteTextLine`/`inviteContact` stay only while `field.business_.team.tsx` uses them (removed in Task 5).
- `TEAM_LOGIN = { button: "Ask the office to send a login", asked: "Asked the office. They'll send the login." }`
- `export async function tradeAddTeamPerson(userId: string, p: { name: string; workerRole: WorkerRole; mobile: string | null; email: string | null; licenceNumber: string | null }): Promise<{ workerId: string }>`. Boss only (`bossOrThrow`). `trade_role` from `c.kind`. Installers: `qualification: installerQualification({})`, `certification_status: "unverified"`, `worker_role: p.workerRole`. Electricians: requires `licenceNumber` ("Add their electrical licence number."), `worker_role: null`. Always `approval_status: "pending"`, `declarations_due: true` (Jo answer 3), `added_by: userId`, mobile through `crewMobileInput`. Error `23502` → "Adding someone without an email needs the office's database update first."; `23505` → "Someone with that email is already on your team."
- Server fn `addTeamPerson`. No new role-switch function: Team and People keep `setWorkerRole` via `WorkerRoleSwitch`.

- [ ] **Step 1: Write failing tests.** Update the pinned `TEAM_RULE` and `teamFactsLine` expectations in `trade-business-m7.test.ts`. Rewrite the `TEAM_ADD_SHEET` assertions in `installer-states.test.ts`. Create `tests/team-add-person.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { teamMittiLine } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const m = (workerRole: "lead" | "crew" | null, mittiLogin: "linked" | "not_set" | "email_changed", mittiRecorded = false) =>
  ({ role: workerRole ? "installer" as const : "electrician" as const, workerRole, mittiLogin, mittiRecorded });
test("teamMittiLine", () => {
  expect(teamMittiLine(m("crew", "not_set"))).toBe("Crew · no Mitti");
  expect(teamMittiLine(m("crew", "not_set", true))).toBe("Crew · Mitti ✓");
  expect(teamMittiLine(m("lead", "linked"))).toBe("Lead · Mitti ✓");
  expect(teamMittiLine(m("lead", "email_changed"))).toBe("Lead · Mitti to re-check");
  expect(teamMittiLine(m("lead", "not_set"))).toBe("Lead · office adding to Mitti");
  expect(teamMittiLine(m(null, "linked"))).toBe("Mitti ✓");
});
test("server wiring", () => {
  const srv = src("src/lib/trade-view.server.ts");
  const add = srv.slice(srv.indexOf("export async function tradeAddTeamPerson"), srv.indexOf("\n}\n", srv.indexOf("export async function tradeAddTeamPerson")));
  expect(add).toContain("c.kind");
  expect(add).not.toContain('trade_role: "installer"');
  expect(add).toContain("declarations_due: true");
  const fns = src("src/lib/trade-view.functions.ts");
  expect(fns).toContain("export const addTeamPerson");
  expect(fns).not.toMatch(/setTeamCrewRole|tradeSetCrewRole/);
  const login = srv.slice(srv.indexOf("export async function tradeRequestLoginInvite"));
  expect(login.slice(0, login.indexOf("\n}\n"))).toContain("tradeChangeRequest(");
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/trade-business-m7.test.ts tests/installer-states.test.ts tests/team-add-person.test.ts`.
- [ ] **Step 3: Implement** as in Interfaces. `tradeBusiness` reads the Mitti records for its worker ids (`mittiRecorded`); `workerRole` keeps coming from `workerRolesFor`.
- [ ] **Step 4: Run, expect PASS.** Same command, then `bunx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts src/lib/trade-view.functions.ts tests/trade-business-m7.test.ts tests/installer-states.test.ts tests/team-add-person.test.ts
git commit -m "feat(team): add people without email; plain login-ask words"
```

### Task 4b: People added on Team sign the declarations by link before any job

**Files:**
- Modify: `src/lib/worker-compliance.core.ts` (message), `src/lib/worker-invite.core.ts` (`completionErrors`, `signLinkBlocker`), `src/lib/worker-invite.functions.ts` (`createWorkerCompletionLink`, `getWorkerInvite`, `submitWorkerInvite` completion branch), `src/routes/join.$token.tsx` (completion form shows the declarations when sent), `src/lib/visit-allocation.core.ts`, `src/lib/visit-allocation.server.ts`, `src/lib/piisa-a3.core.ts`, `src/lib/piisa-a3.server.ts`
- Test: create `tests/team-sign-declarations.test.ts`; update `tests/worker-cert-onboarding.test.ts` only if its `completionErrors` call breaks

**Interfaces:**
- `export const DECLARATIONS_DUE_MESSAGE = "Hasn't signed their worker declarations yet.";` in `worker-compliance.core.ts`.
- `AllocationCandidate` gains `declarationsDue?: boolean`. `ALLOCATION_REASON.unsigned = DECLARATIONS_DUE_MESSAGE`. `allocationBlocker` order becomes: removed → `declarationsDue` (both visits) → the rest as in Task 3. `visit-allocation.server` selects `declarations_due`.
- Go-live (preflight ruling 10): every new `declarations_due` read (`crewStaff`, `visit-allocation.server`, `createWorkerCompletionLink`, `getWorkerInvite`, `submitWorkerInvite`) is not deployed before 0230 is live. If the branch must ship first, wrap each read so `isMissingDbObject(error)` re-reads without the column and treats everyone as not due.
- `StaffOption` gains `declarationsDue?: boolean` (`crewStaff` selects `declarations_due`; `staffFromRecords` copies it). `crewSelectionProblems` pushes `` `${s.name}: ${DECLARATIONS_DUE_MESSAGE}` `` for the Lead and for any listed crew member with `declarationsDue === true`, next to the existing notice/White Card checks.
- `export function signLinkBlocker(w: { trade_role: string; declarations_due: boolean; email: string | null; mobile: string | null; certification_status: string | null }): string | null`. When `declarations_due`: returns `"Add their mobile or email first, then make their link."` if both are blank, otherwise `null` (any trade). When not due: today's rules, i.e. `"Certificate completion links are only for installer workers."` for non-installers and `"This worker's certificate is already verified."` when verified.
- `export function completionErrors(s: { certificate_path?: string; accepted?: string[]; signed_name?: string }, need: { cert: boolean; declarationKeys: string[] } = { cert: true, declarationKeys: [] }): string[]`. The cert error shows only when `need.cert`. When `declarationKeys` is not empty it also uses the same two errors as registration: `"Tick every box before signing."` and `"Type your full name to sign."`
- `createWorkerCompletionLink` selects `declarations_due, email, mobile` and throws `signLinkBlocker(w)` when it's not null (it replaces the two inline checks). Delivery is unchanged: it returns `{ token }` and the Team page shows the `/join/<token>` link with "Copy link" for the boss to send. No text or email is sent (the existing completion flow doesn't send one).
- `getWorkerInvite` (completion mode) reads the worker's `declarations_due` and `certification` and returns `declarations: due ? workerDeclarations(t, businessName) : []` and `needsCert: t === "installer" && !hasEecUpload(certification)`. `hasEecUpload` = `certification.eec_upload.path` is set.
- `submitWorkerInvite` completion branch: `completionErrors(data, { cert: needsCert, declarationKeys: due ? decls.map((d) => d.key) : [] })`, with `needsCert` and `due` worked out the same way. It refuses `"This completion link is no longer available. Ask the business owner for a new one."` for a removed worker, and for an electrician whose `declarations_due` is false. The certificate is merged only when a path is given. When due, after the claim it writes the invite row `signed_name` and `declarations: { version: WORKER_DECLARATIONS_VERSION, accepted: decls, signed_at: now }` (same shape as registration), then sets `partner_workers.declarations_due = false`. If that update fails it un-claims, as today.
- Join page, completion mode: when `inv.declarations.length > 0` it shows heading `"Sign your declarations"`, sub `` `You're on ${inv.businessName}'s team as ${inv.inviteeName}. Read and tick each one, then sign. You can't be sent to jobs until you do.` ``, the existing tick list and "Type your full name to sign", and the certificate fields only when `inv.needsCert`. Button `"Sign"`. Done: `"Thanks — you've signed."` / `` `${inv.businessName} can now send you to jobs once our office has checked your details.` `` The certificate-only wording stays as it is.

- [ ] **Step 1: Write the failing test** `unsigned people can't go on jobs`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { allocationBlocker, ALLOCATION_REASON } from "../src/lib/visit-allocation.core";
import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
import { completionErrors, signLinkBlocker } from "../src/lib/worker-invite.core";
import { DECLARATIONS_DUE_MESSAGE } from "../src/lib/worker-compliance.core";
const src = (p: string) => readFileSync(p, "utf8");
const today = "2026-10-29";
const cleared = { workerId: "a", name: "Ann Lead", tradeRole: "installer", email: null, mobile: "0412345678", workerRole: "lead" as const,
  clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } };

describe("unsigned people can't go on jobs", () => {
  test("allocation refuses both visits until signed", () => {
    expect(allocationBlocker("ready_check", { ...cleared, declarationsDue: true }, today)).toBe(ALLOCATION_REASON.unsigned);
    expect(allocationBlocker("install", { ...cleared, declarationsDue: true }, today)).toBe(ALLOCATION_REASON.unsigned);
    expect(allocationBlocker("ready_check", { ...cleared, declarationsDue: false }, today)).toBeNull();
    expect(ALLOCATION_REASON.unsigned).toBe(DECLARATIONS_DUE_MESSAGE);
  });
  test("picker refuses an unsigned Lead or crew member", () => {
    const s = (id: string, name: string, due: boolean) => ({ workerId: id, name, eec: "E1", eecVerified: true, cleared: true, workerRole: "lead" as const, declarationsDue: due });
    const staff = [s("a", "Ann Lead", true), s("b", "Bob Ok", false)];
    expect(crewSelectionProblems({ lead: "a", additional: [] }, staff).problems).toEqual([`Ann Lead: ${DECLARATIONS_DUE_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [{ workerId: "a" }] }, staff).problems).toEqual([`Ann Lead: ${DECLARATIONS_DUE_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [] }, staff).problems).toEqual([]);
  });
  test("no link without a mobile or email", () => {
    const w = { trade_role: "installer", declarations_due: true, email: null, mobile: null, certification_status: "unverified" };
    expect(signLinkBlocker(w)).toBe("Add their mobile or email first, then make their link.");
    expect(signLinkBlocker({ ...w, mobile: "0412345678" })).toBeNull();
    expect(signLinkBlocker({ ...w, trade_role: "electrician", email: "e@x.au", certification_status: null })).toBeNull();
    expect(signLinkBlocker({ ...w, declarations_due: false, trade_role: "electrician" })).toBe("Certificate completion links are only for installer workers.");
  });
  test("signing needs every tick and a name; certificate only when asked", () => {
    const keys = ["own_behalf", "true_info"];
    expect(completionErrors({ accepted: ["own_behalf"], signed_name: "" }, { cert: false, declarationKeys: keys })).toEqual(["Tick every box before signing.", "Type your full name to sign."]);
    expect(completionErrors({ accepted: keys, signed_name: "Ann Lead" }, { cert: false, declarationKeys: keys })).toEqual([]);
    expect(completionErrors({})).toEqual(["Upload the EEC / Certified Insulation Installer certificate."]);
  });
  test("server wiring", () => {
    const fns = src("src/lib/worker-invite.functions.ts");
    const done = fns.slice(fns.indexOf('inviteMode(inv) === "completion"'), fns.indexOf("Registration mode"));
    expect(done).toContain("declarations: { version: WORKER_DECLARATIONS_VERSION");
    expect(done).toContain("declarations_due: false");
    expect(fns).toContain("signLinkBlocker(");
    expect(src("src/lib/piisa-a3.server.ts")).toContain("declarations_due");
    expect(src("src/lib/visit-allocation.server.ts")).toContain("declarations_due");
    expect(src("src/routes/join.$token.tsx")).toContain("Sign your declarations");
  });
});
```

Adjust the `staff`/`cleared` fixture fields to match the real `StaffOption`/`CrewClearanceFacts` shapes if tsc complains. Keep the assertions as they are.
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-sign-declarations.test.ts`.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-sign-declarations.test.ts tests/team-lead-crew-picker.test.ts tests/worker-cert-onboarding.test.ts tests/worker-invite.test.ts tests/visit-allocation.test.ts tests/piisa-crew-ready-check.test.ts`, then `bunx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/lib src/routes/join.\$token.tsx tests/team-sign-declarations.test.ts tests/worker-cert-onboarding.test.ts
git commit -m "feat(team): people added on Team sign the declarations by link before any job"
```

### Task 5: One Team page (screens)

**Files:**
- Modify: `src/routes/_authenticated/field.business_.team.tsx`, `src/routes/_authenticated/field.business.tsx`, `src/components/portal/worker-compliance.tsx` (`CertLinkInline` optional `label`), `src/lib/trade-view.core.ts` / `trade-view.server.ts` (`TeamMemberView.declarationsDue: boolean`, `TEAM_SIGN`). Not modified: `WorkerRoleSwitch`, `partner-people.tsx` (Jo's switch on People already exists, Jo answer 4).

**Interfaces:** `TEAM_SIGN = { due: "Not signed yet · can't go on jobs", needContact: "Add a mobile or email to send their signing link.", link: "Make signing link" }`. `CertLinkInline({ workerId, name, label? })` uses `label` in place of "Create certificate link for …" when given.
- Test: `tests/team-page.test.ts` (source-reading, house style)

- [ ] **Step 1: Write the failing test.** The Team route: does not import `createWorkerInvite`; uses `addTeamPerson`, `WorkerRoleSwitch`, `TEAM_LOGIN.button`, `TEAM_RULE` and `CertLinkInline`; shows the licence field only when `data.kind === "electrician"`, and the Lead/Crew choice in the add sheet only for installers; carries over Remove using the existing `removeWorker`; and its intro no longer says "Everyone listed here can be given a Ready Check". For a row with `declarationsDue`, it shows `TEAM_SIGN.due`, then `TEAM_SIGN.needContact` when there's no mobile and no email, otherwise `CertLinkInline` with `label={TEAM_SIGN.link}`. `field.business.tsx`: "Add a team member" links to `/field/business/team` and never to `/partner/workers`. `partner-people.tsx` still renders `<WorkerRoleSwitch tone="office"` (non-regression).
- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/team-page.test.ts`.
- [ ] **Step 3: Implement.** The installer intro on Team = `TEAM_RULE`, and the electrician intro = `TEAM_ADD_SHEET.bodyElectrician`. Each installer row keeps the existing `WorkerRoleSwitch` (no new button). The add sheet uses the fields from Task 4. Once someone is added, the sheet closes and their row shows the signing line above (the link also brings the certificate upload for an installer, Task 4b). The `TEAM_RULE` paragraph under the list is removed, so the rule shows once.
- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/team-page.test.ts tests/installer-states.test.ts tests/business-owner-only.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/field.business_.team.tsx src/routes/_authenticated/field.business.tsx src/components/portal/worker-compliance.tsx src/lib/trade-view.core.ts src/lib/trade-view.server.ts tests/team-page.test.ts
git commit -m "feat(team): one Team page; add without email; signing line"
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

### Task 9: Short "How it works" for electricians (copy approved by Jo 29 Oct 2026)

**Files:**
- Modify: `src/lib/trade-view.core.ts`, `src/routes/_authenticated/field.guide.tsx`, `src/routes/_authenticated/field.business.tsx`
- Test: `tests/electrician-guide.test.ts`

**Exact copy (approved, build word for word):**

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
- Modify: `src/config/workflow-decisions.ts` (`partnerPeople.leadCrew`), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` (one line), `src/lib/AGENTS.md` (amend the decision 161 and Mitti access lines)

- [ ] **Step 1:** Add `leadCrew: { by: "Jo 27–29 Oct 2026", replaces: "Jo 28 Oct 2026 (null = Crew unless Mitti access; Lead → Crew deactivates Mitti)", installerRoles: ["lead", "crew"], nullReadsAs: "lead", mittiAutoInviteOnlyFor: "lead", installLeadOnlyFor: "lead", leadNoEmailUses: "business_office_email", changeableBy: ["office", "business_owner"], effect: "immediate", everyInstallerNeedsCii: true, readyCheckNeedsMittiLogin: true, crewSwitchKeepsMitti: true, teamAddedSignDeclarationsByLink: true, signLinkNeedsMobileOrEmail: true, officeInvitesMittiByHand: true }`. The two docs get the matching one-line rules and say they replace the 28 Oct rules: null = Lead; only Leads are auto-invited to Mitti and can be install-day Lead; Ready Check = anyone on the list with a Mitti login, Lead or Crew; switching to Crew leaves Mitti alone; Team-added people sign by link before any job.
- [ ] **Step 2: Run the full checks**

Run: `bun run test` · Expected: all pass, no new failures.
Run: `bunx tsc --noEmit` · Expected: no new errors.
Run: `bun scripts/scan-retired-terms.ts` · Expected: ends `0 customer-visible (failing).`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/workflow-decisions.ts docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md src/lib/AGENTS.md
git commit -m "docs: record Lead/Crew, install Lead and Ready Check Mitti-login rule (Jo 27–29 Oct 2026)"
```

Going live (separate, Jo-approved): `0229_worker_email_optional.sql` first (if not live yet), then a read-only check that live `worker_role` holds only null/`lead`/`crew` and that `declarations_due` doesn't exist yet, then `0230_team_declarations_due.sql`, then push and check Team on the TEST businesses on a phone and a computer. Tell Jo first: once this ships, every existing installer with no role set counts as Lead (Jo answer 1), so plan G's notice page shows them as "(lead installer)".
