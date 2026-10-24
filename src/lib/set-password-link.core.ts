// Set-password links carry the one-time token to OUR page, which redeems it itself.
// This never depends on the auth redirect allowlist (which sent people to the calculator home page).
export const SET_PASSWORD_BASE = "https://estimate.homeinsulationvictoria.com.au";

export type SetPasswordNext = "/field/welcome" | "/partner" | "/field/setup" | "/portal";
export type SetPasswordKind = "recovery" | "invite";

export function setPasswordLink(hashedToken: string, next: SetPasswordNext = "/field/welcome", base = SET_PASSWORD_BASE, kind: SetPasswordKind = "recovery"): string {
  const u = new URL("/reset-password", base);
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", kind);
  u.searchParams.set("next", next);
  return u.toString();
}

/** Where to go after a password is saved. Only known in-portal paths; anything else goes to the role router. Never the calculator. */
export function afterPasswordPath(next: string | null): "/field/welcome" | "/portal" {
  return next === "/field/welcome" || next === "/field/setup" || next === "/partner" ? "/field/welcome" : "/portal";
}

export type PortalRoleInput = { roles: string[]; hasBusiness: boolean };
/** Role router used by /portal after sign-in. */
export function portalDestination(me: PortalRoleInput): "/admin/needs-me" | "/field" | "/owner" | "no-access" | "choose" {
  const trade = me.roles.includes("installer") || me.roles.includes("electrician") || me.hasBusiness;
  if (me.roles.includes("admin")) return trade ? "choose" : "/admin/needs-me"; // decision 218: Needs me is the office home
  if (me.roles.includes("installer") || me.roles.includes("electrician")) return "/field";
  if (me.hasBusiness) return "/field";
  if (me.roles.includes("owner")) return "/owner";
  return "no-access";
}

/** Partner welcome/login links last 24 hours and work once (Jo, 7 Oct). They carry our own token; opening the link mints a fresh one-time set-password token. */
export const PARTNER_LINK_HOURS = 24;
export function partnerLoginUrl(token: string, base = SET_PASSWORD_BASE): string {
  const u = new URL("/reset-password", base);
  u.searchParams.set("link", token);
  u.searchParams.set("next", "/field/welcome");
  return u.toString();
}
export type PartnerLinkOutcome = "ok" | "used" | "expired" | "invalid";
export function partnerLinkMessage(o: Exclude<PartnerLinkOutcome, "ok">): string {
  return o === "used" ? "This link has already been used." : o === "expired" ? "This link has expired." : "This link isn't valid.";
}
