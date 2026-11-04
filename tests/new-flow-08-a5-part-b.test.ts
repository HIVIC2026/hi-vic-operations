// New job flow Part 8 Task 6 (Jo 2 Nov 2026): A5 Install day ends with the Lead Installer's VEEC Part B (tick + signature).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_DECLARATION } from "../src/lib/veec-assignment-form.core";
import {
  INSTALL_DAY_NOV2_Q, INSTALL_DAY_PART_B_PAGE, INSTALL_DAY_PART_B_TEXT, INSTALL_DAY_Q as ID, INSTALL_DAY_QUESTIONS,
  installDayPartB, readInstallDay,
} from "../src/lib/install-day.core";
import { PART_B_MISSING, installDayFormResult } from "../src/lib/install-day-confirm.core";

const SIG = "2026-10-29T20:00:00Z";
const END = "2026-10-30T04:05:00Z";
const MEDIA = (c: string) => `0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5${c}`;
let k = 0;
const item = (label: string, x: Record<string, unknown> = {}) => ({ item_id: `i${k++}`, label, ...x });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const sign = (label: string, at: string, c = "b") => item(label, { type: "signature", responses: { image: { media_id: MEDIA(c), name: "Ivy Installer", timestamp: at } } });
const unsigned = (label: string) => item(label, { type: "signature", responses: {} });
const base = () => [tick(ID.declaration), sign(ID.signature, SIG, "a"), sign(ID.signature, END, "c")];
const audit = (extra: unknown[]) => ({ items: [...base(), ...extra] });

describe("A5 Part B (Lead Installer's VEEC declaration)", () => {
  test("Part B text is the official v1.1 Section 3 Part B, without the blank signature line", () => {
    expect(INSTALL_DAY_PART_B_TEXT.startsWith("Part B: Declaration by lead installer")).toBe(true);
    expect(INSTALL_DAY_PART_B_TEXT).not.toContain("Installer signature:");
    expect(INSTALLER_DECLARATION.startsWith(INSTALL_DAY_PART_B_TEXT)).toBe(true);
    expect(INSTALL_DAY_PART_B_PAGE).toBe("Rebate form (VEEC) — Lead Installer");
  });
  test("labels are new, not Q1-Q48, and distinct from the Q36/Q48 signature label", () => {
    expect(INSTALL_DAY_QUESTIONS.at(-1)!.n).toBe(48);
    const { partBTick, partBSignature } = INSTALL_DAY_NOV2_Q;
    expect(partBSignature).not.toBe(ID.signature);
    for (const l of [partBTick, partBSignature]) expect(INSTALL_DAY_QUESTIONS.some((q) => q.label === l)).toBe(false);
  });
  test("reader: absent / unsigned / ticked + signed", () => {
    expect(installDayPartB(audit([]))).toMatchObject({ onForm: false, ticked: false });
    const half = installDayPartB(audit([tick(INSTALL_DAY_NOV2_Q.partBTick), unsigned(INSTALL_DAY_NOV2_Q.partBSignature)]));
    expect(half).toMatchObject({ onForm: true, ticked: true });
    expect(half.signature.present).toBe(false);
    const done = installDayPartB(audit([tick(INSTALL_DAY_NOV2_Q.partBTick), sign(INSTALL_DAY_NOV2_Q.partBSignature, END, "d")]));
    expect(done).toMatchObject({ onForm: true, ticked: true });
    expect(done.signature.present).toBe(true);
  });
  const input = (partB?: ReturnType<typeof installDayPartB>) => ({
    formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: { ok: true, message: "" },
    summary: { applies: true, blockers: [], rulerBlockers: [] }, ...(partB ? { partB } : {}),
  });
  test("form with Part B unsigned -> not 'All filled in'; signed -> all filled in; old form -> unchanged", () => {
    const unsignedB = installDayPartB(audit([tick(INSTALL_DAY_NOV2_Q.partBTick), unsigned(INSTALL_DAY_NOV2_Q.partBSignature)]));
    expect(installDayFormResult(input(unsignedB)).missing).toContain(PART_B_MISSING);
    expect(installDayFormResult(input(unsignedB)).state).toBe("not_finished");
    const untickedB = installDayPartB(audit([sign(INSTALL_DAY_NOV2_Q.partBSignature, END, "d"), item(INSTALL_DAY_NOV2_Q.partBTick, { type: "checkbox", responses: {} })]));
    expect(installDayFormResult(input(untickedB)).missing).toContain(PART_B_MISSING);
    const ok = installDayPartB(audit([tick(INSTALL_DAY_NOV2_Q.partBTick), sign(INSTALL_DAY_NOV2_Q.partBSignature, END, "d")]));
    expect(installDayFormResult(input(ok))).toEqual({ state: "all_filled_in", missing: [] });
    expect(installDayFormResult(input(installDayPartB(audit([]))))).toEqual({ state: "all_filled_in", missing: [] });
    expect(installDayFormResult(input())).toEqual({ state: "all_filled_in", missing: [] });
    expect(PART_B_MISSING).toBe("Rebate form (Part B) not ticked and signed by the Lead Installer");
  });
  test("Q36/Q48 signatures unchanged when the Part B signature is present", () => {
    const r = readInstallDay(audit([tick(INSTALL_DAY_NOV2_Q.partBTick), sign(INSTALL_DAY_NOV2_Q.partBSignature, "2026-10-30T05:00:00Z", "d")]));
    expect(r.declarationSignature.signedAt).toBe(SIG);
    expect(r.completionSignature.signedAt).toBe(END);
  });
  test("paste: new LAST page after Q48, text item = Part B verbatim, tick + signature, change nothing else", () => {
    const doc = readFileSync("docs/mitti-paste-2026-11-02-A5-adult-part-b.md", "utf8");
    const blocks = doc.match(/```[\s\S]*?```/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const b = blocks[1]!;
    expect(b).toContain("1f325828-3f71-4b1a-988f-083c83414f95");
    expect(b).toContain(INSTALL_DAY_PART_B_PAGE);
    expect(b).toContain(INSTALL_DAY_PART_B_TEXT);
    expect(b).toContain(`"${INSTALL_DAY_NOV2_Q.partBTick}"`);
    expect(b).toContain(`"${INSTALL_DAY_NOV2_Q.partBSignature}"`);
    expect(b).toContain("Sign this last, after the install is finished.");
    expect(b).toContain(`after the page that holds "${ID.signature}" (the last signature)`);
    expect(b).toContain("Change nothing else");
    expect(b).toContain("Publish.");
  });
});
