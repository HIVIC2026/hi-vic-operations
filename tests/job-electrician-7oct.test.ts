import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_INVITED_LABEL, OWNER_CONTACT_PERMISSION, SAFETY_CHECK_NOTE, existingElectricianInviteBlocker, electricianInviteEmail, electricianPlanBlocker, firstOfferedElectrician, jobElectricianLabel, newElectricianProblems, usualElectrician, visitedFromEvidence } from "../src/lib/job-electrician.core";
import { officeEmailBlocker, officeEmailTo } from "../src/lib/office-email.core";
import { CONTACT_PERMISSION_WORDING } from "../src/lib/bulk-import.core";
import { ONE_JOB_PERMISSION_WORDING } from "../src/lib/pilot.core";
import { nextOfferBatch, type RecCandidate } from "../src/lib/allocation.core";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Jo 7 Oct: Add one job + each Upload jobs card", () => {
  test("owner consent wording is Jo's exact text everywhere", () => {
    expect(OWNER_CONTACT_PERMISSION).toBe("The owner has given Home Insulation Victoria permission to contact them.");
    expect(CONTACT_PERMISSION_WORDING).toBe(OWNER_CONTACT_PERMISSION);
    expect(ONE_JOB_PERMISSION_WORDING).toBe(OWNER_CONTACT_PERMISSION);
  });
  test("safety check note is Jo's approved wording, shown under the choice", () => {
    expect(SAFETY_CHECK_NOTE).toBe("Once the owner accepts the quote and pays the $349 Pre Insulation Electrical Safety Assessment (PIESA), they'll choose 3 days and times that suit them. These go to the electrician to accept, and the booking updates in the job automatically so everyone can see it.");
    expect(read("src/components/trade/job-intake.tsx")).toContain("{SAFETY_CHECK_NOTE}");
  });
  test("My electrician needs a pick; Home Insulation Victoria arranges never blocks", () => {
    expect(electricianPlanBlocker({ mode: "mine" })).toBe("Choose your electrician");
    expect(electricianPlanBlocker({ mode: "mine", business_id: "b" })).toBeNull();
    expect(electricianPlanBlocker({ mode: "mine", nomination_id: "n" })).toBeNull();
    expect(electricianPlanBlocker({ mode: "hivic" })).toBeNull();
  });
  test("usual electrician is preselected (Main first)", () => {
    expect(usualElectrician([{ businessId: "a" }, { businessId: "b", primary: true }])?.businessId).toBe("b");
    expect(usualElectrician([{ businessId: "a" }])?.businessId).toBe("a");
    expect(usualElectrician([])).toBeNull();
  });
  test("new electrician needs name, business, mobile and email", () => {
    expect(newElectricianProblems({ name: "", business: "", mobile: "1", email: "x" })).toEqual(["Add their name", "Add their business", "Add their mobile", "Add their email"]);
    expect(newElectricianProblems({ name: "Sam Spark", business: "Spark Co", mobile: "0400 000 000", email: "sam@spark.com.au" })).toEqual([]);
  });
  test("unsent electrician nomination may issue its first invitation", () => {
    expect(existingElectricianInviteBlocker({ status: "invite_pending_comms", sentAt: null, attempted: false })).toBeNull();
  });
  test("sent or ambiguous electrician invitation must not send again", () => {
    expect(existingElectricianInviteBlocker({ status: "invited", sentAt: "2026-10-08", attempted: true })).toContain("already been sent");
    expect(existingElectricianInviteBlocker({ status: "invite_pending_comms", sentAt: null, attempted: true })).toContain("office check");
    expect(existingElectricianInviteBlocker({ status: "invite_pending_comms", sentAt: null, issuedAt: "2026-10-08T09:00:00Z", attempted: false })).toContain("office check");
  });
  test("job label: invited until approved", () => {
    expect(jobElectricianLabel({ choice: "nominated", invitedName: "Sam" })).toBe(ELECTRICIAN_INVITED_LABEL);
    expect(jobElectricianLabel({ choice: "preferred", chosenName: "Spark Co" })).toBe("Your electrician: Spark Co");
    expect(jobElectricianLabel({ choice: "hivic_organise" })).toBe("Home Insulation Victoria arranges");
    expect(jobElectricianLabel({ choice: "preferred", chosenName: "Spark Co", assignedName: "Spark Co" })).toBe("Electrician: Spark Co");
  });
  test("invite email carries the electrician application link and the installer's name", () => {
    const m = electricianInviteEmail({ electricianName: "Sam", installerName: "Reinsulate", link: "https://estimate.homeinsulationvictoria.com.au/electrician-onboarding?invite=abc" });
    expect(m.subject).toContain("Reinsulate");
    expect(m.message).toContain("/electrician-onboarding?invite=abc");
    expect(m.message).toContain("Home Insulation Victoria");
  });
  test("invite follows the manual-email rule: a partner email sends; automated/homeowner still blocked; TEST → Jo's inbox", () => {
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "partner", to: "sam@spark.com.au", message: "hi" })).toBeNull();
    expect(officeEmailBlocker({ origin: "automated" as never, recipient: "partner", to: "sam@spark.com.au", message: "hi" })).not.toBeNull();
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "homeowner", to: "o@x.com", message: "hi" })).not.toBeNull();
    expect(officeEmailTo("sam@spark.com.au", true)).toBe("jolowexo@hotmail.com");
    expect(officeEmailTo("Sam@Spark.com.au", false)).toBe("sam@spark.com.au");
  });
  test("the installer's chosen electrician is offered the owner's times first, alone; otherwise normal batches", () => {
    expect([...firstOfferedElectrician("chosen", ["p1", "p2"])]).toEqual(["chosen"]);
    expect([...firstOfferedElectrician(null, ["p1"])]).toEqual(["p1"]);
    const c = (id: string, preferred = false) => ({ business_id: id, name: id, preferred }) as unknown as RecCandidate;
    expect(nextOfferBatch([c("chosen", true), c("x"), c("y")], new Set(), 3, { installerSourced: true }).map((x) => x.business_id)).toEqual(["chosen"]);
    expect(nextOfferBatch([c("chosen", true), c("x"), c("y")], new Set(["chosen"]), 3, { installerSourced: true }).map((x) => x.business_id)).toEqual(["x", "y"]);
  });
  test("photos or a measurement still mean Visited", () => {
    expect(visitedFromEvidence({ files: [{ name: "IMG_1.jpg" }] })).toBe(true);
    expect(visitedFromEvidence({ files: [{ name: "x", type: "image/heic" }] })).toBe(true);
    expect(visitedFromEvidence({ files: [{ name: "quote.pdf" }], measuredArea: 120 })).toBe(true);
    expect(visitedFromEvidence({ files: [{ name: "quote.pdf" }] })).toBe(false);
  });
  test("server: chosen electrician is never auto-assigned; consent and choice checked on confirm; switch to Home Insulation Victoria", () => {
    const team = read("src/lib/teaming.server.ts"); expect(team).toContain('.eq("job_id", jobId).is("ended_at", null);\n  if (chosen) return false;');
    const imp = read("src/lib/partner-import.server.ts"); expect(imp).toContain("electricianPlanBlocker"); expect(imp).toContain("recordJobElectricianChoice"); expect(imp).toContain("contact_permission !== true");
    const bulk = read("src/lib/bulk-import.server.ts"); expect(bulk).toContain("recordJobElectricianChoice"); expect(bulk).not.toContain('role: "electrician", business_id: plan.business_id');
    const je = read("src/lib/job-electrician.server.ts"); expect(je).toContain("An electrician has already accepted this job"); expect(read("src/lib/job-electrician-invite.server.ts")).toContain('recipient: "partner"');
  });
  test("pages: camera + files with remove, consent tick required, three electrician options", () => {
    const ui = read("src/components/trade/job-intake.tsx");
    for (const t of ['capture="environment"', "Take photo", "Choose files", "Remove ${f.name}", "My electrician", "+ Add another electrician", "Home Insulation Victoria arranges"]) expect(ui).toContain(t);
    // Decision 34 (Jo 24 Oct): Add a job is basics only — the consent tick is sent with the customer; no files or electrician picker there.
    const one = read("src/components/trade/add-job-flow.tsx");
    expect(one).toContain("owner: customer"); expect(one).not.toContain("<AttachFiles"); expect(one).not.toContain("<ElectricianPicker");
  });
});
