# Part 8 — Mitti form changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the four live Mitti templates (A1/A2 Ready Check, A3 PIESA, A5 Install day) exactly as the 2 Nov spec and Jo's 2 Nov evening answers ask, and make the portal read, check and use every new answer (photo-ID tick, adult present, life support plan, SWMS changes during the job, Lead Installer's VEEC Part B signature), with ECOWOOL removed.

**Architecture:** Mitti is external: every template change is a ChatGPT paste file in `docs/mitti-paste-2026-11-02-*.md`, in the house style of `docs/mitti-paste-A5-ruler-photos.md` (one fenced box, exact labels, "change nothing else", publish). Every label the portal reads lives once in a pure core (`ready-check-lean.core.ts`, `official-short.core.ts`, `install-day.core.ts`), and a drift test reads the paste file and fails if a label differs. New A5 items are kept OUT of the numbered `INSTALL_DAY_QUESTIONS` (Q1–Q48), exactly like decision 396's ruler photos, so no existing question is renumbered and in-flight forms keep working. Readers stay label-based and absent-safe: a form built before the paste reads `null` ("not asked"), never a made-up answer.

**Tech Stack:** TypeScript, bun:test, Supabase (no SQL in this part), Mitti REST via `mitti.server.ts` (`MittiCall`, `MittiMediaFetch`).

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` (rev 31), sections "Lead Installer and crew", "VEU and ESC timing rules", "More VEU Code of Conduct rules", "Compliance gates and checks" (records list), "PDFs and official forms" (ECOWOOL). Wording source: `docs/hiv-touchpoint-decisions.md` (photo-ID tick, Part B at end of install form, day-2+ re-check, ECOWOOL excluded).

## Global Constraints

- Source of truth: `hiv-touchpoint-decisions.md` (2 Nov 2026); latest dated decision wins; "Decisions from the electrician + SWMS chat" wins over earlier.
- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` before edits; run `bun scripts/scan-retired-terms.ts` before workflow work. Update `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` in the same commit as any rule they state.
- Trades see PIESA, SWMS, PIISA, VEEC without explanation. Write "Home Insulation Victoria" in full, never "HIV". Write "Lead Installer" in full on anything new.
- Mitti labels are read by exact first-line text: every label is a constant in a `*.core.ts`, copied character for character into the paste file; a drift test reads the paste file.
- Approved Mitti wording (verbatim, Jo 2 Nov): `I showed my photo ID (name + business)`. Any other new Mitti label in this plan is a DRAFT until Jo approves it (Task 1); nothing is pasted into Mitti before that.
- Official wording is verbatim: VEEC Section 3 Part B text comes from `INSTALLER_DECLARATION` in `src/lib/veec-assignment-form.core.ts` (ESC template v1.1), never retyped.
- Never renumber A5 Q1–Q48 (`INSTALL_DAY_QUESTIONS.at(-1).n === 48` stays true). New A5 items live in their own constant, like `INSTALL_DAY_RULER_Q`.
- A form built before a paste (question absent) reads as "not asked" (`null`) and is never blocked for it; only a form that carries the question is checked.
- Paste files never include template edits beyond the listed items ("Change nothing else … Publish.").
- No new SQL. No sends added in this part.
- TEST jobs (`source='qa_test'`) use the Mitti simulator (`realMittiCall` routing); never paste into Mitti from a test.

## Review Focus

1. **In-flight forms without the new questions.** An A1/A2/A3/A5 form created before Jo pastes must still complete, still record the installation and still let the Lead Installer sign Part B on the existing portal path. Tasks 2, 4, 6, 7 each test an "old form" case.
2. **Two "Lead installer's signature" items already on A5 (Q36, Q48).** The Part B signature must use a different label, or `readInstallDay` would read the wrong signature. Task 6 tests that Q36/Q48 still read the same signatures with Part B present.
3. **Part B signer is not the job's Lead Installer** (crew member signs on the Lead's phone). The portal must not apply a Mitti signature whose name doesn't match the selected Lead Installer; it holds and tells the office. Task 7 test.
4. **Adult answers "No" but the form is marked Complete anyway.** PIESA must not advance and the installation must not be recorded. Tasks 3 and 5 test it.
5. **ECOWOOL answer on an old Ready Check.** Still read (quote held for office, as today), but no warranty family and no ECOWOOL option offered anywhere. Task 2 test.

---

## Task 1: Jo approves the new Mitti wording (gate — no code)

