# Installer pages Part 1 — E. Money — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Jo's answers (29 Oct 2026):** 1–3 approved as written. 4 (file name) proceeding as proposed.
1. E1 electrician empty Money page: "No completed visits yet." / "Your pay for each safety check and fixes visit shows here once the visit is done." Tiles say "1 visit" / "3 visits".
2. E2: show the **last 4** bank digits everywhere (per-job page and My business already use 4; only the Money page uses 3).
3. E3 job pay page heading for the reasons: "Why your pay is held". The reasons use the same words the Money list already shows (e.g. "Waiting for Final check (AP approval) — installer pay falls due 7 days after it"). OK as is?
4. E4 file name: `pay-statement-2026-10-28.csv` (today's date). On iPhone it opens the Share sheet, where they tap "Save to Files".

**Goal:** Fix the four Money problems in spec section E: electrician words, same bank digits on every page, the job pay page says why pay is held, and Download statement saves on an iPhone.

**Architecture:** Words and the CSV live in pure cores (`installer-screens.core.ts`, `trade-view.core.ts`). The server reads (`trade-view.server.ts`) use one `accountEnding` helper and pass the existing `held` reasons to the per-job page. The statement is built in the page as a `File` and saved through a small `saveFile` helper: Share sheet on touch phones (iPhone "Save to Files"), blob link download elsewhere — the same pattern `admin.users.tsx` already uses. No new server route, no DB change.

**Tech Stack:** TypeScript, TanStack Start, React, bun:test (pure-function tests + source-reading tests for pages).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` — section E only.

## Global Constraints

- Only E1–E4. Nothing else on Money, the per-job page or other pages changes. The look stays the same.
- Stays the same: on installers' own customers (`installer_sourced`), pay waits until the owner has paid in full (`payState`, `installerPayHeldReasons` untouched).
- Installer wording on Money stays exactly as today; only electricians get new words.
- Never show more than the last 4 account digits or more than the first 3 BSB digits.
- Pay amounts, pay states and held reasons are not recalculated — only shown.
- Trade screens read only through `trade-view.server.ts` (src/AGENTS.md).

## Review Focus

1. Money, per-job and My business bank page all show the same 4 digits → Task 1 test: `accountEnding` + no `slice(-3)` on account digits in `trade-view.server.ts`.
2. An electrician sees no "install" words on Money; installer words unchanged → Task 2 test on `moneyWords`.
3. A held job page shows "Held" and every reason; a paid job shows no reasons → Task 3 test on `moneyJobDetail`.
4. Own-customer installer pay still waits for the owner's payment in full → Task 3 test on `payState` / `installerPayHeldReasons`.
5. Statement escapes commas/quotes, shows "Held" for held rows, and the page no longer uses a `data:` link → Task 4 tests.

---

### Task 1: E2 — same bank digits (last 4) on every page

**Files:**
- Modify: `src/lib/trade-view.core.ts` (add `accountEnding`)
- Modify: `src/lib/trade-view.server.ts` (`tradeMoney` ~line 524–527, `tradeMoneyJob` ~line 995–999, `tradeMoneyExtras` ~line 1014–1016)
- Modify: `src/lib/installer-screens.core.ts` (`bankLine` comment example "471" → "4471")
- Test: `tests/installer-money-e.test.ts` (new)

**Interfaces:**
- Produces: `export function accountEnding(raw: string | null | undefined): string | null` — digits only, last 4, `null` when fewer than 4 digits.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accountEnding } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");

describe("E2 bank digits", () => {
  test("last 4 digits everywhere, never fewer", () => {
    expect(accountEnding("123 456 789")).toBe("6789");
    expect(accountEnding("12-34")).toBe("1234");
    expect(accountEnding("123")).toBeNull();
    expect(accountEnding(null)).toBeNull();
    const srv = src("src/lib/trade-view.server.ts");
    expect(srv).not.toMatch(/digits\.slice\(-3\)/);
    expect(srv.match(/accountEnding\(bank\?\.account_number\)/g)?.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-money-e.test.ts` — Expected: FAIL (`accountEnding` not exported).
- [ ] **Step 3: Implement** `accountEnding` in `trade-view.core.ts`. In `trade-view.server.ts` replace the three `digits` lines with `accountEnding(bank?.account_number)` (`bankEnding` on `tradeMoney`, `accountEnding` on `tradeMoneyJob` and `tradeMoneyExtras`); update the "last 3 digits" comment to "last 4".
- [ ] **Step 4: Run** `bun test tests/installer-money-e.test.ts tests/installer-screens.core.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/lib/trade-view.server.ts src/lib/installer-screens.core.ts tests/installer-money-e.test.ts
git commit -m "fix(money): show the last 4 bank digits on every trade page"
```

### Task 2: E1 — electrician words on Money

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (add `moneyWords` after `moneyTotals`)
- Modify: `src/routes/_authenticated/field.money.tsx` (empty state + "This month" / "Last month" tile subs)
- Test: `tests/installer-money-e.test.ts`

**Interfaces:**
- Produces: `export function moneyWords(kind: "installer" | "electrician"): { emptyTitle: string; emptyBody: string; count: (n: number) => string }`
  - installer: `"No completed jobs yet."`, `"Your pay for each install appears here once the install is done."`, `1 install` / `n installs` (today's text).
  - electrician: open question 1 wording, `1 visit` / `n visits`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { moneyWords } from "../src/lib/installer-screens.core";
describe("E1 electrician words", () => {
  test("electricians never see install words; installer words unchanged", () => {
    const e = moneyWords("electrician");
    expect(`${e.emptyTitle} ${e.emptyBody} ${e.count(0)} ${e.count(1)} ${e.count(3)}`).not.toMatch(/install/i);
    expect(e.count(1)).toBe("1 visit");
    expect(e.count(3)).toBe("3 visits");
    expect(e.emptyTitle).toBe("No completed visits yet."); // Jo answer 1, exact
    expect(e.emptyBody).toBe("Your pay for each safety check and fixes visit shows here once the visit is done.");
    const i = moneyWords("installer");
    expect([i.emptyTitle, i.emptyBody, i.count(1), i.count(2)]).toEqual(["No completed jobs yet.", "Your pay for each install appears here once the install is done.", "1 install", "2 installs"]);
    const page = src("src/routes/_authenticated/field.money.tsx");
    expect(page).toContain("moneyWords(data.kind)");
    expect(page).not.toContain("once the install is done");
    expect(page).not.toMatch(/install\$\{t\.(this|last)Month/);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-money-e.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `moneyWords`; in `field.money.tsx` set `const w = moneyWords(data.kind);` and use `w.emptyTitle`, `w.emptyBody`, `w.count(t.thisMonth.installs)`, `w.count(t.lastMonth.installs)`.
- [ ] **Step 4: Run** `bun test tests/installer-money-e.test.ts tests/electrician-pay.test.ts tests/trade-payout-gate.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-screens.core.ts src/routes/_authenticated/field.money.tsx tests/installer-money-e.test.ts
git commit -m "fix(money): electricians see visit words, not install words"
```

### Task 3: E3 — job pay page says why pay is held

**Files:**
- Modify: `src/lib/installer-screens.core.ts` (`MoneyJobFacts` + `moneyJobDetail`)
- Modify: `src/lib/trade-view.server.ts` (`tradeMoneyJob` return: add `held: row?.held ?? []`)
- Modify: `src/routes/_authenticated/field.money_.$jobId.tsx` (pill + reasons list)
- Test: `tests/installer-money-e.test.ts`

**Interfaces:**
- Consumes: `heldPayPill(reasons)` from `trade-view.core.ts` (existing); `held: string[]` already on money rows.
- Produces: `MoneyJobFacts.held: string[]`; `moneyJobDetail(...)` also returns `held: string[]` (`[]` when `state.kind === "paid"`).
- Page: when `v.held.length`, the pill is `heldPayPill(v.held)` ("Held") and a `<ul data-money-job-held>` under the heading from open question 3 lists every reason; otherwise today's pill.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { moneyJobDetail } from "../src/lib/installer-screens.core";
import { INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER, installerPayHeldReasons, payState } from "../src/lib/trade-view.core";
const facts = { jobNumber: "HV-1", suburb: "Kew", channel: "hivic_sourced", doneAt: null, amount: 1200, state: { kind: "checking" as const }, accountEnding: "6789", product: null, areaM2: null, removalM2: null, crew: [], installerSignedAt: null, ownerSignedAt: null, apApprovedAt: null, ownerPaidInFullAt: null, held: [] as string[] };
describe("E3 why pay is held", () => {
  test("every reason passes through; paid shows none", () => {
    const held = ["Install form not Complete in Mitti", INSTALLER_PAY_WAITING_AP];
    expect(moneyJobDetail({ ...facts, held }).held).toEqual(held);
    expect(moneyJobDetail({ ...facts, held, state: { kind: "paid", on: "2026-10-20T00:00:00Z" } }).held).toEqual([]);
    const page = src("src/routes/_authenticated/field.money_.$jobId.tsx");
    expect(page).toContain("heldPayPill(v.held)");
    expect(page).toContain("data-money-job-held");
    expect(src("src/lib/trade-view.server.ts")).toContain("held: row?.held ?? []");
  });
  test("stays the same: own-customer pay waits for the owner's payment in full", () => {
    const f = { installerSupplied: true, apApprovedAt: "2026-10-01T00:00:00Z", ownerPaidInFullAt: null };
    expect(payState({ paidAt: null, ...f }).kind).toBe("checking");
    expect(installerPayHeldReasons(f)).toEqual([INSTALLER_PAY_WAITING_OWNER]);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-money-e.test.ts` — Expected: FAIL (`held` missing).
- [ ] **Step 3: Implement** as in Interfaces. Leave `payState`, `installerPayHeldReasons` and reason wording untouched.
- [ ] **Step 4: Run** `bun test tests/installer-money-e.test.ts tests/installer-screens.core.test.ts tests/trade-view.test.ts tests/office-money-installer-payout.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-screens.core.ts src/lib/trade-view.server.ts "src/routes/_authenticated/field.money_.$jobId.tsx" tests/installer-money-e.test.ts
git commit -m "fix(money): job pay page lists why pay is held"
```

### Task 4: E4 — Download statement saves on an iPhone

**Files:**
- Modify: `src/lib/trade-view.core.ts` (add `StatementRow`, `statementCsv`, `statementFileName`)
- Create: `src/components/trade/save-file.ts`
- Modify: `src/routes/_authenticated/field.money.tsx` (both "Download statement" links → one `<button>` calling `saveFile`)
- Test: `tests/installer-money-e.test.ts`

**Interfaces:**
- `export type StatementRow = { jobNumber: string | number | null; surname: string | null; suburb: string | null; what: string; amount: number | null; state: PayState; held: string[] }`
- `export function statementCsv(rows: StatementRow[]): string` — same columns as today (`Job, Owner, Suburb, What, Amount, Status`), every cell quoted, `"` doubled, `\r\n` line ends; Status = `heldPayPill(held)?.label` for unpaid rows, else `payPill(state).label`.
- `export function statementFileName(now?: Date): string` — `pay-statement-YYYY-MM-DD.csv`, Melbourne date.
- `export async function saveFile(file: File): Promise<void>` — on `(pointer: coarse)` with `navigator.canShare?.({ files: [file] })` → `navigator.share({ files: [file] })` (AbortError = done); else blob URL + hidden `<a download>` click, revoke after 30 s. Called directly in the tap handler (no `await` before it) so iPhone keeps the user gesture. File = `new File([statementCsv(data.rows)], statementFileName(), { type: "text/csv" })`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { statementCsv, statementFileName } from "../src/lib/trade-view.core";
describe("E4 statement", () => {
  test("csv escapes, shows Held, iPhone-safe save", () => {
    const csv = statementCsv([{ jobNumber: "HV-1", surname: 'O"Brien, J', suburb: null, what: "Install", amount: 1200, state: { kind: "checking" }, held: ["Form not Complete"] }]);
    expect(csv.split("\r\n")).toEqual(['"Job","Owner","Suburb","What","Amount","Status"', '"HV-1","O""Brien, J","","Install","1200","Held"']);
    expect(statementFileName(new Date("2026-10-27T14:30:00Z"))).toBe("pay-statement-2026-10-28.csv");
    const page = src("src/routes/_authenticated/field.money.tsx");
    expect(page).not.toContain("data:text/csv");
    expect(page.match(/saveFile\(/g)?.length).toBeGreaterThanOrEqual(1);
    const sf = src("src/components/trade/save-file.ts");
    for (const s of ["navigator.canShare", "navigator.share", "createObjectURL", "revokeObjectURL", "AbortError"]) expect(sf).toContain(s);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/installer-money-e.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces; delete the inline `csv()`; keep the button's `outlineLinkClass` look and "Download statement" label.
- [ ] **Step 4: Run** `bun test tests/installer-money-e.test.ts tests/trade-payout-gate.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/components/trade/save-file.ts src/routes/_authenticated/field.money.tsx tests/installer-money-e.test.ts
git commit -m "fix(money): Download statement saves on iPhone via the Share sheet"
```

### Task 5: Full checks and phone check

- [ ] **Step 1:** `bun run test` — Expected: no failures.
- [ ] **Step 2:** `bunx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` — Expected: last line ends `0 customer-visible (failing).`
- [ ] **Step 4: Real iPhone check (Jo, Safari, TEST accounts, TEST jobs only).** Installer TEST login → Money: tap Download statement → Share sheet opens → Save to Files → open the file in Files: one row per job, "Held" on held jobs. Same on a computer (file downloads). Bank line on Money and a job pay page show the same 4 digits. Open a held TEST job → "Held" + reasons. Electrician TEST login → Money: no "install" words. Jo approves each page before it goes live.
