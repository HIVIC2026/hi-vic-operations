// Jo 24 Oct: a "Mitti form" button must open that exact form. Mitti's per-form deep link (POST /audits/{id}/deep_link)
// answers {"url":"https://sfty.io/…","web_url":"https://app.au.safetyculture.com/inspection/{id}?…"} (checked live on
// HV-3066): the short url opens the Mitti app on a phone and the web app otherwise. The web address (Mitti runs on
// SafetyCulture's AU web app) is only the fallback.
export const MITTI_WEB_BASE = "https://app.au.safetyculture.com";
export const mittiFormUrl = (auditId: string) => `${MITTI_WEB_BASE}/inspection/${encodeURIComponent(auditId.trim())}`;

/** The link from Mitti's deep-link answer, whatever field it uses; null when there is no https link. */
export function deepLinkFromResponse(res: unknown): string | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^https:\/\/\S+$/.test(v.trim());
  if (ok(res)) return res.trim();
  const o = (res ?? {}) as Record<string, unknown>;
  for (const k of ["deep_link", "deeplink", "deepLink", "url", "link", "web_url", "href"]) if (ok(o[k])) return (o[k] as string).trim();
  for (const v of Object.values(o)) {
    if (ok(v)) return v.trim();
    if (v && typeof v === "object") { const inner = deepLinkFromResponse(v); if (inner) return inner; }
  }
  return null;
}

/** The "Mitti form" button's fallback web address, or null when no form is linked. */
export const mittiAuditUrl = (id: string | null | undefined) => (id ? mittiFormUrl(id) : null);
