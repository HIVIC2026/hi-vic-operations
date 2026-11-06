import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIRM_PAGE_COPY } from "../src/lib/firm-quote-page-copy.core";

const page = readFileSync(new URL("../src/routes/estimate_.$token.firm-quote.tsx", import.meta.url), "utf8");

test("page after Proceed uses Jo's approved wording", () => {
  expect(FIRM_PAGE_COPY.thanks("Alex")).toBe("Thanks, Alex. We're on it.");
  expect(FIRM_PAGE_COPY.assessment).toBe("One of our certified installers will now do a desktop assessment using your photos, aerial imagery and floor plan records.");
  expect(FIRM_PAGE_COPY.emailBy).toBe("We'll email your firm quote by");
  expect(FIRM_PAGE_COPY.nothingLocked).toBe("Nothing is locked in until you accept your firm quote.");
});
test("due date is shown in bold", () => expect(page).toContain("{FIRM_PAGE_COPY.emailBy} <strong>{formatDueDate(dueBy!)}</strong>."));
test("footer line is exactly Jo's", () => expect(FIRM_PAGE_COPY.footer).toBe("Home Insulation Victoria · VEU Accredited Person A003654"));
test("confirmation has three tick rows, the logo and no house icon", () => {
  const confirmation = page.slice(page.indexOf("{saved ? <div"), page.indexOf(": <section"));
  expect(confirmation.match(/<Tick>/g)).toHaveLength(3);
  expect(confirmation).not.toContain("OwnerHouse");
  expect(page).toContain('className="h-16 w-auto"');
});
test("before the tap: one big green button with Jo's exact wording, no other line", () => {
  expect(FIRM_PAGE_COPY.confirmButton).toBe("Confirm my firm quote request");
  const before = page.slice(page.indexOf(": <section"), page.indexOf("</section>"));
  expect(before).toContain("OwnerHouse");
  expect(before).toContain(">Your firm quote</h1>");
  expect(before.match(/<button/g)).toHaveLength(1);
  expect(before).toContain("w-full");
  expect(before).toContain("bg-estimate-green");
  expect(before).toContain("onClick={() => void proceed()}");
  expect(page).not.toContain("Proceed to firm quote");
});
test("only the button saves: no tap-anywhere / first-touch save, never on load", () => {
  expect(page).not.toContain("shouldFireOneTapSave");
  expect(page).not.toContain("ONE_TAP_SAVE_EVENTS");
  expect(page).not.toContain("addEventListener");
  expect(page).not.toMatch(/\.then\(\(r\) => \{[^}]*proceed\(/);
  expect(page.match(/proceed\(\)/g)).toHaveLength(1);
});
test("saving shows the thanks page straight from the save result", () => expect(page).toContain('setFirst(result.firstName ?? first); setDueBy(result.dueBy); setState("saved");'));
test("closed / not eligible keeps the existing friendly line", () => expect(page).toContain("This one's already been taken care of."));
test("already asked shows the same confirmation from the page read", () => expect(page).toContain('if (r.available && r.dueBy) { setDueBy(r.dueBy); setState("saved"); return; }'));
