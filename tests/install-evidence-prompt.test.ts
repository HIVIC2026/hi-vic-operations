// The Mitti build prompts and the readers must never drift. The install day form's drift test is tests/install-day.test.ts
// (docs/MITTI_INSTALL_FORM_FIX_PROMPT.md vs install-day.core.ts); the old combined build prompt is marked superseded.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AFTER_INSTALL_QUESTIONS, INSTALL_DAY_EVIDENCE, INSTALL_EVIDENCE_QUESTIONS, installEvidenceQuestionList } from "../src/lib/install-evidence.core";
import { PIESA_EFFECTIVE_QUESTION } from "../src/lib/official-short.core";

const install = readFileSync("docs/MITTI_INSTALL_FORM_CHATGPT_PROMPT.md", "utf8");
const fix = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
const piesa = readFileSync("docs/MITTI_PIESA_CHATGPT_PROMPT.md", "utf8");

describe("Install day prompts", () => {
  test("the old combined build prompt is marked superseded and points at the one install day prompt", () => {
    expect(install).toContain("**Superseded (24 Oct 2026, decisions 260–266).**");
    expect(install).toContain("`docs/MITTI_INSTALL_FORM_FIX_PROMPT.md`");
  });
  test("every install-evidence label on the install day form is in the prompt verbatim", () => {
    for (const q of installEvidenceQuestionList()) expect(fix, q.label).toContain(`\`${q.label}\``);
    for (const l of [INSTALL_DAY_EVIDENCE.afterVideos, INSTALL_DAY_EVIDENCE.depthPhotos, INSTALL_EVIDENCE_QUESTIONS.multiDay, INSTALL_EVIDENCE_QUESTIONS.dailyRecheck, ...Object.values(AFTER_INSTALL_QUESTIONS)]) expect(fix).toContain(`\`${l}\``);
  });
});

describe("PIESA prompt addendum", () => {
  test("carries the official effective question verbatim", () => {
    expect(piesa).toContain(`\`${PIESA_EFFECTIVE_QUESTION}\``);
    expect(readFileSync("docs/MITTI_PIESA_FORM_SPEC.md", "utf8")).toContain(PIESA_EFFECTIVE_QUESTION);
  });
});
