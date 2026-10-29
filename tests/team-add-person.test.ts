import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { teamMittiLine } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const m = (workerRole: "lead" | "crew" | null, mittiLogin: "linked" | "not_set" | "email_changed", mittiRecorded = false) =>
  ({ role: workerRole ? "installer" as const : "electrician" as const, workerRole, mittiLogin, mittiRecorded });
test("teamMittiLine", () => {
  expect(teamMittiLine(m("crew", "not_set"))).toBe("Crew · no Mitti");
  expect(teamMittiLine(m("crew", "not_set", true))).toBe("Crew · Mitti ✓");
  expect(teamMittiLine(m("lead", "linked"))).toBe("Lead · Mitti ✓");
  expect(teamMittiLine(m("lead", "email_changed"))).toBe("Lead · Mitti to re-check");
  expect(teamMittiLine(m("lead", "not_set"))).toBe("Lead · office adding to Mitti");
  expect(teamMittiLine(m(null, "linked"))).toBe("Mitti ✓");
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
  const login = srv.slice(srv.indexOf("export async function tradeRequestLoginInvite"));
  expect(login.slice(0, login.indexOf("\n}\n"))).toContain("tradeChangeRequest(");
});
