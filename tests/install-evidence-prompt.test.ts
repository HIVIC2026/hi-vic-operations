// The Mitti build prompts and the readers must never drift: every exact wording constant appears verbatim in the prompt.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { A3_RELABELS, AFTER_INSTALL_QUESTIONS, FOIL_QUESTIONS, RETIRED_FINAL_PLAN_UPLOAD_LABEL, SOLAR_RESTARTED_OPTIONS, SWMS_ADDITIONAL_INSTALLERS, SWMS_HAZARDS, SWMS_HOW_IN_PLACE, SWMS_HRCW_OPTIONS, SWMS_QUESTIONS, SWMS_STANDARD_CONTROLS_TEXT, ZONE_PRODUCT_OPTIONS, installEvidenceQuestionList } from "../src/lib/install-evidence.core";
import { A3_INSTRUCTION_LABELS_2026_10_09 } from "../src/lib/piisa-a3.core";
import { PIESA_EFFECTIVE_QUESTION } from "../src/lib/official-short.core";

const install = readFileSync("docs/MITTI_INSTALL_FORM_CHATGPT_PROMPT.md", "utf8");
const piesa = readFileSync("docs/MITTI_PIESA_CHATGPT_PROMPT.md", "utf8");

describe("Install day prompt carries every constant verbatim", () => {
  test("every new question label, in form order, as a backticked line", () => {
    let last = -1;
    for (const q of installEvidenceQuestionList()) {
      const at = install.indexOf(`\`${q.label}\` —`);
      expect(at, q.label).toBeGreaterThan(-1);
      expect(at, `${q.label} out of order`).toBeGreaterThan(last);
      last = at;
    }
  });
  test("the four relabels, every option list and the prefill texts", () => {
    for (const v of Object.values(A3_RELABELS)) expect(install).toContain(`New: \`${v}\``);
    for (const o of [...SWMS_HRCW_OPTIONS, ...SWMS_HAZARDS.map((h) => h.name), ...SOLAR_RESTARTED_OPTIONS, ...ZONE_PRODUCT_OPTIONS]) expect(install).toContain(`\`${o}\``);
    expect(install).toContain(`\`${SWMS_STANDARD_CONTROLS_TEXT}\``);
    expect(install).toContain(`\`${SWMS_QUESTIONS.leadSignature}\``);
    expect(install).toContain(`\`${AFTER_INSTALL_QUESTIONS.completionSignature}\``);
    expect(install).toContain(`\`${FOIL_QUESTIONS.foilPhoto}\``);
  });
  test("asks for no plan upload, tells Jo to delete the old one (decision 211) and states the count", () => {
    expect(install).toContain("Do not add a plan or floor-plan upload");
    expect(install).toContain(`## Part F: remove the old final-plan upload`);
    expect(install).toContain(`\`${RETIRED_FINAL_PLAN_UPLOAD_LABEL}\``);
    expect(RETIRED_FINAL_PLAN_UPLOAD_LABEL).toBe(A3_INSTRUCTION_LABELS_2026_10_09.final_plan);
    expect(install).toContain(`${installEvidenceQuestionList().length} new questions in total`);
  });
});

describe("PIESA prompt addendum", () => {
  test("carries the official effective question verbatim", () => {
    expect(piesa).toContain(`\`${PIESA_EFFECTIVE_QUESTION}\``);
    expect(readFileSync("docs/MITTI_PIESA_FORM_SPEC.md", "utf8")).toContain(PIESA_EFFECTIVE_QUESTION);
  });
});

/** Decision 256: the fix prompt Jo pastes into ChatGPT is the spec for the slimmed SWMS — the code must equal it. */
describe("Install day fix prompt §1 (SWMS) equals the code", () => {
  const fix = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
  const S = SWMS_QUESTIONS;
  const quoted = (v: string) => expect(fix, v).toContain(`"${v}"`);
  test("every new / renamed / kept SWMS label is quoted verbatim", () => {
    for (const v of [S.hrcw, S.hazards, S.standardControls, S.changes, S.leadSignature, S.signedAt, S.day3Recheck]) quoted(v);
    expect(fix).toContain(`"${S.leadDeclaration.split(". ")[0]}. …"`);
    // The prompt writes the crew items once with "N" (N = 1, 2, 3).
    quoted(S.installerRead(1).replace("installer 1:", "installer N:"));
    quoted(S.installerSignature(1).replace("installer 1:", "installer N:"));
    expect(SWMS_ADDITIONAL_INSTALLERS).toBe(3);
    expect(fix).toContain('"Additional Installer 1", "Additional Installer 2", "Additional Installer 3"');
  });
  test("the nine hazard answers, in order, exactly", () => {
    const block = fix.slice(fix.indexOf(`"${S.hazards}"`), fix.indexOf("b) Instruction"));
    const answers = [...block.matchAll(/^\s+- (.+)$/gm)].map((m) => m[1]!.trim());
    expect(answers).toEqual(SWMS_HAZARDS.map((h) => h.name));
  });
  test("the standard-controls instruction is the hazards' control sentences plus the how-it-is-put-in-place sentence", () => {
    quoted(SWMS_STANDARD_CONTROLS_TEXT);
    expect(SWMS_STANDARD_CONTROLS_TEXT.endsWith(SWMS_HOW_IN_PLACE)).toBe(true);
  });
  test("the old items the prompt deletes are no longer read", () => {
    const labels = installEvidenceQuestionList().map((q) => q.label);
    for (const gone of ["SWMS — prepared by (installer business name)", "SWMS — first aider on site (name)", "SWMS — emergency assembly point", "SWMS — how the controls will be checked during the job", "SWMS — changes to hazards or controls during this job (write 'None' if none)"]) {
      expect(fix).toContain(`"${gone}"`);
      expect(labels).not.toContain(gone);
    }
    for (let n = 1; n <= 4; n++) {
      expect(fix).toContain(`"SWMS — worker ${n}: …"`);
      expect(labels.some((l) => l.startsWith(`SWMS — worker ${n}:`))).toBe(false);
    }
  });
});
