/**
 * Which web address a visitor used decides what the bare address shows them.
 *
 * estimate.homeinsulationvictoria.com.au is a customer-facing marketing address:
 * someone typing it (or tapping a link in an SMS) must land on the calculator,
 * never on a staff sign-in page. Staff reach the portal at /home on any address.
 */

/** Addresses that are customer entry points (exact match, no subdomains). */
export const CUSTOMER_HOSTS: readonly string[] = ["estimate.homeinsulationvictoria.com.au"];

/** Where a customer is sent when they arrive at the bare address. */
export const CUSTOMER_ENTRY_PATH = "/calculator";

/** Bare hostname from a Host header: lower-cased, no port, no trailing dot. */
export function normalizeHost(header: string | null | undefined): string {
  if (!header) return "";
  const [name = ""] = header.trim().toLowerCase().split(":");
  return name.replace(/\.$/, "");
}

export function isCustomerHost(header: string | null | undefined): boolean {
  const host = normalizeHost(header);
  if (!host) return false;
  return CUSTOMER_HOSTS.some((entry) => entry.toLowerCase() === host);
}

/**
 * Returns the path to send this visitor to, or undefined to serve the page as normal.
 * Only the bare address redirects — every other path is left alone so that a
 * customer link, an onboarding link or a staff bookmark keeps working.
 */
export function customerEntryPoint(
  host: string | null | undefined,
  pathname: string,
): string | undefined {
  if (!isCustomerHost(host)) return undefined;
  if (pathname !== "/" && pathname !== "") return undefined;
  return CUSTOMER_ENTRY_PATH;
}
