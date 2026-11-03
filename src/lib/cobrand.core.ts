// Part 10 Task 5: co-branding an installer's OWN customer's quote email, page and invoice with the installer's logo beside
// ours. Pure. One switch for all three surfaces, off until Jo approves the look. The installer's logo comes from Part 5's
// `businessLogoUrl` (trade-view.server: businesses.branding.logo_url, https only); anything else → our logo alone — never
// a broken image or an empty <img>.
export const OWN_CUSTOMER_COBRAND_APPROVED: boolean = false;

/** Both logos sit on one row at this width (ours is 132px in the shared header). */
export const OWN_COBRAND_LOGO_WIDTH = 132;

export type CobrandLogo = { url: string; alt: string };

/** `installer` is null unless the URL is https and the installer has a name (the alt text). */
export function cobrandLogos(i: { installerName: string | null | undefined; logoUrl: string | null | undefined }): { installer: CobrandLogo | null } {
  const url = i.logoUrl?.trim() ?? "";
  const alt = i.installerName?.trim() ?? "";
  if (!/^https:\/\/\S+$/.test(url) || !alt) return { installer: null };
  return { installer: { url, alt } };
}
