# Installer pages Part 1 · A. Add a job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Jo's answers (29 Oct 2026):**
1. Lead-source choices, refusal line and staff line: approved as written in Global Constraints.
2. Address already an open job of another installer: keep refusing it, as today. Only HIV-lead clashes are saved and flagged.
3. Bulk upload: remove for everyone, office included.
4. The `add_installer_job` database function may go live once it passes the PGlite test.
5. Pricing on HIV leads already uses agreed rates; Task 9 only adds tests pinning that.

**Goal:** Make the installer's Add a job page do A1–A9 of the Part 1 spec: lead-source question, HIV-lead clashes saved and flagged, only onboarded usual electricians, no bulk upload, staff told at the start, all-or-nothing save, a "Try again" button, typed addresses and pinned pricing rules.

**Architecture:** Pure rules go in the existing cores (`onsite-ready-check.core.ts`, `add-job-flow.core.ts`, `duplicate-address.core.ts`, `rec-onboarded.core.ts`). Persistence stays in `onsite-ready-check.server.ts`. One new database function, `add_installer_job`, writes owner, property, job, assignment, consent and events in a single transaction, keyed by a request key the phone keeps, so a retry finishes the same job. It is staged in `docs/pending-migrations/` and proven on PGlite. Until it is applied, the server falls back to today's step-by-step save.

