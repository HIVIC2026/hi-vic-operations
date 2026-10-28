# Installer pages Part 1 — D. Today's job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Open questions for Jo (answer before the task named; the proposal is used until she says otherwise):**
1. (Task 4) One name for the crew everywhere: **"Who's going"** (replaces "Crew today", "Who's doing this", "Who's on this").
2. (Task 4) The Lead and crew for an install are picked only on Today's job. The job page picker keeps only "who does the Ready Check". OK?
3. (Task 4) A Lead typed in by hand ("Enter installer details") has no Mitti login, so the form can't go to them. Keep allowing it (form stays with whoever has it now)? Proposed: keep as is. Staff (not the boss) can still save the crew, but only the boss can make someone else the Lead, because that moves the Mitti form.
4. (Task 1) After a Ready Check "Couldn't get in", the installer stays on the job and offers the owner new times from the job page, as when an owner moves a visit. Words stay "Thanks. We'll rebook it."
5. (Task 2) Electrician fixes visit words: heading "Electrical fixes", panel "Do the fixes in Mitti" / "Open the fixes form. Press Complete when the repair work is done.", button "Fixes form in Mitti" (the label the job page already uses).

**Goal:** Fix the nine Today's job problems in spec section D (D1–D9).

**Architecture:** Rules go in the pure cores (`trade-view.core.ts`, `installer-screens.core.ts`, `visit-allocation.core.ts`, `piisa-a3.core.ts`, `install-no-access-notice.core.ts`). Server reads/writes stay in `trade-view.server.ts`, `visit-allocation.server.ts` and `install-no-access-notice.server.ts`. The held "couldn't get in" text is released by a new catch-up sweep on the existing 15-minute allocation tick, built like `sweepJobOfferTexts` (decision 361). No DB change, no new SMS type, no new wording except where Jo answers above.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase (admin client), bun:test (pure-function tests + source-reading tests for pages and server wiring).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` — section D only.

## Global Constraints

- Only D1–D9. The look stays the same. Nothing on other pages changes except the job page crew heading/install row (D6).
- No customer texts between 8pm and 7am Melbourne: the catch-up never sends inside quiet hours (`smsQuietReason`), and only retries texts whose every hold was the quiet-hours hold.
- One text per cancelled install booking: the same idempotency key `installNoAccessKeys(bookingId).sms`, event time = the original report (24h freshness unchanged).
- TEST jobs (`source = 'qa_test'`) are never touched by the sweep (they already went through test-send). All checks on TEST jobs only.
- Allocation guards are unchanged: only the business owner can hand the install form to someone else; install-day people must be CII-cleared; "Add them in Mitti first" still refuses before anything is recorded.
- Trade screens read only through `trade-view.server.ts` (src/AGENTS.md).

## Review Focus

1. Ready Check "Couldn't get in" keeps the installer assigned, and the reload shows "Thanks. We'll rebook it." (no redirect, no "not assigned") → Task 1 tests on `couldntGetInDay` and `tradeCouldntGetIn`.
2. A refused report shows the reason and the sheet stays open → Task 1 route source test.
3. A text held after 8pm goes once after 7am; never in quiet hours, never after 24h, never when held for another reason → Task 3 tests on `installNoAccessTextCatchUpDue`.
4. Changing the Lead hands the Mitti install form to the Lead; same Lead = no hand-over; Lead + 2 max → Task 4 tests on `leadNeedsHandover` and `crewSelectionProblems`.
5. An electrician's fixes visit opens the fixes form and is never labelled PIESA → Task 2 tests on `dayNext`/`DAY_WHAT` and `tradeDay`.

---

### Task 1: D1, D2, D7 — "Couldn't get in" keeps the installer; refusals and load errors are shown

**Files:**
- Modify: `src/lib/trade-view.core.ts` (add `couldntGetInDay`)
- Modify: `src/lib/trade-view.server.ts` (`tradeDay` ~line 333–342; `tradeCouldntGetIn` ~line 385: delete the `job_assignments` update)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (line 47 error branch; line 86 reason buttons)
- Test: `tests/installer-part1-d.test.ts` (new)

**Interfaces:**
- Produces: `export function couldntGetInDay(f: { stage: string | null; last: { visit?: string; reason?: string } | null }): { visit: CouldntGetInVisit; reason: string } | null` — `install` when `last.visit === "install"` and stage `installation_scheduling`; `ready_check` when `last.visit !== "install"` and stage `ready_check_ready_to_schedule`; else `null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { couldntGetInDay } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const DAY = "src/routes/_authenticated/field.day.$jobId.tsx";

