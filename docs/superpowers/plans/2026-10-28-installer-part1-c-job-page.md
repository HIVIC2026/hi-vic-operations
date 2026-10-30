# Installer pages Part 1 — C. Job page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Jo's answers (29 Oct 2026):**
1. C7: "More · staff job links" becomes **"Send this job to a staff member"**. Approved.
2. C2: button **"Use Home Insulation Victoria's electrician ($349)"**, then **"Switch this job to Home Insulation Victoria's electrician? You can't switch back."** with "Not yet" / "Yes, switch". Approved.
3. C3: yes, these are the electrician's own Call / Text (owner) buttons on their Job page.
4. C5: the "N days left" next to "Install must start by…" goes too for electricians. Proceeding as proposed.
5. C4: a repeat PIESA gets its **own new Mitti form**, made automatically when the repeat PIESA time is booked, like the first one (new Task 5). Then Pass/Fail and manual entry are removed completely, with no exception for repeats (Task 6).

**Goal:** Build spec section C (C1–C9) on the installer and electrician Job page (`/field/$jobId`). Nothing else.

**Architecture:** Wording rules stay in pure `installer-screens.core.ts` and use the existing `PIESA_FULL` constant (`src/lib/job-wording.ts`). The one-way electrician switch is a pure rule (`installer-price.core.ts`) plus one guarded server action that records the existing `electrician_choice_set` event and then re-prepares the quote the same way `setInstallerPrice` does. The electrician's Call/Text rule reuses the existing `contactVisible` (trade-view.core), now returned by `tradeJobStatus`. PIESA results come only from Mitti: Mitti sync → `assessments.piesa_outcome` → "Complete PIESA" (`completePiesaAssessment` writes the `initial` record, or `reassessment` for a repeat, Task 5). The A4 fixes form → `applyPiesaRecord` (fixes-day.server). Apart from that record kind, this plan keeps both paths unchanged. A repeat PIESA reuses the job's one `assessments` row (`job_id` is unique). The first check stays on record in its `piesa_records` row and in a `repeat_piesa_form_reset` event. No DB change.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase (admin client), bun:test (pure tests plus the repo's source-reading tests).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` §C

## Global Constraints

- Only C1–C9. Today's job (`field.day.$jobId.tsx`, `dayNext`, `electricianOnSite`, `DAY_WHAT`) belongs to the D plan and is not touched here.
- **Assumption (C9 "built twice"):** Today's job keeps its own "The install is finished" copy, which is the main one. This plan moves that exact button (same words) into one shared component and uses it on the Job page only. The D plan switches Today's job over to it.
- C1 rule: on the Job page, the text people see never says "safety check" or "electrical safety check". The first mention in a sentence is `PIESA_FULL`. Later mentions in the same panel say "PIESA".
- C4: the server functions `recordPiesa`, `completeAssessment` and `saveAssessment` stay as they are (the office, the A4 path and the DB tests use them). Only the portal entry screens go.
- C2: only the business owner (`business_admin`) of the business that supplied the job can switch, and only while the quote is held as "Electrician not onboarded". No office control is added.
- C9 makes no change anyone can see, apart from removing the "4 · " step number, which the spec asks for.
- Look and layout stay the same (Part 2 handles that).

## Review Focus

1. Mitti PIESA results still land after the manual entry is removed. Task 6 test: the Mitti branch keeps `Complete PIESA` and `FixesFormCard`, and `fixes-day.server.ts` still calls `applyPiesaRecord`.
2. The switch works one way only and only for the business owner. Task 7 test: `hivSwitchOffered` is false once the choice is `hivic` or when nothing is held. The server function calls `requireMember(..., true)`. No admin route imports it.
3. Call/Text disappear only after **all** of the electrician's own visits are done. Task 4 test: `contactVisible` cases, and the route puts the buttons behind `ownerContactVisible`.
4. No "safety check" wording is left on Job page screens. Task 1 test: a source scan of every Job page file, with comments stripped.
5. A repeat PIESA gets exactly one new Mitti form, and the first check stays on record. Task 5 test: `repeatFormStep` resets once per lapsed deadline (a replayed or second booking confirmation → `"none"`), `claimGeneration` moves on after a reset, and a completed repeat writes `reassessment`.

---

### Task 1: C1 — one PIESA name on the Job page

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (only the part above `// ---------- M4 · Today's job`)
- Modify: `src/lib/piesa-owner-confirm.core.ts` (`OWNER_PIESA_CONFIRM_WAITING`)
- Modify: `src/lib/trade-view.core.ts` (`SAFETY_CHECK_DOC_TITLE`)
- Modify: `src/components/trade/InstallerPriceCard.tsx` (note, line 66)
- Modify: `src/components/portal/piesa-times-electrician.tsx` (Section title)
- Modify: `src/components/trade/FixesTimesCard.tsx` (line 41 text)
- Modify: `src/components/portal/mitti.tsx` (non-measure-up Section title)
- Test: create `tests/installer-part1-job-page.test.ts`. Update `tests/installer-screens.core.test.ts:17`, `tests/installer-states.test.ts:71`, `tests/piesa-owner-confirm.test.ts:108`, `tests/electrician-piesa-copy.test.ts:75`

**Interfaces:** Consumes `PIESA_FULL` from `src/lib/job-wording.ts`. Produces no new exports.

- [ ] **Step 1: Write the failing test** (new file):

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PIESA_FULL } from "../src/lib/job-wording";
import { jobNext, thirtyDayLine } from "../src/lib/installer-screens.core";
import { OWNER_PIESA_CONFIRM_WAITING } from "../src/lib/piesa-owner-confirm.core";
import { SAFETY_CHECK_DOC_TITLE } from "../src/lib/trade-view.core";
const read = (p: string) => readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROUTE = "src/routes/_authenticated/field.$jobId.tsx";

