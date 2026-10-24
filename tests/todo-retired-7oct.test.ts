import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { movedFromTodo, MITTI_FORMS } from "../src/lib/needs-me.core";

const nav = readFileSync(new URL("../src/lib/office-nav.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/routes/_authenticated/admin.todo.tsx", import.meta.url), "utf8");

describe("old To action list retired (Jo 7 Oct)", () => {
  test("tab is gone from the office menu", () => {
    expect(nav).not.toContain("To action (old list)");
    expect(nav).not.toMatch(/to: "\/admin\/todo"/);
  });
  test("/admin/todo redirects to /admin/needs-me (the office home)", () => {
    expect(route).toContain('redirect({ to: "/admin/needs-me"');
  });
  test("Needs me now shows unconnected Mitti forms", () => {
    const rows = movedFromTodo({ formIds: { mitti_ready_check_template_id: "a", mitti_ready_check_priced_template_id: "b", mitti_piesa_template_id: null, mitti_piisa_template_id: "" }, pendingWorkers: [] });
    expect(rows.map((r) => r.title)).toEqual(["Onsite form not set up: B Pre Insulation Electrical Safety Assessment (PIESA)", "Onsite form not set up: C PIISA installer Pre Insulation Electrical Safety Assessment (PIESA)"]);
    expect(rows.every((r) => r.href === "/admin/compliance")).toBe(true);
    expect(movedFromTodo({ formIds: Object.fromEntries(MITTI_FORMS.map(([, c]) => [c, "x"])), pendingWorkers: [] })).toEqual([]);
  });
  test("Needs me now shows real workers waiting for approval, never TEST ones", () => {
    const rows = movedFromTodo({ formIds: null, pendingWorkers: [
      { id: "1", full_legal_name: "Sam Real", business: "Real Insulation" },
      { id: "2", full_legal_name: "Bhavdeep singh", business: "[TEST PARTNER] Reinsulate" },
      { id: "3", full_legal_name: "T", business: "TEST Delta Electrical" },
      { id: "4", full_legal_name: null, business: null },
    ] });
    expect(rows.map((r) => r.title)).toEqual(["Approve worker – Sam Real", "Approve worker – name not given"]);
    expect(rows.every((r) => r.href === "/admin/workers" && !/undefined|null/.test(r.title + r.why))).toBe(true);
  });
});
