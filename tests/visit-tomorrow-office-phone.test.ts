import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { visitTomorrowText } from "@/lib/approved-texts.core";

const rapid = { name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapid.test" };
const viking = { name: "Viking Electrical", tradingName: null, officePhone: "03 9111 1111", email: null };

describe("See you tomorrow texts use the business office phone (#25)", () => {
  it("Ready Check", () => {
    expect(visitTomorrowText({ kind: "ready_check", time: "9:00am", business: rapid }))
      .toBe("Home Insulation Victoria: See you tomorrow at 9:00am for your free Ready Check (Rapid Insulation, 03 9000 0000).");
  });
  it("PIESA says electrical safety check (PIESA); business email is not needed", () => {
    expect(visitTomorrowText({ kind: "piesa", time: "9:00am", business: viking }))
      .toBe("Home Insulation Victoria: See you tomorrow at 9:00am for your electrical safety check (PIESA) (Viking Electrical, 03 9111 1111).");
  });
  it("install keeps the power reminder", () => {
    expect(visitTomorrowText({ kind: "install", time: "9:00am", business: rapid }))
      .toBe("Home Insulation Victoria: See you tomorrow at 9:00am for your insulation install (Rapid Insulation, 03 9000 0000). Reminder: power will be off while they work in the ceiling.");
  });
  it("no office phone holds the send", () => {
    for (const kind of ["ready_check", "piesa", "install"] as const) {
      const r = visitTomorrowText({ kind, time: "9:00am", business: { ...rapid, officePhone: "  " } });
      expect(typeof r).toBe("object");
      expect((r as { held: string }).held).toContain("Rapid Insulation");
    }
  });
  it("the sender reads the business office phone, never the worker's", () => {
    const s = readFileSync("src/lib/approved-texts.server.ts", "utf8");
    const fn = s.split("export async function textOwnerVisitTomorrow")[1]!.split("\nexport async function")[0]!;
    expect(fn).toContain("businessContactForJob");
    expect(fn).toContain("visitTomorrowText(");
    expect(fn).not.toMatch(/workers|who\.phone|trade\.phone/);
  });
});
