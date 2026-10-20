import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { qaAccessPath, qaPersonaMissingMessage } from "../src/lib/qa-role-link.core";

const fns = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
const ui = readFileSync("src/routes/_authenticated/admin.test-centre.tsx", "utf8");
const issueBody = fns.slice(fns.indexOf("export const issueQaPersonaLink"), fns.indexOf("export const simulateQaJourneyTime"));
const openAs = ui.slice(ui.indexOf("const openAs"), ui.indexOf("const runTime"));

describe("Open as … is sign-in only", () => {
  test("login path performs no account/role/credential writes", () => {
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", "updateUserById", "createUser", "prepareQaJourney"]) expect(issueBody.includes(w)).toBe(false);
    expect(issueBody).toContain("generateLink");
  });
  test("Open as never calls prepare and never uses window.open", () => {
    expect(openAs).not.toContain("ready(");
    expect(openAs).not.toContain("prepare(");
    expect(openAs).not.toContain("window.open");
  });
  test("missing TEST persona gives an actionable no-change message", () => {
    expect(qaPersonaMissingMessage("installer_boss")).toMatch(/Nothing was changed.*Assign an existing TEST installer/);
    expect(qaPersonaMissingMessage("owner")).toMatch(/no existing TEST owner/);
  });
});

describe("tab opening survives pop-up blocking", () => {
  test("opens via a real user-clicked link with noopener", () => {
    expect(ui).toMatch(/<a href=\{roleLink\.href\} target="_blank" rel="noopener noreferrer"/);
  });
  test("link is same-origin qa-access and encodes values", () => {
    expect(qaAccessPath({ tokenHash: "a&b", next: "/home" })).toBe("/qa-access?token_hash=a%26b&type=magiclink&next=%2Fhome");
  });
});
