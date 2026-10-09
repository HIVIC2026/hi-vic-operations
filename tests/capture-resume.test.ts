import { describe, expect, test } from "bun:test";
import { captureResume } from "../src/lib/capture-resume.core";
describe("Group B email link resume", () => {
  test("a saved spot never shows the four choices again", () => expect(captureResume({ spotSaved: true, ownerQualified: false })).toBe("spot_saved"));
  test("a recorded qualifying Yes resumes at Save my spot", () => expect(captureResume({ spotSaved: false, ownerQualified: true })).toBe("declared"));
  test("no answer yet shows the four choices", () => expect(captureResume({ spotSaved: false, ownerQualified: false })).toBe("choices"));
});
