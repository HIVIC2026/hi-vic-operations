import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveOwnerScreen } from "../src/lib/owner-myjob.core";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("old estimate and calculator links open Save my spot", () => {
  for (const f of ["src/routes/estimate.$token.tsx", "src/routes/estimate_.$token.calculator.tsx"]) {
    expect(code(f)).toMatch(/throw redirect\(\{\s*to:\s*"\/estimate\/\$token\/campaign"/);
    expect(code(f)).not.toMatch(/CustomerEstimate|PublicCalculator/);
  }
});
test("3-questions page has no photos box", () => { expect(code("src/routes/estimate_.$token.video.tsx")).not.toContain("photosTitle"); });
test("My job home never shows", () => { expect(resolveOwnerScreen("home", {})).toBe("all_set"); });
test("no owner message links to My job home", () => {
  for (const f of ["veec-emails", "visit-new-times", "deposit-release-notice", "install-no-access-notice", "thirty-day-rule", "spot-saved-messages", "ready-check-booked-email", "safety-check-emails"]) expect(code(`src/lib/${f}.core.ts`)).not.toMatch(/See my job|See where you're up to/);
});
test("on-the-way SMS has no My job link (decisions 54-58 item 4)", async () => {
  const { visitNewTimesText } = await import("../src/lib/visit-new-times.core");
  const t = visitNewTimesText({ kind: "ready_check", wasIso: "2026-11-10T00:00:00Z", ownerPicks: false, link: "https://x/my-job/t" } as never);
  expect(t).not.toContain("https://x/my-job/t");
  expect(visitNewTimesText({ kind: "ready_check", wasIso: "2026-11-10T00:00:00Z", ownerPicks: true, link: "https://x/my-job/t" } as never)).toContain("https://x/my-job/t");
});

