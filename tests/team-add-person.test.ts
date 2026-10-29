import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { teamFactsLine, teamMittiLine } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const m = (workerRole: "lead" | "crew" | null, mittiLogin: "linked" | "not_set" | "email_changed", mittiRecorded: boolean | null = false) =>
  ({ role: workerRole ? "installer" as const : "electrician" as const, workerRole, mittiLogin, mittiRecorded });
test("teamMittiLine", () => {
  expect(teamMittiLine(m("crew", "not_set"))).toBe("Crew · no Mitti");
  expect(teamMittiLine(m("crew", "not_set", true))).toBe("Crew · Mitti ✓");
  expect(teamMittiLine(m("lead", "linked"))).toBe("Lead · Mitti ✓");
  expect(teamMittiLine(m("lead", "email_changed"))).toBe("Lead · Mitti to re-check");
  expect(teamMittiLine(m("lead", "not_set"))).toBe("Lead · office adding to Mitti");
  expect(teamMittiLine(m(null, "linked"))).toBe("Mitti ✓");
});
test("unknown Mitti records say nothing wrong", () => {
  expect(teamMittiLine(m("crew", "not_set", null))).toBeNull();
  expect(teamMittiLine(m("lead", "not_set", null))).toBeNull();
  expect(teamMittiLine(m("lead", "linked", null))).toBe("Lead · Mitti ✓");
  expect(teamFactsLine({ ...m("crew", "not_set", null), mobile: "0412 000 111", noticeAcknowledged: null })).toBe("0412 000 111");
});
test("server wiring", () => {
  const srv = src("src/lib/trade-view.server.ts");
  const add = srv.slice(srv.indexOf("export async function tradeAddTeamPerson"), srv.indexOf("\n}\n", srv.indexOf("export async function tradeAddTeamPerson")));
  expect(add).toContain("c.kind");
  expect(add).not.toContain('trade_role: "installer"');
  expect(add).toContain("declarations_due: true");
  const fns = src("src/lib/trade-view.functions.ts");
  expect(fns).toContain("export const addTeamPerson");
  expect(fns).not.toMatch(/setTeamCrewRole|tradeSetCrewRole/);
  expect(srv).toContain("recsError");
  expect(fns).toContain('z.literal("")');
  const login = srv.slice(srv.indexOf("export async function tradeRequestLoginInvite"));
  expect(login.slice(0, login.indexOf("\n}\n"))).toContain("tradeChangeRequest(");
});
