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
    for (const o of [...SWMS_HRCW_OPTIONS, ...SOLAR_RESTARTED_OPTIONS, ...ZONE_PRODUCT_OPTIONS]) expect(install).toContain(`\`${o}\``);
    expect(install).toContain(`\`${SWMS_STANDARD_CONTROLS_TEXT}\``);
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

/** Decisions 256–259: docs/MITTI_INSTALL_FORM_FIX_PROMPT.md is the one end-state prompt Jo pastes into ChatGPT — the code must equal it. */
describe("Install day end-state prompt (SWMS, finish time, re-check lines) equals the code", () => {
  const spec = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
  const S = SWMS_QUESTIONS;
  const quoted = (v: string) => expect(spec, v).toContain(`"${v}"`);
  test("every current SWMS label is quoted verbatim (crew signature written once with N = 1, 2, 3)", () => {
    for (const v of [S.hrcw, S.standardControls, S.changes]) quoted(v);
    quoted(S.installerSignature(1).replace("installer 1:", "installer N:"));
    expect(SWMS_ADDITIONAL_INSTALLERS).toBe(3);
  });
  test("the standard-controls instruction is the nine hazards' control sentences plus the how-it-is-put-in-place sentence", () => {
    quoted(SWMS_STANDARD_CONTROLS_TEXT);
    expect(SWMS_HAZARDS).toHaveLength(9);
    expect(SWMS_STANDARD_CONTROLS_TEXT.endsWith(SWMS_HOW_IN_PLACE)).toBe(true);
    expect(SWMS_STANDARD_CONTROLS_TEXT).toContain("it is a licensed asbestos removalist's job before work continues");
  });
  test("items the prompt deletes are no longer asked for or required", () => {
    const labels = installEvidenceQuestionList().map((q) => q.label);
    for (const gone of ["SWMS — hazards on this job (tick every one that applies)", "SWMS — lead installer signature", "SWMS — signed at (date and time)", "SWMS — prepared by (installer business name)", "SWMS — first aider on site (name)", "Installation finished at (date and time)", "SWMS — day 2 re-check: date, time and lead installer initials (and any change to the SWMS)", "SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)"]) expect(labels).not.toContain(gone);
    expect(labels.some((l) => /^SWMS — (worker \d|I am the lead installer)/.test(l) || /additional installer \d: I have read/.test(l))).toBe(false);
    expect(installEvidenceQuestionList().filter((q) => q.optional).map((q) => q.label)).toEqual([S.changes]);
  });
});
