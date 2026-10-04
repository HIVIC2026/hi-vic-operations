import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallHold } from "@/lib/allocation.functions";
import { formatHoldWeek } from "@/lib/install-holds.core";
import { Section } from "./panels";

/** Office-only: the install hold. A capacity reservation, never a booking or owner-visible appointment. */
export function OfficeInstallHoldCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallHold);
  const { data: h } = useQuery({ queryKey: ["install-hold", jobId], queryFn: () => load({ data: { jobId } }) });
  if (!h) return null;
  const b = h.businesses as { name: string; trading_name: string | null } | null;
  return (
    <Section title="Install hold (office only)">
      {h.status === "active" ? (
        <p className="text-sm font-medium">Install hold: week of {formatHoldWeek(h.target_week_start)}, {Number(h.area_m2)} m²{b ? ` · ${b.trading_name || b.name}` : ""}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Last hold {h.status}{h.release_reason ? `: ${h.release_reason}` : ""}.</p>
      )}
      {h.status === "active" && h.over_capacity && <p className="mt-1 text-sm font-medium text-danger">Installer is over capacity for the next 8 weeks — office to check.</p>}
      <p className="mt-1 text-xs text-muted-foreground">Reserves the installer's capacity only. Not a booking: no contact details shared, not shown to the owner, does not allow installation.</p>
    </Section>
  );
}
