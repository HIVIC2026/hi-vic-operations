import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getInHouseBookingAccess, inHouseBookVisit } from "@/lib/trade-view.functions";
import { installStartAt } from "@/lib/install-days.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Group } from "./installer-kit";
import { TeamElectricianPicker } from "./TeamElectricianPicker";

const visits = [
  { kind: "ready_check", label: "Ready Check" },
  { kind: "assessment", label: "PIESA" },
  { kind: "rectification", label: "Part C rectification" },
  { kind: "installation", label: "Install" },
] as const;

type VisitKind = (typeof visits)[number]["kind"];

export function useInHouseBookingAccess(jobId: string) {
  const load = useServerFn(getInHouseBookingAccess);
  return useQuery({ queryKey: ["in-house-booking-access", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
}

type ExistingBooking = { id: string; kind: string; scheduled_start: string | null; status: string };

function VisitPicker({ jobId, kind, label, booking }: { jobId: string; kind: VisitKind; label: string; booking: ExistingBooking | undefined }) {
  const book = useServerFn(inHouseBookVisit);
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[]>([]);
  const id = `in-house-${jobId}-${kind}`;
  return (
    <form className="space-y-2 border-b border-line py-4 last:border-b-0" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setBlockers([]);
      try {
        const [day, time] = value.split("T");
        if (!day || !time) return;
        const result = await book({ data: { jobId, kind, start: installStartAt(day, time).toISOString() } });
        if (!result.ok) { setBlockers(result.blockers); return; }
        markOfficeChanged(); toast.success(`${label} booked`); await qc.invalidateQueries();
      } catch (error) { setBlockers([error instanceof Error ? error.message : "Something went wrong"]); }
      finally { setBusy(false); }
    }}>
      <Label htmlFor={id}>{label}</Label>
      {booking && <p className="break-words text-sm text-sub">
        {booking.scheduled_start && <time dateTime={booking.scheduled_start}>{new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" }).format(new Date(booking.scheduled_start))} · {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(booking.scheduled_start))}</time>}
        {booking.scheduled_start ? " · " : ""}{booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
      </p>}
      <Input id={id} type="datetime-local" aria-label={`${label} date and time (Melbourne)`} className="h-12 min-w-0 w-full" required value={value} onChange={(event) => setValue(event.target.value)} />
      {blockers.length > 0 && <ul role="alert" className="space-y-1 break-words text-sm text-rose">{blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      <Button type="submit" size="field" variant="outline" className="w-full whitespace-normal" disabled={busy || !value}>{busy ? "Saving…" : `Book ${label}`}</Button>
    </form>
  );
}

export function InHouseBookingCard({ jobId }: { jobId: string }) {
  const access = useInHouseBookingAccess(jobId);
  const data = access.data;
  if (access.isLoading || access.isError || data?.allowed !== true) return null;
  return <><TeamElectricianPicker jobId={jobId} /><Group title="Visit bookings">{visits.map((visit) => <VisitPicker key={visit.kind} jobId={jobId} {...visit} booking={data.bookings?.find((booking) => booking.kind === visit.kind)} />)}</Group></>;
}