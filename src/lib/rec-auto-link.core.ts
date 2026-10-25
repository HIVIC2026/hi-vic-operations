// Decision 303 addition (Jo 25 Oct 2026): when a REC becomes an approved, rated electrician on the portal, link it
// automatically to every installer who named that electrician — by licence / REC number first, then exact name (the
// decision-157 `matchUsualElectrician` normalisation) — against (a) the installer's saved usual-electrician nomination and
// (b) legacy `installer_price_set` electrician blocks on the installer's OPEN jobs (e.g. HV-3193: "ornaldo", A123212, no
// saved usual electrician). On a match the installer's usual electrician is recorded as that REC (append-only config
// event, `source: "auto_linked_on_approval"`), never overwriting a DIFFERENT existing nomination (conflict = office item);
// the "Electrician not onboarded" hold on their quotes is lifted by re-running the quote pipeline, which re-prices the
// PIESA line at the REC's onboarded rate (decision 302) and leaves the draft on Quotes to check. Nothing is sent. PURE.
import { approvedRecBlocker, approvedRecFor, type ApprovedRecCandidate } from "./rec-onboarded.core";
import type { UsualElectrician } from "./usual-electrician.core";

export const REC_AUTO_LINKED_EVENT = "rec_auto_linked";
export const REC_LINK_CONFLICT_EVENT = "rec_link_conflict";
export const AUTO_LINK_SOURCE = "auto_linked_on_approval";

export type InstallerNominations = {
  installerBusinessId: string;
  installerName: string | null;
  /** Saved My business usual electrician (latest config event), null when none. */
  usual: UsualElectrician | null;
  /** Legacy free-text electricians on this installer's OPEN jobs (installer_price_set blocks / old form answers). */
  legacy: { jobId: string; name: string | null; licence: string | null }[];
};

export type AutoLinkPlan =
  | { action: "link"; installerBusinessId: string; installerName: string | null; electrician: UsualElectrician; via: "usual" | "legacy"; jobIds: string[] }
  | { action: "conflict"; installerBusinessId: string; installerName: string | null; existing: UsualElectrician; jobIds: string[]; reason: string }
  | { action: "none"; installerBusinessId: string };

const matches = (rec: ApprovedRecCandidate, e: { name: string | null; licence: string | null }) => approvedRecFor(e, [rec]).rec != null;

/** What to do for each installer once `rec` is an approved REC with an active PIESA rate. Not approved yet → nothing anywhere. */
export function autoLinkPlans(rec: ApprovedRecCandidate, installers: InstallerNominations[]): AutoLinkPlan[] {
  if (approvedRecBlocker(rec)) return installers.map((i) => ({ action: "none", installerBusinessId: i.installerBusinessId }));
  const rate = Math.round(Number(rec.piesa_rate!.rate_inc_gst) * 100) / 100;
  return installers.map((i): AutoLinkPlan => {
    const legacyHits = i.legacy.filter((l) => matches(rec, l));
    const jobIds = [...new Set(legacyHits.map((l) => l.jobId))];
    if (i.usual && matches(rec, i.usual)) {
      // Same electrician already nominated: re-record it as the approved REC at the onboarded rate (never silently changes a different one).
      return { action: "link", installerBusinessId: i.installerBusinessId, installerName: i.installerName, via: "usual", jobIds,
        electrician: { ...i.usual, licence: i.usual.licence || rec.rec_number || "", priceIncGst: rate } };
    }
    if (!legacyHits.length) return { action: "none", installerBusinessId: i.installerBusinessId };
    if (i.usual) return { action: "conflict", installerBusinessId: i.installerBusinessId, installerName: i.installerName, existing: i.usual, jobIds,
      reason: `${rec.trading_name ?? rec.name ?? "The REC"} was named on ${jobIds.length} job${jobIds.length === 1 ? "" : "s"} but ${i.installerName ?? "the installer"}'s saved usual electrician is ${i.usual.name} — the office decides; nothing was changed` };
    const first = legacyHits[0]!;
    return { action: "link", installerBusinessId: i.installerBusinessId, installerName: i.installerName, via: "legacy", jobIds,
      electrician: { name: (first.name ?? rec.trading_name ?? rec.name ?? "").trim(), licence: (first.licence ?? rec.rec_number ?? "").trim(), priceIncGst: rate } };
  });
}

/** The one office line in Needs me (Partner & system fold). */
export const recLinkedLine = (recName: string, installerName: string, quotesReady: number) =>
  `${recName} onboarded and linked to ${installerName} — ${quotesReady} quote${quotesReady === 1 ? "" : "s"} ready to check`;
export const recConflictLine = (recName: string, installerName: string) =>
  `${recName} onboarded — ${installerName} named them on a job but has a different usual electrician saved · office to decide`;
