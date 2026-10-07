// Set-password links carry the one-time token to OUR page, which redeems it itself.
// This never depends on the auth redirect allowlist (which sent people to the calculator home page).
export const SET_PASSWORD_BASE = "https://estimate.homeinsulationvictoria.com.au";

export function setPasswordLink(hashedToken: string, next: "/field/welcome" | "/partner" | "/field/setup" = "/field/welcome", base = SET_PASSWORD_BASE): string {
  const u = new URL("/reset-password", base);
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", "recovery");
  u.searchParams.set("next", next);
  return u.toString();
}
