import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFICE_HEADINGS, sectionFor } from "../src/lib/office-nav";
import { TEMPLATE_ENTRIES, TEMPLATE_STANDING, entriesFor, parseTemplateSearch, selectTemplate, templateStanding } from "../src/lib/template-hub.core";
import { PARTNER_TEMPLATES, renderPartnerTemplate } from "../src/lib/partner-templates";
import { INSTALLER_INVITATION_HTML } from "../src/lib/installer-invitation.html";

describe("Templates navigation", () => {
  test("one Templates heading among the five primary workspaces", () => {
    expect(OFFICE_HEADINGS.map((h) => h.key)).toEqual(["enquiries", "active", "closed", "communications", "templates"]);
    expect(sectionFor("/admin/templates", { cat: "mitti" })).toBe("templates");
    expect(sectionFor("/admin/communications")).toBe("communications");
    expect(sectionFor("/admin/compliance")).toBe("more");
    expect(OFFICE_HEADINGS.filter((h) => h.label === "Templates").length).toBe(1);
  });
  test("standing separates approved, draft, reference and historical wording", () => {
    expect(TEMPLATE_STANDING.map((s) => s.key)).toEqual(["approved", "draft", "reference", "historical"]);
    const jo = TEMPLATE_ENTRIES.find((e) => e.group.startsWith("Jo's approved"))!;
    expect(templateStanding(jo)).toBe("approved");
    expect(templateStanding(TEMPLATE_ENTRIES.find((e) => e.group === "Customer emails")!)).toBe("historical");
    expect(templateStanding(TEMPLATE_ENTRIES.find((e) => e.id === "email:rec_invitation")!)).toBe("draft");
    expect(templateStanding(TEMPLATE_ENTRIES.find((e) => e.view.kind === "compliance_template")!)).toBe("reference");
  });
});

describe("Template selection", () => {
  test("unique ids; every category has entries; unknown or cross-category id falls back to first", () => {
    expect(new Set(TEMPLATE_ENTRIES.map((e) => e.id)).size).toBe(TEMPLATE_ENTRIES.length);
    for (const c of ["email", "mitti", "compliance"] as const) expect(entriesFor(c).length).toBeGreaterThan(0);
    expect(selectTemplate("mitti", "email:save_my_spot").category).toBe("mitti");
    // P1-S77: a retired id (superseded Save-your-spot copy) is no longer listed and falls back to Jo's first template.
    expect(selectTemplate("email", "email:save_my_spot_no_size").title).toBe("Eligible — no existing insulation (size unknown)");
    expect(parseTemplateSearch({ cat: "bogus" })).toEqual({ cat: "email" });
    // Standing must survive parsing so `/admin/templates?standing=historical` is not rewritten.
    expect(parseTemplateSearch({ cat: "mitti", standing: "historical" })).toEqual({
      cat: "mitti",
      standing: "historical",
    });
    expect(parseTemplateSearch({ standing: "approved" })).toEqual({
      cat: "email",
      standing: "approved",
    });
  });
  test("Mitti has A1, A2, B, C; PIESA/PIISA register entries cross-reference Mitti, not editable copies", () => {
    expect(entriesFor("mitti").map((e) => e.id).sort()).toEqual(["mitti:piesa", "mitti:piisa", "mitti:ready_check", "mitti:ready_check_priced"]);
    const piesa = entriesFor("compliance").find((e) => e.title.includes("(PIESA)"))!;
    expect(piesa.view).toMatchObject({ kind: "register", mitti: ["piesa"] });
    expect(entriesFor("compliance").some((e) => e.view.kind === "compliance_template" && e.view.templateKey === "piesa")).toBe(false);
  });
  test("no metadata invents approval for unknown records", () => {
    const rec = TEMPLATE_ENTRIES.find((e) => e.id === "email:rec_invitation")!;
    expect(rec.approval).toBe("Not recorded");
    // P1-S77: superseded entries are removed, not relabelled; Jo's seven carry her recorded approval.
    expect(TEMPLATE_ENTRIES.find((e) => e.id === "email:save_my_spot_no_size")).toBeUndefined();
    expect(TEMPLATE_ENTRIES.find((e) => e.id === "email:insulation_details")).toBeUndefined();
    for (const e of TEMPLATE_ENTRIES.filter((x) => x.id.startsWith("email:jo:"))) expect(e.approval).toBe("Approved by Jo Lowe, 15 Oct 2026");
    for (const entry of entriesFor("mitti")) expect(entry.approval).toBe("Not recorded");
  });
  test("email inventory distinguishes exact builders, stored reviews and original tool", () => {
    const emails = entriesFor("email");
    // Jo's 7 homeowner enquiry emails (T8 retired 24 Oct 2026) + 2 customer emails outside her set (3-day reminder,
    // area unavailable) + 6 partner emails = 15. The five later-stage review-only placeholders were removed on 24 Oct
    // 2026 (replaced by approved designs O18, O35, O28, P4, O47). Nothing links to a legacy tool any more.
    expect(emails.length).toBe(15);
    expect(emails.filter((e) => e.view.kind === "jo_sample").length).toBe(7);
    expect(emails.filter((e) => e.view.kind === "sample_email").map((e) => e.id).sort()).toEqual(["email:area_unavailable", "email:estimate_unopened_3d"]);
    expect(emails.some((e) => (e.view.kind as string) === "review_only")).toBe(false);
    expect(emails.filter((e) => ["partner_invitation", "partner_email", "plain_email"].includes(e.view.kind)).length).toBe(6);
    expect(emails.some((e) => (e.view.kind as string) === "open_original")).toBe(false);
  });
});

