# Installer pages Part 1 · G. Guide, welcome and tidy-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Section G of the Part 1 spec only (G1–G5): full PIESA name and plain explanations on the guide and welcome pages, staff see only My work on the welcome page, "(lead installer)" only on the real Lead, and a no-visible-change code tidy.

**Architecture:** Guide words stay in pure `trade-view.core.ts` (`GUIDE_STEPS`), using the existing `PIESA_FULL` from `job-wording.ts`. Welcome reads `boss` from `tradeSetup`. The notice status gets an optional `lead` flag from `partner_workers.worker_role`. Tidy: one `NextPanel` (installer-kit), shared input style, dead exports removed.

**Tech Stack:** TypeScript, React (TanStack Start), bun:test (pure + source-reading + `renderToStaticMarkup` tests).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-pages-part1-design.md` § G.

## Global Constraints

- Only G1–G5. No new pages, buttons or wording beyond the copy below (Jo approves it first — see Open questions).
- Not touched here (other plans own them): `partner.bulk-import.tsx` + `src/lib/bulk-import.*` + `bulk-upload-switch.core.ts` (plan A), Team / `partner.workers.tsx` / Lead–Crew editing (plan F), Job page and Today's job wording incl. `installer-screens.core.ts` (plans C, D).
- G4 reads Lead as `partner_workers.worker_role === "lead"` (column is live; TEST Bravo already uses `'lead'`). If plan F picks a different stored value, change the one comparison in `collectionNoticeStatus`.
- G5 changes nothing people see: existing tests pass unchanged (except dropping imports of removed exports) and a source-reading test proves the removed exports are gone.
- Checked findings (no work needed): `notice.$token.tsx` shows only the person's own name, never "(lead installer)"; `navyCard`, `inputCls`, `TradePublicShell` and the `test` / `redesign` shell options are all in use (keep); `greenBtn`/`navyBtn` in `business-pages.tsx` differ from `TradeShell`'s `greenBtn`/`ghostBtn` (padding, gap) so merging would change the look — left as is.
- `/field/practice/$jobId/$auditId` stays: `src/lib/mitti-link.functions.ts` returns it for simulated (`sim_`) Ready Check forms, `scripts/journey-screens.ts` drives it, and `tests/mitti-practice*.test.ts` cover it.

## Review Focus

1. A staff member (not the boss) on the welcome page sees only My work → Task 2 test pins `boss={data.boss}` and `boss: c.boss` in `tradeSetup`.
2. A business with no Lead set shows nobody as "(lead installer)", and the first row is no longer assumed → Task 3 test (`collectionNoticeStatus` `lead` + page source).
3. Electrician welcome and the guide say "Pre Insulation Electrical Safety Assessment (PIESA)" and every SWMS/PIISA/VEEC/Part B is explained the first time → Task 1 test.
4. My business "Next" panel looks exactly the same after the merge → Task 4 render test pins every class string.
5. `/partner/bulk-import` still sends every role to the same place after the route-guard tidy → Task 5 test keeps all `partnerPathAllowed` assertions.

---

### Task 1: Guide and welcome wording (G1, G2)

**Files:**
- Modify: `src/lib/trade-view.core.ts` (`GUIDE_STEPS` "Safety check" and "Install day" bodies; add `WELCOME_TAKES`)
- Modify: `src/routes/_authenticated/field.welcome.tsx` (use `WELCOME_TAKES`)
- Test: `tests/installer-guide-welcome.test.ts` (new)

**Interfaces:**
- Consumes: `PIESA_FULL` from `src/lib/job-wording.ts`.
- Produces: `export const WELCOME_TAKES = { installer: "Ready Checks and installs", electrician: \`${PIESA_FULL} jobs\` } as const;` in `trade-view.core.ts`.

Copy (DRAFT — Open question for Jo):
- Safety check: "We arrange it once the owner accepts. You get the Pre Insulation Electrical Safety Assessment (PIESA) at least 24 hours before install."
- Install day: "Follow the install form from the 6:30am text, top to bottom: the SWMS (Safe Work Method Statement: your safety plan for the job), the PIISA (Pre-installation installer safety assessment: your safety check before you start), then the photos. Press Complete in Mitti, then sign Part B (your declaration) of the VEEC form (the rebate form: VEEC is the Victorian Energy Efficiency Certificate) on the job."
- Electrician welcome: "{business} is ready to take Pre Insulation Electrical Safety Assessment (PIESA) jobs from Home Insulation Victoria."

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GUIDE_STEPS, WELCOME_TAKES } from "../src/lib/trade-view.core";

