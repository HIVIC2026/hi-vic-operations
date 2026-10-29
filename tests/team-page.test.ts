import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TEAM_ADD_SHEET, TEAM_SIGN } from "../src/lib/trade-view.core";
const src = (p: string) => readFileSync(p, "utf8");
const team = src("src/routes/_authenticated/field.business_.team.tsx");

test("Team page uses the new add and login words", () => {
  expect(team).not.toContain("createWorkerInvite");
  expect(team).toContain("addTeamPerson");
  expect(team).toContain("WorkerRoleSwitch");
  expect(team).toContain("TEAM_LOGIN.button");
  expect(team).toContain("TEAM_RULE");
  expect(team).toContain("CertLinkInline");
  expect(team).toContain("removeWorker");
  expect(team).toContain("TEAM_ADD_SHEET.button");
});
test("licence only for electricians, Lead/Crew only for installers", () => {
  expect(team).toContain('kind={data.kind}');
  expect(team).toContain('{kind === "electrician" && (');
  expect(team).toContain('{kind === "installer" && (');
  expect(team).toContain("TEAM_ADD_SHEET.licence");
  expect(team).toContain("TEAM_ADD_SHEET.crew");
});
test("intro: rule for installers, electrician text for electricians; rule shown once", () => {
  expect(team).not.toContain("Everyone listed here can be given a Ready Check");
  expect(team).toContain("TEAM_ADD_SHEET.bodyElectrician");
  expect(team.split("TEAM_RULE").length - 1).toBe(2); // import + one use
});
test("signing line", () => {
  expect(TEAM_SIGN).toEqual({ due: "Not signed yet · can't go on jobs", needContact: "Add a mobile or email to send their signing link.", link: "Make signing link" });
  expect(team).toContain("m.declarationsDue");
  expect(team).toContain("TEAM_SIGN.due");
  expect(team).toContain("TEAM_SIGN.needContact");
  expect(team).toContain("label={TEAM_SIGN.link}");
  expect(team).not.toMatch(/data\.kind === "installer"[^\n]*TEAM_SIGN/); // electricians who are due get the link too
});
test("old invite-only keys are gone", () => {
  for (const k of ["body", "fields", "inviteButton", "linkNote"]) expect(Object.keys(TEAM_ADD_SHEET)).not.toContain(k);
});
test("CertLinkInline takes an optional label", () => {
  const wc = src("src/components/portal/worker-compliance.tsx");
  expect(wc).toContain("{ workerId: string; name: string; label?: string }");
  expect(wc).toContain("label ??");
});
test("server and view carry declarationsDue", () => {
  expect(src("src/lib/trade-view.core.ts")).toContain("declarationsDue: boolean");
  const srv = src("src/lib/trade-view.server.ts");
  expect(srv).toContain("declarationsDue:");
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
  expect(team).toMatch(/removeErr\[id\]\s*&&\s*<p role="alert"/);
  expect(team).not.toMatch(/remove\(\{[^\n]*setAsked/);
  expect(team.indexOf('role="alert" className="mt-1')).toBeGreaterThan(team.indexOf("</div>}"));
});
