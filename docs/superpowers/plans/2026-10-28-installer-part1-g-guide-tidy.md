# Installer pages Part 1 · G. Guide, welcome and tidy-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Section G of the Part 1 spec only (G1–G5): full PIESA name and plain explanations on the guide and welcome pages, staff see only My work on the welcome page, "(lead installer)" only on the real Lead, and a no-visible-change code tidy.

**Architecture:** Guide words stay in pure `trade-view.core.ts` (`GUIDE_STEPS`), using the existing `PIESA_FULL` from `job-wording.ts`. Welcome reads `boss` from `tradeSetup`. The notice status gets a `lead` flag from the one Lead/Crew rule, `effectiveWorkerRole` in `worker-role.core.ts` (as changed by plan F). Tidy: one `NextPanel` (installer-kit), shared input style, dead exports removed, bulk upload server leftovers deleted, one `saveFile`.

**Tech Stack:** TypeScript, React (TanStack Start), bun:test (pure + source-reading + `renderToStaticMarkup` tests).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` § G.

## Global Constraints

- Only G1–G5. No new pages, buttons or wording beyond the copy below (Jo approves it first — see Open questions).
- Not touched here (other plans own them): `partner.bulk-import.tsx` (deleted by plan A Task 4), Team / `partner.workers.tsx` / Lead–Crew editing (plan F), Job page and Today's job wording incl. `installer-screens.core.ts` (plans C, D). The bulk upload server leftovers are G5's (Task 5b, preflight ruling 6).
- G4 reads Lead with `effectiveWorkerRole` (plan F: a null installer role reads as Lead, Jo F answer 1), never with its own `=== "lead"` comparison (preflight ruling 4). Tell Jo before go-live: every existing installer with no role set will show "(lead installer)".
- G5 changes nothing people see: existing tests pass unchanged (except dropping imports of removed exports) and a source-reading test proves the removed exports are gone.
- Checked findings (no work needed): `notice.$token.tsx` shows only the person's own name, never "(lead installer)"; `navyCard`, `inputCls`, `TradePublicShell` and the `test` / `redesign` shell options are all in use (keep); `greenBtn`/`navyBtn` in `business-pages.tsx` differ from `TradeShell`'s `greenBtn`/`ghostBtn` (padding, gap) so merging would change the look — left as is.
- `/field/practice/$jobId/$auditId` stays: `src/lib/mitti-link.functions.ts` returns it for simulated (`sim_`) Ready Check forms, `scripts/journey-screens.ts` drives it, and `tests/mitti-practice*.test.ts` cover it.
- Line numbers cited in this plan are hints from 28 Oct; earlier tasks and plans shift them. Find every edit point by its text (preflight ruling 15).

## Review Focus

1. A staff member (not the boss) on the welcome page sees only My work → Task 2 test pins `boss={data.boss}` and `boss: c.boss` in `tradeSetup`.
2. A business with no Lead set shows nobody as "(lead installer)", and the first row is no longer assumed → Task 3 test (`collectionNoticeStatus` `lead` + page source).
3. Electrician welcome and the guide say "Pre Insulation Electrical Safety Assessment (PIESA)" and every SWMS/PIISA/VEEC/Part B is explained the first time → Task 1 test.
4. My business "Next" panel looks exactly the same after the merge → Task 4 render test pins every class string.
5. Bulk upload server code is gone but Add a job's electrician choices still load → Task 5b test (deleted files, no imports left) plus the Add a job tests in its Step 4.

---

### Task 1: Guide and welcome wording (G1, G2)

**Files:**
- Modify: `src/lib/trade-view.core.ts` (`GUIDE_STEPS`: third step title "Safety check" → "PIESA"; its body, the "Install days" body and the "Install day" body; add `WELCOME_TAKES`)
- Modify: `src/routes/_authenticated/field.welcome.tsx` (use `WELCOME_TAKES`)
- Test: `tests/installer-guide-welcome.test.ts` (new); update `tests/installer-states.test.ts` (the pinned `GUIDE_STEPS` titles, "Safety check" → "PIESA")

**Interfaces:**
- Consumes: `PIESA_FULL` from `src/lib/job-wording.ts`.
- Produces: `export const WELCOME_TAKES = { installer: "Ready Checks and installs", electrician: \`${PIESA_FULL} jobs\` } as const;` in `trade-view.core.ts`.

Copy (approved by Jo 29 Oct 2026 — use exactly):
- Step title "Safety check" becomes "PIESA".
- PIESA (was Safety check): "We arrange it once the owner accepts. You get the Pre Insulation Electrical Safety Assessment (PIESA) at least 24 hours before install."
- Install days: "Once the PIESA is cleared, offer the owner 3 days with arrival times. Install within 30 days of the PIESA, or a new one is needed."
- Install day: "Follow the install form from the 6:30am text, top to bottom: the SWMS (Safe Work Method Statement: your safety plan for the job), the PIISA (Pre-installation installer safety assessment: your safety check before you start), then the photos. Press Complete in Mitti, then sign Part B (your declaration) of the VEEC form (the rebate form) on the job."
- Electrician welcome: "{business} is ready to take Pre Insulation Electrical Safety Assessment (PIESA) jobs from Home Insulation Victoria."

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GUIDE_STEPS, WELCOME_TAKES } from "../src/lib/trade-view.core";