**Tech Stack:** TanStack Start (React), Supabase/PostgREST, PGlite for DB proofs, bun:test (source-reading tests for wiring, real unit tests for `*.core.ts`).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` (section A only)

## Global Constraints

- Build only A1–A9. Do not change the look: reuse the existing classes, `CARD`, `FieldError`, `PRIMARY_BTN` and radio markup in `add-job-flow.tsx`.
- Still required: owner full name, mobile, email and address (`onsiteProblems` unchanged). The optional Ready Check day/time card stays as it is.
- Left as is: no "who manages it" choice. Reinsulate's electrician stays $350 (`installer-paid-electricians.core.ts` untouched).
- Lead-origin choices (proposed, Q1): `owner_contacted` "The owner contacted me" · `referral` "Referral or past customer" · `door_knock` "Door-knocking" · `cold_call` "Cold call". Blocked: `door_knock`, `cold_call`.
- Door-knock refusal (proposed, Q1): "Jobs from door-knocking or cold calls can't be added — the VEU Code of Conduct doesn't allow them."
- Staff line (proposed, Q1): "Only your business owner can add jobs. Ask them to add this customer for you."
- Retry wording is exactly "Try again" everywhere on Add a job.
- Server functions are literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains. Never import `@tanstack/react-start/server` in `*.functions.ts`.
- DB change only as `docs/pending-migrations/add-installer-job-atomic.sql` + `.undo.sql`, proven on PGlite. This plan never applies it live.
- qa_test and real jobs never match each other (`practiceMatches` unchanged). Tests use fake TEST data only.

## Review Focus

1. The signal drops after the server saved, then the installer taps Try again. Expect the same job number and no second job (Task 6: same request key twice → one job).
2. The address matches a *cancelled* HIV lead, or a qa_test lead for a real job. Expect a normal save with no flag (Task 2 test).
3. Reinsulate's usual electrician has no PIESA rate because Reinsulate pays its own electricians. Expect it to count as onboarded (Task 3 test).
4. A typed address with an ACT postcode, or with no street number. Expect it still refused. Picking from the list again clears "typed" (Task 8 test).
5. Someone who is staff in one business and owner of another. Expect the owner path for the business they own. Staff-only gets the staff line (Task 5 test).

---

### Task 1: A1 — Ask how they got the customer; refuse door-knocked and cold-called jobs

**Files:**
- Modify: `src/lib/onsite-ready-check.core.ts`, `src/lib/add-job-flow.core.ts` (`AddJobField`, `fieldErrors`), `src/lib/onsite-ready-check.server.ts`, `src/lib/onsite-ready-check.functions.ts`, `src/components/trade/add-job-flow.tsx`
- Modify callers: `scripts/installer-test.ts` (2 calls), `tests/installer-own-job-e2e-db.test.ts`, `tests/journey-a1-complete-route-db.test.ts`. Pass `leadOrigin: "owner_contacted"` in opts.
- Test: `tests/add-job-lead-origin.test.ts` (new)

**Interfaces:**
- Produces (in `onsite-ready-check.core.ts`): `type LeadOrigin = "owner_contacted" | "referral" | "door_knock" | "cold_call"`; `LEAD_ORIGIN_QUESTION = "How did you get this customer?"`; `LEAD_ORIGINS: { value: LeadOrigin; label: string }[]`; `LEAD_ORIGIN_MISSING = "Choose how you got this customer."`; `LEAD_ORIGIN_BLOCKED` (refusal line); `leadOriginProblem(o: LeadOrigin | null | undefined): string | null`.
- Produces: `startOnsiteReadyCheckFor` opts gain `leadOrigin?: LeadOrigin | null`, and the `installer_job_added` event details gain `lead_origin`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAD_ORIGINS, LEAD_ORIGIN_BLOCKED, LEAD_ORIGIN_MISSING, leadOriginProblem } from "../src/lib/onsite-ready-check.core";
import { fieldErrors } from "../src/lib/add-job-flow.core";

test("A1: four choices; door-knock and cold call refused; an answer is required", () => {
  expect(LEAD_ORIGINS.map((o) => o.value)).toEqual(["owner_contacted", "referral", "door_knock", "cold_call"]);
  expect(leadOriginProblem("owner_contacted")).toBeNull();
  expect(leadOriginProblem("referral")).toBeNull();
  expect(leadOriginProblem("door_knock")).toBe(LEAD_ORIGIN_BLOCKED);
  expect(leadOriginProblem("cold_call")).toBe(LEAD_ORIGIN_BLOCKED);
  expect(leadOriginProblem(null)).toBe(LEAD_ORIGIN_MISSING);
  expect(fieldErrors([LEAD_ORIGIN_BLOCKED]).lead_origin).toBe(LEAD_ORIGIN_BLOCKED);
  expect(fieldErrors([LEAD_ORIGIN_MISSING]).lead_origin).toBe(LEAD_ORIGIN_MISSING);
});
test("A1: the server refuses before anything is saved and records the answer", () => {
  const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
  expect(srv).toContain("leadOriginProblem(opts.leadOrigin)");
  expect(srv.indexOf("leadOriginProblem(")).toBeLessThan(srv.indexOf("if (problems.length) throw"));
  expect(srv).toContain("lead_origin: opts.leadOrigin");
  const fn = readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8");
  expect(fn).toContain('leadOrigin: z.enum(["owner_contacted", "referral", "door_knock", "cold_call"]).nullable().optional()');
  const ui = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
  expect(ui).toContain("data-lead-origin");
  expect(ui.indexOf("data-lead-origin")).toBeLessThan(ui.indexOf("data-owner-card"));
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-job-lead-origin.test.ts`. Expected: FAIL (exports missing).
- [ ] **Step 3: Implement.** Add the core exports with the exact values from Global Constraints. In `fieldErrors`, map `LEAD_ORIGIN_BLOCKED`/`LEAD_ORIGIN_MISSING` to `lead_origin` before the other rules. In the server, push `leadOriginProblem(opts.leadOrigin)` into `problems` next to the electrician check, and add `lead_origin: opts.leadOrigin` to the `installer_job_added` details. In the functions file, add the zod field and pass it through. In the UI, add a `<fieldset className={CARD} data-lead-origin>` with radios as the first card. Hold its own state (not in the phone draft, so it is asked again). Include it in `problems()` and send it as `leadOrigin`. Update the three callers.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-job-lead-origin.test.ts tests/add-job-flow.test.ts tests/electrician-choice.test.ts tests/installer-own-job-e2e-db.test.ts tests/journey-a1-complete-route-db.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/onsite-ready-check.core.ts src/lib/add-job-flow.core.ts src/lib/onsite-ready-check.server.ts src/lib/onsite-ready-check.functions.ts src/components/trade/add-job-flow.tsx scripts/installer-test.ts tests/
git commit -m "feat(add-job): ask how they got the customer; refuse door-knocked and cold-called jobs (A1)"
```

### Task 2: A2 — HIV-lead clash saves the job and flags it for the office

**Files:**
- Modify: `src/lib/duplicate-address.core.ts`, `src/lib/duplicate-address.server.ts` (select + return `channel`), `src/lib/onsite-ready-check.server.ts`, `src/AGENTS.md` and `src/lib/AGENTS.md` (the decision-282 lines: an installer's Add a job at an open *HIV lead* address is saved and flagged)
- Test: `tests/duplicate-address.test.ts` (add tests)

**Interfaces:**
- Produces: `OpenAddressJob` gains `channel: string | null`; `addJobClashAction(open: { channel: string | null } | null): "none" | "save_and_flag" | "refuse"`; `hivLeadClashSummary(existingJobNumber: string): string`.

- [ ] **Step 1: Write the failing test** (append to `tests/duplicate-address.test.ts`)

```ts
test("A2: an open HIV lead at the address → save and flag; another installer's open job → refuse; none → none", () => {
  expect(addJobClashAction(null)).toBe("none");
  expect(addJobClashAction({ channel: "hivic_sourced" })).toBe("save_and_flag");
  expect(addJobClashAction({ channel: "installer_sourced" })).toBe("refuse");
  expect(hivLeadClashSummary("HV-3201")).toBe("This address is already a Home Insulation Victoria lead (HV-3201) — the installer's job was saved; office to check");
});
test("A2 review focus: a cancelled HIV lead or a practice lead never clashes with a real Add a job", () => {
  expect(openJobAtAddress(req, [job({ address_line: "1/5 Smith St", stage: "cancelled" })])).toBeNull();
  expect(openJobAtAddress({ ...req, source: "installer_onsite" }, [job({ address_line: "1/5 Smith St", source: "qa_test" })])).toBeNull();
});
test("A2 wiring: the server flags the NEW job and only refuses non-HIV clashes", () => {
  const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
  expect(srv).toContain("addJobClashAction(open)");
  expect(srv).toContain('clash === "refuse"');
  expect(srv).toContain("hivLeadClashSummary(open.job_number)");
  expect(readFileSync("src/lib/duplicate-address.server.ts", "utf8")).toContain("id, job_number, stage, source, channel, deleted_at, created_at, property_id");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/duplicate-address.test.ts`. Expected: FAIL (`addJobClashAction` not exported).
- [ ] **Step 3: Implement.** Add both pure exports. `findOpenJobAtAddress` selects and returns `channel`. In `startOnsiteReadyCheckFor`: `const clash = addJobClashAction(open)`. Keep today's flag-and-throw only when `clash === "refuse"`. When `"save_and_flag"`, carry on. After the job insert, write one internal `DUPLICATE_ADDRESS_EVENT` on the **new** job with `hivLeadClashSummary(open.job_number)` and `{ from: "add_a_job", existing_job_id, existing_job_number, needs_office: true }`. That event is already in `FLAG_EVENTS`, so it shows in New from installers. Nothing is told to the installer. Update the two AGENTS.md lines.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/duplicate-address.test.ts tests/r01-intake-owner-untouched-db.test.ts tests/owners-email-not-unique-practice-db.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/duplicate-address.core.ts src/lib/duplicate-address.server.ts src/lib/onsite-ready-check.server.ts src/AGENTS.md src/lib/AGENTS.md tests/duplicate-address.test.ts
git commit -m "feat(add-job): save and flag when the address is already an HIV lead (A2)"
```

### Task 3: A3 — "My usual electrician" only once that electrician is onboarded

**Files:**
- Modify: `src/lib/rec-onboarded.core.ts`, `src/lib/usual-electrician.server.ts`, `src/lib/electrician-choice.core.ts`, `src/lib/add-job-flow.core.ts` (`ELECTRICIAN_CARD`), `src/lib/onsite-ready-check.functions.ts` (`addJobOptions`), `src/lib/onsite-ready-check.server.ts`, `src/components/trade/add-job-flow.tsx`
- Test: `tests/electrician-choice.test.ts` (add tests)

**Interfaces:**
- Consumes: `approvedRecFor(declared, candidates, flatPiesaIncGst)`, `loadApprovedRecCandidates()`, `installerPaysOwnElectricians(businessId)` (all existing).
- Produces: `usualIsOnboarded(usual: UsualElectrician | null, candidates: ApprovedRecCandidate[], flatPiesaIncGst: number | null): boolean`; `readUsualElectricianStatus(businessId: string): Promise<{ electrician: UsualElectrician | null; onboarded: boolean }>`; `type UsualStatus = { name: string; onboarded: boolean } | null`; `addJobUsual(s: UsualStatus): { name: string } | null` (null unless onboarded); `addJobElectricianProblem(choice, s: UsualStatus): string | null`; `ELECTRICIAN_CHOICE_ISSUES.notOnboarded = "Your usual electrician isn't onboarded with Home Insulation Victoria yet — choose Home Insulation Victoria's electrician."`; `ELECTRICIAN_CARD.notOnboarded(name) = \`${name} can be picked here once they finish onboarding with Home Insulation Victoria.\``; `addJobOptions` returns `usualElectrician: { name: string; onboarded: boolean } | null`.
- `resolveElectricianChoice`, `defaultElectricianChoice`, `electricianChoiceOptions` and `recordElectricianChoice` stay unchanged. The UI and server pass them `addJobUsual(status)`.

- [ ] **Step 1: Write the failing test**

```ts
test("A3: a saved but not-onboarded usual electrician is not offered, not the default, and refused", () => {
  const off = { name: "Sam Lee", onboarded: false }, on = { name: "Sam Lee", onboarded: true };
  expect(electricianChoiceOptions(addJobUsual(off)).map((o) => o.value)).toEqual(["hivic"]);
  expect(defaultElectricianChoice(addJobUsual(off))).toBe("hivic");
  expect(addJobElectricianProblem("usual", off)).toBe(ELECTRICIAN_CHOICE_ISSUES.notOnboarded);
  expect(addJobElectricianProblem("usual", on)).toBeNull();
  expect(addJobElectricianProblem("usual", null)).toBe(ELECTRICIAN_CHOICE_ISSUES.usual);
  expect(defaultElectricianChoice(addJobUsual(on))).toBe("usual");
  expect(fieldErrors([ELECTRICIAN_CHOICE_ISSUES.notOnboarded]).electrician).toBe(ELECTRICIAN_CHOICE_ISSUES.notOnboarded);
});
test("A3: onboarded = an approved REC match; Reinsulate (pays own electricians) needs no rate", () => {
  const rec = { business_id: "b1", name: "Sparkie Co", rec_number: "REC1", onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: null };
  const usual = { name: "Sparkie Co", licence: "REC1" };
  expect(usualIsOnboarded(usual, [rec], null)).toBe(false);          // no active PIESA rate
  expect(usualIsOnboarded(usual, [rec], 350)).toBe(true);            // flat-paid installer
  expect(usualIsOnboarded(usual, [{ ...rec, piesa_rate: { id: "r", rate_inc_gst: 300 } }], null)).toBe(true);
  expect(usualIsOnboarded(usual, [], null)).toBe(false);
  expect(usualIsOnboarded(null, [rec], null)).toBe(false);
});
test("A3 wiring: server and options read the onboarded status", () => {
  expect(readFileSync("src/lib/onsite-ready-check.server.ts", "utf8")).toContain("addJobElectricianProblem(electricianChoice, status)");
  expect(readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8")).toContain("readUsualElectricianStatus(data.businessId)");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/electrician-choice.test.ts`. Expected: FAIL (new exports missing).
- [ ] **Step 3: Implement.** `usualIsOnboarded` returns true when `approvedRecFor(...).rec !== null`. `readUsualElectricianStatus` reads the usual electrician and, only when one is saved, the candidates and the flat price. The server uses the status for the default and the problem check. The UI shows `ELECTRICIAN_CARD.notOnboarded(name)` where `noUsual` shows today, when a usual electrician is saved but not onboarded.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/electrician-choice.test.ts tests/our-lead-piesa-electrician.test.ts tests/installer-own-job-e2e-db.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/rec-onboarded.core.ts src/lib/usual-electrician.server.ts src/lib/electrician-choice.core.ts src/lib/add-job-flow.core.ts src/lib/onsite-ready-check.functions.ts src/lib/onsite-ready-check.server.ts src/components/trade/add-job-flow.tsx tests/electrician-choice.test.ts
git commit -m "feat(add-job): usual electrician can be picked only once onboarded (A3)"
```

### Task 4: A4 — Remove the bulk upload page and its links

**Files:**
- Delete: `src/routes/_authenticated/partner.bulk-import.tsx`. Regenerate `src/routeTree.gen.ts` (run `bun run build`; the router plugin rewrites it).
- Modify: `src/lib/route-guards.ts` (drop `/partner/bulk-import` from `INSTALLER_BOSS_ONLY`, the bulk line in `partnerPathAllowed`, and `legacyBulkImportRedirect`), `src/lib/legacy-links.core.ts` (`PARTNER["bulk-import"] = { to: "/partner/import" }` so old bookmarks land on Add a job)
- Modify script page lists: `scripts/installer-test.ts` (lines ~337, 344, 439, 635), `scripts/reinsulate-shots.ts`, `scripts/trade-shots.ts`, `scripts/portal-qa-coverage.ts`
- Tests that read the deleted page: `tests/add-job-legacy-entry.test.ts` (rewrite), `tests/bulk-import-confirm-files.test.ts` (drop `page` and its test), `tests/bulk-import-review.test.mjs` (drop `uiFixture` and every test using it), `tests/job-electrician-7oct.test.ts` (drop the two `bulk` lines), `tests/upload-redesign-7oct.test.ts` (drop the "page: 3 steps" test)
- Server bulk functions stay. G5 tidies them later.

- [ ] **Step 1: Write the failing test** (`tests/add-job-legacy-entry.test.ts`, replace the bulk tests)

```ts
test("A4: no bulk upload page or link; old address lands on Add a job", () => {
  expect(existsSync("src/routes/_authenticated/partner.bulk-import.tsx")).toBe(false);
  expect(partnerLegacyTarget("bulk-import")).toEqual({ to: "/partner/import" });
  expect(readFileSync("src/lib/route-guards.ts", "utf8")).not.toContain("bulk-import");
  for (const f of ["src/routeTree.gen.ts", "src/components/trade/TradeShell.tsx", "src/components/portal/trade-work.tsx", "src/components/portal/AppShell.tsx", "scripts/installer-test.ts", "scripts/trade-shots.ts", "scripts/reinsulate-shots.ts", "scripts/portal-qa-coverage.ts"])
    expect(readFileSync(f, "utf8")).not.toContain("/partner/bulk-import");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-job-legacy-entry.test.ts`. Expected: FAIL (page exists).
- [ ] **Step 3: Implement** the deletions and edits listed above. Keep the team-management and electrician-admin tests in that file.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-job-legacy-entry.test.ts tests/bulk-import-confirm-files.test.ts tests/job-electrician-7oct.test.ts tests/upload-redesign-7oct.test.ts tests/add-job-confirmations.test.ts` and `bun test tests/bulk-import-review.test.mjs`
- [ ] **Step 5: Commit**

```bash
git add -A src/routes src/routeTree.gen.ts src/lib/route-guards.ts src/lib/legacy-links.core.ts scripts tests
git commit -m "feat(add-job): remove the bulk upload page and its links (A4)"
```

### Task 5: A5 — Staff are told at the start, before any form

**Files:**
- Modify: `src/lib/add-job-flow.core.ts`, `src/lib/onsite-ready-check.functions.ts`, `src/routes/_authenticated/partner.import.tsx`
- Test: `tests/add-job-flow.test.ts` (add tests)

**Interfaces:**
- Produces: `ADD_JOB_STAFF_ONLY` (staff line from Global Constraints); `addJobStartState(m: Map<string, "business_admin" | "member">): { kind: "owner"; businessId: string } | { kind: "staff" } | { kind: "none" }`; server fn `addJobStart` (no input) returning that state, read with `myBusinesses(context.userId)`. This is the same membership rule `requireMember(…, true)` uses at save, so the start and the save always agree.

- [ ] **Step 1: Write the failing test**

```ts
test("A5: owner of any business → owner of THAT business; staff only → staff; nothing → none", () => {
  expect(addJobStartState(new Map([["b1", "member"], ["b2", "business_admin"]]))).toEqual({ kind: "owner", businessId: "b2" });
  expect(addJobStartState(new Map([["b1", "member"]]))).toEqual({ kind: "staff" });
  expect(addJobStartState(new Map())).toEqual({ kind: "none" });
});
test("A5: the page decides before the form renders", () => {
  const page = readFileSync("src/routes/_authenticated/partner.import.tsx", "utf8");
  expect(page).toContain("addJobStart");
  expect(page).not.toContain("getPartnerProfile");
  expect(page).toContain("ADD_JOB_STAFF_ONLY");
  expect(page.indexOf('kind === "staff"')).toBeLessThan(page.indexOf("<AddJobFlow"));
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-job-flow.test.ts`
- [ ] **Step 3: Implement.** The page queries `addJobStart`. Staff see `ADD_JOB_STAFF_ONLY` plus the existing "Back to My work" link in the existing `data-no-business` box. `none` keeps today's box. `owner` renders `<AddJobFlow businessId=…>`. Loading and error states stay the same.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-job-flow.test.ts tests/business-owner-only.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/add-job-flow.core.ts src/lib/onsite-ready-check.functions.ts src/routes/_authenticated/partner.import.tsx tests/add-job-flow.test.ts
git commit -m "feat(add-job): staff are told at the start that only the owner can add jobs (A5)"
```

### Task 6: A6 — No half-saved jobs; Try again finishes the same job

**Files:**
- Create: `docs/pending-migrations/add-installer-job-atomic.sql` and `.undo.sql`, `src/lib/add-installer-job.core.ts`, `src/lib/add-installer-job.server.ts`
- Modify: `src/lib/onsite-ready-check.server.ts`, `src/lib/onsite-ready-check.functions.ts` (`requestKey: z.string().uuid().optional()`), `src/lib/add-job-flow.core.ts` (`restoreCustomer` / draft carries `request_key`), `src/components/trade/add-job-flow.tsx` (one `crypto.randomUUID()` per draft, kept across retries and reloads, new one on "Add another job")
- Test: `tests/add-installer-job-practice-db.test.ts` (new, PGlite), `tests/add-installer-job.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `lead_origin`, Task 2 flag event, Task 3 `electricianChoiceRecord(...)`.
- Produces SQL: `public.add_installer_job(_payload jsonb) returns table(job_id uuid, job_number text, created boolean)`, `security definer`, `set search_path = public`, execute granted to `service_role` only. In one transaction it inserts the owner, property, job (`external_enquiry_id = 'onsite:' || request_key`, `electrician_choice = 'hivic_organise'`, the other columns as today), the installer `job_assignments` row and the `owner_contact_consents` row. It then writes the events `electrician_choice_set`, `installer_job_added` and `installer_contact_permission`, plus the optional `flag_event`. If `onsite:<key>` already exists, it returns that job with `created = false` and writes nothing.
- Produces TS: `type AddInstallerJobPayload` (keys: `request_key, business_id, user_id, source, owner{full_name,email,phone}, property{address_line,suburb,postcode}, consent{key,by,text,sha256}, electrician_choice, lead_origin, visit_requested, flag_event|null`); `addInstallerJobPayload(i): AddInstallerJobPayload` (trims, lower-cases email); `findAddedJob(requestKey: string, businessId: string): Promise<{ jobId: string; jobNumber: string } | null>`; `addInstallerJobAtomic(p: AddInstallerJobPayload): Promise<{ jobId: string; jobNumber: string; created: boolean } | "not_deployed">` (uses `isMissingDbObject`).

- [ ] **Step 1: Write the failing PGlite test.** Build the tables the function touches, with the real immutability triggers on `workflow_events` and `owner_contact_consents`. Then:

```ts
test("all rows in one go", async () => {
  const r = await call(payload("k1"));
  expect(r.created).toBe(true);
  expect(await count("owners")).toBe(1); expect(await count("properties")).toBe(1); expect(await count("job_assignments")).toBe(1);
  expect(await one("select external_enquiry_id from jobs")).toBe("onsite:k1");
  expect(await events(r.job_id)).toEqual(["electrician_choice_set", "installer_job_added", "installer_contact_permission"]);
  expect((await detail(r.job_id, "installer_job_added")).lead_origin).toBe("owner_contacted");
});
test("same request key again → same job, nothing new", async () => {
  const a = await call(payload("k2")), b = await call(payload("k2"));
  expect(b).toEqual({ ...a, created: false }); expect(await count("jobs")).toBe(2);
});
test("a failure on the last write leaves nothing behind", async () => {
  await db.exec(`create function boom() returns trigger language plpgsql as $$ begin if new.event_type='installer_contact_permission' then raise exception 'boom'; end if; return new; end $$;
    create trigger t_boom before insert on workflow_events for each row execute function boom();`);
  const before = await counts();
  await expect(call(payload("k3"))).rejects.toThrow("boom");
  expect(await counts()).toEqual(before);
  await db.exec("drop trigger t_boom on workflow_events");
  expect((await call(payload("k3"))).created).toBe(true); // Try again works
});
test("HIV-lead clash flag lands on the new job", async () => {
  const r = await call({ ...payload("k4"), flag_event: { summary: "x", details: { needs_office: true } } });
  expect(await events(r.job_id)).toContain("duplicate_address_linked");
});
test("only the service role may run it; undo drops it", async () => {
  expect(await one("select has_function_privilege('authenticated','public.add_installer_job(jsonb)','execute')")).toBe(false);
  await db.exec(UNDO_SQL); expect(await one("select count(*)::int from pg_proc where proname='add_installer_job'")).toBe(0);
});
```

And `tests/add-installer-job.test.ts`:

```ts
test("payload is trimmed, email lower-cased, key carried", () => {
  const p = addInstallerJobPayload({ ...input, requestKey: K, owner: { ...input.owner, email: " A@B.CO " } });
  expect(p.request_key).toBe(K); expect(p.owner.email).toBe("a@b.co");
});
test("server: a known request key resumes BEFORE the address check; atomic call with a fallback", () => {
  const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
  expect(srv.indexOf("findAddedJob(")).toBeLessThan(srv.indexOf("findOpenJobAtAddress("));
  expect(srv).toContain("addInstallerJobAtomic(");
  expect(srv).toContain('=== "not_deployed"');
  expect(readFileSync("src/lib/add-installer-job.server.ts", "utf8")).toContain('rpc("add_installer_job"');
  expect(readFileSync("src/components/trade/add-job-flow.tsx", "utf8")).toContain("requestKey");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-installer-job-practice-db.test.ts tests/add-installer-job.test.ts`. Expected: FAIL (SQL file and modules missing).
- [ ] **Step 3: Implement.** Write the SQL and undo (undo = `drop function if exists public.add_installer_job(jsonb);`). Put a header comment in the house style: what, why, "Proven on PGlite: tests/add-installer-job-practice-db.test.ts". Add one line for the new rule to `src/lib/AGENTS.md`. In `startOnsiteReadyCheckFor`: after validation, call `findAddedJob` and, if found, skip straight to the visit and form steps. Otherwise run the clash check, then `addInstallerJobAtomic`. On `"not_deployed"`, run today's step-by-step writes unchanged, as a local `legacySequentialSave`. The visit booking and `onReadyCheckJobAdded` stay after the save.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-installer-job-practice-db.test.ts tests/add-installer-job.test.ts tests/installer-own-job-e2e-db.test.ts tests/journey-a1-complete-route-db.test.ts tests/t3-mitti-async-claim.test.ts tests/electrician-choice.test.ts`
- [ ] **Step 5: Commit**

```bash
git add docs/pending-migrations/add-installer-job-atomic.sql docs/pending-migrations/add-installer-job-atomic.undo.sql src/lib/add-installer-job.core.ts src/lib/add-installer-job.server.ts src/lib/onsite-ready-check.server.ts src/lib/onsite-ready-check.functions.ts src/lib/add-job-flow.core.ts src/components/trade/add-job-flow.tsx src/lib/AGENTS.md tests/add-installer-job-practice-db.test.ts tests/add-installer-job.test.ts
git commit -m "feat(add-job): all-or-nothing save keyed by a request key so Try again finishes the same job (A6)"
```

### Task 7: A7 — "Retry submission" becomes "Try again"

**Files:** Modify `src/lib/add-job-flow.core.ts`, `src/components/trade/add-job-flow.tsx`. Test: `tests/add-job-flow.test.ts`.

**Interfaces:** Produces `TRY_AGAIN_LABEL = "Try again"`.

- [ ] **Step 1: Write the failing test**

```ts
test("A7: plain retry words", () => {
  expect(TRY_AGAIN_LABEL).toBe("Try again");
  expect(saveErrorMessage("Failed to fetch")).toBe("The save confirmation was interrupted. Your details are kept; tap Try again to finish the same job. Do not add it again.");
  const ui = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
  expect(ui).not.toContain("Retry submission"); expect(ui).toContain("TRY_AGAIN_LABEL");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-job-flow.test.ts`
- [ ] **Step 3: Implement.** Export the constant, change the one line in `saveErrorMessage`, and use `TRY_AGAIN_LABEL` on the save button's error state.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-job-flow.test.ts tests/add-job-confirmations.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/add-job-flow.core.ts src/components/trade/add-job-flow.tsx tests/add-job-flow.test.ts
git commit -m "fix(add-job): 'Retry submission' becomes 'Try again' (A7)"
```

### Task 8: A8 — Type in the address when Google can't find it

**Files:** Modify `src/lib/onsite-ready-check.core.ts` (`OnsiteInput.address_typed?: boolean`), `src/lib/add-job-flow.core.ts`, `src/lib/onsite-ready-check.functions.ts` (zod `address_typed: z.boolean().optional()`), `src/components/onboarding/VerifiedAddressInput.tsx` (optional prop `onNoMatch?: (none: boolean) => void`, called `true` where the "No Australian address matched" or "lookup is unavailable" note is set, `false` when results come back), `src/components/trade/customer-fields.tsx`. Test: `tests/add-job-address-name.test.ts`.

**Interfaces:** Produces `ADDRESS_TYPE_IN = "Can't find the address? Type it in"`, `ADDRESS_PICK_AGAIN = "Pick from the list instead"`; `customerProblems` skips `PICK_ADDRESS` when `address_verified || address_typed`; `restoreCustomer` keeps `address_typed`.

- [ ] **Step 1: Write the failing test**

```ts
const typed = { ...restoreCustomer({}), full_name: "Ann Lee", address_line: "12 Bush Track", suburb: "Kinglake", postcode: "3763", phone: "0412 345 678", email: "a@b.co", contact_permission: true, consent_by: "installer" as const, address_typed: true };
test("A8: a typed address is accepted without the list, but still checked", () => {
  expect(customerProblems(typed)).toEqual([]);
  expect(customerProblems({ ...typed, address_typed: false })).toContain(PICK_ADDRESS);
  expect(customerProblems({ ...typed, postcode: "2604" })).toContain("We can only take Victorian jobs — this one can't be added");
  expect(customerProblems({ ...typed, address_line: "Bush Track" })).toContain("Add the street number to the address");
  expect(restoreCustomer({ ...typed }).address_typed).toBe(true);
});
test("A8 wiring: the link shows only after no match; picking again clears typed", () => {
  const cf = readFileSync("src/components/trade/customer-fields.tsx", "utf8");
  expect(cf).toContain("onNoMatch="); expect(cf).toContain("ADDRESS_TYPE_IN"); expect(cf).toContain("ADDRESS_PICK_AGAIN");
  expect(cf).toContain("address_verified: true, address_typed: false");
  expect(readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8")).toContain("address_typed: z.boolean().optional()");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/add-job-address-name.test.ts`
- [ ] **Step 3: Implement.** In `CustomerFields`, keep a `noMatch` flag from `onNoMatch`. When it is set, show the `ADDRESS_TYPE_IN` link. Tapping it sets `address_typed: true, address_verified: false` and renders the existing `offline` street/suburb/postcode fields with the `ADDRESS_PICK_AGAIN` link. `onSelect` adds `address_typed: false`.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/add-job-address-name.test.ts tests/add-job-address-keeps-contact.test.tsx tests/onsite-ready-check-7oct.test.ts tests/add-job-flow.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/lib/onsite-ready-check.core.ts src/lib/add-job-flow.core.ts src/lib/onsite-ready-check.functions.ts src/components/onboarding/VerifiedAddressInput.tsx src/components/trade/customer-fields.tsx tests/add-job-address-name.test.ts
git commit -m "feat(add-job): installer can type the address when Google can't find it (A8)"
```

### Task 9: A9 — Price: agreed rates on HIV leads, typed price on own jobs (pin it)

The code already does this (Q5). This task pins it with tests, so a later change can't break it.

**Files:** Test: `tests/installer-price.test.ts` (add test). Code changes only if a check fails.

- [ ] **Step 1: Write the test**

```ts
test("A9: price box and price step only on installers' own jobs; HIV leads quoted from agreed rates", () => {
  expect(priceFromPortal("installer_sourced")).toBe(true);
  expect(priceFromPortal("hivic_sourced")).toBe(false);
  expect(installerPriceState({ channel: "hivic_sourced", record: null, entries: [] })).toEqual({ required: false, present: true, source: null });
  expect(installerStatusLine({ channel: "hivic_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: false, boss: true, quoteLine: null }).kind).not.toBe("price");
  expect(readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8")).toContain('page.boss && page.channel === "installer_sourced" && <InstallerPriceCard');
  expect(readFileSync("src/lib/installer-price-set.server.ts", "utf8")).toContain("Only your own customers' jobs take your price here.");
  expect(readFileSync("src/lib/quotes.server.ts", "utf8")).toContain("the quote uses that installer's agreed rates");
});
```

- [ ] **Step 2: Run.** `bun test tests/installer-price.test.ts`. Expected: PASS (already true). If it fails, fix only the failing line's code to match the spec, then re-run.
- [ ] **Step 3: Commit**

```bash
git add tests/installer-price.test.ts
git commit -m "test(add-job): pin agreed-rate pricing on HIV leads and typed price on own jobs (A9)"
```

### Task 10: Full checks

- [ ] **Step 1:** `bun run test`. Expected: last line `N files · N pass · 0 fail`, exit 0.
- [ ] **Step 2:** `bunx tsc --noEmit` (there is no typecheck script in package.json). Expected: exit 0. If the baseline before Task 1 already had errors, there must be no new errors in files this plan touched.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts`. Expected: ends `… 0 customer-visible (failing).`, exit 0.
- [ ] **Step 4:** Do not apply `add-installer-job-atomic.sql` live. It waits for Jo's answer to Q4. Then check each fix on the TEST jobs, on a phone and a computer, before Jo approves the page.
