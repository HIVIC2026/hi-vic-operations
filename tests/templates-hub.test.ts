import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SECTION_TABS, sectionFor, tabActive } from "../src/lib/office-nav";
import { TEMPLATE_ENTRIES, entriesFor, parseTemplateSearch, selectTemplate } from "../src/lib/template-hub.core";
import { samples } from "../src/lib/step3-email-samples";
import { renderStep3SaveSpot, renderStep3SaveSpotNoSize, STEP3_SAVESPOT_SAMPLE } from "../src/lib/step3-emails";
import { PARTNER_TEMPLATES, renderPartnerTemplate } from "../src/lib/partner-templates";
import { INSTALLER_INVITATION_HTML } from "../src/lib/installer-invitation.html";

describe("Templates navigation", () => {
  test("one Templates heading with Email / Mitti / Compliance tabs; other headings unchanged", () => {
    expect(SECTION_TABS.templates.map((t) => t.label)).toEqual(["Email", "Mitti", "Compliance"]);
    expect(sectionFor("/admin/templates", { cat: "mitti" })).toBe("templates");
    expect(sectionFor("/admin/communications")).toBe("pipeline");
    expect(sectionFor("/admin/compliance")).toBe("settings");
    expect(SECTION_TABS.settings.map((t) => t.to)).toContain("/admin/compliance");
    const office = readFileSync("src/components/portal/office.tsx", "utf8");
    expect(office.match(/label: "Templates"/g)?.length).toBe(1);
  });
  test("category tab is active only for its own category", () => {
    const [email, mitti] = SECTION_TABS.templates;
    expect(tabActive(mitti!, "/admin/templates", { cat: "mitti" })).toBe(true);
    expect(tabActive(email!, "/admin/templates", { cat: "mitti" })).toBe(false);
  });
});

describe("Template selection", () => {
  test("unique ids; every category has entries; unknown or cross-category id falls back to first", () => {
    expect(new Set(TEMPLATE_ENTRIES.map((e) => e.id)).size).toBe(TEMPLATE_ENTRIES.length);
    for (const c of ["email", "mitti", "compliance"] as const) expect(entriesFor(c).length).toBeGreaterThan(0);
    expect(selectTemplate("mitti", "email:save_my_spot").category).toBe("mitti");
    expect(selectTemplate("email", "email:save_my_spot_no_size").title).toBe("Save your spot — no ceiling size");
    expect(parseTemplateSearch({ cat: "bogus" })).toEqual({ cat: "email" });
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
    expect(TEMPLATE_ENTRIES.find((e) => e.id === "email:save_my_spot_no_size")!.approval).toMatch(/no stored approval/);
    expect(TEMPLATE_ENTRIES.find((e) => e.id === "email:insulation_details")!.approval).toMatch(/not approved/);
  });
});

describe("Render parity — hub shows the exact existing HTML", () => {
  test("Save your spot and no-size samples equal the Step 3 builders", () => {
    expect(samples.savespot.html).toBe(renderStep3SaveSpot(STEP3_SAVESPOT_SAMPLE).html);
    expect(samples.savespotNoSize.html).toBe(renderStep3SaveSpotNoSize(STEP3_SAVESPOT_SAMPLE).html);
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
  });
  test("templates route lives under the admin-only layout", () => {
    expect(readFileSync("src/routes/_authenticated/admin.templates.tsx", "utf8")).toContain('createFileRoute("/_authenticated/admin/templates")');
    expect(readFileSync("src/routes/_authenticated/admin.tsx", "utf8")).toContain("redirect({ to: \"/home\" })");
  });
});