const all = GUIDE_STEPS.map((s) => s.body).join(" ");
test("G1: guide and welcome use the full PIESA name", () => {
  expect(all).toContain("Pre Insulation Electrical Safety Assessment (PIESA)");
  // The full name comes first; "PIESA" alone only after it (Jo 29 Oct, Install days body).
  const full = "Pre Insulation Electrical Safety Assessment (";
  expect(all.indexOf("PIESA")).toBe(all.indexOf(`${full}PIESA)`) + full.length);
  expect(GUIDE_STEPS[3]).toEqual({ title: "Install days", body: "Once the PIESA is cleared, offer the owner 3 days with arrival times. Install within 30 days of the PIESA, or a new one is needed." });
  expect(GUIDE_STEPS.map((s) => s.body).join(" ")).not.toMatch(/electrical safety check|safety check is cleared/i);
  expect(WELCOME_TAKES.electrician).toBe("Pre Insulation Electrical Safety Assessment (PIESA) jobs");
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("WELCOME_TAKES");
  expect(page).not.toContain('"PIESAs"');
});
test("G2: SWMS, PIISA, VEEC and Part B explained the first time they appear", () => {
  for (const [term, plain] of [["SWMS", "Safe Work Method Statement"], ["PIISA", "Pre-installation installer safety assessment"], ["VEEC", "the rebate form"], ["Part B", "your declaration"]] as const) {
    const at = all.indexOf(term);
    expect(at).toBeGreaterThan(-1);
    expect(all.slice(at, at + 140)).toContain(plain);
  }
});
test("guide still has the same five steps", () => {
  expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "PIESA", "Install days", "Install day"]);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `bun test tests/installer-guide-welcome.test.ts`
Expected: FAIL (`WELCOME_TAKES` missing; "PIESA" used before the full name; old Install days body; title still "Safety check"; no explanations).

- [ ] **Step 3: Implement** — import `PIESA_FULL` into `trade-view.core.ts`; rename the third step's title to "PIESA" and set the three `GUIDE_STEPS` bodies to the copy above (PIESA body via `` `…You get the ${PIESA_FULL} at least…` ``); add `WELCOME_TAKES`. In `tests/installer-states.test.ts` change the pinned title "Safety check" to "PIESA". In `field.welcome.tsx` replace `{installer ? "Ready Checks and installs" : "PIESAs"}` with `{installer ? WELCOME_TAKES.installer : WELCOME_TAKES.electrician}`.

- [ ] **Step 4: Run tests, expect PASS**

