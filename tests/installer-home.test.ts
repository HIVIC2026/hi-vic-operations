// Installer My work (approved mock-up M1, decision 198): one group and one "Next:" line per job, from facts only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRESS_COMPLETE_LINE, QUOTE_ACCEPTED_LINE, QUOTE_DECLINED_LINE, QUOTE_HELD_LINE, QUOTE_SENT_LINE } from "../src/lib/installer-quote-status.core";
import { comingForInstaller, doneLine, doneSub, exactTime, installerHomeGroups, installerNext, monthStripWords, needsFinishingItems, offerPanelWords, sourceLabel, type InstallerHomeJob } from "../src/lib/installer-home.core";

const job = (o: Partial<InstallerHomeJob>): InstallerHomeJob => ({
  jobId: "j", jobNumber: "HV-3066", street: "5 Somerset Court, Mulgrave", suburb: "Mulgrave", channel: "installer_sourced", stage: "ready_check_ready_to_schedule",
  place: "moving", placeTitle: null, nextAction: null, quoteLine: null, status: null, upcoming: null, installDeadline: null, endedAt: null, ...o,
});

describe("source label (decision 48)", () => {
  test("quiet grey words, never the installer's business name", () => {
    expect(sourceLabel("installer_sourced")).toBe("Your customer");
    expect(sourceLabel("hivic_sourced")).toBe("Home Insulation Victoria lead");
    expect(sourceLabel(null)).toBeNull();
  });
});

describe("Next: line — the installer's own task first (Action needed)", () => {
  test("missing Mitti basics → finish the Mitti form (… missing)", () => {
    expect(needsFinishingItems("Needs finishing: price on the Mitti form")).toBe("price");
    expect(needsFinishingItems("Needs finishing: price, owner mobile/email/permission on the Mitti form")).toBe("price and owner details");
    expect(needsFinishingItems("Needs finishing: ceiling area, insulation product on the Mitti form")).toBe("ceiling area and insulation product");
    expect(needsFinishingItems("Owner to book Ready Check")).toBeNull();
    expect(installerNext(job({ nextAction: "Needs finishing: price on the Mitti form" }))).toEqual({ group: "action", next: "Next: finish the Mitti form (price missing)" });
  });
  test("own job waiting for its Ready Check day → enter the Ready Check day; a lead → offer 3 times", () => {
    const own = job({ place: "needs_me", placeTitle: "Book the Ready Check with the owner" });
    expect(installerNext(own)).toEqual({ group: "action", next: "Next: enter the Ready Check day" });
    expect(installerNext({ ...own, channel: "hivic_sourced" }).next).toBe("Next: offer the owner 3 Ready Check times");
  });
  test("install days: offer 3 by the 30-day deadline when known", () => {
    const j = job({ channel: "hivic_sourced", stage: "installation_scheduling", place: "needs_me", placeTitle: "Book the install with the owner", installDeadline: "2026-11-21" });
    expect(installerNext(j)).toEqual({ group: "action", next: "Next: offer 3 install days by 21 Nov" });
    expect(installerNext({ ...j, installDeadline: null }).next).toBe("Next: offer 3 install days");
  });
  test("prepared quote: press Complete in Mitti is the installer's move", () => {
    expect(installerNext(job({ quoteLine: PRESS_COMPLETE_LINE }))).toEqual({ group: "action", next: "Next: press Complete in Mitti when the Ready Check is finished" });
  });
  test("other installer tasks", () => {
    expect(installerNext(job({ place: "needs_me", placeTitle: "Do the Ready Check and fill in the form" })).next).toBe("Next: do the Ready Check and fill in the Mitti form");
    expect(installerNext(job({ place: "needs_me", placeTitle: "Install and add the photos" })).next).toBe("Next: install and press Complete in Mitti");
    expect(installerNext(job({ place: "needs_me", placeTitle: "2 photos missing" })).next).toBe("Next: add the 2 missing install photos in Mitti");
    expect(installerNext(job({ place: "needs_me", placeTitle: "Reply to the owner's suggested time" })).next).toBe("Next: reply to the owner's suggested time");
  });
});

