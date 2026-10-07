import { installerFactLabels, type InstallerJobFacts } from "@/lib/bulk-import.core";

/** Installer-sourced jobs: site check done? and the installer's own price (or "Quote needed from installer"). */
export function InstallerFactsLine({ facts }: { facts: InstallerJobFacts | null | undefined }) {
  if (!facts) return null;
  const l = installerFactLabels(facts);
  return (
    <div className="flex flex-wrap gap-1 text-[11px] font-semibold" data-installer-facts>
      <span className={`rounded px-1.5 py-0.5 ${facts.site_check === "yes" ? "bg-success-soft text-success" : facts.site_check === "no" ? "bg-muted text-foreground" : "bg-warning-soft text-foreground"}`}>{l.siteCheck}</span>
      <span className={`rounded px-1.5 py-0.5 ${facts.quoted_price_inc_gst ? "bg-muted text-foreground" : "bg-warning-soft text-foreground"}`}>{l.price}</span>
    </div>
  );
}
