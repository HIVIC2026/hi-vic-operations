import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
// Jo 22 Oct: installers use ONLY the Mitti form; the portal Ready Check form (incl. electrical fields) is gone.
describe("portal Ready Check form retired", () => {
  test("form components no longer exist", () => {
    expect(existsSync("src/components/trade/ReadyCheckDraft.tsx")).toBe(false);
    expect(existsSync("src/components/trade/ReadyCheckAreas.tsx")).toBe(false);
  });
  test("save, submit and area saving refuse new answers", () => {
    const s = readFileSync("src/lib/ready-check-draft.functions.ts", "utf8");
    for (const n of ["saveReadyCheckDraft", "submitReadyCheckDraft", "saveReadyCheckAreas"]) {
      const body = s.slice(s.indexOf(`export const ${n}`), s.indexOf(`export const ${n}`) + 600);
      expect(body).toContain("done only in the Mitti form");
    }
  });
});
