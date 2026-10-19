import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFICE_HEADINGS, SECTION_TABS, sectionFor, tabActive } from "../src/lib/office-nav";
import { TEMPLATE_ENTRIES, entriesFor, parseTemplateSearch, selectTemplate } from "../src/lib/template-hub.core";
import { samples } from "../src/lib/step3-email-samples";
import { renderStep3SaveSpot, renderStep3SaveSpotNoSize, STEP3_SAVESPOT_SAMPLE } from "../src/lib/step3-emails";
import { PARTNER_TEMPLATES, renderPartnerTemplate } from "../src/lib/partner-templates";
import { INSTALLER_INVITATION_HTML } from "../src/lib/installer-invitation.html";

describe("Templates navigation", () => {
  test("one Templates heading with Email / Mitti / Compliance tabs; original tools retained", () => {
    expect(SECTION_TABS.templates.map((t) => t.label)).toEqual(["Email", "Mitti", "Compliance"]);
    expect(sectionFor("/admin/templates", { cat: "mitti" })).toBe("templates");
    expect(sectionFor("/admin/communications")).toBe("overview");
    expect(sectionFor("/admin/compliance")).toBe("settings");
    expect(SECTION_TABS.settings.map((t) => t.to)).toContain("/admin/compliance");
    expect(OFFICE_HEADINGS.filter(h => h.label === "Templates").length).toBe(1);
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
    for (const entry of entriesFor("mitti")) expect(entry.approval).toBe("Not recorded");
  });
  test("email inventory distinguishes exact builders, stored reviews and original tool", () => {
    const emails = entriesFor("email");
    expect(emails.length).toBe(19);
    // P1-R2-S02: the five later-stage lifecycle templates now mount the existing sample_email
    // renderer (draft wording preview) instead of a bare review_only placeholder, so no email
    // entry is review_only any more. Their stored review-version keys are still wired (reviewKey).
    expect(emails.filter((e) => e.view.kind === "review_only").length).toBe(0);
    expect(emails.filter((e) => e.view.kind === "sample_email").map((e) => e.reviewKey)).toEqual(
      expect.arrayContaining(["measured_quote", "booking_consent", "pre_install_pack", "assignment_signing", "completion_pack"]),
    );
    // 13 pre-S02 (sample/partner/plain) + the 5 lifecycle sample_email renderers = 18.
    expect(emails.filter((e) => ["sample_email", "partner_invitation", "partner_email", "plain_email"].includes(e.view.kind)).length).toBe(18);
    expect(emails.filter((e) => e.view.kind === "open_original").length).toBe(1);
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
    expect(card).toContain('const displayedId = draft ?? connected ?? "";');
    expect(card).toContain("value={displayedId}");
    expect(card).toContain("templateId: displayedId.trim()");
  });
  test("hub read endpoints check admin access before reading stored content", () => {
    for (const [file, name] of [
      ["src/lib/customer-communications.functions.ts", "listCustomerCommunicationTemplates"],
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
