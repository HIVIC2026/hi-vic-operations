// The Mitti build prompts and the readers must never drift: every exact wording constant appears verbatim in the prompt.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { A3_RELABELS, AFTER_INSTALL_QUESTIONS, FOIL_QUESTIONS, SOLAR_RESTARTED_OPTIONS, SWMS_CONTROL_CHECK_OPTIONS, SWMS_HAZARDS, SWMS_HRCW_OPTIONS, SWMS_PERSON_OPTIONS, SWMS_PREPARED_FOR, SWMS_QUESTIONS, SWMS_WORK_DEFAULT, ZONE_PRODUCT_OPTIONS, installEvidenceQuestionList } from "../src/lib/install-evidence.core";
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
    for (const o of [...SWMS_HRCW_OPTIONS, ...SWMS_PERSON_OPTIONS, ...SWMS_CONTROL_CHECK_OPTIONS, ...SOLAR_RESTARTED_OPTIONS, ...ZONE_PRODUCT_OPTIONS]) expect(install).toContain(`\`${o}\``);
    for (const h of SWMS_HAZARDS) for (const c of h.controls) expect(install, `${h.name}: ${c}`).toContain(`\`${c}\``);
    expect(install).toContain(SWMS_PREPARED_FOR);
    expect(install).toContain(SWMS_WORK_DEFAULT);
    expect(install).toContain(`\`${SWMS_QUESTIONS.leadSignature}\``);
    expect(install).toContain(`\`${AFTER_INSTALL_QUESTIONS.completionSignature}\``);
    expect(install).toContain(`\`${FOIL_QUESTIONS.foilPhoto}\``);
  });
  test("asks for no plan upload and states the count", () => {
    expect(install).toContain("Do not add a plan or floor-plan upload");
    expect(install).toContain(`${installEvidenceQuestionList().length} new questions in total`);
  });
});

describe("PIESA prompt addendum", () => {
  test("carries the official effective question verbatim", () => {
    expect(piesa).toContain(`\`${PIESA_EFFECTIVE_QUESTION}\``);
    expect(readFileSync("docs/MITTI_PIESA_FORM_SPEC.md", "utf8")).toContain(PIESA_EFFECTIVE_QUESTION);
  });
});
