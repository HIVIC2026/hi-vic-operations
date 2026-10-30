# Installer pages Part 1 — D. Today's job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Jo's answers (29 Oct 2026):**
1. (Task 5) One crew name for install crews: **"Who's on the crew today?"** (replaces "Crew today", "Who's doing this", "Who's on this" for installs). Ready Checks are one person, often on a later day, so the crew line doesn't read naturally there: the Ready Check keeps its labels ("Who's doing this" on the Job page, "Who's on this" on Today's job).
2. (Task 5) The boss picks the install crew and Lead **before the day, in ONE picker on the Job page**. Today's job shows "Who's on the crew today?" with a **"Change"** button that opens that same picker. One stored crew (`piisa_crew_selected`), so the Lead on the Mitti install form is the Lead who gets Mitti. Lead + 2 stays (Task 4). The 2pm day-before crew reminder email keeps reading the same stored crew. (This reverses the earlier "Today's job only" proposal.)
3. (Task 4) The Lead must come from the Team list (no typed-in Lead), because the Lead needs a Mitti login. Crew members: kept as the code allows now: Team list, or "Enter installer details" for someone not on it (the office checks them before work starts). No conflict with the Lead rule.
4. (Task 1) After "Couldn't get in" on a Ready Check, the installer stays on the job and offers the owner new times. Approved.
5. (Task 2) Fixes visit words approved: heading "Electrical fixes", line "Do the fixes in Mitti", button "Fixes form in Mitti".

**Goal:** Fix the nine Today's job problems in spec section D (D1–D9).

**Architecture:** Rules go in the pure cores (`trade-view.core.ts`, `installer-screens.core.ts`, `visit-allocation.core.ts`, `piisa-a3.core.ts`, `install-no-access-notice.core.ts`). Server reads/writes stay in `trade-view.server.ts`, `visit-allocation.server.ts`, `piisa-a3.server.ts` and `install-no-access-notice.server.ts`. The held "couldn't get in" text is released by a new catch-up sweep on the existing 15-minute allocation tick, built like `sweepJobOfferTexts` (decision 361). The install crew picker (`PiisaCrewPicker`) is the one picker, shown on the Job page and on Today's job; its saved crew is seeded by the Job page bundle so the page still loads in one call. No DB change, no new SMS type, no new wording except Jo's answers above and the two refusal/empty lines named in Task 4.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase (admin client), bun:test (pure-function tests + source-reading tests for pages and server wiring).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` — section D only.

## Global Constraints

- Only D1–D9. The look stays the same. Nothing on other pages changes except the Job page crew picker (D6).
- No customer texts between 8pm and 7am Melbourne: the catch-up never sends inside quiet hours (`smsQuietReason`), and only retries texts whose every hold was the quiet-hours hold.
- One text per cancelled install booking: the same idempotency key `installNoAccessKeys(bookingId).sms`, event time = the original report (24h freshness unchanged).
- TEST jobs (`source = 'qa_test'`) are never touched by the sweep (they already went through test-send). All checks on TEST jobs only.
- Allocation guards are unchanged: only the business owner can hand the install form to someone else; install-day people must be CII-cleared; "Add them in Mitti first" still refuses before anything is recorded. Staff can still save crew members (as now); changing the Lead to someone else needs the owner.
- The crew reminder email (`crew-reminder.server.ts`) is not edited; it keeps counting `piisa_crew_selected`, which every crew save still records.
- Trade screens read only through `trade-view.server.ts` (src/AGENTS.md).
- Build after plan C (`2026-10-28-installer-part1-c-job-page.md`); see Task 5 and Task 7 Interfaces.
- Line numbers cited in this plan are hints from 28 Oct; earlier tasks and plans shift them. Find every edit point by its text (preflight ruling 15).

## Review Focus

1. Ready Check "Couldn't get in" keeps the installer assigned, and the reload shows "Thanks. We'll rebook it." (no redirect, no "not assigned") → Task 1 tests on `couldntGetInDay` and `tradeCouldntGetIn`.
2. A refused report shows the reason and the sheet stays open → Task 1 route source test.
3. A text held after 8pm goes once after 7am; never in quiet hours, never after 24h, never when held for another reason → Task 3 tests on `installNoAccessTextCatchUpDue`.
4. Lead from the Team list only, Lead + 2 max (Task 4 `crewSelectionProblems`); one picker on the Job page and Today's job, a new Lead gets the Mitti install form, page still one call (Task 5 `leadNeedsHandover`, `saveCrewWithLead`, bundle `crew`).
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
  - `tradeCouldntGetIn`: delete the `job_assignments` update line (booking cancel and event stay). The transition's `nextAction` becomes `` `Installer offers the owner new Ready Check times (${reason}).` `` — the installer still holds the job, so `readyCheckTurn` gives them `installer_to_offer` and the office "Choose installer" item correctly stays away (Jo answer 4).
  - Route: `const [cgiError, setCgiError] = useState<string | null>(null)`; reason `onClick`: `setCgiError(null)`, `try { await cgi(...); await refetch(); setAsking(false); } catch (e) { setCgiError(e instanceof Error ? e.message : "Couldn't send that. Try again."); } finally { setBusy(false); }`; render `{cgiError && <p role="alert" className="mt-2 text-sm font-semibold" data-cgi-error>{cgiError}</p>}` under the reasons; Cancel also clears it. Error branch: add `<Link to="/field" className={outlineLinkClass}>Back to My work</Link>` after the message.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/install-no-access.test.ts tests/historical-ready-check-day.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts
git commit -m "fix(today): couldn't get in keeps the installer and shows thanks; refusals and load errors shown"
```

