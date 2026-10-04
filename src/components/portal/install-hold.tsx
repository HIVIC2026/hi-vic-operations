import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallHold } from "@/lib/allocation.functions";
import { formatHoldWeek } from "@/lib/install-holds.core";
import { Section } from "./panels";

/** Office-only: expected install week. A planning note only, never a booking or owner-visible appointment. */
export function OfficeInstallHoldCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallHold);
  const { data: h } = useQuery({ queryKey: ["install-hold", jobId], queryFn: () => load({ data: { jobId } }) });
  if (!h) return null;
  const b = h.businesses as { name: string; trading_name: string | null } | null;
  return (
    <Section title="Expected install week (office only)">
      {h.status === "active" ? (
        <p className="text-sm font-medium">Expected install week: week of {formatHoldWeek(h.target_week_start)}, {Number(h.area_m2)} m²{b ? ` · ${b.trading_name || b.name}` : ""}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Last note {h.status}{h.release_reason ? `: ${h.release_reason}` : ""}.</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Planning note only. Reserves and blocks nothing; trades manage their own diaries. Not a booking: no contact details shared, not shown to the owner.</p>
    </Section>
  );
}