describe("C1 one PIESA name on the Job page", () => {
  test("no 'safety check' wording in Job page sources", () => {
    const core = read("src/lib/installer-screens.core.ts").split("// ---------- M4 · Today's job")[0]!;
    for (const src of [core, read(ROUTE), read("src/components/trade/InstallerPriceCard.tsx"), read("src/components/portal/piesa-times-electrician.tsx"), read("src/components/trade/FixesTimesCard.tsx")])
      expect(code(src)).not.toMatch(/safety check/i);
  });
  test("shared constants use the standard name", () => {
    expect(OWNER_PIESA_CONFIRM_WAITING).toBe(`Waiting for the owner to confirm the ${PIESA_FULL}`);
    expect(SAFETY_CHECK_DOC_TITLE).toBe(PIESA_FULL);
    expect(thirtyDayLine("2026-11-21")).toBe(`Install within 30 days of the ${PIESA_FULL} (by 21 Nov) or a new PIESA is needed, and whoever's move it was pays for it.`);
    expect(code(read("src/components/portal/mitti.tsx"))).toContain("`Mitti · ${PIESA_FULL}`");
  });
  test("PIESA booked title", () => {
    const n = jobNext({ channel: "hivic_sourced", stage: "piesa_scheduled", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: null, piesaBooking: { electrician: "Sam Lee", start: "2026-10-28T22:00:00Z" } } as never);
    expect(n.title).toBe(`Nothing for you — ${PIESA_FULL} booked`);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `bun test tests/installer-part1-job-page.test.ts`. Expected: FAIL (old wording).

- [ ] **Step 3: Replace the wording** (import `PIESA_FULL` where needed):

| Where | Now | New |
|---|---|---|
| core L147 | `Then we arrange the electrical safety check.` | `` `Then we arrange the ${PIESA_FULL}.` `` |
| core L181 | `Safety check cleared ${…} · ` | `` `${PIESA_FULL} cleared ${…} · ` `` |
| core L186 title / sub | `A new safety check is needed` / `The 30-day window after the safety check has passed. Home Insulation Victoria arranges the new check.` | `` `A new ${PIESA_FULL} is needed` `` / `The 30-day window after the PIESA has passed. Home Insulation Victoria arranges the new PIESA.` |
| core L188 | `The safety check (PIESA) found electrical fixes.` | `` `The ${PIESA_FULL} found electrical fixes.` `` |
| core L202 | `Nothing for you — safety check booked` | `` `Nothing for you — ${PIESA_FULL} booked` `` |
| core L220 and InstallerPriceCard L66 | `…fee and the electrical safety check, take off…` | `` `…fee and the ${PIESA_FULL}, take off…` `` |
| core L242 `thirtyDayLine` | `…of the safety check (by X) or a new check is needed…` | `` `…of the ${PIESA_FULL} (by X) or a new PIESA is needed…` `` |
| `OWNER_PIESA_CONFIRM_WAITING` | `…confirm the safety check` | `` `Waiting for the owner to confirm the ${PIESA_FULL}` `` |
| `SAFETY_CHECK_DOC_TITLE` | `Safety check (PIESA)` | `PIESA_FULL` |
| piesa-times-electrician title | `Safety check times` | `` `${PIESA_FULL} times` `` |
| FixesTimesCard L41 | `The safety check needs electrical fixes.` | `` `The ${PIESA_FULL} needs electrical fixes.` `` |
| mitti.tsx title | `Mitti electrical assessment · PIESA` | `` `Mitti · ${PIESA_FULL}` `` |

Update the four pinned old strings in the existing tests listed above to the new values.

- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/installer-part1-job-page.test.ts tests/installer-screens.core.test.ts tests/installer-states.test.ts tests/piesa-owner-confirm.test.ts tests/electrician-piesa-copy.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-screens.core.ts src/lib/piesa-owner-confirm.core.ts src/lib/trade-view.core.ts src/components tests docs/superpowers/plans/2026-10-28-installer-part1-c-job-page.md
git commit -m "fix(job page): one PIESA name everywhere on the Job page (C1)"
```

### Task 2: C8 — the 6:30am sentence shows once

**Files:** Modify `src/lib/installer-screens.core.ts` (`jobNext` install_booked line). Test: `tests/installer-part1-job-page.test.ts`.

- [ ] **Step 1: Failing test** (append):

```ts
test("C8: install booked without a deadline says the 6:30am sentence once", () => {
  const n = jobNext({ channel: "hivic_sourced", stage: "installation_booked", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: null, installTurn: "booked", installBookedAt: "2026-10-26T21:00:00Z", installDeadline: null } as never);
  expect([n.title, n.sub, n.note].join(" | ").match(/6:30am/g)?.length).toBe(1);
  expect(n.sub).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/installer-part1-job-page.test.ts`
- [ ] **Step 3: Implement.** install_booked `sub`: `f.installDeadline ? \`Install by …${left}.\` : null`. `note` stays as it is.
- [ ] **Step 4: Run, expect PASS.** Same file plus `tests/installer-screens.core.test.ts tests/installer-states.test.ts`.
- [ ] **Step 5: Commit** `git add src/lib/installer-screens.core.ts tests/installer-part1-job-page.test.ts && git commit -m "fix(job page): 6:30am sentence once (C8)"`

### Task 3: C6 — "Open Mitti form" once, and C7 — plain staff-links label

**Files:** Modify `src/lib/installer-screens.core.ts` (add exports) and `src/routes/_authenticated/field.$jobId.tsx` (NextPanel link L391, Ready Check link L428, `<summary>` L436). Test: `tests/installer-part1-job-page.test.ts`.

**Interfaces (Produces, in installer-screens.core.ts):**
- `export function mittiLinkPlace(f: { panel: JobNextPanel | null; yours: boolean; auditId: string | null; mittiInvited: boolean; formLinked: boolean }): "next" | "ready_check" | null` returns `"next"` when (`panel === "mitti_form"` or (`panel === "quote_status"` and `yours`)) and there is an `auditId` and `mittiInvited`. Otherwise it returns `"ready_check"` when `formLinked`, `auditId` and `mittiInvited`. Otherwise `null`.
- `export const STAFF_LINKS_LABEL = "Send this job to a staff member";` (Jo's answer 1)

- [ ] **Step 1: Failing test:**

```ts
import { mittiLinkPlace, STAFF_LINKS_LABEL } from "../src/lib/installer-screens.core";
test("C6: Open Mitti form has exactly one place", () => {
  const f = { auditId: "a1", mittiInvited: true, formLinked: true };
  expect(mittiLinkPlace({ ...f, panel: "mitti_form", yours: true })).toBe("next");
  expect(mittiLinkPlace({ ...f, panel: "quote_status", yours: true })).toBe("next");
  expect(mittiLinkPlace({ ...f, panel: "quote_status", yours: false })).toBe("ready_check");
  expect(mittiLinkPlace({ ...f, panel: "waiting", yours: false })).toBe("ready_check");
  expect(mittiLinkPlace({ ...f, mittiInvited: false, panel: "mitti_form", yours: true })).toBeNull();
  const r = read(ROUTE);
  expect(r).toContain('mittiLink === "next" && <MittiFormLink'); expect(r).toContain('mittiLink === "ready_check" && <MittiFormLink');
  expect(r).not.toContain('next.panel === "mitti_form" || (next.panel === "quote_status" && next.yours)'); // old inline rule gone
});
test("C7: plain staff-links label", () => {
  expect(read(ROUTE)).not.toContain("More · staff job links");
  expect(read(ROUTE)).toContain("{STAFF_LINKS_LABEL}");
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `InstallerFlow`: `const mittiLink = page && next ? mittiLinkPlace({ panel: next.panel, yours: next.yours, auditId: page.form.auditId, mittiInvited: page.mittiInvited, formLinked: page.form.linked }) : null;` (Pass `page.mittiInvited` for now. Task 8 swaps it for `useMittiInvited()`.) The NextPanel link renders when `mittiLink === "next"`. The Ready Check link renders when `mittiLink === "ready_check"`. The summary text becomes `{STAFF_LINKS_LABEL}`.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/installer-part1-job-page.test.ts tests/field-job-one-call.test.tsx`
- [ ] **Step 5: Commit** `git add src/lib/installer-screens.core.ts "src/routes/_authenticated/field.\$jobId.tsx" tests/installer-part1-job-page.test.ts && git commit -m "fix(job page): Open Mitti form once; plain staff links label (C6, C7)"`

### Task 4: C5 — no install deadline for electricians, and C3 — Call/Text go once their visit is done

**Files:**
- Modify: `src/lib/job-status.server.ts` (`tradeJobStatus` return adds `ownerContactVisible`)
- Modify: `src/components/trade/job-status.tsx` (export the hook the card already uses)
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (electrician `NowPanel`, L121–129)
- Test: `tests/installer-part1-job-page.test.ts`

**Interfaces:**
- Consumes: `contactVisible(myBookings: { status: string }[]): boolean` (trade-view.core).
- Produces: `tradeJobStatus(...)` now also returns `ownerContactVisible: boolean`, computed as `contactVisible(own business's bookings on this job)` (`bookings.select("status").eq("job_id").eq("business_id", c.biz.id)`). Also `export function useTradeJobStatus(jobId: string, enabled?: boolean)` (default `true`) in job-status.tsx, with the same query key `["trade-job-status", jobId]`.

- [ ] **Step 1: Failing test:**

```ts
import { contactVisible } from "../src/lib/trade-view.core";
test("C3: electrician Call/Text follow their own visits", () => {
  expect(contactVisible([{ status: "confirmed" }])).toBe(true);
  expect(contactVisible([{ status: "completed" }, { status: "confirmed" }])).toBe(true);
  expect(contactVisible([{ status: "completed" }, { status: "cancelled" }])).toBe(false);
  expect(read("src/lib/job-status.server.ts")).toContain("ownerContactVisible: contactVisible(");
  const elec = read(ROUTE).split("function FieldJobBody")[1]!.split("function A1ReadyCheckTimeCard")[0]!;
  expect(elec).toContain("showOwnerContact && job.owner_phone && <a href={`tel:");
  expect(elec).toContain("showOwnerContact && job.owner_phone && <a href={`sms:");
});
test("C5: electricians don't see the install deadline", () => {
  const elec = read(ROUTE).split("function FieldJobBody")[1]!.split("function A1ReadyCheckTimeCard")[0]!;
  expect(elec).not.toContain("Install must start by");
  expect(elec).not.toContain("days left");
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Server: add the bookings read and the field. Card: move its `useQuery` into `useTradeJobStatus` and use it. Route: in `FieldJobBody`, **before its early returns** (hook order), `const status = useTradeJobStatus(jobId, role === "electrician");` (add an `enabled` second param, default `true`). Then `const showOwnerContact = status.data?.ownerContactVisible !== false;`. Remove the `due` and `next` props from `NowPanel`. Put `showOwnerContact &&` in front of the Call and Text anchors. Directions stays.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/installer-part1-job-page.test.ts tests/trade-view.test.ts`
- [ ] **Step 5: Commit** `git add src/lib/job-status.server.ts src/components/trade/job-status.tsx "src/routes/_authenticated/field.\$jobId.tsx" tests/installer-part1-job-page.test.ts && git commit -m "fix(job page): electricians — no install deadline; Call/Text go after their visit (C3, C5)"`

### Task 5: C4 (Jo 29 Oct) — a repeat PIESA gets its own new Mitti form

Today `piesaAutoFormDecision` skips because `assessments.external_mitti_id` still holds the first check's form. The `piesa` claim at generation 0 is also already used, so even the office button would get `MittiClaimHeld`. The fix: when a repeat PIESA time is booked, the first check moves to history **once per lapsed deadline**, and the claim moves to a new generation. Then the existing Decision 398 path makes the new form, and the existing pull and "Complete PIESA" bring its result back.

**Files:**
- Create: `src/lib/repeat-piesa-form.core.ts`. Modify: `src/lib/mitti-create-claim.core.ts`, `src/lib/mitti-create.server.ts` (`generationOf`), `src/lib/piesa-autoform.server.ts`, `src/lib/piesa-complete.server.ts`
- Test: create `tests/repeat-piesa-form.test.ts`

**Interfaces (Produces):**
- `repeat-piesa-form.core.ts`: `export const REPEAT_PIESA_FORM_RESET_EVENT = "repeat_piesa_form_reset";`. `export const repeatFormResetSeed = (jobId: string, deadline: string) => \`repeat-piesa-form:${jobId}:${deadline}\`;`. `export const ASSESSMENT_ROUND_RESET = { status: "in_progress", completed_at: null, piesa_outcome: "pending", assessed_on: null, no_rectification_confirmed: null, external_mitti_id: null, mitti_template_id: null, mitti_raw_snapshot: null, mitti_sync_status: "not_synced", mitti_last_error: null } as const;`
- `export function repeatFormStep(f: { repeatDeadline: string | null; reset: { previousAuditId: string | null } | null; current: { auditId: string | null; status: string } | null }): "reset" | "none"`. It returns `"none"` with no deadline. It returns `"reset"` when no reset event exists for this deadline. When the event exists, it returns `"reset"` only if the row is still the old round (`status === "complete"` and `auditId === reset.previousAuditId`). This covers a crash between the event and the row update.
- `export function piesaCompletionKind(priorOfficialRecords: number): "initial" | "reassessment"`
- `mitti-create-claim.core.ts`: `export function claimGeneration(f: { releasedKinds: (string | undefined)[]; repeatResets: number; kind: MittiFormKind }): number` is the number of releases of `kind`, plus `repeatResets` when `kind === "piesa"`. `generationOf` also reads `REPEAT_PIESA_FORM_RESET_EVENT` rows and calls it. The office button then gets the new generation too.
- `piesa-autoform.server.ts`: `async function startRepeatRoundIfDue(jobId: string, actorId: string | null): Promise<void>`. It uses `repeatPiesaContext` (`stage === "offer"` → deadline), the reset event for that deadline and the assessments row, then calls `repeatFormStep`. On `"reset"`: insert the event with `id: await stableUuid(repeatFormResetSeed(jobId, deadline))` (a duplicate is ignored). Its details are `{ deadline, previous_audit_id, previous_outcome, previous_assessed_on }` and it is `{ internal: true }`. Then use the stored event's `previous_audit_id` to update `assessments` with `ASSESSMENT_ROUND_RESET`, guarded by `.eq("job_id", jobId).eq("status", "complete")` plus the `external_mitti_id` match (`.is(…, null)` when null). It is called first in `onPiesaBooked`. On an error it returns `failed(…, "New PIESA round not started: …")` (one Needs me row). TEST jobs keep `piesaTestAssignee` as they are.
- `piesa-complete.server.ts`: count `piesa_records` with `kind` in `initial` / `reassessment` for the job, then `kind: piesaCompletionKind(prior ?? 0)`.

- [ ] **Step 1: Failing test** (new file):

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { piesaCompletionKind, repeatFormStep } from "../src/lib/repeat-piesa-form.core";
import { claimGeneration } from "../src/lib/mitti-create-claim.core";
const read = (p: string) => readFileSync(p, "utf8");
const old = { auditId: "m-first", status: "complete" };
describe("Repeat PIESA gets its own Mitti form (Jo 29 Oct 2026)", () => {
  test("first check moves to history once per lapsed deadline", () => {
    expect(repeatFormStep({ repeatDeadline: null, reset: null, current: old })).toBe("none");
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: null, current: old })).toBe("reset");
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: old })).toBe("reset"); // crash replay
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: { auditId: "m-repeat", status: "in_progress" } })).toBe("none"); // 2nd confirm / sync replay
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: { auditId: null, status: "in_progress" } })).toBe("none");
  });
  test("claim moves to a new generation only for the PIESA form", () => {
    expect(claimGeneration({ releasedKinds: [], repeatResets: 0, kind: "piesa" })).toBe(0);
    expect(claimGeneration({ releasedKinds: ["piesa", "ready_check"], repeatResets: 1, kind: "piesa" })).toBe(2);
    expect(claimGeneration({ releasedKinds: ["piesa"], repeatResets: 1, kind: "ready_check" })).toBe(0);
  });
  test("completed repeat is a reassessment; first stays initial", () => {
    expect(piesaCompletionKind(0)).toBe("initial"); expect(piesaCompletionKind(1)).toBe("reassessment");
  });
  test("wiring", () => {
    const s = read("src/lib/piesa-autoform.server.ts");
    expect(s.indexOf("await startRepeatRoundIfDue(")).toBeGreaterThan(-1);
    expect(s.indexOf("await startRepeatRoundIfDue(")).toBeLessThan(s.indexOf('admin.from("assessments").select("external_mitti_id")'));
    const fn = s.slice(s.indexOf("async function startRepeatRoundIfDue"));
    for (const x of ["repeatFormStep(", "repeatFormResetSeed(", "ASSESSMENT_ROUND_RESET", '.eq("status", "complete")', "internal: true"]) expect(fn).toContain(x);
    expect(read("src/lib/mitti-create.server.ts")).toContain("claimGeneration(");
    expect(read("src/lib/piesa-complete.server.ts")).toContain("kind: piesaCompletionKind(");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/repeat-piesa-form.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces above exactly. Do not change `piesaAutoFormDecision`, `createAssignMittiAudit` or the pull.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/repeat-piesa-form.test.ts tests/decision-398-piesa-autoform.test.ts tests/repeat-piesa.test.ts tests/t3-mitti-async-claim.test.ts tests/piisa-claim-guard.test.ts tests/mitti-retry-sweep.test.ts`
- [ ] **Step 5: Commit** `git add src/lib/repeat-piesa-form.core.ts src/lib/mitti-create-claim.core.ts src/lib/mitti-create.server.ts src/lib/piesa-autoform.server.ts src/lib/piesa-complete.server.ts tests/repeat-piesa-form.test.ts && git commit -m "feat(piesa): a repeat PIESA gets its own new Mitti form when booked; first check kept as history (Jo 29 Oct)"`

### Task 6: C4 — PIESA result in Mitti only

**Files:**
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (`ElectricianFlow`. Delete `PiesaForm`.)
- Delete: `src/components/portal/electrician-manual-result.tsx`, `tests/electrician-manual-result.test.tsx`
- Modify: `tests/p1-s64-date-payment-regressions.test.ts`. Replace the "S64 manual PIESA form is wired…" describe block and the "client additionally caps the date input" test with the Step 1 test. The server date-rule tests stay.

**Interfaces:** Consumes Task 5 (a repeat PIESA comes through its own Mitti form, so no repeat needs Pass/Fail), `completeAssessment` (kept), `FixesFormCard`, `MittiOnly` (route-local, `which: "piesa"`).

- [ ] **Step 1: Failing test** (in the S64 file):

```ts
describe("C4 (Jo 28 Oct 2026): PIESA result comes from Mitti only", () => {
  test("no Pass/Fail or manual entry on the Job page", () => {
    const src = routeSrc();
    for (const gone of ["function PiesaForm(", "recordPiesa", "ElectricianManualResult", "manualResultEntry", ">Pass</Button>", ">Fail</Button>", "PIESA window expired"]) expect(src).not.toContain(gone);
  });
  test("Mitti result path kept", () => {
    const src = routeSrc();
    const mitti = src.split("{a?.external_mitti_id && (assessing || locked) && (")[1]!.split("function OtherItems")[0]!;
    expect(mitti).toContain("MittiSyncedFields"); expect(mitti).toContain("Complete PIESA");
    expect(src).toContain("<FixesFormCard jobId={jobId}");
    expect(src).toContain('<MittiOnly jobId={jobId} which="piesa" />'); // no form yet → "Home Insulation Victoria links it"
    expect(srcText("../src/lib/fixes-day.server.ts")).toContain("applyPiesaRecord(");
    expect(srcText("../src/lib/piesa-complete.server.ts")).toContain("kind: piesaCompletionKind("); // Task 5: initial or reassessment
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/p1-s64-date-payment-regressions.test.ts`
- [ ] **Step 3: Implement.** In `ElectricianFlow`, remove both `<PiesaForm …/>` lines, the `showManual` block, and `f` / `setF` / `saved` / `put` / `save` / `useEffect`. `needsPlan` reads `a?.no_rectification_confirmed !== true`. Add `{assessing && !a?.external_mitti_id && <Section title={PIESA_FULL}><MittiOnly jobId={jobId} which="piesa" /></Section>}`. Keep the existing locked line for old completed assessments that have no Mitti id: `{locked && !a?.external_mitti_id && <Section title={PIESA_FULL}><p className="text-sm text-sub">{PIESA_FULL} complete.</p></Section>}`. Drop the `expired` prop (and `expired={!!job.piesa_expired}`) and the now-unused imports (`recordPiesa`, `saveAssessment`, `ElectricianManualResult`, `manualResultEntry`, `useEffect`). Delete the two files.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/p1-s64-date-payment-regressions.test.ts tests/a4-clearance-guard.test.ts tests/install-clearance.test.ts tests/fixes-day.test.ts`
- [ ] **Step 5: Commit** `git add -A src/routes src/components/portal tests && git commit -m "fix(job page): PIESA result from Mitti only — remove Pass/Fail and manual entry (C4)"`

### Task 7: C2 — one-way switch to HIV's electrician

**Files:**
- Modify: `src/lib/installer-price.core.ts`, `src/lib/electrician-choice.core.ts` (source union), `src/lib/installer-price-set.server.ts`, `src/lib/installer-price.functions.ts`, `src/components/trade/InstallerPriceCard.tsx`
- Test: `tests/installer-part1-job-page.test.ts`

**Interfaces (Produces):**
- `installer-price.core.ts`: `export function hivSwitchOffered(f: { quoteHeldNotOnboarded: boolean; choice: ElectricianChoice }): boolean` (`ElectricianChoice` from `electrician-choice.core.ts`, `"hivic" | "usual"`) returns `held && choice !== "hivic"`. Also `export const HIV_SWITCH = { button: (priceIncGst: number) => \`Use Home Insulation Victoria's electrician ($${priceIncGst})\`, confirm: "Switch this job to Home Insulation Victoria's electrician? You can't switch back.", yes: "Yes, switch", refused: "This job can't be switched to Home Insulation Victoria's electrician." } as const;`
- `electrician-choice.core.ts`: `ElectricianChoiceRecord["source"]` adds `"installer_switch"`.
- `installer-price-set.server.ts`: `installerPriceView` also returns `hivSwitch: { priceIncGst: number } | null`. It is non-null only when `hivSwitchOffered({ quoteHeldNotOnboarded: (await loadInstallerQuote(jobId)).electricianNotOnboarded === true, choice })`. The price comes from current `retail_estimator_settings.piesa_assessment_inc_gst`, else 349. Add `export async function switchToHivElectrician(jobId: string, userId: string): Promise<{ ok: true }>`: `a1JobOrThrow` → `requireMember(userId, biz, true)` → re-check `hivSwitchOffered` (else `WorkflowError(HIV_SWITCH.refused)`) → `recordElectricianChoice(jobId, biz, userId, "hivic", "installer_switch")` → `prepareQuoteFromPortal(jobId, userId)`. `prepareQuoteFromPortal` is the sync + draft + auto-send try-block moved verbatim out of `setInstallerPrice`, which now calls it.
- `installer-price.functions.ts`: `export const switchToHivElectricianFn` (POST, `{ jobId: uuid }`).

- [ ] **Step 1: Failing test:**

```ts
import { readdirSync } from "node:fs";
import { HIV_SWITCH, hivSwitchOffered } from "../src/lib/installer-price.core";
test("C2: one-way switch only on a job held for a not-onboarded electrician", () => {
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: true, choice: "usual" })).toBe(true);
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: true, choice: "hivic" })).toBe(false); // already switched: no way back
  expect(hivSwitchOffered({ quoteHeldNotOnboarded: false, choice: "usual" })).toBe(false);
  expect(HIV_SWITCH.button(349)).toBe("Use Home Insulation Victoria's electrician ($349)");
  const srv = read("src/lib/installer-price-set.server.ts");
  const fn = srv.slice(srv.indexOf("export async function switchToHivElectrician"));
  expect(fn).toMatch(/requireMember\(userId, [^,]+, true\)/);
  expect(fn).toContain('recordElectricianChoice(jobId, ');
  expect(fn).toContain('"hivic", "installer_switch")');
  const card = read("src/components/trade/InstallerPriceCard.tsx");
  expect(card).toContain("confirm={HIV_SWITCH.confirm}");
  for (const f of readdirSync("src/routes/_authenticated").filter((n: string) => n.startsWith("admin"))) expect(read(`src/routes/_authenticated/${f}`)).not.toContain("switchToHivElectrician");
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the interfaces above. Card: under the "Electrician" row, `{view.hivSwitch && <OneTapAction label={HIV_SWITCH.button(view.hivSwitch.priceIncGst)} busyLabel="Switching…" confirm={HIV_SWITCH.confirm} confirmLabel={HIV_SWITCH.yes} run={() => sw({ jobId }, "Switched to Home Insulation Victoria's electrician")} />}` with `const sw = useAction(switchToHivElectricianFn);`.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/installer-part1-job-page.test.ts tests/installer-price.test.ts tests/rec-onboarded*.test.ts tests/trade-job-bundle.test.ts`
- [ ] **Step 5: Commit** `git add src/lib/installer-price.core.ts src/lib/electrician-choice.core.ts src/lib/installer-price-set.server.ts src/lib/installer-price.functions.ts src/components/trade/InstallerPriceCard.tsx tests/installer-part1-job-page.test.ts && git commit -m "feat(job page): one-way switch to HIV's electrician when stuck on a not-onboarded one (C2)"`

### Task 8: C9 — tidy-up, no visible change

**Files:**
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (`OtherItems` title, `InstallerFlow` Mitti check, sign_rebate block)
- Create: `src/components/trade/InstallFinishedButton.tsx`
- Test: `tests/installer-part1-job-page.test.ts`

**Interfaces (Produces):** `export function InstallFinishedButton({ run }: { run: () => Promise<unknown> }): JSX.Element` is the `OneTapAction` copied character-for-character from `field.day.$jobId.tsx` L150 (label "The install is finished", busy "Recording…", same confirm text, "Yes, it's finished").

- [ ] **Step 1: Failing test:**

```ts
test("C9: tidy-up keeps the same screen", () => {
  const r = read(ROUTE);
  expect(r).not.toContain("4 · Electrical fixes items"); expect(r).toContain('title="Electrical fixes items"');
  expect(r).not.toContain("page.mittiInvited"); // one Mitti-account check: useMittiInvited()
  expect(r).not.toContain("The install is finished"); expect(r).toContain("<InstallFinishedButton run={");
  const b = read("src/components/trade/InstallFinishedButton.tsx");
  for (const s of ["The install is finished", 'busyLabel="Recording…"', "Confirm the install is finished on site? Only do this once the Mitti install form is Complete.", `confirmLabel="Yes, it's finished"`]) expect(b).toContain(s);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Rename the section title. In `InstallerFlow` add `const mittiInvited = useMittiInvited();` and use it everywhere `page.mittiInvited` was used. The bundle already seeds `["mitti-invited"]`, so this adds no call. In sign_rebate, replace the inline `OneTapAction` with `<InstallFinishedButton run={() => done({ jobId }, "Install recorded")} />`. `Check` stays imported (Complete PIESA still uses it).
- [ ] **Step 4: Run, expect PASS.** `bun test tests/installer-part1-job-page.test.ts tests/field-job-one-call.test.tsx`
- [ ] **Step 5: Commit** `git add "src/routes/_authenticated/field.\$jobId.tsx" src/components/trade/InstallFinishedButton.tsx tests/installer-part1-job-page.test.ts && git commit -m "refactor(job page): tidy-up — one Mitti check, shared install-finished button, no step number (C9)"`

### Task 9: Full checks

- [ ] **Step 1:** `bun run test`. Expected: all suites pass and none fail.
- [ ] **Step 2:** `bunx tsc --noEmit`. Expected: exit 0 with no errors, in particular no unused-import or type errors in the files changed above.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts`. Expected: the last line reads `N matches, 0 customer-visible (failing).` and it exits with 0 (the new `$349` button text must not trip the "$349 electrician fee" rule).
- [ ] **Step 4:** Commit only if Steps 1–3 needed a fix: `git commit -am "chore: job page Part 1 C — checks green"`
