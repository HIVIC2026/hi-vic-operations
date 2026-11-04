// New job flow, Part 6, Task 8: electricians never log in — the electrician sign-in surfaces are gone. Each job reaches
// an electrician as one no-login link (/e/<token>). An existing electrician login that still reaches the portal sees one
// plain line, never a blank page. Installer and business-admin logins are untouched.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NO_LOGIN_NEEDED } from "../src/lib/trade-access-role.core";
import { grantedRole, tradeAccessBlocker } from "../src/lib/trade-access.core";

const read = (p: string) => readFileSync(p, "utf8");

describe("the trade area for an electrician-only login", () => {
  const route = read("src/routes/_authenticated/field.tsx");
  test("/field (and everything under it, Money included): an electrician-only user gets the plain no-login line, never a blank page or a redirect loop", () => {
    expect(route).toContain("a.electrician && !a.installer && !a.admin");
    expect(route).toContain('lazy(() => import("@/components/trade/FieldLayout"))');
    const layout = read("src/components/trade/FieldLayout.tsx");
    expect(layout).toContain("a.electrician && !a.installer && !a.admin");
    expect(layout).toContain("NO_LOGIN_NEEDED");
    expect(layout).toContain("data-no-login");
    expect(layout).toContain("Sign out");
    // Join 4 Nov 2026: Part 5's layout (server noLogin) with this rule OR'd in.
    expect(layout).toContain("if (data?.noLogin !== true && !electricianOnly) return <Outlet />;");
    // The role gate itself is unchanged: installers, business admins (installer role) and office admins still get the screens.
    expect(route).toContain("if (!(a.admin || a.installer || a.electrician)) throw redirect({ to: \"/home\" });");
    expect(read("src/routes/_authenticated/field.money.tsx")).toContain('createFileRoute("/_authenticated/field/money")');
  });
  test("the wording is one plain DRAFT line, the same string Part 5 uses", () => {
    expect(NO_LOGIN_NEEDED).toBe("You don't need to sign in. Your jobs come to you by text.");
  });
});

describe("the electrician screens are gone", () => {
  test("field.$jobId.tsx: no ElectricianFlow / OtherItems; an electrician role sees the plain line; the installer flow is untouched", () => {
    const page = read("src/routes/_authenticated/field.$jobId.tsx");
    for (const gone of ["function ElectricianFlow", "function OtherItems", "<ElectricianFlow", "<OtherItems", 'which="piesa"', "ElectricianPiesaTimesCard", "completeAssessment", "addOtherRectItem"]) expect(page).not.toContain(gone);
    expect(page).toContain("InstallerFlow");
    expect(page).toContain('role === "installer"');
    expect(page).toContain("NO_LOGIN_NEEDED");
  });
  test("field.index.tsx: no electrician home (Needs me / Your move / Taking a while tiles); the installer home is untouched", () => {
    const page = read("src/routes/_authenticated/field.index.tsx");
    for (const gone of ["electricianYourJobs", "ELECTRICIAN_WORK_WORDS", '"Needs me"', "Your move", "data-work-tiles", "data-your-jobs"]) expect(page).not.toContain(gone);
    // Join 4 Nov 2026: the installer home is Part 5's My work (JobCard / data-my-work), not the M1 groups.
    for (const kept of ["JobCard", "data-my-work", 'data.kind === "installer"']) expect(page).toContain(kept);
    expect(page).toContain("NO_LOGIN_NEEDED");
  });
  test("field.guide.tsx: no electrician guide (Part 5 Task 11 retired the installer guide too: the route redirects to My work)", () => {
    const page = read("src/routes/_authenticated/field.guide.tsx");
    for (const gone of ["ElectricianGuide", "ELECTRICIAN_GUIDE_STEPS", "ELECTRICIAN_GUIDE_WORDS", "GUIDE_STEPS.map"]) expect(page).not.toContain(gone);
    expect(page).toContain('redirect({ to: "/field"');
  });
  test("trade-view.core.ts: the electrician guide and work words are gone (and so is the installer guide, Part 5 Task 11)", async () => {
    const core = read("src/lib/trade-view.core.ts");
    for (const gone of ["export const ELECTRICIAN_GUIDE_STEPS", "export const ELECTRICIAN_GUIDE_WORDS", "ELECTRICIAN_WORK_WORDS", "export const GUIDE_STEPS"]) expect(core).not.toContain(gone);
    const m = await import("../src/lib/trade-view.core");
    expect("GUIDE_STEPS" in m).toBe(false);
  });
  test("w.$token.tsx: no rate box, no 'fixes'; the two rectification server functions are gone", () => {
    const page = read("src/routes/w.$token.tsx");
    expect(page).not.toMatch(/fixes/i);
    for (const gone of ["getWorkerApprovedRectificationRates", "addWorkerApprovedRectificationItem", "approvedRates"]) expect(page).not.toContain(gone);
    const fns = read("src/lib/worker-links.functions.ts");
    for (const gone of ["getWorkerApprovedRectificationRates", "addWorkerApprovedRectificationItem"]) expect(fns).not.toContain(gone);
    // G8 (3), Jo 4 Nov 2026 21:45: the /w/ page is RETIRED (no worker pages or logins) — it reads nothing; the two server
    // functions stay for history / the QA launcher only.
    for (const kept of ["getWorkerJobView", "postWorkerMessage"]) expect(fns).toContain(kept);
    expect(page).not.toContain("useServerFn("); // the page calls nothing
    expect(page).toContain("data-worker-link-retired");
  });
  test("the sign-in page no longer says 'and electricians'", () => {
    expect(read("src/routes/portal.tsx")).not.toContain("and electricians");
  });
});

