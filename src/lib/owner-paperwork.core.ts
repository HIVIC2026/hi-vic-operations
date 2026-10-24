/** Pure: how a template-managed owner document shows on the Owner paperwork page.
 * The newest version is what needs reading/approving. If it is not approved (wording was
 * edited by adding a new version), the document is back to Draft. Presentation only —
 * the real-job gate still reads compliance_templates approved + active. */
export type TemplateRow = { id: string; template_key: string; version: string; body: string; approved: boolean; approved_by: string | null; approved_at: string | null; is_active: boolean; created_at: string };

export function templateDocState(rows: TemplateRow[], key: string) {
  const mine = rows.filter((r) => r.template_key === key).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newest = mine[0] ?? null;
  if (!newest) return { templateId: null, version: "not loaded", body: "", status: "Draft" as const, approvedBy: null, approvedAt: null };
  return {
    templateId: newest.id, version: newest.version, body: newest.body,
    status: newest.approved ? ("Approved" as const) : ("Draft" as const),
    approvedBy: newest.approved ? newest.approved_by : null,
    approvedAt: newest.approved ? newest.approved_at : null,
  };
}

/** Link to that template's wording on the Compliance templates page. */
export const templateEditHref = (key: string) => `/admin/settings?tab=templates&key=${encodeURIComponent(key)}#tpl-${key}`;