Run: `bun test tests/installer-guide-welcome.test.ts tests/installer-states.test.ts tests/trade-payout-gate.test.ts tests/partner-welcome-steps.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/routes/_authenticated/field.welcome.tsx tests/installer-guide-welcome.test.ts tests/installer-states.test.ts
git commit -m "fix(guide): full PIESA name and plain explanations on guide and welcome (G1, G2)"
```

### Task 2: Welcome page — staff see only My work (G3)

**Files:**
- Modify: `src/lib/trade-view.server.ts` (`tradeSetup` return adds `boss: c.boss`)
- Modify: `src/routes/_authenticated/field.welcome.tsx` (`<TradeShell installer={installer} boss={data.boss}>`)
- Test: `tests/installer-guide-welcome.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

```ts
test("G3: welcome page menu follows the person — staff see only My work", () => {
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("<TradeShell installer={installer} boss={data.boss}>");
  expect(page).not.toMatch(/<TradeShell installer=\{installer\} boss>/);
  const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const fn = srv.slice(srv.indexOf("export async function tradeSetup("), srv.indexOf("export async function tradeSetupMark("));
  expect(fn).toContain("boss: c.boss");
});
```

- [ ] **Step 2: Run it, expect FAIL** — `bun test tests/installer-guide-welcome.test.ts` → FAIL (welcome forces `boss`).
- [ ] **Step 3: Implement** — the two one-line changes in Files.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-guide-welcome.test.ts tests/portal-routing.test.ts` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.server.ts src/routes/_authenticated/field.welcome.tsx tests/installer-guide-welcome.test.ts
git commit -m "fix(welcome): staff see only My work (G3)"
```

### Task 3: Notice page — "lead" only for the Lead (G4)

**Files:**
- Modify: `src/lib/esc-collection-notice.core.ts` (`NoticeWorker` + `worker_role?: string | null`; `NoticeStatus` + `lead?: boolean`; `collectionNoticeStatus` sets `lead: effectiveWorkerRole({ tradeRole: w.trade_role, stored: w.worker_role }) === "lead"`, imported from `worker-role.core.ts`)
- Modify: `src/lib/esc-collection-notice.server.ts` (`NoticeWorkerRow` + `worker_role?: string | null`; `NOTICE_WORKER_COLS` + `, worker_role`)
- Modify: `src/routes/_authenticated/field.business_.esc-notice.tsx` (line 42: suffix when `s.lead`, drop the `i` index)
- Test: `tests/esc-collection-notice.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

```ts
test("G4: lead follows the one Lead/Crew rule — never just the first row", () => {
  const s = collectionNoticeStatus([{ ...w("a@x.au"), worker_role: "crew" }, w("b@x.au", "C D"), { ...w("c@x.au"), worker_role: "lead" }], []);
  expect(s.map((x) => x.lead)).toEqual([false, true, true]); // crew → false; null installer → Lead (Jo F answer 1)
  expect(readFileSync("src/lib/esc-collection-notice.core.ts", "utf8")).toContain("effectiveWorkerRole(");
  expect(readFileSync("src/lib/esc-collection-notice.core.ts", "utf8")).not.toContain('worker_role === "lead"');
  expect(readFileSync("src/lib/esc-collection-notice.server.ts", "utf8")).toMatch(/NOTICE_WORKER_COLS = "[^"]*worker_role/);
  const page = readFileSync("src/routes/_authenticated/field.business_.esc-notice.tsx", "utf8");
  expect(page).toContain("s.lead ? P5.leadSuffix");
  expect(page).not.toContain("i === 0");
  expect(readFileSync("src/routes/notice.$token.tsx", "utf8")).not.toContain("leadSuffix");
});
```