describe("Render parity — hub shows the exact existing HTML", () => {
  test("Jo's seven preview through the SAME renderers every real send uses; no superseded sample is mounted", () => {
    const ui = readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(ui).toContain('from "@/lib/jo-outcome-email.core"');
    expect(ui).toMatch(/renderJoOutcomeEmail\(/);
    expect(ui).not.toMatch(/renderJoReadyCheckInvitationEmail/);
    // The only remaining sample_email entries are the two customer emails outside Jo's set.
    const samplesUsed = entriesFor("email").flatMap((e) => (e.view.kind === "sample_email" ? [e.view.sample] : [])).sort();
    expect(samplesUsed).toEqual(["coverage", "reminder3"]);
  });
  test("partner invitation HTML is verbatim", () => {
    expect(renderPartnerTemplate(PARTNER_TEMPLATES.find((t) => t.key === "installer_invitation")!)).toBe(INSTALLER_INVITATION_HTML);
  });
  test("hub mounts emails in a fully sandboxed frame and adds no send/save endpoints", () => {
    const ui = readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(ui).toContain('sandbox=""');
    expect(ui).not.toMatch(/send[A-Z]\w*\(|connectMittiForm|createServerFn|saveCustomerCommunicationDraft|addComplianceTemplate/);
    expect(readFileSync("src/lib/template-hub.core.ts", "utf8")).not.toMatch(/createServerFn|supabase/);
  });
  test("Mitti connect stays behind the existing button; hub load reads settings only", () => {
    const card = readFileSync("src/components/portal/mitti-forms.tsx", "utf8");
    expect(card.match(/connect\(\{/g)?.length).toBe(1);
    expect(card).toContain("onClick={async () => {");
    expect(card).toContain('const displayedId = draft ?? connected ?? "";');
    expect(card).toContain("value={displayedId}");
    expect(card).toContain("templateId: displayedId.trim()");
  });
  test("hub read endpoints check admin access before reading stored content", () => {
    for (const [file, name] of [
      ["src/lib/mitti-forms.functions.ts", "getMittiForms"],
      ["src/lib/portal.functions.ts", "listComplianceTemplates"],
      ["src/lib/owner-gates.functions.ts", "paperworkCatalogueFn"],
    ]) {
      const source = readFileSync(file, "utf8").split(`export const ${name} =`)[1]?.split("export const ")[0];
      expect(source).toContain("middleware([requireSupabaseAuth])");
      expect(source).toContain("requireAdmin(context.supabase");
      expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|realMittiCall/);
    }
  });
  test("templates route lives under the admin-only layout", () => {
    expect(readFileSync("src/routes/_authenticated/admin.templates.tsx", "utf8")).toContain('createFileRoute("/_authenticated/admin/templates")');
    expect(readFileSync("src/routes/_authenticated/admin.tsx", "utf8")).toContain("redirect({ to: \"/home\" })");
  });
});
