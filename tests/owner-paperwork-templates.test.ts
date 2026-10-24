import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { templateDocState, templateEditHref, type TemplateRow } from "../src/lib/owner-paperwork.core";

const row = (o: Partial<TemplateRow>): TemplateRow => ({ id: "a", template_key: "esc_consent", version: "v1", body: "Wording v1", approved: false, approved_by: null, approved_at: null, is_active: false, created_at: "2026-10-01", ...o });

describe("Owner paperwork shows template documents", () => {
  test("draft template shows its wording and needs approval", () => {
    const s = templateDocState([row({})], "esc_consent");
    expect(s).toMatchObject({ templateId: "a", status: "Draft", body: "Wording v1" });
  });
  test("approved template shows Approved", () => {
    expect(templateDocState([row({ approved: true, is_active: true, approved_by: "u" })], "esc_consent").status).toBe("Approved");
  });
  test("edited wording (new version) goes back to Draft", () => {
    const s = templateDocState([row({ approved: true, is_active: true }), row({ id: "b", version: "v2", body: "Wording v2", created_at: "2026-10-07" })], "esc_consent");
    expect(s).toMatchObject({ templateId: "b", version: "v2", status: "Draft", body: "Wording v2" });
  });
  test("one approval record: both pages call the same helper", () => {
    const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
    const gates = readFileSync("src/lib/owner-gates.functions.ts", "utf8");
    expect(portal).toContain("approveTemplateVersion(data.id");
    expect(gates).toContain("approveTemplateVersion(data.id");
    const page = readFileSync("src/components/portal/owner-documents.tsx", "utf8"); // merged into Settings › Templates (O7 build B)
    expect(page).not.toContain("Managed in Compliance templates");
    expect(page).toContain("Edit wording");
    expect(templateEditHref("esc_consent")).toBe("/admin/settings?tab=templates&key=esc_consent#tpl-esc_consent");
  });
  test("real-job gate still requires approved + active template", () => {
    const srv = readFileSync("src/lib/owner-gates.server.ts", "utf8");
    expect(srv).toContain('.eq("approved", true).eq("is_active", true)');
  });
});