- [ ] **Step 2: Run it, expect FAIL** — `bun test tests/esc-collection-notice.test.ts` → FAIL (`lead` undefined). Runs after plan F (it needs F's `effectiveWorkerRole` where null → Lead).
- [ ] **Step 3: Implement** — per Files. Page: `data.statuses.map((s) => …name={\`${s.name}${s.lead ? P5.leadSuffix : ""}\`}…)`.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/esc-collection-notice.test.ts tests/owner-pages.core.test.ts tests/worker-role-crew.test.ts` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/esc-collection-notice.core.ts src/lib/esc-collection-notice.server.ts src/routes/_authenticated/field.business_.esc-notice.tsx tests/esc-collection-notice.test.ts
git commit -m "fix(notice): label only the real Lead as lead installer (G4)"
```

### Task 4: One Next panel (G5, no visual change)

**Files:**
- Modify: `src/components/trade/installer-kit.tsx` (`NextPanel` gains `look`)
- Modify: `src/components/trade/business-kit.tsx` (delete `NextPanel`; drop `M7.secondary` / `M7.field` only if `grep -rn "M7\.secondary\|M7\.field" src` shows no user after plan F Task 5, else keep them; preflight ruling 9)
- Modify: `src/routes/_authenticated/field.business.tsx` (line 44 uses installer-kit `NextPanel`)
- Test: `tests/installer-part1-g-tidy.test.tsx` (new)

**Interfaces:**
- `export function NextPanel({ eyebrow = "Next", title, sub, children, look = "job" }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; look?: "job" | "business" })`. `look="job"` renders exactly today's markup. `look="business"` renders today's business-kit classes: section `rounded-[18px] bg-estimate-panel p-4` + `data-next`, eyebrow `text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue`, title as `<p className="mt-1.5 text-[17px] font-semibold leading-[1.3] text-estimate-navy">` (a `<p>`, not `<h2>`, so the brand h2 font doesn't apply), sub `<p className="mt-1 text-sm text-estimate-sub">`.
- Business page: `{data.boss && data.next && <NextPanel look="business" title={data.next.title} sub={data.next.sub}><Link to={data.next.to as never} className={\`${M7.primary} mt-3.5\`}>{data.next.button}</Link></NextPanel>}`.

- [ ] **Step 1: Write the failing test** — mock `@tanstack/react-router` `Link` as `<a href className>` (same pattern as `tests/field-job-one-call.test.tsx`), then:

```tsx
test("G5: one NextPanel; business look renders exactly the old classes; job look unchanged", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NextPanel } = await import("../src/components/trade/installer-kit");
  const biz = renderToStaticMarkup(<NextPanel look="business" title="T" sub="S" />);
  expect(biz).toContain('class="rounded-[18px] bg-estimate-panel p-4"');
  expect(biz).toContain('<p class="text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Next</p>');
  expect(biz).toContain('<p class="mt-1.5 text-[17px] font-semibold leading-[1.3] text-estimate-navy">T</p>');
  expect(biz).toContain('<p class="mt-1 text-sm text-estimate-sub">S</p>');
  const job = renderToStaticMarkup(<NextPanel title="T" sub="S" />);
  expect(job).toContain('class="rounded-[18px] bg-mist p-4"');
  expect(job).toContain('<h2 class="mt-1.5 text-[17px] font-semibold leading-[1.3]">T</h2>');
  expect(job).toContain('<p class="mt-1 text-sm leading-[1.45] text-sub">S</p>');
  const kit = readFileSync("src/components/trade/business-kit.tsx", "utf8");
  expect(kit).not.toContain("function NextPanel");
  // Only when grep found no M7.secondary / M7.field user (Files). Otherwise drop this line and keep both styles.
  expect(kit).not.toMatch(/\bsecondary:|\bfield:/);
  expect(readFileSync("src/routes/_authenticated/field.business.tsx", "utf8")).toContain('<NextPanel look="business"');
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-part1-g-tidy.test.tsx` → FAIL (`look` ignored; business-kit still has `NextPanel`).
- [ ] **Step 3: Implement** — per Interfaces; keep `aria-label="Next"`/`data-next-panel` on the job look only.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-part1-g-tidy.test.tsx tests/installer-states.test.ts tests/trade-payout-gate.test.ts tests/field-job-one-call.test.tsx` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/components/trade/installer-kit.tsx src/components/trade/business-kit.tsx src/routes/_authenticated/field.business.tsx tests/installer-part1-g-tidy.test.tsx
git commit -m "refactor(trade): one Next panel, unused M7 styles removed if unused (G5)"
```

### Task 5: Shared leftovers tidy (G5, no visual change)

**Files:**
- Modify: `src/lib/route-guards.ts` — replace dead `const m = ids.map(() => null);` with direct `ids.length > 0`. Add no bulk line: plan A Task 4 already removed the bulk guard lines, `legacyBulkImportRedirect` and the switch import, and its test bans `bulk-import` in this file (preflight ruling 5).
- Modify: `src/components/trade/business-pages.tsx`: `export const field = inputCls;` (import `inputCls` from `TradeShell`; the two strings are identical today).
- Modify: `src/components/trade/installer-kit.tsx` (`BackToWork` no longer exported); `src/components/trade/TradeShell.tsx` (`TradeTabBar` no longer exported).
- Modify: `src/routes/_authenticated/admin.users.tsx` — delete the inline `savePrivateFile` and call plan E's `saveFile(file, { title: "Private TEST login" })` from `src/components/trade/save-file.ts`; `saveFile` gains an optional second argument `opts?: { title?: string }` passed to `navigator.share` (existing callers unchanged; preflight ruling 12).
- Test: `tests/installer-part1-g-tidy.test.tsx` (add test)

- [ ] **Step 1: Write the failing test**

```tsx
test("G5: removed leftovers are gone, access results unchanged", async () => {
  const g = readFileSync("src/lib/route-guards.ts", "utf8");
  expect(g).not.toContain("ids.map(() => null)");
  expect(g).not.toContain("INSTALLER_BULK_UPLOAD_ENABLED");
  expect(g).not.toContain("legacyBulkImportRedirect");
  expect(readFileSync("src/components/trade/business-pages.tsx", "utf8")).toContain("export const field = inputCls;");
  expect(readFileSync("src/components/trade/installer-kit.tsx", "utf8")).not.toContain("export function BackToWork");
  expect(readFileSync("src/components/trade/TradeShell.tsx", "utf8")).not.toContain("export function TradeTabBar");
  const users = readFileSync("src/routes/_authenticated/admin.users.tsx", "utf8");
  expect(users).toContain("saveFile(");
  expect(users).not.toContain("URL.createObjectURL");
  expect(readFileSync("src/components/trade/save-file.ts", "utf8")).toContain("opts?: { title?: string }");
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-part1-g-tidy.test.tsx` → FAIL (leftovers present).
- [ ] **Step 3: Implement** — per Files. `grep -rn "BackToWork\|TradeTabBar\|savePrivateFile" src` must show only in-file uses (none for `savePrivateFile`).
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-part1-g-tidy.test.tsx tests/installer-money-e.test.ts tests/add-job-legacy-entry.test.ts tests/ffs-field-access.step36.test.ts tests/ffs-minimum-results.p1-s23b.test.ts tests/field-job-one-call.test.tsx` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/route-guards.ts src/components/trade/business-pages.tsx src/components/trade/installer-kit.tsx src/components/trade/TradeShell.tsx src/components/trade/save-file.ts src/routes/_authenticated/admin.users.tsx tests/installer-part1-g-tidy.test.tsx
git commit -m "refactor(trade): remove shared leftovers, no visible change (G5)"
```

### Task 5b: Bulk upload server leftovers (G5, no visible change)

Spec G5 "remove bulk upload leftovers"; Jo A answer 3 "remove for everyone, office included" (preflight ruling 6). Plan A Task 4 already deleted the page.

**Files:**
- Delete: `src/lib/bulk-import.server.ts`, `src/lib/bulk-import-commit.server.ts`, `src/lib/bulk-import-access.server.ts`, `src/lib/bulk-upload-switch.core.ts`, and the bulk create/review/confirm server functions in `src/lib/bulk-import.functions.ts`.
- Keep (still used by Add a job and the office): `bulkElectricianChoices`, `addBulkElectrician`, `readBulkFile` (imported by `installer-intake-flow.tsx` and `intake-details-editor.tsx`); `bulk-import.core.ts` pieces still imported by `partner-import.server.ts` (`quotedGap`), `portal.functions.ts` (`planQuotedAnswer`) and `JobCard.tsx` (`InstallerJobFacts`); `bulk.functions.ts` (office bulk job actions, not bulk upload). If `bulk-import.functions.ts` then holds only the three kept functions, leave them in that file (no rename; no visible change).
- Modify: `src/lib/upload-safety.core.ts` (drop the bulk-import-only file types only if nothing else reads them), `src/lib/electrician-choice.core.ts` (keep `"bulk_upload"` in `source`; old records carry it).
- Tests: delete test files that only exercise the deleted code (find with `grep -rln "bulk-import.server\|bulk-import-commit\|bulk-import-access\|bulk-upload-switch\|requireBulkUploadOpen" tests`); in `tests/add-job-legacy-entry.test.ts` drop the `requireBulkUploadOpen` line (keep its page-link loop). Edit a mixed test file only by removing the lines about deleted code.
- Test: `tests/installer-part1-g-tidy.test.tsx` (add test)

- [ ] **Step 1: Write the failing test**

Add `import { existsSync } from "node:fs";` and `import { execSync } from "node:child_process";` to the test file's imports.

```tsx
test("G5: bulk upload server leftovers are gone; Add a job's electrician choices stay", () => {
  for (const f of ["src/lib/bulk-import.server.ts", "src/lib/bulk-import-commit.server.ts", "src/lib/bulk-import-access.server.ts", "src/lib/bulk-upload-switch.core.ts"]) expect(existsSync(f)).toBe(false);
  const fns = readFileSync("src/lib/bulk-import.functions.ts", "utf8");
  expect(fns).not.toContain("requireBulkUploadOpen");
  for (const keep of ["bulkElectricianChoices", "addBulkElectrician", "readBulkFile"]) expect(fns).toContain(`export const ${keep}`);
  expect(execSync("grep -rln 'bulk-upload-switch\\|bulk-import-commit\\|bulk-import-access\\|bulk-import.server' src || true", { encoding: "utf8" }).trim()).toBe("");
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-part1-g-tidy.test.tsx` → FAIL (files exist).
- [ ] **Step 3: Implement** — per Files. Before each delete, `grep -rn "<export name>" src scripts` and keep anything still reachable.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-part1-g-tidy.test.tsx tests/add-job-legacy-entry.test.ts tests/installer-intake-upload-ui.test.mjs tests/add-job-confirmations.test.ts tests/duplicate-address.test.ts tests/quoted-answer-7oct.test.ts tests/security-review.test.ts`, then `bunx tsc --noEmit` (no new errors).
- [ ] **Step 5: Commit**

```bash
git add -A src/lib src/components tests
git commit -m "refactor: remove bulk upload server leftovers, no visible change (G5)"
```

### Task 6: Full checks

- [ ] **Step 1:** `bun run test` — Expected: all pass, no new failures.
- [ ] **Step 2:** `bunx tsc --noEmit` — Expected: no new errors (today's only line is the existing `TS2688 … 'vite/client'`).
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` — Expected: ends `… 0 customer-visible (failing).`
- [ ] **Step 4:** On the TEST accounts, phone and computer: guide and welcome read as approved; a TEST staff login on `/field/welcome` sees only My work; My business Next panel looks the same; the notice page shows "(lead installer)" only on the Lead. Jo approves before go-live.

## Jo's answers (29 Oct 2026)

1. Guide wording approved exactly as in Task 1 (install-day VEEC explanation shortened to "(the rebate form)").
2. Electrician welcome line approved.
3. (29 Oct, preflight ruling 14) "Install days" body exactly: "Once the PIESA is cleared, offer the owner 3 days with arrival times. Install within 30 days of the PIESA, or a new one is needed." The guide step title "Safety check" becomes "PIESA".
