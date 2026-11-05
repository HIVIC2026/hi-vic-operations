// Installer screens Task 10 — Team (approved mock-up team-phone.png, Jo 2 Nov 2026): one line per person from recorded
// facts, roles for Add a person, mobile + date of birth required for everyone, and the boss-only "Can see Money" switch.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ADD_PERSON_ROLES, ADD_PERSON_ROLE_LABEL, TEAM_INTRO, TEAM_WORDS, addPersonProblems, moneySwitchLine, teamRow, type TeamRowFacts,
} from "../src/lib/team-screen.core";

const TODAY = "2026-11-03";
const cleared = { certStatus: "verified", level: "CII", expiresOn: "2027-06-30" };
const base = (over: Partial<TeamRowFacts>): TeamRowFacts => ({
  name: "Person", role: "installer", workerRole: "lead", mobile: "0412 000 111", cii: cleared,
  escRegistered: true, licenceAndRec: false, canSeeMoney: false, hasDob: true, ...over,
});

describe("teamRow — the one line under each name (team-phone.png)", () => {
  test("Boss", () => {
    expect(teamRow(base({ name: "James Sachinidis", role: "owner", workerRole: null, cii: null, hasDob: null }), TODAY)).toEqual({ name: "James Sachinidis", line: "Boss ›", warn: false });
  });
  test("Office with Money on / off", () => {
    expect(teamRow(base({ name: "Mia Chen", role: "office", workerRole: null, cii: null, canSeeMoney: true }), TODAY)).toEqual({ name: "Mia Chen", line: "Office · prices ✓ · Money: On ›", warn: false });
    expect(teamRow(base({ role: "office", workerRole: null, cii: null, canSeeMoney: false }), TODAY).line).toBe("Office · prices ✓ · Money: Off ›");
  });
  test("Lead Installer with CII and ESC registration", () => {
    expect(teamRow(base({ name: "John Smith" }), TODAY)).toEqual({ name: "John Smith", line: "Lead Installer · CII ✓ · ESC registered ✓ ›", warn: false });
  });
  test("Lead Installer not yet registered: Home Insulation Victoria's job, so not orange (DRAFT words)", () => {
    expect(teamRow(base({ escRegistered: false }), TODAY)).toEqual({ name: "Person", line: "Lead Installer · CII ✓ · ESC registration pending ›", warn: false });
  });
  test("Crew with and without CII", () => {
    expect(teamRow(base({ name: "Sam Lee", workerRole: "crew" }), TODAY)).toEqual({ name: "Sam Lee", line: "Crew · CII ✓ ›", warn: false });
    expect(teamRow(base({ name: "Ali Khan", workerRole: "crew", cii: { certStatus: null, level: null, expiresOn: null } }), TODAY)).toEqual({ name: "Ali Khan", line: "Crew · needs CII certificate ›", warn: true });
    expect(teamRow(base({ workerRole: "crew", cii: { certStatus: "verified", level: "CII", expiresOn: "2026-01-01" } }), TODAY)).toEqual({ name: "Person", line: "Crew · needs CII certificate ›", warn: true }); // expired = not cleared
  });
  test("an installer row with no Lead/Crew recorded is Crew (worker-role rule: null = Crew, Jo 5 Nov 2026)", () => {
    expect(teamRow(base({ workerRole: null }), TODAY).line).toBe("Crew · CII ✓ ›");
  });
  test("Electrician with and without licence + REC", () => {
    expect(teamRow(base({ name: "Will Casdorff", role: "electrician", workerRole: null, cii: null, licenceAndRec: true }), TODAY)).toEqual({ name: "Will Casdorff", line: "Electrician · licence + REC ✓ ›", warn: false });
    expect(teamRow(base({ role: "electrician", workerRole: null, cii: null, licenceAndRec: false }), TODAY)).toEqual({ name: "Person", line: "Electrician · needs licence + REC check ›", warn: true });
  });
  test("missing date of birth and mobile are orange and end the line (DRAFT words)", () => {
    const r = teamRow(base({ hasDob: false }), TODAY);
    expect(r.line.endsWith("· needs date of birth ›")).toBe(true);
    expect(r).toEqual({ name: "Person", line: "Lead Installer · CII ✓ · ESC registered ✓ · needs date of birth ›", warn: true });
    expect(teamRow(base({ mobile: null }), TODAY)).toEqual({ name: "Person", line: "Lead Installer · CII ✓ · ESC registered ✓ · needs mobile ›", warn: true });
    expect(teamRow(base({ mobile: "  ", hasDob: false }), TODAY).line).toBe("Lead Installer · CII ✓ · ESC registered ✓ · needs date of birth · needs mobile ›");
    expect(teamRow(base({ role: "office", workerRole: null, cii: null, hasDob: false }), TODAY)).toEqual({ name: "Person", line: "Office · prices ✓ · Money: Off · needs date of birth ›", warn: true });
    // Unknown (the private table couldn't be read, or the boss has no staff row): nothing is claimed either way.
    expect(teamRow(base({ hasDob: null }), TODAY).warn).toBe(false);
  });
  test("the line never prints a date of birth — only has / missing", () => {
    for (const f of [base({}), base({ hasDob: false })]) expect(teamRow(f, TODAY).line).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2} \w{3} \d{4}/);
  });
});

