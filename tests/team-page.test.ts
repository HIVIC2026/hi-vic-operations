import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as tradeCore from "../src/lib/trade-view.core";
import { TEAM_ADD_SHEET } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const team = src("src/routes/_authenticated/field.business_.team.tsx");

test("Team page uses the new add and login words", () => {
  expect(team).not.toContain("createWorkerInvite");
  expect(team).toContain("addTeamPerson");
  expect(team).toContain("WorkerRoleSwitch");
  expect(team).toContain("TEAM_LOGIN.button");
  // G8 (3), Jo 4 Nov 2026 21:45: no worker logins — the login ask shows for Office people only.
  expect(team).toContain('m.role === "office" && !m.hasLogin');
  expect(team).toContain("CertLinkInline");
  expect(team).toContain("removeWorker");
  expect(team).toContain("TEAM_ADD_SHEET.button");
});
test("licence + REC for an electrician person; the four roles only for installer businesses (Task 10)", () => {
  expect(team).toContain('kind={data.kind}');
  expect(team).toContain('{electricianFields && (');
  expect(team).toContain('{kind === "installer" && (');
  expect(team).toContain("TEAM_ADD_SHEET.licence");
  expect(team).toContain("ADD_PERSON_ROLES.map");
  expect(team).toContain("TEAM_WORDS.rec");
});
test("intro: the approved Team line for installers, electrician text for electricians (Task 10 replaced TEAM_RULE)", () => {
  expect(team).not.toContain("Everyone listed here can be given a Ready Check");
  expect(team).toContain("TEAM_ADD_SHEET.bodyElectrician");
  expect(team).not.toContain("TEAM_RULE");
  expect(team.split("TEAM_INTRO").length - 1).toBe(3); // import + heading + Add a person sheet
});
test("no signing line: nothing on Team asks a person to sign (Jo 5 Nov 2026)", () => {
  expect((tradeCore as Record<string, unknown>)["TEAM_SIGN"]).toBeUndefined();
  expect(team).not.toContain("declarationsDue");
  expect(team).not.toContain("TEAM_SIGN");
  expect(team).not.toContain("data-sign-due");
  expect(TEAM_ADD_SHEET.bodyInstaller).not.toMatch(/sign|declaration/i);
  expect(TEAM_ADD_SHEET.bodyElectrician).not.toMatch(/sign|declaration/i);
  // The certificate link stays for an installer whose CII is not cleared.
  expect(team).toContain('m.cii && cii?.tone === "rose"');
});
test("old invite-only keys are gone", () => {
  for (const k of ["body", "fields", "inviteButton", "linkNote"]) expect(Object.keys(TEAM_ADD_SHEET)).not.toContain(k);
});
test("CertLinkInline takes an optional label", () => {
  const wc = src("src/components/portal/worker-compliance.tsx");
  expect(wc).toContain("{ workerId: string; name: string; label?: string }");
  expect(wc).toContain("label ??");
});
test("server and view no longer carry declarationsDue", () => {
  expect(src("src/lib/trade-view.core.ts")).not.toContain("declarationsDue");
  const srv = src("src/lib/trade-view.server.ts");
  expect(srv).not.toContain("declarationsDue");
  expect(srv).not.toContain("declarations_due: true");
  expect(srv).toContain("isMissingDbObject");
});
test("My business: Add a team member goes to Team", () => {
  const biz = src("src/routes/_authenticated/field.business.tsx");
  expect(biz).toContain("/field/business/team");
  expect(biz).not.toContain("/partner/workers");
});
test("People switch is unchanged", () => {
  expect(src("src/components/portal/partner-people.tsx")).toContain('<WorkerRoleSwitch tone="office"');
});
test("remove error shows outside the login branch", () => {
  expect(team).toContain("setRemoveErr");
  expect(team).toMatch(/removeErr\s*&&\s*<p role="alert"/);
  expect(team).not.toMatch(/remove\(\{[^\n]*setAsked/);
  expect(team.indexOf('{removeErr && <p role="alert"')).toBeGreaterThan(team.indexOf("</div>}"));
});