### Task 2: D3 — an electrician's fixes visit opens the fixes form

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (the one `DayKind` gains `"fixes"`; `DAY_WHAT.fixes`; `dayNext` fixes branch) and `src/lib/trade-view.core.ts` (delete its own `DayKind` copy; `import type { DayKind } from "./installer-screens.core"` and `export type { DayKind }` so `TradePrestart.tsx` keeps its import; preflight ruling 11)
- Modify: `src/lib/trade-view.server.ts` (`tradeDay`: `dayKind`, `mittiId`)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (line 46 `installer`)
- Test: `tests/installer-part1-d.test.ts`

**Interfaces:**
- Consumes: `fixesFormState(jobId)` (`fixes-day.server.ts`, existing), `FIXES_FORM_LINK_LABEL` (`fixes-day.core.ts`, = "Fixes form in Mitti").
- Produces: `DayKind = "safety_check" | "ready_check" | "install" | "fixes"`; `DAY_WHAT.fixes = "Electrical fixes"`; `dayNext({ kind: "fixes", … })` → `{ title: "Do the fixes in Mitti", sub: "Open the fixes form. Press Complete when the repair work is done.", button: FIXES_FORM_LINK_LABEL, signRebate: false }` (Jo answer 5).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { DAY_WHAT, dayNext } from "../src/lib/installer-screens.core";
import { FIXES_FORM_LINK_LABEL } from "../src/lib/fixes-day.core";
describe("D3 fixes visit", () => {
  test("fixes visit has its own words and form", () => {
    expect(DAY_WHAT.fixes).toBe("Electrical fixes");
    expect(FIXES_FORM_LINK_LABEL).toBe("Fixes form in Mitti");
    expect(dayNext({ kind: "fixes", channel: null, installFormComplete: false, rebateSigned: false })).toEqual({ title: "Do the fixes in Mitti", sub: "Open the fixes form. Press Complete when the repair work is done.", button: FIXES_FORM_LINK_LABEL, signRebate: false });
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"));
    expect(day).toContain('b?.kind === "rectification" ? "fixes"');
    expect(day).toContain("fixesFormState(jobId)");
    expect(src(DAY)).toContain('const installer = data ? data.kind === "ready_check" || data.kind === "install" : false;');
    expect(src("src/lib/trade-view.core.ts")).not.toContain("export type DayKind =");
    expect(src("src/lib/installer-screens.core.ts").match(/export type DayKind =/g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. `DayKind` is declared once, in `installer-screens.core.ts`; `"fixes"` is added there only. Delete the unused `START_LABEL` from `trade-view.core.ts` now (nothing imports it; it would otherwise need a `fixes` entry). In `tradeDay`: `dayKind = b?.kind === "rectification" ? "fixes" : b?.kind === "installation" ? "install" : …`; when `dayKind === "fixes"` read `(await import("./fixes-day.server")).fixesFormState(jobId)` and use its `auditId` (still only when `mitti_account_invited`) as `mittiId`; the PIESA `a?.external_mitti_id` is used only for `safety_check`. Return type widens to include `"fixes"`.
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

### Task 4: D5 — Lead + 2, and the Lead comes from the Team list

**Files:**
- Modify: `src/lib/piisa-a3.core.ts` (`crewSelectionProblems` ~line 562–589)
- Modify: `src/lib/piisa-a3.functions.ts` (`savePiisaCrew` input, line 21)
- Modify: `src/components/trade/PiisaCrewPicker.tsx` (Lead select, lines 37–48; `extra.length < 3` lines 66 and 75; the `data-no-staff` line 36)
- Test: `tests/installer-part1-d.test.ts`; update `tests/piisa-crew-ready-check.test.ts` (the "lead may be Other" test, lines 36–44)

**Interfaces:**
- Produces: `crewSelectionProblems` pushes `"The install form has room for a Lead and 2 more"` when `additional.length > 2`, and `"Choose the Lead from your Team list"` when `sel.lead` is an `{ other }` object or `null` (replaces the old "Other lead" branch and "Choose the lead installer from your staff, or Other"). `CrewSelection` type and `crewPrefill` stay as they are (old saved crews still prefill).
- Keep plan F's checks when rewriting the Lead branch: the Crew-Lead refusal (`CREW_NOT_LEAD_MESSAGE`) and the `declarationsDue` refusal for the Lead and crew members (plan F Tasks 3 and 4b, built before this task; their tests live in `tests/team-lead-crew-picker.test.ts` and `tests/team-sign-declarations.test.ts`).
- Produces: `savePiisaCrew` input `lead: z.string().uuid().nullable()`, `additional: z.array(pick).max(2)` (crew members keep "Enter installer details", Jo answer 3).
- Picker: Lead select has no "Enter installer details" option and no `data-lead-other` inputs; `lead` state is `string | null`; a saved legacy `{ other }` Lead loads as `null` so the boss must pick from the list. Empty-list line becomes `"No CII-cleared installer is on your Team list yet. Add them under My business → Team."` (the old line told them to type the Lead in).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
describe("D5 Lead + 2, Lead from the Team list", () => {
  const s = (id: string) => ({ workerId: id, name: id, eec: `CII-${id}`, eecVerified: true });
  const staff = ["a", "b", "c", "d"].map(s);
  test("Lead and 2 more, no more", () => {
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }] }, staff).problems).toEqual([]);
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }, { workerId: "d" }] }, staff).problems).toContain("The install form has room for a Lead and 2 more");
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("additional: z.array(pick).max(2)");
    expect(src("src/components/trade/PiisaCrewPicker.tsx")).toContain("extra.length < 2");
    expect(src("src/components/trade/PiisaCrewPicker.tsx")).not.toContain("extra.length < 3");
  });
  test("no typed-in Lead; crew members may still be entered", () => {
    expect(crewSelectionProblems({ lead: { other: { name: "Zed New", eec: "Z-1" } }, additional: [] }, staff).problems).toEqual(["Choose the Lead from your Team list"]);
    expect(crewSelectionProblems({ lead: null, additional: [] }, staff).problems).toEqual(["Choose the Lead from your Team list"]);
    expect(crewSelectionProblems({ lead: "a", additional: [{ other: { name: "Zed New", eec: "Z-1" } }] }, staff).needsVerification).toEqual(["Zed New (EEC Z-1) must be verified by the office before work starts"]);
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("lead: z.string().uuid().nullable()");
    const picker = src("src/components/trade/PiisaCrewPicker.tsx");
    expect(picker).not.toContain("data-lead-other");
    expect(picker).toContain("No CII-cleared installer is on your Team list yet. Add them under My business → Team.");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. In `tests/piisa-crew-ready-check.test.ts` rename the test to "a typed-in Lead is refused; old saved crews still prefill": assert `problems` equals `["Choose the Lead from your Team list"]` for the Zed New lead, drop the `needsVerification`/"choose them instead of Other" lead lines, keep the `listed twice` line only as a crew-member case (`lead: "<cleared staff id from that file>"`, two `{ other }` crew members with the same name), keep the `crewPrefill` line unchanged.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/team-lead-crew-picker.test.ts tests/team-sign-declarations.test.ts tests/piisa-crew-ready-check.test.ts tests/piisa-crew-roster.test.ts tests/piisa-native-crew.test.ts tests/white-card.core.test.ts tests/esc-collection-notice.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/piisa-a3.core.ts src/lib/piisa-a3.functions.ts src/components/trade/PiisaCrewPicker.tsx tests/installer-part1-d.test.ts tests/piisa-crew-ready-check.test.ts
git commit -m "fix(crew): Lead + 2, Lead picked from the Team list"
```

### Task 5: D6 — one crew picker on the Job page, one name, the Lead gets the Mitti form

**Files:**
- Modify: `src/lib/visit-allocation.core.ts` (add `leadNeedsHandover`), `src/lib/visit-allocation.server.ts` (add `saveCrewWithLead`)
- Modify: `src/lib/piisa-a3.functions.ts` (`savePiisaCrew` handler calls `saveCrewWithLead`)
- Modify: `src/lib/installer-screens.core.ts` (add `CREW_TITLE`)
- Modify: `src/lib/trade-job-bundle.core.ts` (`BUNDLE_QUERY_KEYS.crew`), `src/lib/trade-job-bundle.server.ts` (`crew` dep + section)
- Modify: `src/components/trade/PiisaCrewPicker.tsx` (title, "Change", note, query options)
- Modify: `src/components/trade/visit-allocation.tsx` (Ready Check only)
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (the `<WhosDoingThis … />` line only)
- Test: `tests/installer-part1-d.test.ts`; update `tests/field-job-one-call.test.tsx` (line 89 seed, line 109 text) and `tests/trade-job-bundle.test.ts` (fake deps line ~31, lists lines 45, 82, 87)

**Interfaces:**
- Depends on plan C (`2026-10-28-installer-part1-c-job-page.md`) being built first. C edits other parts of `field.$jobId.tsx` (NextPanel/Ready Check Mitti links, the staff-links `<summary>`, sign_rebate) and runs `tests/field-job-one-call.test.tsx`. This task only replaces the `<WhosDoingThis … />` line, adds the picker after it, and adds `visitsForStage` to the route's imports from `@/lib/visit-allocation.core` (not imported there today); find edit points by text, not line number. No overlap with C.
- Produces: `export const CREW_TITLE = "Who's on the crew today?"` (Jo answer 1).
- Produces: `export function leadNeedsHandover(f: { leadWorkerId: string | null; allocatedWorkerId: string | null; assigneeWorkerId: string | null }): boolean` → `!!lead && lead !== (allocated ?? assignee)`.
- Produces: `export async function saveCrewWithLead(jobId: string, userId: string, sel: CrewSelection, call?: MittiCall): Promise<{ needsVerification: string[] }>` — `loadCrew` + throw on `crewSelectionProblems(...).problems` first; reads the current install allocation (`currentAllocation(events, "install")`) and the assigned installer's own `partner_workers` row (`profile_id` = active installer assignment `user_id`); if `leadNeedsHandover` → `allocateVisit(jobId, userId, "install", leadId, call)` (its owner/CII/"Add them in Mitti first" guards refuse before anything is recorded); then `saveCrewSelection(jobId, userId, sel)` (records `piisa_crew_selected`, which the 2pm crew reminder reads).
- Produces: `BUNDLE_QUERY_KEYS.crew = (jobId) => ["piisa-crew", jobId]`; `BundleDeps.crew: (jobId: string) => Promise<{ staff: StaffOption[]; selection: CrewSelection | null }>` (real = `loadCrew`); bundle asks for it only when installer and `visitsForStage(ov.row.stage).includes("install")`, else `undefined`; refused access → refused like the other sections.
- Picker: `Group title={CREW_TITLE}`; the saved-crew edit `LinkRow` reads `Change` (both pages); query adds `retry: false, staleTime: 20_000` (the bundle seed is not refetched); `Note`: `` `The Mitti install form and the 6:30am text go to ${leadName ?? "the Lead"}. Only CII-cleared staff can be on an install. The crew goes on the PIISA.` `` (the install sentence moved from the old Job page card).
- Job page: `<WhosDoingThis … />` stays (now Ready Check only) and `{visitsForStage(job.stage).includes("install") && <PiisaCrewPicker jobId={jobId} />}` follows it. Today's job keeps `{data.kind === "install" && <PiisaCrewPicker jobId={jobId} />}` (same component, same stored crew) and keeps the Ready Check "Who's on this" group.
- `WhosDoingThis`: `const visits = data.visits.filter((v) => v.kind === "ready_check")`; return null when empty; the install-only line and `hasInstall` note go; Note = "The Mitti form and the 6:30am text go to the person you choose."; title stays "Who's doing this" (Ready Check label, Jo answer 1).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { leadNeedsHandover } from "../src/lib/visit-allocation.core";
import { CREW_TITLE } from "../src/lib/installer-screens.core";
import { BUNDLE_QUERY_KEYS } from "../src/lib/trade-job-bundle.core";
describe("D6 one crew picker", () => {
  test("the Lead gets the Mitti form; same person = no hand-over", () => {
    expect(leadNeedsHandover({ leadWorkerId: "a", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(true);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: null, allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("saveCrewWithLead(data.jobId, context.userId, { lead: data.lead, additional: data.additional })");
    const srv = src("src/lib/visit-allocation.server.ts");
    const fn = srv.slice(srv.indexOf("export async function saveCrewWithLead"));
    expect(fn.indexOf("crewSelectionProblems(")).toBeLessThan(fn.indexOf("allocateVisit("));
    expect(fn).toContain("saveCrewSelection(jobId, userId, sel)");
  });
  test("one picker, one name, on the Job page and Today's job", () => {
    expect(CREW_TITLE).toBe("Who's on the crew today?");
    const picker = src("src/components/trade/PiisaCrewPicker.tsx");
    expect(picker).toContain("title={CREW_TITLE}");
    expect(picker).toContain(">Change</LinkRow>");
    expect(picker).toContain("staleTime: 20_000");
    expect(picker).not.toContain('"Crew today"');
    expect(src("src/routes/_authenticated/field.$jobId.tsx")).toContain('{visitsForStage(job.stage).includes("install") && <PiisaCrewPicker jobId={jobId} />}');
    expect(src(DAY)).toContain('{data.kind === "install" && <PiisaCrewPicker jobId={jobId} />}');
    const card = src("src/components/trade/visit-allocation.tsx");
    expect(card).toContain('data.visits.filter((v) => v.kind === "ready_check")');
    expect(card).not.toContain("Mitti install form");
  });
  test("the Job page still loads in one call", () => {
    expect(BUNDLE_QUERY_KEYS.crew("j")).toEqual(["piisa-crew", "j"]);
    expect(src("src/lib/trade-job-bundle.server.ts")).toContain('visitsForStage(ov.row.stage).includes("install")');
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Test updates: `tests/field-job-one-call.test.tsx` — `fullBundle()` adds `crew: { staff: [], selection: null }` (fixture stage is `installation_scheduling`), line 109 expects `"Who's on the crew today?"` and `not.toContain("Who's doing this")`, `calls` stays `{ getTradeJobBundle: 1 }`. `tests/trade-job-bundle.test.ts` — fake deps add `crew: rec("crew", { staff: [], selection: null })`; add `"crew"` to the called-once list (line 45, stage there is `installation_scheduling`), the seeded list (line 82) and the refused list (line 87); add `"crew"` to the electrician not-called list (line 65).
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/field-job-one-call.test.tsx tests/trade-job-bundle.test.ts tests/visit-allocation.test.ts tests/piisa-crew-roster.test.ts tests/piisa-crew-ready-check.test.ts tests/worker-role-crew.test.ts tests/worker-role-crew-server.test.ts tests/journey-a1-complete-route-db.test.ts` — Expected: PASS (the last two cover the crew reminder).
- [ ] **Step 5: Commit**

```bash
git add src/lib/visit-allocation.core.ts src/lib/visit-allocation.server.ts src/lib/piisa-a3.functions.ts src/lib/installer-screens.core.ts src/lib/trade-job-bundle.core.ts src/lib/trade-job-bundle.server.ts src/components/trade/PiisaCrewPicker.tsx src/components/trade/visit-allocation.tsx "src/routes/_authenticated/field.\$jobId.tsx" tests/installer-part1-d.test.ts tests/field-job-one-call.test.tsx tests/trade-job-bundle.test.ts
git commit -m "fix(crew): one crew picker on the Job page and Today's job; the Lead gets the Mitti install form"
```

### Task 6: D8 — reloading doesn't make them tap Start again

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
    expect(page).toContain("useRememberedStart(");
    expect(page).not.toContain("setStarted(true)");
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

### Task 7: D9 — tidy: old phone-check list, dead messages, shared install-finished button (no visible change)

**Files:**
- Modify: `src/lib/trade-view.core.ts` (delete `PRESTART_CHECKS`; `prestartReady` signature; `START_LABEL` already gone in Task 2)
- Modify: `src/components/trade/TradePrestart.tsx` (drop `disabledReason`; `prestartReady(ticks, checks)`)
- Modify: `src/lib/trade-view.server.ts` (`tradeDay`: drop the `quotes` read and `mittiReady`; `q ? { kind: "quoted" } : { kind: "quoted" }` → `{ kind: "quoted" }`)
- Modify: `src/routes/_authenticated/field.day.$jobId.tsx` (drop the `disabledReason=` prop and its "still setting up" message; `SignRebate` uses `InstallFinishedButton`)
- Test: `tests/installer-part1-d.test.ts`; update `tests/trade-view.test.ts` (import line 2, lines 36–38)

**Interfaces:**
- Produces: `export function prestartReady(ticks: boolean[], checks: readonly string[]): boolean` → every check ticked.
- Consumes: `InstallFinishedButton({ run })` from `src/components/trade/InstallFinishedButton.tsx`, made by plan C Task 8 (C's "built twice" tidy hands Today's job to this plan). Same words, so nothing visible changes.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { prestartReady } from "../src/lib/trade-view.core";
import * as tv from "../src/lib/trade-view.core";
describe("D9 tidy", () => {
  test("one phone-check list, no dead messages, one install-finished button", () => {
    expect("PRESTART_CHECKS" in tv).toBe(false);
    expect("START_LABEL" in tv).toBe(false);
    expect(prestartReady([true, true, false], ["a", "b", "c"])).toBe(false);
    expect(prestartReady([true, true, true], ["a", "b", "c"])).toBe(true);
    const all = src("src/lib/trade-view.core.ts") + src("src/components/trade/TradePrestart.tsx") + src(DAY);
    for (const dead of ["Battery over 50%", "disabledReason", "still setting up the onsite form"]) expect(all).not.toContain(dead);
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"), src("src/lib/trade-view.server.ts").indexOf("export async function tradeCouldntGetIn"));
    expect(day).not.toContain('{ kind: "quoted" } : { kind: "quoted" }');
    expect(day).not.toContain("mittiReady");
    expect(src(DAY)).toContain("<InstallFinishedButton run={onDone} />");
    expect(src(DAY)).not.toContain("The install is finished");
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-part1-d.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Files/Interfaces. In `SignRebate` replace the inline `OneTapAction` with `<InstallFinishedButton run={onDone} />`; remove `OneTapAction`/`Check` imports only if nothing else in the file uses them. In `tests/trade-view.test.ts` remove `PRESTART_CHECKS` from the import and the line-36 assertion; call `prestartReady(ticks, ["a", "b", "c"])`.
- [ ] **Step 4: Run** `bun test tests/installer-part1-d.test.ts tests/trade-view.test.ts tests/installer-screens.core.test.ts tests/brief-n-ready-check-success.test.ts tests/installer-part1-job-page.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts src/components/trade/TradePrestart.tsx "src/routes/_authenticated/field.day.\$jobId.tsx" tests/installer-part1-d.test.ts tests/trade-view.test.ts
git commit -m "chore(today): remove the old phone-check list and dead messages; shared install-finished button"
```

### Task 8: Full checks and phone check

- [ ] **Step 1:** `bun run test` — Expected: no failures.
- [ ] **Step 2:** `bunx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` — Expected: last line ends `0 customer-visible (failing).`
- [ ] **Step 4: Phone and computer check (TEST accounts, TEST jobs only).** Installer TEST login, booked TEST Ready Check today → Couldn't get in → No one home → "Thanks. We'll rebook it."; reload → same page, job still on My work, offer-times shown. Try it on a Ready Check booked tomorrow → the reason shows in the sheet. TEST job at install booked, as the boss on the Job page → "Who's on the crew today?" → Lead list has no "Enter installer details" → pick a cleared Lead other than yourself + 2 → no third "Add" → Save → Mitti install form now with that Lead. Open Today's job for that install → same crew shown → Change → same picker. As a staff login, change only a crew member → saves; try another Lead → "Only the business owner…" refusal. Tick 3 checks → Start → reload → form button still shown. Electrician TEST login, booked TEST fixes visit → heading "Electrical fixes", "Do the fixes in Mitti", button "Fixes form in Mitti" opens the fixes form. Open `/field/day/<bad id>` → message + "Back to My work". Jo approves the page before it goes live.
- [ ] **Step 5 (after deploy, read-only DB check):** no `sms_messages` row of type `install_no_access` with status `sent` between 8pm and 7am Melbourne from the deploy time on; each held one has a later `sent` row under the same key.
