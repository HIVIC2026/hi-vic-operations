// New job flow Part 8 Task 5 (Jo 2 Nov 2026, Code of Conduct): A5 Install day asks "adult at home"; No holds Installation complete.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADULT_PRESENT_LABEL, ADULT_PRESENT_STOP_A3 } from "../src/lib/official-short.core";
import {
  INSTALL_DAY_NOV2_Q, INSTALL_DAY_Q as ID, INSTALL_DAY_QUESTIONS, INSTALL_DAY_RULER_Q as RQ,
  installDayAdultOnForm, installDayAdultPresent, installDayMissingQuestions, installDayNov2MissingQuestions,
} from "../src/lib/install-day.core";
import {
  INSTALL_ADULT_BLOCKER, INSTALL_DAY_EVIDENCE as E, AFTER_INSTALL_QUESTIONS as A, INSTALL_EVIDENCE_QUESTIONS as Q,
  evaluateInstallEvidence, installCompletionDecision, readInstallEvidence, type JobZone,
} from "../src/lib/install-evidence.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { installDayTemplate } from "./helpers/journey-forms";

const SIG = "2026-10-29T20:00:00Z";
const geo = (id: string, at: string) => ({ media_id: id, captured_at: at, location: { lat: -38.14, lng: 145.12 } });
let k = 0;
const item = (label: string, x: Record<string, unknown> = {}) => ({ item_id: `i${k++}`, label, ...x });
const photo = (label: string, ...files: ReturnType<typeof geo>[]) => item(label, { type: "media", media: files });
const pick = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const unanswered = (label: string) => item(label, { type: "question", responses: {} });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const sign = (label: string, at: string) => item(label, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", name: "Ivy Installer", timestamp: at } } });
const copy = (n: number) => ({ item_id: `copy-${n}`, label: "", children: [photo(RQ.existingDepth, geo("e1", "2026-10-29T19:50:00Z")), photo(RQ.newDepth, geo("n1", "2026-10-30T03:10:00Z"))] });
/** A complete A5; `extra` adds the adult item (or not). */
const a5 = (extra: unknown[] = []) => ({ items: [
  copy(1), ...extra,
  tick(ID.declaration), sign(ID.signature, SIG),
  photo(E.afterVideos, geo("av1", "2026-10-30T03:00:00Z")), photo(E.depthPhotos, geo("dp1", "2026-10-30T03:05:00Z")),
  pick(Q.multiDay, "No"), pick(A.lockoutRemoved, "Yes"), pick(A.lockoutRemovedBy, "Lead installer"), photo(A.switchboardAfterPhoto, geo("sw", "2026-10-30T04:00:00Z")),
  pick(A.solarRestarted, "There isn't one"), tick(A.leadPresent), tick(ID.allFilledIn), sign(A.completionSignature, "2026-10-30T04:05:00Z"),
] });
const zones: JobZone[] = [{ name: "Main house", underInsulated: false, areaM2: 100, product: "Bradford Gold R5", beforeVideo: true }];
const ctx = (installDate: string) => ({ installDate, zones, multiDay: false, leadName: "Ivy Installer", solarPresent: false, existingInsulation: false });
const summary = (audit: unknown, installDate = "2026-10-29") => evaluateInstallEvidence(readInstallEvidence(audit), ctx(installDate), SIG);
const decide = (audit: unknown, installDate = "2026-10-29") =>
  installCompletionDecision({ formCompleted: true, declarationSaved: true, alreadyCompleted: false, summary: summary(audit, installDate), allFilledInTicked: true } as never);

describe("A5 adult at home (Jo 2 Nov 2026)", () => {
  test("label is the shared adult wording, kept out of Q1-Q48", () => {
    expect(INSTALL_DAY_NOV2_Q.adultPresent).toBe(ADULT_PRESENT_LABEL);
    expect(INSTALL_DAY_QUESTIONS.at(-1)!.n).toBe(48);
    expect(INSTALL_DAY_QUESTIONS.some((q) => q.label === ADULT_PRESENT_LABEL)).toBe(false);
  });
  test("reader: Yes / No / absent", () => {
    expect(installDayAdultPresent(a5([pick(ADULT_PRESENT_LABEL, "Yes")]))).toBe("Yes");
    expect(installDayAdultPresent(a5([pick(ADULT_PRESENT_LABEL, "No")]))).toBe("No");
    expect(installDayAdultPresent(a5())).toBeNull();
    expect(installDayAdultOnForm(a5())).toBe(false);
    expect(installDayAdultOnForm(a5([unanswered(ADULT_PRESENT_LABEL)]))).toBe(true);
  });
  test("No holds Installation complete, before or after the effective date", () => {
    for (const date of ["2026-10-29", "2026-01-01"]) {
      const audit = a5([pick(ADULT_PRESENT_LABEL, "No")]);
      expect(summary(audit, date).blockers).toContain(INSTALL_ADULT_BLOCKER);
      const d = decide(audit, date);
      expect(d.record).toBe(false);
      expect(d.outstanding).toContain(INSTALL_ADULT_BLOCKER);
    }
  });
  test("unanswered on a form that carries it holds too; Yes passes", () => {
    expect(summary(a5([unanswered(ADULT_PRESENT_LABEL)])).blockers).toContain(INSTALL_ADULT_BLOCKER);
    expect(summary(a5([pick(ADULT_PRESENT_LABEL, "Yes")])).blockers).not.toContain(INSTALL_ADULT_BLOCKER);
  });
  test("a form without the item is never blocked for it", () => {
    const s = summary(a5());
    expect(s.blockers).not.toContain(INSTALL_ADULT_BLOCKER);
    expect(decide(a5()).outstanding).not.toContain(INSTALL_ADULT_BLOCKER);
  });
  test("blocker wording", () => {
    expect(INSTALL_ADULT_BLOCKER).toBe("No adult (18 or over) was at home — don't start; book a new day");
  });
  test("template check: Q1-Q48 unaffected, form health lists the absent item", () => {
    const tpl = { items: installDayTemplate(INSTALL_DAY_QUESTIONS).items };
    expect(installDayMissingQuestions(tpl)).toEqual([]);
    expect(installDayNov2MissingQuestions(tpl)).toContain(ADULT_PRESENT_LABEL);
    const withIt = { items: [...tpl.items, { item_id: "x", label: ADULT_PRESENT_LABEL, type: "question" }] };
    expect(installDayNov2MissingQuestions(withIt)).not.toContain(ADULT_PRESENT_LABEL);
    const health = validateSavedDefinition("piisa", tpl);
    expect(health.ok).toBe(true);
    expect(health.issues.some((i) => i.includes(ADULT_PRESENT_LABEL))).toBe(true);
  });
  test("paste file and build prompt", () => {
    const doc = readFileSync("docs/mitti-paste-2026-11-02-A5-adult-part-b.md", "utf8");
    const blocks = doc.match(/```[\s\S]*?```/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const b = blocks[0]!;
    expect(b).toContain("1f325828-3f71-4b1a-988f-083c83414f95");
    expect(b).toContain(`"${ADULT_PRESENT_LABEL}"`);
    expect(b).toContain(`straight after "${ID.powerInformed}"`);
    expect(b).toContain(ADULT_PRESENT_STOP_A3);
    expect(b).toContain("Change nothing else");
    expect(b).toContain("Publish.");
    expect(readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8")).toContain(`\`${ADULT_PRESENT_LABEL}\``);
  });
});