describe("the /w/ worker link (installers' crew) never serves an electrician", () => {
  test("resolveLink refuses an electrician's token with the switched-off message; the dead electrician branch is gone", () => {
    const fns = read("src/lib/worker-links.functions.ts");
    const resolve = fns.slice(fns.indexOf("async function resolveLink"), fns.indexOf("export const getWorkerJobView"));
    expect(resolve).toContain('w.trade_role === "electrician"');
    expect(resolve).toContain("This link has been switched off. Ask your company for a new one.");
    const view = fns.slice(fns.indexOf("export const getWorkerJobView"), fns.indexOf("export const postWorkerMessage"));
    expect(view).not.toContain('w.trade_role === "electrician"');
  });
});

describe("no electrician ever gets a sign-in", () => {
  const w = { email: "a@b.com", approval_status: "approved", removed_at: null, trade_role: "installer", certification_status: "verified" };
  test("tradeAccessBlocker: an electrician is told no login is needed; installers unchanged", () => {
    expect(tradeAccessBlocker({ ...w, trade_role: "electrician" }, true)).toBe(NO_LOGIN_NEEDED);
    expect(tradeAccessBlocker({ ...w, trade_role: "electrician", profile_id: "p1" }, true)).toBe(NO_LOGIN_NEEDED); // even an old linked login
    // Part 5 Task 1 (join): Lead Installers and Crew get no NEW login either; one already linked stays recoverable.
    expect(tradeAccessBlocker(w, true)).toBe(NO_LOGIN_NEEDED);
    expect(tradeAccessBlocker({ ...w, profile_id: "p1" }, true)).toBeNull();
  });
  test("grantedRole only ever grants installer", () => {
    expect(grantedRole("installer")).toBe("installer");
    expect(grantedRole("electrician")).toBe("installer");
  });
});

describe("untouched", () => {
  test("electrician business onboarding and the office approval screens stay", () => {
    expect(read("src/routes/electrician-onboarding.tsx")).toContain("createFileRoute");
    expect(read("src/lib/worker-links.core.ts")).toContain("hashToken");
    expect(read("src/lib/electrician-link.server.ts")).toContain("mintElectricianLink");
  });
  test("the two workflow docs say it", () => {
    expect(read("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md")).toContain("Electricians never log in; each job is one no-login link");
    expect(read("src/config/workflow-decisions.ts")).toContain("Electricians never log in; each job is one no-login link");
  });
});