describe("Add a person", () => {
  test("approved words", () => {
    expect(TEAM_INTRO).toBe("Everyone needs a date of birth and mobile. Lead Installers are registered with the ESC by Home Insulation Victoria.");
    expect(TEAM_WORDS.title).toBe("Team");
    expect(TEAM_WORDS.addPerson).toBe("Add a person");
  });
  test("roles, in order, with Lead Installer in full", () => {
    expect(ADD_PERSON_ROLES).toEqual(["office", "lead", "crew", "electrician"]);
    expect(ADD_PERSON_ROLES.map((r) => ADD_PERSON_ROLE_LABEL[r])).toEqual(["Office", "Lead Installer", "Crew", "Electrician"]);
  });
  test("mobile and date of birth are required for every role; electricians also need licence + REC", () => {
    const ok = { name: "Mia Chen", role: "office" as const, mobile: "0412 000 111", dateOfBirth: "1990-05-12", licenceNumber: "", recNumber: "" };
    for (const role of ADD_PERSON_ROLES) {
      const extra = role === "electrician" ? { licenceNumber: "A12345", recNumber: "REC 1234" } : {};
      expect(addPersonProblems({ ...ok, ...extra, role }, TODAY)).toEqual([]);
      expect(addPersonProblems({ ...ok, ...extra, role, mobile: "" }, TODAY)).toContain("Add their mobile number.");
      expect(addPersonProblems({ ...ok, ...extra, role, dateOfBirth: "" }, TODAY)).toContain("Add their date of birth for ESC registration.");
    }
    expect(addPersonProblems({ ...ok, role: "electrician" }, TODAY)).toEqual(["Add their electrical licence number.", "Add their REC number."]);
    expect(addPersonProblems({ ...ok, name: "M" }, TODAY)).toContain("Add their full name.");
    expect(addPersonProblems({ ...ok, dateOfBirth: TODAY }, TODAY)).toContain("Date of birth must be before today.");
  });
});

describe("Can see Money switch (boss only; Office rows)", () => {
  test("words", () => {
    expect(moneySwitchLine(true)).toBe("Money: On");
    expect(moneySwitchLine(false)).toBe("Money: Off");
    expect(TEAM_WORDS.canSeeMoney).toBe("Can see Money");
    expect(TEAM_WORDS.addDob).toBe("Add date of birth");
    expect(TEAM_WORDS.dobSaved).toBe("Date of birth on file ✓");
  });
});

