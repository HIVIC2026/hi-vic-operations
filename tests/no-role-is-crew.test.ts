// Jo 5 Nov 2026: an installer with no role (partner_workers.worker_role null) is Crew, not Lead. Reverses 29 Oct "null = Lead".
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { effectiveWorkerRole } from "../src/lib/worker-role.core";
import { groupPeople } from "../src/lib/person-approval.core";
import { teamRow } from "../src/lib/team-screen.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
const src = (p: string) => readFileSync(p, "utf8");

describe("no role = Crew", () => {
  test("effectiveWorkerRole", () => {
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: null })).toBe("crew");
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: "lead" })).toBe("lead");
    expect(effectiveWorkerRole({ tradeRole: "electrician", stored: null })).toBeNull();
  });
  test("People list groups a null installer under Crew", () => {
    const g = groupPeople([{ id: "a", role: "installer", workerRole: null }, { id: "b", role: "installer", workerRole: "lead" as const }]);
    expect(g.find((x) => x.key === "crew")!.people.map((p) => p.id)).toEqual(["a"]);
    expect(g.find((x) => x.key === "lead")!.people.map((p) => p.id)).toEqual(["b"]);
  });
  test("Team row shows Crew for a missing role, even when the field is absent", () => {
    const base = { name: "P", role: "installer" as const, mobile: "0412000111", cii: null, hasDob: true, escRegistered: false } as never;
    expect(teamRow({ ...(base as object), workerRole: null } as never, "2026-11-05").line.startsWith("Crew")).toBe(true);
    expect(teamRow({ ...(base as object) } as never, "2026-11-05").line.startsWith("Crew")).toBe(true);
  });
  test("decision record says null reads as crew", () => {
    expect(WORKFLOW_DECISIONS.partnerPeople.leadCrew.nullReadsAs).toBe("crew");
  });
  test("no caller still defaults a missing role to lead", () => {
    expect(src("src/lib/worker-links.functions.ts")).not.toContain('?? "lead"');
    expect(src("src/lib/people-on-file.server.ts")).not.toContain('worker_role !== "crew"');
    expect(src("src/lib/team-screen.core.ts")).not.toContain('workerRole !== "crew"');
    expect(src("src/lib/trade-view.server.ts")).not.toContain('p.workerRole ?? "lead"');
  });
  test("every path that creates an installer stores an explicit role (Crew unless it is the owner row)", () => {
    expect(src("src/lib/worker-invite.functions.ts")).toMatch(/worker_role: t === "installer" \? "crew" : null/);
    expect(src("src/lib/worker-links.functions.ts")).toContain('{ worker_role: "crew" }');
    expect(src("src/lib/qa-access.server.ts")).toContain('worker_role: "crew"');
    expect(src("src/lib/journey-setup.server.ts")).toMatch(/trade_role: "installer"[^}]*worker_role: "lead"/); // the business owner row is the Lead
  });
  test("docs and agent rules no longer state null = Lead", () => {
    expect(src("src/lib/AGENTS.md")).not.toMatch(/null = Lead/);
    expect(src("src/lib/AGENTS.md")).toContain("no role = Crew");
    expect(src("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md")).toContain("- No role set = Crew");
  });
});
