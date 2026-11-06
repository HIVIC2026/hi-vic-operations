// Installer redesign look (spec v2 §3): the website look tokens on .installer-redesign.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const block = css.match(/\.estimate-brand\.portal-theme\.installer-redesign\s*\{([^}]*)\}/)?.[1] ?? "";

describe("installer redesign look", () => {
  test("installer redesign uses the website look", () => {
    for (const pair of ["--hiv-ink: #22376b", "--hiv-sub: #5b6785", "--hiv-blue: #3c51c4", "--hiv-green: #07bf61", "--hiv-canvas: #f5f7fb", "--hiv-line: #e3e8f2", "--warning: #8a4b00", "--warning-soft: #fef3e2", "--hiv-rose: #b42318", "--danger-soft: #fdeaea"]) {
      expect(block.toLowerCase()).toContain(pair);
    }
    expect(block).toContain('--app-font: "Open Sans"');
    expect(block).toContain('--app-font-display: "Open Sans"');
  });
});
