// Decision 381 (Jo 25 Oct 2026): staff get their own address. On a staff host the bare address opens sign-in
// (/auth, which sends signed-in staff on to /home) instead of the public calculator. Every other host and path,
// including /calculator on the staff host, is unchanged, so customer links keep working. Pure rules only.
export const STAFF_HOSTS: readonly string[] = ["portal.homeinsulationvictoria.com.au"];

export const isStaffHost = (hostname: string | null | undefined) => STAFF_HOSTS.includes(String(hostname ?? "").toLowerCase().replace(/\.$/, ""));

/** Where a request to `url` should go instead, or null to serve it as normal. */
export function staffHostRedirect(url: string | URL): string | null {
  const u = typeof url === "string" ? new URL(url) : url;
  return isStaffHost(u.hostname) && (u.pathname === "/" || u.pathname === "") ? "/auth" : null;
}