const all = GUIDE_STEPS.map((s) => s.body).join(" ");
test("G1: guide and welcome use the full PIESA name", () => {
  expect(all).toContain("Pre Insulation Electrical Safety Assessment (PIESA)");
  expect(all).not.toMatch(/(?<!\()PIESA(?!\))/); // never "PIESA" alone
  expect(WELCOME_TAKES.electrician).toBe("Pre Insulation Electrical Safety Assessment (PIESA) jobs");
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("WELCOME_TAKES");
  expect(page).not.toContain('"PIESAs"');
});
test("G2: SWMS, PIISA, VEEC and Part B explained the first time they appear", () => {
  for (const [term, plain] of [["SWMS", "Safe Work Method Statement"], ["PIISA", "Pre-installation installer safety assessment"], ["VEEC", "Victorian Energy Efficiency Certificate"], ["Part B", "your declaration"]] as const) {
    const at = all.indexOf(term);
    expect(at).toBeGreaterThan(-1);
    expect(all.slice(at, at + 140)).toContain(plain);
  }
});
test("guide still has the same five steps", () => {
  expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "Safety check", "Install days", "Install day"]);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `bun test tests/installer-guide-welcome.test.ts`
Expected: FAIL (`WELCOME_TAKES` missing; "PIESA" alone; no explanations).

- [ ] **Step 3: Implement** — import `PIESA_FULL` into `trade-view.core.ts`; set the two `GUIDE_STEPS` bodies to the copy above (Safety check body via `` `…You get the ${PIESA_FULL} at least…` ``); add `WELCOME_TAKES`. In `field.welcome.tsx` replace `{installer ? "Ready Checks and installs" : "PIESAs"}` with `{installer ? WELCOME_TAKES.installer : WELCOME_TAKES.electrician}`.

- [ ] **Step 4: Run tests, expect PASS**

Run: `bun test tests/installer-guide-welcome.test.ts tests/installer-states.test.ts tests/trade-payout-gate.test.ts tests/partner-welcome-steps.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trade-view.core.ts src/routes/_authenticated/field.welcome.tsx tests/installer-guide-welcome.test.ts
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
- Modify: `src/lib/esc-collection-notice.core.ts` (`NoticeWorker` + `worker_role?: string | null`; `NoticeStatus` + `lead?: boolean`; `collectionNoticeStatus` sets `lead: w.worker_role === "lead"`)
- Modify: `src/lib/esc-collection-notice.server.ts` (`NoticeWorkerRow` + `worker_role?: string | null`; `NOTICE_WORKER_COLS` + `, worker_role`)
- Modify: `src/routes/_authenticated/field.business_.esc-notice.tsx` (line 42: suffix when `s.lead`, drop the `i` index)
- Test: `tests/esc-collection-notice.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

```ts
test("G4: only a worker stored as Lead is the lead — never just the first row", () => {
  const s = collectionNoticeStatus([w("a@x.au"), { ...w("b@x.au", "C D"), worker_role: "lead" }], []);
  expect(s.map((x) => x.lead)).toEqual([false, true]);
  expect(collectionNoticeStatus([w("a@x.au")], [])[0]!.lead).toBe(false);
  expect(readFileSync("src/lib/esc-collection-notice.server.ts", "utf8")).toMatch(/NOTICE_WORKER_COLS = "[^"]*worker_role/);
  const page = readFileSync("src/routes/_authenticated/field.business_.esc-notice.tsx", "utf8");
  expect(page).toContain("s.lead ? P5.leadSuffix");
  expect(page).not.toContain("i === 0");
  expect(readFileSync("src/routes/notice.$token.tsx", "utf8")).not.toContain("leadSuffix");
});
```

- [ ] **Step 2: Run it, expect FAIL** — `bun test tests/esc-collection-notice.test.ts` → FAIL (`lead` undefined).
- [ ] **Step 3: Implement** — per Files. Page: `data.statuses.map((s) => …name={\`${s.name}${s.lead ? P5.leadSuffix : ""}\`}…)`.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/esc-collection-notice.test.ts tests/owner-pages.core.test.ts` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/esc-collection-notice.core.ts src/lib/esc-collection-notice.server.ts src/routes/_authenticated/field.business_.esc-notice.tsx tests/esc-collection-notice.test.ts
git commit -m "fix(notice): label only the real Lead as lead installer (G4)"
```

