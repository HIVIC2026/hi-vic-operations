/** Presentation-only regrouping of already-authorised trade rows; never reads or changes job facts. */
type Row = [string, string] | [string, string, boolean];
const moneyLabels = new Set(["Your install pay", "Your PIESA pay", "Your PIESA price (owner pays you)", "Your pay", "Owner's quote"]);

export function installerJobSections(input: {
  ownCustomer: boolean;
  quoteSent: boolean;
  siteNotes: readonly Row[];
  jobDetails: readonly Row[];
}) {
  const notes = [...input.siteNotes, ...input.jobDetails.filter(([label]) => !moneyLabels.has(label))]
    .filter(([, value]) => value.trim().length > 0);
  const money: Row[] = input.ownCustomer && !input.quoteSent ? [] : input.jobDetails
    .filter(([label, value]) => moneyLabels.has(label) && label !== "Owner's quote" && value.trim() !== "" && value !== "—")
    .map(([label, value]) => [label === "Your pay" ? "Your price inc GST" : label === "Your PIESA price (owner pays you)" ? "Safety check (owner pays you)" : label === "Your PIESA pay" ? "Your safety check pay" : label, value]);
  return { notes, money };
}