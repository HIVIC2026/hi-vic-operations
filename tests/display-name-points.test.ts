import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { quickTapsText } from "../src/lib/area-batch.core";
import { firstName as installerFirstName } from "../src/lib/installer-screens.core";
import { firstName as workerFirstName } from "../src/lib/worker-links.core";

const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");

test("greetings use the normal-case first name", () => {
  expect(workerFirstName("WAYNE WILSON")).toBe("Wayne");
  expect(installerFirstName("WAYNE WILSON")).toBe("Wayne");
  expect(quickTapsText("WAYNE WILSON", "https://x.test/a")).toStartWith("Hi Wayne,");
  expect(quickTapsText("INSolation Pty", "https://x.test/a")).toStartWith("Hi INSolation,");
  expect(workerFirstName(null)).toBeNull();
  expect(quickTapsText(null, "https://x.test/a")).toStartWith("Hi there,");
});

test("loaders and the owner email format names for display", () => {
  for (const f of [
    "installer-waiting.server.ts", "area-batch.server.ts", "in-house-batch.server.ts", "offer-dispatch.functions.ts",
    "office-job-page.server.ts", "office-lists.server.ts", "in-house-batch-email.server.ts",
  ]) expect(src(f)).toContain("displayName(");
});

test("official paperwork never imports the display-name helper", () => {
  for (const f of ["official-forms.core.ts", "official-forms.server.ts", "signed-pdf.server.ts", "esc.server.ts", "veec-assignment-form.core.ts", "owner-gates.core.ts"]) {
    let text = "";
    try { text = src(f); } catch { continue; }
    expect(text).not.toContain("display-name.core");
  }
});

test("stored installer_name stays raw in the area batch sent event", () => {
  expect(src("area-batch.server.ts")).toContain("installer_name: installer.name,");
});