describe("Next: line — nothing for the installer yet (In progress)", () => {
  test("booked visit: exact day and arrival time, never a window (decision 43)", () => {
    const j = job({ place: "coming_up", upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } });
    expect(installerNext(j)).toEqual({ group: "coming", next: "Next: install Tue 27 Oct at 8:00am" });
    expect(installerNext(job({ place: "coming_up", upcoming: { what: "Ready Check", start: "2026-10-25T20:30:00Z" } })).next).toBe("Next: Ready Check Mon 26 Oct at 7:30am");
    expect(exactTime("2026-10-26T21:00:00Z")).toBe("8:00am");
  });
  test("quote with the owner / office / declined", () => {
    expect(installerNext(job({ quoteLine: QUOTE_SENT_LINE }))).toEqual({ group: "progress", next: "Next: nothing yet — owner has the quote" });
    expect(installerNext(job({ quoteLine: QUOTE_HELD_LINE })).next).toBe("Next: nothing yet — office is checking the quote");
    expect(installerNext(job({ quoteLine: QUOTE_DECLINED_LINE })).next).toBe("Next: nothing yet — owner declined the quote");
    expect(installerNext(job({ quoteLine: QUOTE_ACCEPTED_LINE, stage: "measured_quote_accepted" })).next).toBe("Next: nothing yet — owner's safety check comes first");
  });
  test("whose move it is, by stage", () => {
    expect(installerNext(job({ stage: "ready_check_ready_to_schedule", status: { text: "Owner choosing Ready Check times", who: "Owner" } })).next).toBe("Next: nothing yet — owner is choosing a Ready Check time");
    expect(installerNext(job({ stage: "ready_check_complete" })).next).toBe("Next: nothing yet — office is checking your Ready Check");
    expect(installerNext(job({ stage: "measured_estimate_ready" })).next).toBe("Next: nothing yet — owner has the quote");
    expect(installerNext(job({ stage: "piesa_scheduled", placeTitle: "Waiting for the electrician" })).next).toBe("Next: nothing yet — electrician's safety check first");
    expect(installerNext(job({ stage: "ap_review" })).next).toBe("Next: nothing yet — office is checking the install photos");
    expect(installerNext(job({ stage: "ready_for_veec", status: { text: "Paid to you Fri 2 Oct", who: null } })).next).toBe("Next: nothing — paid to you Fri 2 Oct");
    expect(installerNext(job({ stage: "on_hold" })).next).toBe("Next: nothing yet — on hold while the office reviews it");
  });
  test("every line starts with Next: and never carries a price", () => {
    for (const stage of ["ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete", "measured_estimate_ready", "measured_quote_accepted", "awaiting_deposit_payment", "piesa_and_install_window_pending", "piesa_complete", "rectification_required", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec", "on_hold", "something_new"]) {
      for (const place of ["moving", "needs_me", "coming_up"] as const) {
        const n = installerNext(job({ stage, place, placeTitle: place === "needs_me" ? "Book the install with the owner" : null, upcoming: place === "coming_up" ? { what: "Install", start: "2026-10-26T21:00:00Z" } : null }));
        expect(n.next.startsWith("Next: ")).toBe(true);
        expect(n.next).not.toMatch(/\$|margin|quoted price/i);
        expect(["action", "coming", "progress"]).toContain(n.group);
      }
    }
  });
});

describe("groups: every job in exactly one; Done only from a final stage", () => {
  test("action / progress / done, offers left to the offer panel", () => {
    const g = installerHomeGroups([
      job({ jobId: "a", nextAction: "Needs finishing: price on the Mitti form" }),
      job({ jobId: "b", place: "coming_up", upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } }),
      job({ jobId: "c", stage: "complete", endedAt: "2026-10-16T03:00:00Z" }),
      job({ jobId: "d", place: "offers", placeTitle: "New job offer" }),
      job({ jobId: "e", stage: "ready_for_veec", nextAction: null }),
    ]);
    expect(g.action.map((r) => r.jobId)).toEqual(["a"]);
    expect(g.coming.map((r) => r.jobId)).toEqual(["b"]);
    expect(g.progress.map((r) => r.jobId)).toEqual(["e"]);
    expect(g.done.map((r) => r.jobId)).toEqual(["c"]);
    const all = [...g.action, ...g.coming, ...g.progress, ...g.done].map((r) => r.jobId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("d");
  });
  test("a job whose basics are missing stays Action needed even with a booked visit (Jo 23 Oct)", () => {
    expect(installerNext(job({ place: "coming_up", nextAction: "Needs finishing: price on the Mitti form", upcoming: { what: "Ready Check", start: "2026-10-26T21:00:00Z" } })).group).toBe("action");
  });
  test("done rows", () => {
    expect(doneLine("complete", "2026-10-16T03:00:00Z")).toBe("Job complete 16 Oct");
    expect(doneLine("cancelled", null)).toBe("Cancelled");
    expect(doneSub("installer_sourced", "complete", "2026-10-16T03:00:00Z")).toBe("Your customer · Job complete 16 Oct");
    expect(doneSub("hivic_sourced", "complete", "2026-10-09T03:00:00Z")).toBe("Home Insulation Victoria lead · Job complete 9 Oct");
  });
});