describe("wiring (source checks)", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  test("the team view carries role office + the checks, and never a date of birth", () => {
    const core = src("src/lib/trade-view.core.ts");
    expect(core).toMatch(/role: "owner" \| "office" \| "installer" \| "electrician"/);
    expect(core).not.toContain("dateOfBirth");
    const srv = src("src/lib/trade-view.server.ts");
    expect(srv).toContain("export async function tradeSetMoneyAccess");
    expect(srv).toContain("set_member_can_see_money");
    expect(srv).toContain("add_team_person_with_identity");
    expect(srv).toContain("hasDob:");
    expect(srv).toContain("escRegistered:");
    expect(srv).toContain("licenceAndRec:");
    expect(srv).toContain("canSeeMoney:");
    expect(srv).not.toMatch(/dateOfBirth\s*:\s*births/); // the dates themselves never reach a trade screen
    const page = src("src/routes/_authenticated/field.business_.team.tsx");
    expect(page).not.toContain("m.dateOfBirth");
    expect(page).toContain("TEAM_INTRO");
    expect(page).toContain("teamRow(");
    expect(page).toContain("setTeamMoneyAccess");
    expect(page).not.toMatch(/\bHIV\b/);
    expect(page).not.toMatch(/\bfixes\b/i);
    expect(src("src/lib/trade-view.functions.ts")).toContain("export const setTeamMoneyAccess");
    // Task 10b: the boss can add a date of birth for an existing person; the sheet shows only on file / missing.
    expect(src("src/lib/trade-view.functions.ts")).toContain("export const setTeamMemberDob");
    expect(srv).toContain("set_worker_identity_dob");
    expect(page).toContain("setTeamMemberDob");
    expect(page).toContain("TEAM_WORDS.addDob");
    expect(page).not.toMatch(/\{m\.dateOfBirth|data\.dateOfBirth|hasDob\s*&&[^\n]*dateOfBirth/); // the saved date is never rendered (the add form's own input value is the only dateOfBirth on the page)
  });
});