The decisions file approves the photo-ID tick wording only. These labels are drafts and must be approved (phone-width text, one question at a time in boxes) before Tasks 3, 5, 6, 10 paste anything (the A5 change items are Jo's own 2 Nov answer 16; only their exact labels are approved here). The rental/tenant questions are NOT on the Mitti Ready Check — the owner answers them in the quick taps (Jo 2 Nov, answer 22; Part 3 Task 19). If Jo changes a word, only the constant and the paste file change.

| Where | Draft label (type) | Stop line |
|---|---|---|
| A3 PIESA, Group 2 after Q7 | `Is an adult (18 or over) who understands what's happening at home with you?` (Yes/No, Required, Yes green No red) | `Stop. Don't start. Leave and call the installer's office.` |
| A5 Install day, Group 3 after `Does the household know the power will be off today?` | `Is an adult (18 or over) who understands what's happening at home with you?` (Yes/No, Required, Yes green No red) | `Stop. Don't start. Leave and call your office.` |
| A5, new last page `Rebate form (VEEC) — Lead Installer` | Text item: Section 3 Part B verbatim (from `INSTALLER_DECLARATION`, without its last "Installer signature: … Date:" line) | — |
| same page | `I am the Lead Installer and I make the Part B declaration above` (Checkbox, Required) | — |
| same page | `Lead Installer's signature for the rebate form (Part B)` (Signature, Required) | — |
| A5 Install day, page holding Q46, straight after Q46 | `Changes during the job: what changed on site? Leave blank if nothing changed.` (Text, optional) and `New control you put in place` (Text, Required when the first is filled) — Jo 2 Nov, answer 16 (Task 11) | — |

- [ ] **Step 1:** Send Jo the table as text (phone width), one box per row: "OK as is" / "Change it".
- [ ] **Step 2:** Record her answers in `docs/hiv-touchpoint-decisions.md` under a dated line "Mitti wording for Part 8 (Jo, <date>)". Tasks 3, 5, 6, 10 use the approved text.

---

## Task 2: Ready Check photo-ID tick + ECOWOOL removed (A1 and A2)

**Files:**
- Modify: `src/lib/ready-check-lean.core.ts` (`LEAN_Q`)
- Modify: `src/lib/mitti-forms.core.ts` (`READY_CHECK_FIELDS` page 2)
- Modify: `src/lib/ready-check-complete.core.ts` (`ReadyCheckFacts`, `readyCheckFactsFromEntries`, `readyCheckCompletionChecks`)
- Modify: `src/lib/ready-check-chase.core.ts` (`installerMissing`)
- Modify: `src/lib/product-warranty.core.ts` (drop the `ecowool` family)
- Modify: `docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md` (Q31 options), `docs/MITTI_PIESA_CHATGPT_PROMPT.md` ("Second prompt" list ends at `Earthwool R5`)
- Create: `docs/mitti-paste-2026-11-02-A1-A2-photo-id.md`
- Test: `tests/new-flow-08-ready-check-photo-id.test.ts`

**Interfaces:**
- Produces: `LEAN_Q.photoIdShown = "I showed my photo ID (name + business)"`; `ReadyCheckFacts.photoIdShown: boolean | null` (null = old form, not asked); `READY_CHECK_PHOTO_ID_MISSING = "the photo ID tick"` (installer chase line) and `READY_CHECK_PHOTO_ID_OFFICE = "Office needs to: the installer hasn't ticked that they showed their photo ID"`.
- Produces: `WarrantyFamily = "bradford_gold" | "pink_batts" | "earthwool"`; `warrantyFamilyForOption("ECOWOOL R5") === null`.
- Consumed by: Part 3's "Nearly there" email (#27, Part 3 Task 14) lists `installerMissing(...)` lines — no wording change there.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAN_Q, PRODUCT_OPTIONS } from "../src/lib/ready-check-lean.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { readyCheckFactsFromEntries, readyCheckCompletionChecks } from "../src/lib/ready-check-complete.core";
import { installerMissing } from "../src/lib/ready-check-chase.core";
import { warrantyFamilyForOption, PRODUCT_WARRANTIES } from "../src/lib/product-warranty.core";
const opts = { formComplete: true, electricianDecided: true, priceKnown: true };
const base = [{ label: LEAN_Q.contactPermission, value: "Yes" }, { label: "Is there existing insulation in this ceiling area?", value: "No" }];

test("approved wording, required tick on A1 and A2", () => {
  expect(LEAN_Q.photoIdShown).toBe("I showed my photo ID (name + business)");
  for (const k of ["ready_check", "ready_check_priced"] as const)
    expect(FORMS[k].fields.find((f) => f.label === LEAN_Q.photoIdShown)).toMatchObject({ type: "tick", required: true });
});
test("ticked → true; unticked on a form that asks → false and chased; old form → null, never chased", () => {
  expect(readyCheckFactsFromEntries([...base, { label: LEAN_Q.photoIdShown, value: "true" }], opts).photoIdShown).toBe(true);
  const unticked = readyCheckFactsFromEntries([...base, { label: LEAN_Q.photoIdShown, value: "" }], opts);
  expect(unticked.photoIdShown).toBe(false);
  expect(installerMissing(unticked)).toContain("the photo ID tick");
  expect(readyCheckCompletionChecks(unticked).reasons).toContain("Office needs to: the installer hasn't ticked that they showed their photo ID");
  const old = readyCheckFactsFromEntries(base, opts);
  expect(old.photoIdShown).toBeNull();
  expect(installerMissing(old)).not.toContain("the photo ID tick");
});
test("ECOWOOL removed: no option, no warranty family, still not a valid product", () => {
  expect(PRODUCT_OPTIONS).not.toContain("ECOWOOL R5");
  expect(warrantyFamilyForOption("ECOWOOL R5")).toBeNull();
  expect(PRODUCT_WARRANTIES.some((w) => /ecowool/i.test(w.productName))).toBe(false);
  expect(readFileSync("docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md", "utf8")).not.toMatch(/ECOWOOL/);
});
test("paste file: both templates, exact tick wording, deletes the ECOWOOL R5 option, publishes", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-02-A1-A2-photo-id.md", "utf8");
  expect(doc).toContain('"A1 – Ready Check | Installer-Supplied Customer"');
  expect(doc).toContain('"A2 – Ready Check | HIVIC Sourced Customer"');
  expect(doc).toContain(`"${LEAN_Q.photoIdShown}" — Checkbox — Required`);
  expect(doc).toContain('Delete the option "ECOWOOL R5"');
  expect(doc).toMatch(/Change nothing else[\s\S]*Publish/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/new-flow-08-ready-check-photo-id.test.ts`
Expected: FAIL — `LEAN_Q.photoIdShown` is undefined.

- [ ] **Step 3: Implement**
  - `LEAN_Q.photoIdShown` on Page 2 "Before you go up", after `contactPermission`.
  - `READY_CHECK_FIELDS`: `{ label: LEAN_Q.photoIdShown, type: "tick", required: true, source: "Code of Conduct cl 9 (Jo 2 Nov 2026)" }` (shared by A1 and A2).
  - `readyCheckFactsFromEntries`: `photoIdShown` = `null` when no entry has the label, else whether the value is a truthy tick (same rule as `noPricingTick` reads).
  - `readyCheckCompletionChecks` pushes the office line only when `photoIdShown === false`; `installerMissing` pushes `"the photo ID tick"` only when `=== false`.
  - Remove the `ecowool` entry and union member from `product-warranty.core.ts`; `warrantyFamilyForOption` drops both ECOWOOL branches. Leave `esc-approved-products.core.ts` alone (it is the ESC register extract).
  - Paste file (house style): edit A1 and A2; on the page "Before you go up", straight after "Homeowner agrees to be contacted by Home Insulation Victoria", add `"I showed my photo ID (name + business)" — Checkbox — Required`; on the question "What insulation product will you be using on this job?" `Delete the option "ECOWOOL R5"` (keep the other seven in order); "Change nothing else … Publish both."
  - Update the two prompt docs' option lists to seven options.
  - Fix existing tests that assert an ECOWOOL warranty family (`tests/victorian-time-task4.test.ts` already expects ECOWOOL refused — keep; update any test expecting `"ecowool"` family to `null`).

- [ ] **Step 4: Run tests**

Run: `bun test tests/new-flow-08-ready-check-photo-id.test.ts tests/lean-ready-check.test.ts tests/insulation-product.test.ts tests/victorian-time-task4.test.ts tests/decision-396-a5-ruler-photos.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ready-check-lean.core.ts src/lib/mitti-forms.core.ts src/lib/ready-check-complete.core.ts src/lib/ready-check-chase.core.ts src/lib/product-warranty.core.ts docs/mitti-paste-2026-11-02-A1-A2-photo-id.md docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md docs/MITTI_PIESA_CHATGPT_PROMPT.md tests/
git commit -m "feat(mitti): Ready Check photo-ID tick, ECOWOOL removed from options and warranty map"
```

---

## Task 3: PIESA (A3) — adult present question and stop

**Files:**
- Modify: `src/lib/official-short.core.ts` (`SHORT_PIESA_FIELDS`, new constant)
- Modify: `src/lib/piesa-evidence.core.ts` (`piesaEvidenceBlockers`)
- Modify: `docs/MITTI_PIESA_CHATGPT_PROMPT.md` (Group 2)
- Create: `docs/mitti-paste-2026-11-02-A3-adult.md`
- Test: `tests/new-flow-08-piesa-adult.test.ts`

**Interfaces:**
- Produces: `ADULT_PRESENT_LABEL` (Task 1 approved text, shared by A3 and A5), `ADULT_PRESENT_STOP_A3`, short-answer id `adultPresent`; `PIESA_ADULT_BLOCKER = "PIESA: no adult (18 or over) was at home — the safety check must be done again with an adult present"`.
- `piesaEvidenceBlockers(a, media)` returns `PIESA_ADULT_BLOCKER` when `a.adultPresent` is a "No" answer; absent (`undefined`) = old form, no blocker. The existing PIESA hold (`PIESA_HOLD.evidence`, `piesaAdvanceDecision`) then holds the job; no new path.
- The question is NOT part of the official DEECA form: `source` says so, and `official-expand.core.ts` must not map it (Part 1 owns the DEECA fill).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADULT_PRESENT_LABEL, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { piesaEvidenceBlockers, emptyPiesaEvidenceMedia, PIESA_ADULT_BLOCKER } from "../src/lib/piesa-evidence.core";
test("A3 asks the adult question, required, not on the official form", () => {
  const f = SHORT_PIESA_FIELDS.find((x) => x.id === "adultPresent")!;
  expect(f).toMatchObject({ label: ADULT_PRESENT_LABEL, required: true });
  expect(f.source).toMatch(/not part of the official form/);
});
test("No → PIESA held; Yes → no adult blocker; old form (absent) → no adult blocker", () => {
  expect(piesaEvidenceBlockers({ adultPresent: "No" }, emptyPiesaEvidenceMedia())).toContain(PIESA_ADULT_BLOCKER);
  expect(piesaEvidenceBlockers({ adultPresent: "Yes" }, emptyPiesaEvidenceMedia())).not.toContain(PIESA_ADULT_BLOCKER);
  expect(piesaEvidenceBlockers({}, emptyPiesaEvidenceMedia())).not.toContain(PIESA_ADULT_BLOCKER);
});
test("paste file adds it after the life support attachment with its stop line, template ID unchanged", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-02-A3-adult.md", "utf8");
  expect(doc).toContain(`"${ADULT_PRESENT_LABEL}" — Yes/No — Required`);
  expect(doc).toContain('straight after "Written consent or medical plan (kept as an attachment to this assessment)"');
  expect(doc).toMatch(/Change nothing else[\s\S]*Publish/);
});
```

- [ ] **Step 2: Run test** — `bun test tests/new-flow-08-piesa-adult.test.ts` — Expected: FAIL (`ADULT_PRESENT_LABEL` not exported).

- [ ] **Step 3: Implement** — add `yn("adultPresent", ADULT_PRESENT_LABEL)` straight after `lifeSupportAttachment` in `SHORT_PIESA_FIELDS` with `source: "Code of Conduct cl 6, 22 (Jo 2 Nov 2026) – not part of the official form"`; add the blocker branch in `piesaEvidenceBlockers` (reads `a["adultPresent"]` with the existing yes/no reader). Paste file: A3 – PIESA, Group 2, after Q7: the question, Yes green / No red, stop text item shown when No (Task 1 wording). Mirror in `docs/MITTI_PIESA_CHATGPT_PROMPT.md` as item `7a.`.

- [ ] **Step 4: Run tests** — `bun test tests/new-flow-08-piesa-adult.test.ts tests/piesa-evidence*.test.ts tests/no-price-talk.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(mitti): PIESA asks for an adult at home; No holds the PIESA"`

---

## Task 4: PIESA life support plan counts as "on file"

The A3 already asks for the consent/medical-plan photo (`lifeSupportAttachment`), but `lifeSupportPlansOnFile` only reads owner uploads and office records, so the plan the electrician photographed never counts. Store it as a `life_support_plan` document so the install gate (Part 9) sees it.

**Files:**
- Modify: `src/lib/piesa-evidence.core.ts` (new pure selector)
- Modify: `src/lib/mitti.server.ts` (`syncMittiAssessment`, next to the existing `piesaEvidenceFilesToStore` save at ~line 378)
- Test: `tests/new-flow-08-piesa-life-support-doc.test.ts`

**Interfaces:**
- Produces: `piesaLifeSupportFiles(snapshot: PiesaSnapshotEntry[]): { mediaId: string; capturedAt: string | null }[]` — the files on the `lifeSupportAttachment` item, only when `lifeSupportPresent` is Yes and consent is one of the two "Yes – received …" options.
- Produces: `savePiesaLifeSupportPlan(jobId: string, auditId: string, files, fetchMedia: MittiMediaFetch): Promise<number>` in `mitti.server.ts` — one `documents` row per Mitti media id, `kind = LIFE_SUPPORT_PLAN_DOC_KIND` (`job-records.server.ts`), title `Life support plan (PIESA attachment)`, idempotent by media id; failures logged, never thrown to the sync.
- Consumed by: Part 9 Task 5 (`lifeSupportPlanMissing` in the GO check).

- [ ] **Step 1: Write the failing test** — pure: Yes + "Yes – received Medical Plan" + 2 files → 2 files; "No – not received" → `[]`; life support No with a stray file → `[]`. Server (mocked admin + fake `fetchMedia`, same mocking style as `tests/decision-396-a5-ruler-photos.test.ts`): first call inserts 2 rows of kind `life_support_plan`; a second call inserts 0; then `lifeSupportPlansOnFile([jobId])` contains the job.
- [ ] **Step 2: Run** `bun test tests/new-flow-08-piesa-life-support-doc.test.ts` — Expected: FAIL (`piesaLifeSupportFiles` not exported).
- [ ] **Step 3: Implement** the selector (reads the stored snapshot's `media` on the item whose label is the `lifeSupportAttachment` label) and the saver (storage path `${jobId}/life-support/${mediaId}`, private `job-files` bucket, the same upload helper the evidence files use). Call it from `syncMittiAssessment` after the evidence save.
- [ ] **Step 4: Run** the test plus `bun test tests/mitti*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(piesa): electrician's life support plan photo is kept as the job's life support plan"`

---

## Task 5: A5 Install day — adult present

**Files:**
- Modify: `src/lib/install-day.core.ts` (new `INSTALL_DAY_NOV2_Q`, reader, missing-question check)
- Modify: `src/lib/install-evidence.core.ts` (blocker)
- Modify: `src/lib/mitti-form-health.core.ts` (report missing Nov-2 items like the ruler items)
- Modify: `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` (Group 3 note, unnumbered)
- Create: `docs/mitti-paste-2026-11-02-A5-adult-part-b.md` (this task writes the adult section; Task 6 adds the Part B section to the same file)
- Test: `tests/new-flow-08-a5-adult.test.ts`

**Interfaces:**
- Produces: `INSTALL_DAY_NOV2_Q = { adultPresent: ADULT_PRESENT_LABEL, partBTick: …, partBSignature: … }` (Part B labels filled in Task 6), `installDayAdultPresent(audit): "Yes" | "No" | null` (null = not on this form), `installDayNov2MissingQuestions(template): string[]`.
- `evaluateInstallEvidence(...)`/`InstallEvidenceSummary.blockers` gains `INSTALL_ADULT_BLOCKER = "No adult (18 or over) was at home — don't start; book a new day"` when the answer is `"No"` or unanswered on a form that carries the question.
- Unchanged: `INSTALL_DAY_QUESTIONS.at(-1).n === 48`.

- [ ] **Step 1: Write the failing test** — label equals `ADULT_PRESENT_LABEL`; not in `INSTALL_DAY_QUESTIONS`; `installDayAdultPresent` on an A5 with `pick(label,"No")` → `"No"` and the evidence summary blockers contain `INSTALL_ADULT_BLOCKER`, so `installCompletionDecision(...).record === false`; an A5 without the item → `null`, no blocker, completion unchanged (reuse the `a5()` fixture builder from `tests/decision-396-a5-ruler-photos.test.ts`); paste file contains the label, `straight after "Does the household know the power will be off today?"`, the stop line, and "Change nothing else … Publish".
- [ ] **Step 2: Run** `bun test tests/new-flow-08-a5-adult.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as above; `installDayNov2MissingQuestions` returns the absent labels (form health shows them as "send a new form", same wording style as `RULER_SECTION_MISSING`).
- [ ] **Step 4: Run** `bun test tests/new-flow-08-a5-adult.test.ts tests/install-day.test.ts tests/decision-396-a5-ruler-photos.test.ts tests/install-evidence-prompt.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mitti): A5 asks for an adult at home; No holds installation complete"`

---

## Task 6: A5 Install day — Lead Installer's VEEC Part B at the end

**Files:**
- Modify: `src/lib/install-day.core.ts` (`INSTALL_DAY_NOV2_Q.partBTick/partBSignature`, `INSTALL_DAY_PART_B_PAGE`, `installDayPartB(audit)`)
- Modify: `src/lib/install-day-confirm.core.ts` (`InstallDayFormInput.partB`, `installDayFormResult`)
- Modify: `src/lib/install-day-confirm.server.ts` (pass `partB` read from the same audit)
- Modify: `docs/mitti-paste-2026-11-02-A5-adult-part-b.md` (Part B section)
- Test: `tests/new-flow-08-a5-part-b.test.ts`

**Interfaces:**
- Produces: `INSTALL_DAY_PART_B_PAGE = "Rebate form (VEEC) — Lead Installer"`; `INSTALL_DAY_PART_B_TEXT` = `INSTALLER_DECLARATION` without its final `"Installer signature: … Date:"` line (derived in code, never retyped).
- Produces: `installDayPartB(audit): { onForm: boolean; ticked: boolean; signature: ReadSignature }` (`ReadSignature` from `install-day.core.ts`).
- Produces: `PART_B_MISSING = "Rebate form (Part B) not ticked and signed by the Lead Installer"`; `installDayFormResult` adds it to `missing` when `partB.onForm && !(partB.ticked && partB.signature.present)`. Old forms (`onForm: false`) never get it.
- Q36 and Q48 still read as `declarationSignature`/`completionSignature` (label `"Lead installer's signature"`), unaffected by the new, differently-labelled signature.

- [ ] **Step 1: Write the failing test**

```ts
test("Part B text is the official v1.1 Section 3 Part B, without the blank signature line", () => {
  expect(INSTALL_DAY_PART_B_TEXT.startsWith("Part B: Declaration by lead installer")).toBe(true);
  expect(INSTALL_DAY_PART_B_TEXT).not.toContain("Installer signature:");
  expect(INSTALLER_DECLARATION.startsWith(INSTALL_DAY_PART_B_TEXT)).toBe(true);
});
test("form with Part B unsigned → not 'All filled in'; signed → all filled in; old form → unchanged", () => { /* installDayFormResult with partB variants; expect missing toContain PART_B_MISSING */ });
test("Q36/Q48 signatures unchanged when the Part B signature is present", () => { /* readInstallDay(...).declarationSignature.signedAt === SIG, completionSignature.signedAt === end */ });
test("paste: new LAST page after Q48, text item = Part B verbatim, tick + signature, change nothing else", () => { /* readFileSync + toContain(INSTALL_DAY_PART_B_TEXT) */ });
```

- [ ] **Step 2: Run** `bun test tests/new-flow-08-a5-part-b.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Paste section: add a new last page `Rebate form (VEEC) — Lead Installer` AFTER the page holding Q48; a text item with the Part B text (copied from the code block the paste file prints from `INSTALL_DAY_PART_B_TEXT`), the tick, the signature; "Change nothing else. Publish." Also add one help line on the page: `Sign this last, after the install is finished.`
- [ ] **Step 4: Run** `bun test tests/new-flow-08-a5-part-b.test.ts tests/install-day*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mitti): A5 ends with the Lead Installer's VEEC Part B; All filled in needs it"`

---

## Task 7: Apply the Mitti Part B signature to the VEEC assignment record

After the installation is recorded from the A5 (`maybeRecordInstallationFromMitti` → `recordInstallationComplete`), the final VEEC assignment is prepared (`prepareFinalAssignment` in `assignment.server.ts`). The Mitti Part B signature then signs Section 3 Part B on that record, exactly like the portal installer signature does today (same columns, same snapshot hash), so `veec-ap-auto` takes over unchanged.

**Files:**
- Create: `src/lib/veec-part-b-mitti.core.ts`
- Create: `src/lib/veec-part-b-mitti.server.ts`
- Modify: `src/lib/install-complete-mitti.server.ts` (call after a successful record)
- Modify: `src/lib/mitti-pull-worker.server.ts` or the A5 sync caller (retry when installation is already recorded and Part B not yet applied)
- Test: `tests/new-flow-08-part-b-apply.test.ts`

**Interfaces:**
- Produces (pure): `partBApplyDecision(i: { partB: { onForm: boolean; ticked: boolean; signature: ReadSignature }; leadName: string | null; assignment: { status: string; installerSignedAt: string | null } | null }): { action: "apply" } | { action: "skip"; reason: string } | { action: "hold"; reason: string }` — skip when not on form / already signed; hold (office) when the signed name doesn't match `leadName` (case/space-insensitive, `labelKey`-style normalising) or the signature has no media id/time.
- Produces (server): `applyMittiPartB(jobId: string, auditId: string, audit: unknown, fetchMedia: MittiMediaFetch): Promise<"applied" | "skipped" | "held">` — stores the signature image in `job-files` at `${jobId}/assignment/part-b-${mediaId}.png` (pattern: `savePiesaSignatureImage` in `official-signature.server.ts`), then writes `installer_signature_name`, `installer_signed_at` (= Mitti signature time), `installer_snapshot` `{ part: "Section 3 Part B", declaration: INSTALLER_DECLARATION, source: "mitti_install_form", audit_id, media_id, image_path, typed_name: sig.name, at: sig.signedAt, facts_sha256, form_version }`, `installer_snapshot_sha256`; idempotent (`.is("installer_signed_at", null)`); logs `veec_part_b_signed_mitti`; a hold logs `veec_part_b_mitti_held` with `needs_office: true`.
- `leadName` = the job's selected Lead Installer (`leadInstallerCert(jobId).name`, `prestart.server.ts`).
- The existing portal Part B signing (`signVeecAssignment` party "installer") stays for old forms and as the office fallback.

- [ ] **Step 1: Write the failing test** — pure cases: matching name → apply; "ivy  installer" vs "Ivy Installer" → apply; crew name → hold with reason containing "isn't the Lead Installer"; already signed → skip; old form → skip. Server (mocked admin, fake media fetch): applied once writes the columns with `installer_signed_at` equal to the Mitti time and `image_path` set; second run → "skipped" and no second write.
- [ ] **Step 2: Run** `bun test tests/new-flow-08-part-b-apply.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** as in Interfaces; call `applyMittiPartB` from `maybeRecordInstallationFromMitti` only after `recorded: true`, wrapped so a failure logs and never undoes the recorded installation; the A5 sync also calls it when the installation was already recorded (retry path).
- [ ] **Step 4: Run** `bun test tests/new-flow-08-part-b-apply.test.ts tests/veec*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(veec): Mitti Part B signature signs the VEEC assignment for the Lead Installer"`

---

## Task 8: Build check — the Mitti signature lands on the official VEEC PDF

Decision (2 Nov, now an overview cross-part decision): "the Mitti signature must land on the official VEEC PDF; if not, come back to Jo." Part 1 Task 8 builds the VEEC PDF with pdf-lib (`veecFormPdf(values, sigs)`), with a Part B slot `VeecSignatures.installer.image` — this task fills it.

**Files:**
- Modify: `src/lib/assignment.server.ts` (the final-copy builder that calls Part 1's `veecFormPdf`: read the image at `installer_snapshot.image_path` from `job-files` and pass `{ installer: { name: typed_name, at: installer_signed_at, image } }`; no image path → name only, as Part 1 does for old portal signatures)
- Test: `tests/new-flow-08-part-b-pdf.test.ts`

**Interfaces:**
- Consumes: `installer_snapshot.image_path`, `installer_snapshot.typed_name`, `installer_signed_at` (Task 7); Part 1 `veecFormPdf(values, sigs: VeecSignatures | null)`, `PdfLayoutReport.images`.

- [ ] **Step 1: Write the failing test** — fixture assignment with `image_path` (mocked storage returns a PNG) → the built PDF's `layout.images` has one entry for block `s3-partB` on the Part B page and that page's text has the name and the Melbourne date; a portal-typed signature (no image path) → `layout.images` is `[]`, name shown; image download fails → the copy is held with an office line, never built without the signature.
- [ ] **Step 2: Run** `bun test tests/new-flow-08-part-b-pdf.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; render the PDF for a TEST job and look at the Part B page (signature inside its box, section not split).
- [ ] **Step 4: Run** the test — Expected: PASS. **If the image can't be placed cleanly, STOP and ask Jo** (her rule); don't ship a workaround.
- [ ] **Step 5: Commit** — `git commit -m "feat(veec): Lead Installer's Mitti signature printed in Part B of the rebate form"`

---

## Task 9: Pin what is already built (day-2+ re-check, Lead Installer whole install, premises type) and the ESC records checklist

Already on the A5 and Ready Check (checked in code 2 Nov): Q40 `Did the install take more than one day?` + Q41 `I checked every item on this form again before starting each day` (the A5 is the PIISA form, so this is the daily PIISA re-check); Q46 `I was here the whole time and supervised everyone` (blocks completion via `install-evidence.core.ts` "Lead installer has not confirmed being on site for the whole installation"); Ready Check `Who lives at the property?` with `PREMISES_TYPE_OPTIONS` (recorded as `mitti_premises_type`). No Mitti change. This task proves they're on the live forms and builds the records checklist the spec asks for.

**Files:**
- Create: `src/lib/esc-records-checklist.core.ts`
- Test: `tests/new-flow-08-records-checklist.test.ts`

**Interfaces:**
- Produces: `ESC_RECORDS_CHECKLIST: readonly { record: string; form: "A1/A2" | "A3" | "A5" | "portal"; labels: readonly string[] }[]` covering (VEET Guidelines v16, spec "Records the ESC wants per job"): electrician at the PIESA (A3 `Photo showing you on site at the property, holding your licence / photo ID (geotagged)`); each installer on site (A5 Q8/Q12/Q16); old R-values (A1/A2 `LEAN_Q.rValue` + `LEAN_Q.depthPhoto`; A5 `INSTALL_DAY_RULER_Q.existingDepth`); new R-values (A5 Q33 packaging photo + `INSTALL_DAY_RULER_Q.newDepth`); power isolated (A5 Q27); products (A5 Q33); before video (A1/A2 `LEAN_Q.beforeVideo`); after video incl. waste removed (A5 Q38, whose label says "no rubbish left"); floor plan with m² and products (portal: `area-diagram.core.ts` from Ready Check areas + product); day-2+ re-check (A5 Q40/Q41); Lead Installer whole install (A5 Q46); premises type (A1/A2 `LEAN_Q.premisesType`).
- Produces: `recordsChecklistGaps(defs: { a1a2: string[]; a3: string[]; a5: string[] }): string[]`.

- [ ] **Step 1: Write the failing test** — every label in the checklist exists in `FORMS.ready_check.fields` / `SHORT_PIESA_FIELDS` / `INSTALL_DAY_QUESTIONS` (+ `INSTALL_DAY_RULER_Q`) → `recordsChecklistGaps(...)` is `[]`; removing Q41 from a copy of the A5 list returns `["Day-2+ PIISA re-check: I checked every item on this form again before starting each day"]`; `installDayMissingQuestions` on the 25 Oct live fixture (`tests/fixtures/a3-published-2026-10-25-read-first.json`) lists none of Q40/Q41/Q46.
- [ ] **Step 2: Run** `bun test tests/new-flow-08-records-checklist.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the constant (labels imported, never retyped) and the gap function.
- [ ] **Step 4: Run** — Expected: PASS. If a live fixture is missing an item, add it to Open questions (don't change Mitti unasked).
- [ ] **Step 5: Commit** — `git commit -m "test(mitti): ESC records checklist pinned to the live form labels"`

---

## Task 10: A5 — "Changes during the job" for the SWMS (Jo 2 Nov, answer 16)

**Files:**
- Modify: `src/lib/install-day.core.ts` (`INSTALL_DAY_NOV2_Q.swmsChange`, `.swmsNewControl`; `installDaySwmsChanges`; `installDayNov2MissingQuestions` lists them), `docs/mitti-paste-2026-11-02-A5-adult-part-b.md` (add the two items), the A5 sync (`install-complete-mitti.server.ts` / A5 pull: after reading the audit, re-file the SWMS PDF when changes exist)
- Test: `tests/new-flow-08-swms-changes.test.ts`

**Interfaces:**
- Consumes: Part 7 Task 2 `type SwmsChange = { what: string; control: string; by: string; at: string }` and `buildSwmsPdf(plan, sigs, { changes })`; existing `fileSwms(jobId, …)` (`swms.server.ts`); `leadInstallerCert(jobId).name` (`prestart.server.ts`).
- Produces: `installDaySwmsChanges(audit: unknown, leadName: string): SwmsChange[]` — one row when the change item is filled (`at` = the item's answer time if Mitti gives one, else the audit's modified time; `by` = `leadName`); `[]` when blank or not on the form (old form); `swmsChangesKey(changes): string` (hash) so the SWMS is re-filed once per distinct set of changes.

- [ ] **Step 1: Write the failing test** — A5 with "Wasp nest in the back ceiling" / "Area closed off, nest removed" → one `SwmsChange` with `by: "John Smith"`; blank → `[]`; old A5 → `[]` and no form-health problem beyond "send a new form"; sync (mocked): first read with changes → `fileSwms` called once with them; same changes again → not called; changes edited → called again; labels sit outside `INSTALL_DAY_QUESTIONS` (`.at(-1).n === 48`).
- [ ] **Step 2: Run** `bun test tests/new-flow-08-swms-changes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; a re-file failure logs on the job and never blocks the installation record.
- [ ] **Step 4: Run** `bun test tests/new-flow-08-swms-changes.test.ts tests/install-day*.test.ts tests/swms*` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mitti): Lead Installer records changes during the job; they print on the SWMS"`

---

## Task 11: Paste to Mitti (Jo, after approval) and live form-health check

- [ ] **Step 1:** Jo pastes, in order: `docs/mitti-paste-2026-11-02-A1-A2-photo-id.md`, `docs/mitti-paste-2026-11-02-A3-adult.md`, `docs/mitti-paste-2026-11-02-A5-adult-part-b.md` (each into ChatGPT, then publishes in Mitti). Template IDs don't change.
- [ ] **Step 2:** Back up the published templates to `docs/mitti-template-backups/2026-11-02/` (same format as `2026-10-23/`).
- [ ] **Step 3:** Run the form-health check on each (`mitti-form-health` office check): expect no missing labels for A1, A2, A3, A5 (including `installDayNov2MissingQuestions` = `[]`).
- [ ] **Step 4:** Run one TEST job end to end on the simulator: Ready Check with tick → PIESA with adult Yes + life support plan → A5 with adult Yes + a change during the job + Part B → installation recorded → VEEC Part B signed from Mitti → Part B PDF page and SWMS "Changes during the job" pictures to Jo.
- [ ] **Step 5: Commit** — `git add docs/mitti-template-backups/2026-11-02 && git commit -m "docs(mitti): 2 Nov template backups after the Part 8 paste"`

---

## Task 12: Ceiling areas — area name drop-down and m² or length × width (Jo 3 Nov)

**Decision:** docs/hiv-touchpoint-decisions-2026-11-02.md "MITTI CEILING AREAS (Jo 3 Nov ~4:50pm)".

**Files:** `src/lib/ready-check-lean.core.ts` (LEAN_Q), `src/lib/mitti-forms.core.ts` (READY_CHECK_FIELDS per-area block), the Ready Check readers/parsers (`mitti.core.ts`, measurement planning), `src/lib/area-diagram.core.ts`; tests.

- [ ] Area name: single choice "Main house" / "Extension" / "Upstairs" / "Other", with "Other → type the area name" shown when Other. The reader takes the choice, or the typed text for Other; old free-text answers on forms already in progress still read.
- [ ] Area size: per area, "How do you want to give the size?" — "Enter area (m²)" / "Length × width". m² → one number field; L × W → the existing Length (m) and Width (m). The reader computes m² from L × W or takes the m² answer; exactly one must be present per area (else the Ready Check holds as incomplete, existing "Nearly there" path).
- [ ] Diagram: m²-only areas draw a square of that area, labelled with the name and "{m²} m²" (no length/width labels).
- [ ] The paste-to-Mitti prompt (Task 11) includes both changes; Jo approves the wording in Task 1's gate.
- [ ] Tests: each choice + Other text; m² only; L × W only; both missing → incomplete; old form answers still parse; diagram for m²-only.

## Self-review notes

- Spec coverage (overview row 8): photo-ID tick → T2; PIESA adult → T3; life support attachment → T4; install form Part B at end → T6/T7/T8; day-2+ re-check, Lead Installer whole install, premises type → T9 (already built, pinned); adult present (install) → T5; records checklist → T9; ECOWOOL → T2; signature on official VEEC PDF → T8; SWMS changes during the job → T10; paste → T11. Rental/tenant questions moved to Part 3 Task 19 (answer 22).
- No new sends, no SQL.

## Open questions for Jo

None left for this part. The draft Mitti words in Task 1 are approved in Task 1 itself at build time.

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Part B signature:** the drawn Mitti signature goes on the rebate form with the name beside it (Task 8, using Part 1's slot).
- **Rentals (answer 22, supersedes where 7 put them):** the Mitti Ready Check does NOT ask the tenant / who-lets-us-in questions — the owner answers in the quick taps (Part 3 Task 19). The existing "Who lives at the property?" premises question stays for the rebate claim.
- **SWMS changes (answer 16):** recorded by the Lead Installer in the A5 (Task 10).
- **Manhole / Pets rows (answer 12):** no new Ready Check questions.

## Assumptions

- The A5 is the PIISA form, so Q41 "I checked every item on this form again before starting each day" meets "re-check every PIISA item at the start of each day"; no rewording.
- Premises type stays a Ready Check question only (already captured and recorded); it isn't asked again on the install form.
- The adult question uses the same words on A3 and A5; only the stop line differs ("installer's office" for electricians, "your office" for installers).
- The adult question is a Home Insulation Victoria item, not printed on the DEECA PIESA/PIISA (those stay as published).
- A Part B signed by someone other than the selected Lead Installer is held for the office, not applied.
- ESC register data (`esc-approved-products.core.ts`) keeps its ECOWOOL rows: it is the ESC's list, not ours.

## Overlaps for the main session (not for Jo)

- Task 8 fills Part 1 Task 8's `VeecSignatures.installer.image` slot (resolved).
- Part 9's GO check consumes Task 4 (`lifeSupportPlansOnFile` now counts the PIESA attachment).
- Part 3's "Nearly there" email (#27) reads `installerMissing`; Task 2 adds "the photo ID tick".
- Task 10 consumes Part 7's `SwmsChange` / `buildSwmsPdf(…, { changes })` (Part 7 builds first).