describe("one job, one list (B1)", () => {
  test("action beats coming up", () => {
    const g = installerHomeGroups([job({ jobId: "a", place: "coming_up", nextAction: "Needs finishing: price on the Mitti form", upcoming: { what: "Ready Check", start: "2026-10-26T21:00:00Z" } })]);
    expect(g.action.map((r) => r.jobId)).toEqual(["a"]);
    expect(g.coming).toEqual([]);
  });
  test("comingForInstaller keeps only Coming up rows", () => {
    const g = installerHomeGroups([
      job({ jobId: "b", place: "coming_up", upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } }),
      job({ jobId: "h", place: "coming_up", quoteLine: QUOTE_HELD_LINE, upcoming: { what: "Install", start: "2026-10-26T21:00:00Z" } }),
    ]);
    expect(g.progress.map((r) => r.jobId)).toEqual(["h"]);
    const visits = [{ jobId: "b", start: "x" }, { jobId: "h", start: "y" }, { jobId: "z", start: "w" }];
    expect(comingForInstaller(visits, g)).toEqual([{ jobId: "b", start: "x" }]);
  });
});

describe("offer panel and This month strip words", () => {
  test("offer panel", () => {
    expect(offerPanelWords({ suburb: "Glen Waverley", areaM2: 120 }, 1)).toEqual({ eyebrow: "1 new job offer", title: "Ready Check in Glen Waverley", detail: "Owner says ~120 m² · Home Insulation Victoria lead" });
    expect(offerPanelWords({ suburb: null, areaM2: null }, 2)).toEqual({ eyebrow: "2 new job offers", title: "Ready Check in Victoria", detail: "No size yet · Home Insulation Victoria lead" });
  });
  test("This month: own pay only, installs done and paid", () => {
    expect(monthStripWords({ jobs: 4, paid: 6840 })).toEqual({ installs: "4 installs done", paid: "$6,840 paid" });
    expect(monthStripWords({ jobs: 1, paid: 0 })).toEqual({ installs: "1 install done", paid: "$0 paid" });
  });
});

describe("screen files follow the mock-ups and the audit removals", () => {
  test("My work: no windows, no first-to-accept, no intake Q&A, no Add a job button, no bulk upload, groups from the pure core", () => {
    const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8");
    for (const gone of ["8–10am", "first to accept", "Quoted?", "Site check?", "InstallerFactsLine", "SourceBadge", "bulk-import", "Upload multiple jobs", "PlusCircle", "Installer customer"]) expect(page).not.toContain(gone);
    for (const kept of ["installer-home.core", "data-my-work", "Coming up", "This month", "View offer", 'to="/field/money"']) expect(page).toContain(kept);
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).not.toMatch(/intakeQuoteAnswers|installer_quoted|o\.kind === "ready_check" \|\| o\.kind === "installer"/);
  });
  test("Add a job: one screen, picked address, permission tick, optional visit, one Add job button, no bulk link or electrician choice", () => {
    const flow = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
    const fields = readFileSync("src/components/trade/customer-fields.tsx", "utf8");
    const route = readFileSync("src/routes/_authenticated/partner.import.tsx", "utf8");
    expect(fields).toContain("✓ Address found");
    expect(fields).toContain("<VerifiedAddressInput");
    for (const gone of ["ElectricianPicker", "bulk-import", "Review & save", "Who organises"]) { expect(flow).not.toContain(gone); expect(route).not.toContain(gone); }
    expect(route).not.toContain("INSTALLER_BULK_UPLOAD_ENABLED");
    expect((flow.match(/PRIMARY_BTN/g) ?? []).length).toBeGreaterThan(0);
  });
});