### Task 4: One Next panel (G5, no visual change)

**Files:**
- Modify: `src/components/trade/installer-kit.tsx` (`NextPanel` gains `look`)
- Modify: `src/components/trade/business-kit.tsx` (delete `NextPanel`; drop unused `M7.secondary`, `M7.field`)
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
git commit -m "refactor(trade): one Next panel, unused M7 styles removed (G5)"
```

### Task 5: Shared leftovers tidy (G5, no visual change)

**Files:**
- Modify: `src/lib/route-guards.ts` — remove `import`/`export { INSTALLER_BULK_UPLOAD_ENABLED }` and `legacyBulkImportRedirect` **only if plan A has already deleted `partner.bulk-import.tsx`** (else leave both and note it in the commit); in `partnerPathAllowed` the bulk line becomes `if (p.startsWith("/partner/bulk-import")) return false;` (same result: switch is off, office returned earlier); replace dead `const m = ids.map(() => null);` with direct `ids.length > 0`.
- Modify: `src/components/trade/business-pages.tsx`: `export const field = inputCls;` (import `inputCls` from `TradeShell`; the two strings are identical today).
- Modify: `src/components/trade/installer-kit.tsx` (`BackToWork` no longer exported); `src/components/trade/TradeShell.tsx` (`TradeTabBar` no longer exported).
- Modify: `tests/add-job-legacy-entry.test.ts` — drop imports/asserts of removed exports only; keep every `partnerPathAllowed` assertion.
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
  const { partnerPathAllowed } = await import("../src/lib/route-guards");
  const base = { admin: false, qaOffice: false, installer: true, electrician: false, owner: false, businessAdmin: false, installerBusinessAdmin: false };
  expect(partnerPathAllowed("/partner/bulk-import", { ...base, businessAdmin: true, installerBusinessAdmin: true })).toBe(false);
  expect(partnerPathAllowed("/partner/bulk-import", { ...base, admin: true })).toBe(true);
});
```

(If plan A has not landed, drop the two bulk `not.toContain` lines from this test and from Step 3.)

- [ ] **Step 2: Run, expect FAIL** — `bun test tests/installer-part1-g-tidy.test.tsx` → FAIL (leftovers present).
- [ ] **Step 3: Implement** — per Files. `grep -rn "BackToWork\|TradeTabBar\|legacyBulkImportRedirect" src` must show only in-file uses.
- [ ] **Step 4: Run, expect PASS** — `bun test tests/installer-part1-g-tidy.test.tsx tests/add-job-legacy-entry.test.ts tests/ffs-field-access.step36.test.ts tests/ffs-minimum-results.p1-s23b.test.ts tests/field-job-one-call.test.tsx` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/route-guards.ts src/components/trade/business-pages.tsx src/components/trade/installer-kit.tsx src/components/trade/TradeShell.tsx tests/add-job-legacy-entry.test.ts tests/installer-part1-g-tidy.test.tsx
git commit -m "refactor(trade): remove shared leftovers, no visible change (G5)"
```

### Task 6: Full checks

- [ ] **Step 1:** `bun run test` — Expected: all pass, no new failures.
- [ ] **Step 2:** `bunx tsc --noEmit` — Expected: no new errors (today's only line is the existing `TS2688 … 'vite/client'`).
- [ ] **Step 3:** `bun scripts/scan-retired-terms.ts` — Expected: ends `… 0 customer-visible (failing).`
- [ ] **Step 4:** On the TEST accounts, phone and computer: guide and welcome read as approved; a TEST staff login on `/field/welcome` sees only My work; My business Next panel looks the same; the notice page shows "(lead installer)" only on the Lead. Jo approves before go-live.

## Open questions for Jo

1. Approve the guide "Safety check" and "Install day" wording and the explanations of SWMS, PIISA, VEEC and Part B (Task 1 copy).
2. Approve the electrician welcome line: "… is ready to take Pre Insulation Electrical Safety Assessment (PIESA) jobs from Home Insulation Victoria."