describe("D1/D2/D7 couldn't get in + load error", () => {
  test("the report is today's page, whatever booking is left", () => {
    expect(couldntGetInDay({ stage: "ready_check_ready_to_schedule", last: { visit: "ready_check", reason: "No one home" } })).toEqual({ visit: "ready_check", reason: "No one home" });
    expect(couldntGetInDay({ stage: "installation_scheduling", last: { visit: "install", reason: "Not safe to go up" } })).toEqual({ visit: "install", reason: "Not safe to go up" });
    expect(couldntGetInDay({ stage: "ready_check_scheduled", last: { visit: "ready_check", reason: "x" } })).toBeNull();
    expect(couldntGetInDay({ stage: "ready_check_ready_to_schedule", last: null })).toBeNull();
  });
  test("the installer stays assigned and the report is never treated as an old visit", () => {
    const srv = src("src/lib/trade-view.server.ts");
    const cgi = srv.slice(srv.indexOf("export async function tradeCouldntGetIn"), srv.indexOf("export async function confirmHivicReadyCheckPricing"));
    expect(cgi).not.toContain('from("job_assignments").update(');
    const day = srv.slice(srv.indexOf("export async function tradeDay"), srv.indexOf("export async function tradeCouldntGetIn"));
    expect(day).toContain("const cgiNow = couldntGetInDay(");
    expect(day).toContain("const historicalVisit = !cgiNow && ");
  });
  test("a refusal is shown in the sheet; a load error has a way back", () => {
    const page = src(DAY);
    expect(page).toContain("catch (e) { setCgiError(");
    expect(page).toContain("data-cgi-error");
    const err = page.slice(page.indexOf("if (error) return"), page.indexOf("if (!data) return"));
    expect(err).toContain("Back to My work");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL (`couldntGetInDay` not exported).
- [ ] **Step 3: Implement**
  - Add `couldntGetInDay` as in Interfaces.
  - `tradeDay`: `const cgiNow = couldntGetInDay({ stage: j?.stage ?? null, last: cgi ? cgiD : null })` before `historicalVisit`; `const historicalVisit = !cgiNow && c.kind === "installer" && historicalReadyCheckDay(...)`; replace the two `couldnt_get_in` outcome lines with `if (cgiNow) outcome = { kind: "couldnt_get_in", ...cgiNow }`; `shownKind = cgiNow ? (cgiNow.visit === "install" ? "install" : "ready_check") : dayKind`.
  - `tradeCouldntGetIn`: delete the `job_assignments` update line (booking cancel and event stay). The transition's `nextAction` becomes `` `Installer offers the owner new Ready Check times (${reason}).` `` — the installer still holds the job, so `readyCheckTurn` gives them `installer_to_offer` and the office "Choose installer" item correctly stays away.
  - Route: `const [cgiError, setCgiError] = useState<string | null>(null)`; reason `onClick`: `setCgiError(null)`, `try { await cgi(...); await refetch(); setAsking(false); } catch (e) { setCgiError(e instanceof Error ? e.message : "Couldn't send that. Try again."); } finally { setBusy(false); }`; render `{cgiError && <p role="alert" className="mt-2 text-sm font-semibold" data-cgi-error>{cgiError}</p>}` under the reasons; Cancel also clears it. Error branch: add `<Link to="/field" className={outlineLinkClass}>Back to My work</Link>` after the message.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/install-no-access.test.ts tests/historical-ready-check-day.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts
git commit -m "fix(today): couldn't get in keeps the installer and shows thanks; refusals and load errors shown"
```

### Task 2: D3 — an electrician's fixes visit opens the fixes form

**Files:**
- Modify: `src/lib/trade-view.core.ts` and `src/lib/installer-screens.core.ts` (`DayKind` gains `"fixes"`; `DAY_WHAT.fixes`; `dayNext` fixes branch)
- Modify: `src/lib/trade-view.server.ts` (`tradeDay`: `dayKind`, `mittiId`)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (line 46 `installer`)
- Test: `tests/installer-part1-d.test.ts`

**Interfaces:**
- Consumes: `fixesFormState(jobId)` (`fixes-day.server.ts`, existing), `FIXES_FORM_LINK_LABEL` (`fixes-day.core.ts`).
- Produces: `DayKind = "safety_check" | "ready_check" | "install" | "fixes"`; `DAY_WHAT.fixes = "Electrical fixes"`; `dayNext({ kind: "fixes", … })` → `{ title: "Do the fixes in Mitti", sub: "Open the fixes form. Press Complete when the repair work is done.", button: FIXES_FORM_LINK_LABEL, signRebate: false }`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { DAY_WHAT, dayNext } from "../src/lib/installer-screens.core";
import { FIXES_FORM_LINK_LABEL } from "../src/lib/fixes-day.core";
describe("D3 fixes visit", () => {
  test("fixes visit has its own words and form", () => {
    expect(DAY_WHAT.fixes).toBe("Electrical fixes");
    expect(dayNext({ kind: "fixes", channel: null, installFormComplete: false, rebateSigned: false })).toEqual({ title: "Do the fixes in Mitti", sub: "Open the fixes form. Press Complete when the repair work is done.", button: FIXES_FORM_LINK_LABEL, signRebate: false });
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"));
    expect(day).toContain('b?.kind === "rectification" ? "fixes"');
    expect(day).toContain("fixesFormState(jobId)");
    expect(src(DAY)).toContain('const installer = data ? data.kind === "ready_check" || data.kind === "install" : false;');
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Delete the unused `START_LABEL` from `trade-view.core.ts` now (nothing imports it; it would otherwise need a `fixes` entry). In `tradeDay`: `dayKind = b?.kind === "rectification" ? "fixes" : b?.kind === "installation" ? "install" : …`; when `dayKind === "fixes"` read `(await import("./fixes-day.server")).fixesFormState(jobId)` and use its `auditId` (still only when `mitti_account_invited`) as `mittiId`; the PIESA `a?.external_mitti_id` is used only for `safety_check`. Return type widens to include `"fixes"`.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/installer-screens.core.test.ts tests/fixes-day.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/installer-screens.core.ts src/lib/trade-view.server.ts "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts
git commit -m "fix(today): electrician fixes visit opens the fixes form, not the PIESA form"
```

### Task 3: D4 — a "couldn't get in" text held after 8pm goes out at 7am

**Files:**
- Modify: `src/lib/install-no-access-notice.core.ts` (add `installNoAccessTextCatchUpDue`)
- Modify: `src/lib/install-no-access-notice.server.ts` (split out `noticeFacts`; add `resendInstallNoAccessText`, `sweepInstallNoAccessTexts`)
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (after the `jobOfferTexts` block, ~line 238)
- Test: `tests/install-no-access.test.ts` (append)

**Interfaces:**
- Produces (core): `export function installNoAccessTextCatchUpDue(f: { claimed: boolean; heldReasons: string[]; reportedAt: string }, nowIso: string): boolean` — false in quiet hours, when `claimed`, when `heldReasons` is empty or any reason `!== SMS_QUIET_REASON`, or when `reportedAt` is over 24h ago.
- Produces (server): `export async function sweepInstallNoAccessTexts(now = new Date()): Promise<{ checked: number; texted: number; failed: number }>` — returns at once in quiet hours; reads `INSTALL_NO_ACCESS_NOTICE_EVENT` rows from the last 24h on non-`qa_test`, non-deleted jobs; per event reads `sms_messages` with `idempotency_key like key%` (`claimKeyOf`), and when due calls `resendInstallNoAccessText`; never throws per event.
- Produces (server): `export async function resendInstallNoAccessText(p: { jobId: string; bookingId: string; wasStart: string; reason: string; reportedAt: string }): Promise<string>` — same facts as the original (`noticeFacts`, `newDays: []`), `sendRealSms({ type: INSTALL_NO_ACCESS_SMS_TYPE, idempotencyKey: installNoAccessKeys(bookingId).sms, …, event: { at: reportedAt } })`. No email, no new event.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { installNoAccessTextCatchUpDue } from "../src/lib/install-no-access-notice.core";
import { SMS_QUIET_REASON } from "../src/lib/quote-hold.core";
describe("D4 held couldn't-get-in text", () => {
  const at = "2026-10-28T10:30:00Z"; // 9:30pm Melbourne
  test("goes once after 7am, only for a quiet-hours hold, inside 24h", () => {
    const held = { claimed: false, heldReasons: [SMS_QUIET_REASON], reportedAt: at };
    expect(installNoAccessTextCatchUpDue(held, "2026-10-28T19:00:00Z")).toBe(false); // 6am Melbourne
    expect(installNoAccessTextCatchUpDue(held, "2026-10-28T20:15:00Z")).toBe(true);  // 7:15am
    expect(installNoAccessTextCatchUpDue({ ...held, claimed: true }, "2026-10-28T20:15:00Z")).toBe(false);
    expect(installNoAccessTextCatchUpDue({ ...held, heldReasons: [SMS_QUIET_REASON, "switch off"] }, "2026-10-28T20:15:00Z")).toBe(false);
    expect(installNoAccessTextCatchUpDue({ ...held, heldReasons: [] }, "2026-10-28T20:15:00Z")).toBe(false);
    expect(installNoAccessTextCatchUpDue(held, "2026-10-29T22:00:00Z")).toBe(false); // over 24h
  });
  test("the tick runs the sweep; the sweep skips TEST jobs and reuses the one key", () => {
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepInstallNoAccessTexts()");
    const s = readFileSync("src/lib/install-no-access-notice.server.ts", "utf8");
    expect(s).toContain('.neq("source", "qa_test")');
    expect(s).toContain("installNoAccessKeys(p.bookingId).sms");
    expect(s).toContain("event: { at: p.reportedAt }");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/install-no-access.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. `sendInstallNoAccessNotice` keeps its behaviour; it now gets `facts` from `noticeFacts`. Tick block copies the `jobOfferTexts` try/catch shape, key `installNoAccessTexts`, comment "Decision 215 / spec D4: a couldn't-get-in text held after 8pm goes at 7am (same key, never twice)".
- [ ] **Step 4: Run** `bun test tests/install-no-access.test.ts tests/sms-sender.test.ts tests/sms-held-attempts.pglite.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/install-no-access-notice.core.ts src/lib/install-no-access-notice.server.ts src/routes/api/public/hooks/allocation-tick.ts tests/install-no-access.test.ts
git commit -m "fix(sms): couldn't-get-in text held after 8pm is sent at 7am, once"
```

### Task 4: D5, D6 — Lead + 2, one crew name, the Lead gets the Mitti form

**Files:**
- Modify: `src/lib/piisa-a3.core.ts` (`crewSelectionProblems` line 589), `src/lib/piisa-a3.functions.ts` (line 21 `.max(3)` → `.max(2)`; handler calls `saveCrewWithLead`)
- Modify: `src/lib/visit-allocation.core.ts` (add `leadNeedsHandover`), `src/lib/visit-allocation.server.ts` (add `saveCrewWithLead`)
- Modify: `src/lib/installer-screens.core.ts` (add `CREW_TITLE`)
- Modify: `src/components/trade/PiisaCrewPicker.tsx` (lines 60, 66, 75), `src/components/trade/visit-allocation.tsx` (lines 21–23, 75), `src/routes/_authenticated/field.day.$jobId.tsx` (line 129)
- Test: `tests/installer-part1-d.test.ts`; update `tests/field-job-one-call.test.tsx` (seed line 89, text line 109)

**Interfaces:**
- Produces: `crewSelectionProblems` pushes `"The install form has room for a Lead and 2 more"` when `additional.length > 2`.
- Produces: `export function leadNeedsHandover(f: { leadWorkerId: string | null; allocatedWorkerId: string | null; assigneeWorkerId: string | null }): boolean` → `!!lead && lead !== (allocated ?? assignee)`.
- Produces: `export async function saveCrewWithLead(jobId: string, userId: string, sel: CrewSelection, call?: MittiCall): Promise<{ needsVerification: string[] }>` — reads `loadCrew` and throws on `crewSelectionProblems(...).problems`; finds the current install allocation and the assigned installer's own `partner_workers` row (`profile_id` = active installer assignment `user_id`); if `leadNeedsHandover` → `allocateVisit(jobId, userId, "install", leadId, call)` (its guards refuse before recording); then `saveCrewSelection(jobId, userId, sel)`.
- Produces: `export const CREW_TITLE = "Who's going"` (Jo question 1).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
import { leadNeedsHandover } from "../src/lib/visit-allocation.core";
describe("D5/D6 crew", () => {
  const s = (id: string) => ({ workerId: id, name: id, eec: `CII-${id}`, eecVerified: true });
  const staff = ["a", "b", "c", "d"].map(s);
  test("Lead and 2 more, no more", () => {
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }] }, staff).problems).toEqual([]);
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }, { workerId: "d" }] }, staff).problems).toContain("The install form has room for a Lead and 2 more");
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("additional: z.array(pick).max(2)");
    expect(src("src/components/trade/PiisaCrewPicker.tsx")).toContain("extra.length < 2");
  });
  test("the Lead gets the Mitti form; same person = no hand-over", () => {
    expect(leadNeedsHandover({ leadWorkerId: "a", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(true);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: null, allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("saveCrewWithLead(data.jobId, context.userId, { lead: data.lead, additional: data.additional })");
  });
  test("one place, one name", () => {
    for (const f of ["src/components/trade/PiisaCrewPicker.tsx", "src/components/trade/visit-allocation.tsx", DAY]) {
      const t = src(f);
      expect(t).toContain("CREW_TITLE");
      for (const old of ['"Crew today"', `"Who's doing this"`, `"Who's on this"`]) expect(t).not.toContain(old);
    }
    expect(src("src/components/trade/visit-allocation.tsx")).toContain('data.visits.filter((v) => v.kind === "ready_check")');
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Picker: add-row and label limits `< 2`. Job-page card: render only the Ready Check visit (`const visits = data.visits.filter(...)`; return null when empty) and its Note keeps only "The Mitti form and the 6:30am text go to the person you choose."; title `CREW_TITLE`. Day page Ready Check group title `CREW_TITLE`. Test file update: seed `visits: [{ kind: "ready_check", label: "Ready Check", current: null, hasForm: false, options: [] }]`, expect `"Who's going"`.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/field-job-one-call.test.tsx tests/visit-allocation.test.ts tests/piisa-crew-roster.test.ts tests/piisa-crew-ready-check.test.ts tests/journey-a1-complete-route-db.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/piisa-a3.core.ts src/lib/piisa-a3.functions.ts src/lib/visit-allocation.core.ts src/lib/visit-allocation.server.ts src/lib/installer-screens.core.ts src/components/trade/PiisaCrewPicker.tsx src/components/trade/visit-allocation.tsx "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts tests/field-job-one-call.test.tsx
git commit -m "fix(crew): Lead + 2, one crew picker and name, Lead gets the Mitti install form"
```

### Task 5: D8 — reloading doesn't make them tap Start again

**Files:**
- Modify: `src/components/trade/TradePrestart.tsx` (add `useRememberedStart`)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (line 43 `started`)
- Test: `tests/installer-part1-d.test.ts`

**Interfaces:**
- Produces: `export function useRememberedStart(key: string): [boolean, () => void]` — reads/writes `localStorage[key]` = `"1"`, every access in try/catch, starts `false` when storage is unavailable.
- Route key: `` `hiv-started-${jobId}-${data?.start ?? ""}` `` (a new booking time = a new Start).

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("D8 remembered Start", () => {
  test("Start is remembered per job and visit time", () => {
    const tp = src("src/components/trade/TradePrestart.tsx");
    expect(tp).toContain("export function useRememberedStart(key: string): [boolean, () => void]");
    expect(tp.match(/try \{/g)?.length).toBeGreaterThanOrEqual(4);
    const page = src(DAY);
    expect(page).toContain("useRememberedStart(`hiv-started-${jobId}-${data?.start ?? \"\"}`)");
    expect(page).not.toContain("useState(false);\n  const [asking");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces; `onStart` ends with `markStarted()` instead of `setStarted(true)`. The hook is called before the early returns and re-reads storage when the key changes (the key is incomplete until `data` loads).
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/t3-mitti-async-claim.test.ts tests/trade-payout-gate.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/trade/TradePrestart.tsx "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts
git commit -m "fix(today): reloading keeps the Mitti form open after Start"
```

### Task 6: D9 — tidy: old phone-check list and dead messages (no visible change)

**Files:**
- Modify: `src/lib/trade-view.core.ts` (delete `PRESTART_CHECKS`; `prestartReady` signature; `START_LABEL` already gone in Task 2)
- Modify: `src/components/trade/TradePrestart.tsx` (drop `disabledReason`; `prestartReady(ticks, checks)`)
- Modify: `src/lib/trade-view.server.ts` (`tradeDay`: drop the `quotes` read and `mittiReady`; `q ? { kind: "quoted" } : { kind: "quoted" }` → `{ kind: "quoted" }`)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (drop the `disabledReason=` prop and its "still setting up" message)
- Test: `tests/installer-part1-d.test.ts`; update `tests/trade-view.test.ts` (import line 2, lines 36–38)

**Interfaces:**
- Produces: `export function prestartReady(ticks: boolean[], checks: readonly string[]): boolean` → every check ticked.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { prestartReady } from "../src/lib/trade-view.core";
import * as tv from "../src/lib/trade-view.core";
describe("D9 tidy", () => {
  test("one phone-check list, no dead messages", () => {
    expect("PRESTART_CHECKS" in tv).toBe(false);
    expect("START_LABEL" in tv).toBe(false);
    expect(prestartReady([true, true, false], ["a", "b", "c"])).toBe(false);
    expect(prestartReady([true, true, true], ["a", "b", "c"])).toBe(true);
    const all = src("src/lib/trade-view.core.ts") + src("src/components/trade/TradePrestart.tsx") + src(DAY);
    for (const dead of ["Battery over 50%", "disabledReason", "still setting up the onsite form"]) expect(all).not.toContain(dead);
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"), src("src/lib/trade-view.server.ts").indexOf("export async function tradeCouldntGetIn"));
    expect(day).not.toContain('{ kind: "quoted" } : { kind: "quoted" }');
    expect(day).not.toContain("mittiReady");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Files/Interfaces. In `tests/trade-view.test.ts` remove `PRESTART_CHECKS` from the import and the line-36 assertion; call `prestartReady(ticks, ["a", "b", "c"])`.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/trade-view.test.ts tests/installer-screens.core.test.ts tests/brief-n-ready-check-success.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts src/components/trade/TradePrestart.tsx "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts tests/trade-view.test.ts
git commit -m "chore(today): remove the old phone-check list and dead messages"
```

### Task 7: Full checks and phone check

- [ ] **Step 1:** `bun run test` — Expected: no failures.
- [ ] **Step 2:** `bunx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` — Expected: last line ends `0 customer-visible (failing).`
- [ ] **Step 4: Phone and computer check (TEST accounts, TEST jobs only).** Installer TEST login, booked TEST Ready Check today → Couldn't get in → No one home → "Thanks. We'll rebook it."; reload → same page, job still on My work. Try it on a Ready Check booked tomorrow → the reason shows in the sheet. Install day TEST job → crew: add 2 → no third "Add" button; pick another cleared person as Lead → Save → Mitti install form now with them. Tick 3 checks → Start → reload → form button still shown. Electrician TEST login, booked TEST fixes visit → heading "Electrical fixes", button opens the fixes form. Open `/field/day/<bad id>` → message + "Back to My work". Jo approves the page before it goes live.
- [ ] **Step 5 (after deploy, read-only DB check):** no `sms_messages` row of type `install_no_access` with status `sent` between 8pm and 7am Melbourne from the deploy time on; each held one has a later `sent` row under the same key.
