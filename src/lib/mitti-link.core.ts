// Jo 24 Oct: the one web address for a Mitti form, in Mitti's documented format (help.mitti.com/000149):
// https://app.mitti.com/inspection/{audit_id}. The old app.au.mitti.com/inspections/{id} opened Mitti's home page.
export const MITTI_WEB_BASE = "https://app.mitti.com";
export const mittiFormUrl = (auditId: string) => `${MITTI_WEB_BASE}/inspection/${encodeURIComponent(auditId.trim())}`;
