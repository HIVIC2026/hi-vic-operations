// Jo 26 Oct 2026 (Deep's email, checked against the ESC Activity Guide and FAQ): an installer may manage and pay its OWN
// electricians. On that installer's jobs, when its own electrician (not Home Insulation Victoria's) does the safety check:
//  • the owner's quote carries a flat safety check (PIESA) price, whatever the installer pays the electrician;
//  • we pay the INSTALLER that amount for each completed check (never the electrician), on the usual electrician timing;
//  • the electrician still onboards for licence, REC and insurance checks, but gives no rates or bank details.
// Fixes (rectification) are unchanged: the electrician quotes them and we pay the electrician. Deep's jobs only for now,
// so the list lives here rather than in a settings table. PURE: no I/O.

export type InstallerPaidElectricians = { businessId: string; name: string; piesaIncGst: number };

const LIST: InstallerPaidElectricians[] = [
  { businessId: "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0", name: "Reinsulate", piesaIncGst: 350 },
  { businessId: "17793408-bf5c-4ddd-9bec-64199f64f9fb", name: "[TEST PARTNER] Reinsulate", piesaIncGst: 350 },
];

/** The arrangement for this installer business, or null when we pay its electricians directly (everyone else). */
export function installerPaysOwnElectricians(businessId: string | null | undefined): InstallerPaidElectricians | null {
  return (businessId && LIST.find((x) => x.businessId === businessId)) || null;
}

/** Safety check payout for one job: who we pay and how much (inc GST). `electricianChoice` is the job's recorded Ready
 *  Check electrician choice; Home Insulation Victoria's own electrician is always paid directly. */
export function safetyCheckPayee(i: { installerBusinessId: string | null | undefined; electricianChoice: string | null | undefined }): InstallerPaidElectricians | null {
  if (!i.electricianChoice || i.electricianChoice === "hivic") return null;
  return installerPaysOwnElectricians(i.installerBusinessId);
}
