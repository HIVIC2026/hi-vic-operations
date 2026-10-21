import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listInterests, updateInterest, type InterestRow } from "@/lib/interest.functions";

export const Route = createFileRoute("/_authenticated/admin/interests")({
  head: () => ({
    meta: [
      { title: "Registered interest – Home Insulation Victoria Operations" },
      { name: "description", content: "Owners who registered interest from the public calculator, with their details and what happens next." },
      { property: "og:title", content: "Registered interest – Home Insulation Victoria Operations" },
      { property: "og:description", content: "Owners who registered interest from the public calculator." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Interests,
});

const STATUSES = [
  { value: "new", label: "New", chip: "border-workspace-blush-strong/50 bg-workspace-blush text-foreground" },
  { value: "contacted", label: "Contacted", chip: "border-info/30 bg-info-soft text-info" },
  { value: "booked", label: "Booked", chip: "border-success/30 bg-success-soft text-success" },
  { value: "closed", label: "Closed", chip: "border-border bg-muted text-muted-foreground" },
] as const;

const INSULATION_WORDS: Record<string, string> = {
  none: "No existing insulation",
  present: "Some insulation already there",
  unknown: "Not sure what's there",
};

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function Interests() {
  const load = useServerFn(listInterests);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["interests"],
    queryFn: () => load(),
  });
  const [filter, setFilter] = useState<string>("all");
  const rows = data ?? [];
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const countOf = (status: string) => rows.filter((r) => r.status === status).length;

  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold">Registered interest</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Owners who asked us to follow up from the calculator. Nothing is sent to them automatically — you call or email.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`min-h-9 rounded-full border px-3 text-xs font-bold transition ${filter === "all" ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground/40"}`}
        >
          All {rows.length}
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setFilter(s.value)}
            className={`min-h-9 rounded-full border px-3 text-xs font-bold transition ${s.chip} ${filter === s.value ? "ring-2 ring-offset-1 ring-foreground/25" : "opacity-90 hover:opacity-100"}`}
          >
            {s.label} {countOf(s.value)}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-danger">We could not load the list. Try again.</p>}
      {!isLoading && !isError && !shown.length && (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      )}

      <ul className="space-y-3">
        {shown.map((row) => (
          <Row key={row.id} row={row} onDone={refetch} />
        ))}
      </ul>
    </AppShell>
  );
}

function Row({ row, onDone }: { row: InterestRow; onDone: () => void }) {
  const save = useServerFn(updateInterest);
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  const [busy, setBusy] = useState(false);

  const act = async (patch: { status?: (typeof STATUSES)[number]["value"]; notes?: string }) => {
    setBusy(true);
    try {
      await save({ data: { id: row.id, ...patch } });
      toast.success("Saved");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold">{row.full_name}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                STATUSES.find((s) => s.value === row.status)?.chip ?? STATUSES[0].chip
              }`}
            >
              {STATUSES.find((s) => s.value === row.status)?.label ?? row.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            <a className="font-semibold text-primary hover:underline" href={`tel:${row.mobile}`}>
              {row.mobile}
            </a>
            <a className="hover:underline" href={`mailto:${row.email}`}>
              {row.email}
            </a>
            <span>
              {row.address_line
                ? `${row.address_line}${row.suburb ? `, ${row.suburb}` : ""} ${row.postcode}`
                : `Postcode ${row.postcode}`}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>{row.ceiling_m2 ? `Ceiling about ${row.ceiling_m2} m²` : "Ceiling size not given"}</span>
            <span>{INSULATION_WORDS[row.insulation_declared] ?? row.insulation_declared}</span>
            <span>Registered {when(row.created_at)}</span>
            <span>Consent {row.consent_version}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.filter((s) => s.value !== row.status).map((s) => (
            <Button key={s.value} size="sm" variant="outline" disabled={busy} onClick={() => act({ status: s.value })}>
              Mark {s.label.toLowerCase()}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Textarea
          className="min-h-16 flex-1"
          placeholder="What happened, what we promised, when to chase"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button size="sm" disabled={busy} onClick={() => act({ notes })}>
          Save note
        </Button>
      </div>
    </li>
  );
}
