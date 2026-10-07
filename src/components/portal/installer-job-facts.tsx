import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallerJobFacts } from "@/lib/portal.functions";
import { Section } from "./panels";
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

/** Office job page card (installer-sourced jobs only). */
export function OfficeInstallerFactsCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerJobFacts);
  const q = useQuery({ queryKey: ["installer-facts", jobId], queryFn: () => load({ data: { jobId } }) });
  if (q.error) return <Section title="Installer's job"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Section>;
  if (!q.data) return null;
  const f = q.data; const l = installerFactLabels(f);
  return (
    <Section title="Installer's job">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-installer-facts-card>
        <dt className="text-muted-foreground">Site check / measure-up</dt><dd className="font-semibold">{l.siteCheck.replace(/^Site check( done)?: /, "")}</dd>
        <dt className="text-muted-foreground">Installer's quoted price</dt><dd className={f.quoted_price_inc_gst ? "font-semibold" : "font-semibold text-destructive"}>{f.quoted_price_inc_gst ? `$${f.quoted_price_inc_gst.toLocaleString("en-AU")} inc GST` : l.price}</dd>
        <dt className="text-muted-foreground">Price includes</dt><dd>{f.price_includes ?? "—"}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">This is the installer's own price, exactly as supplied. Yes skips the Ready Check; No goes to it.</p>
    </Section>
  );
}