describe("server: Money switch and Add a person go through the Task 1 RPCs (mocked database)", () => {
  type Call = { fn: string; args: Record<string, unknown> };
  const calls: Call[] = [];
  let rpcError: { code?: string; message: string } | null = null;
  let memberRole = "business_admin";
  const result = (table: string) => {
    if (table === "business_members") return { data: [{ business_id: "b1", member_role: memberRole, businesses: { id: "b1", name: "Test Biz", business_type: "eec_installer" } }], error: null };
    if (table === "user_roles") return { data: [{ role: "installer" }], error: null };
    if (table === "profiles") return { data: { full_name: "Boss Test" }, error: null };
    return { data: null, error: null };
  };
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => result(table);
    c.single = async () => result(table);
    c.then = (r: (v: unknown) => unknown) => Promise.resolve(result(table)).then(r);
    return c;
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => chain(t), rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcError ? { data: null, error: rpcError } : { data: "w1", error: null }; } } }));

  test("tradeSetMoneyAccess: boss → set_member_can_see_money; office login refused before any call; missing SQL = plain message", async () => {
    const { tradeSetMoneyAccess } = await import("../src/lib/trade-view.server");
    calls.length = 0; rpcError = null; memberRole = "business_admin";
    expect(await tradeSetMoneyAccess("u1", "w9", true)).toEqual({ ok: true, canSeeMoney: true });
    expect(calls).toEqual([{ fn: "set_member_can_see_money", args: { _business: "b1", _actor: "u1", _worker: "w9", _on: true } }]);
    calls.length = 0; memberRole = "office";
    await expect(tradeSetMoneyAccess("u1", "w9", true)).rejects.toThrow("Only the business owner can see this.");
    expect(calls).toEqual([]);
    memberRole = "business_admin"; rpcError = { code: "PGRST202", message: "function not found" };
    await expect(tradeSetMoneyAccess("u1", "w9", false)).rejects.toThrow("This setting isn't switched on yet. Home Insulation Victoria is finishing it; nothing has changed.");
    rpcError = { code: "P0001", message: "Office person not found" };
    await expect(tradeSetMoneyAccess("u1", "w9", true)).rejects.toThrow("This person doesn't have a portal login yet. Ask the office to send one first.");
  });
  test("tradeSetWorkerDob (Task 10b): boss → set_worker_identity_dob; refused for office logins and bad dates before any call; the answer never carries the date", async () => {
    const { tradeSetWorkerDob } = await import("../src/lib/trade-view.server");
    calls.length = 0; rpcError = null; memberRole = "business_admin";
    const r = await tradeSetWorkerDob("u1", "w9", "1988-02-29");
    expect(r).toEqual({ ok: true, hasDob: true });
    expect(JSON.stringify(r)).not.toContain("1988");
    expect(calls).toEqual([{ fn: "set_worker_identity_dob", args: { p_worker: "w9", p_dob: "1988-02-29", p_actor: "u1" } }]);
    calls.length = 0;
    await expect(tradeSetWorkerDob("u1", "w9", "2999-01-01")).rejects.toThrow("Date of birth must be before today.");
    await expect(tradeSetWorkerDob("u1", "w9", "")).rejects.toThrow("Add their date of birth for ESC registration.");
    memberRole = "office";
    await expect(tradeSetWorkerDob("u1", "w9", "1988-02-29")).rejects.toThrow("Only the business owner can see this.");
    expect(calls).toEqual([]);
    memberRole = "business_admin"; rpcError = { code: "PGRST202", message: "function not found" };
    await expect(tradeSetWorkerDob("u1", "w9", "1988-02-29")).rejects.toThrow("This setting isn't switched on yet. Home Insulation Victoria is finishing it; nothing has changed.");
    rpcError = { code: "P0001", message: "Team member not found" };
    await expect(tradeSetWorkerDob("u1", "w9", "1988-02-29")).rejects.toThrow("Team member not found.");
    rpcError = null;
  });
  test("tradeAddTeamPerson: every role goes to add_team_person_with_identity with the date of birth; refused without mobile or date of birth", async () => {
    const { tradeAddTeamPerson } = await import("../src/lib/trade-view.server");
    calls.length = 0; rpcError = null; memberRole = "business_admin";
    expect(await tradeAddTeamPerson("u1", { name: "Mia Chen", role: "office", mobile: "0412 000 111", email: null, dateOfBirth: "1990-05-12", licenceNumber: null, recNumber: null })).toEqual({ workerId: "w1" });
    // Go-live 5 Nov 2026: an electrician needs their Mitti email at Add (the safety check form is handed to them in Mitti).
    await expect(tradeAddTeamPerson("u1", { name: "Will Casdorff", role: "electrician", mobile: "0412 000 112", email: null, dateOfBirth: "1990-05-12", licenceNumber: "A12345", recNumber: "REC 1234" })).rejects.toThrow("Add their email — the safety check form goes to them in Mitti.");
    expect(await tradeAddTeamPerson("u1", { name: "Will Casdorff", role: "electrician", mobile: "0412 000 112", email: "will@sparks.example", dateOfBirth: "1990-05-12", licenceNumber: "A12345", recNumber: "REC 1234" })).toEqual({ workerId: "w1" });
    expect(calls.map((c) => [c.fn, c.args._role, c.args._mobile, c.args._dob, c.args._licence, c.args._rec])).toEqual([
      ["add_team_person_with_identity", "office", "+61412000111", "1990-05-12", null, null],
      ["add_team_person_with_identity", "electrician", "+61412000112", "1990-05-12", "A12345", "REC 1234"],
    ]);
    calls.length = 0;
    await expect(tradeAddTeamPerson("u1", { name: "Sam Lee", role: "crew", mobile: null, email: null, dateOfBirth: "1990-05-12", licenceNumber: null, recNumber: null })).rejects.toThrow("Add their Australian mobile, like 0412 345 678.") // #134 (Jo 3 Nov) wording runs first at the join;
    await expect(tradeAddTeamPerson("u1", { name: "Sam Lee", role: "crew", mobile: "0412 000 111", email: null, dateOfBirth: null, licenceNumber: null, recNumber: null })).rejects.toThrow("Add their date of birth for ESC registration.");
    expect(calls).toEqual([]);
    // Office / Electrician before the pending SQL is live: the existing message, no other write.
    rpcError = { code: "PGRST202", message: "function not found" };
    await expect(tradeAddTeamPerson("u1", { name: "Mia Chen", role: "office", mobile: "0412 000 111", email: null, dateOfBirth: "1990-05-12", licenceNumber: null, recNumber: null })).rejects.toThrow("Adding people needs the office's database update first (go-live step 2). Try again once it's done.");
    // 5 Nov 2026 (Tom, go-live morning): PostgREST's missing-function message lists the arguments (`_mobile` included) — it must
    // never read as "Add their mobile number." when the mobile was typed.
    rpcError = { code: "PGRST202", message: "Could not find the function public.add_team_person_with_identity(_actor, _business, _dob, _email, _licence, _mobile, _name, _rec, _role) in the schema cache" };
    await expect(tradeAddTeamPerson("u1", { name: "Will Casdorff", role: "electrician", mobile: "0473 541 226", email: "will@sparks.example", dateOfBirth: "1978-11-05", licenceNumber: "4556789", recNumber: "256678" })).rejects.toThrow("Adding people needs the office's database update first (go-live step 2). Try again once it's done.");
  });
});
