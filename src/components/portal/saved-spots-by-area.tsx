// Saved spots by area (Jo 3 Nov 2026, spec §1): To release opens on "By area". One card per ~10 km area (the list's
// `areas`, in its order); inside each area: said yes, then waiting for owner, then Best → Good → OK → Weak, then score.
// Each spot: job, owner, suburb, size (+ "~X m² from above"), estimate, waiting since, band chip, one-line reason, tags
// (Life support red), Satellite and Listing links. Ticks are the screen's (shared with the Table) and feed its Send bar.
// Phone: cards; computer: rows.
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Pill, listCard, type PillTone } from "@/components/portal/kit";
import { batchRowLine } from "@/lib/area-batch.core";
import type { SpotBand } from "@/lib/saved-spot-rank.core";
import {
  areaSpotOrder,
  spotFields,
  tickableForSend,
  type InstallerWaitingRow,
} from "@/lib/installer-waiting-columns.core";
import type { InstallerWaitingList } from "@/lib/installer-waiting.server";

const BAND_LABEL: Record<SpotBand, string> = { best: "Best", good: "Good", ok: "OK", weak: "Weak" };
const BAND_TONE: Record<SpotBand, PillTone> = {
  best: "green",
  good: "plain",
  ok: "amber",
  weak: "plain",
};

// Literal class names (Tailwind only sees whole strings).
const tickCols =
  "lg:grid-cols-[28px_76px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_88px_minmax(0,1fr)]";
const plainCols =
  "lg:grid-cols-[76px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_88px_minmax(0,1fr)]";
const outLink = "font-semibold text-hiv-blue underline";

function SpotRow({
  r,
  now,
  ticked,
  onToggle,
  canTick,
}: {
  r: InstallerWaitingRow;
  now: number;
  ticked: boolean;
  onToggle: (id: string) => void;
  canTick: boolean;
}) {
  const f = spotFields(r, now);
  const batchLine = batchRowLine(r.batch ?? null, r.ownerName);
  return (
    <li
      className="border-b border-[#eef1f6] px-4 py-3.5 text-[14px] last:border-b-0 lg:px-5 lg:py-2.5"
      data-spot={r.id}
      data-job={r.jobNumber}
    >
      <div
        className={cn(
          "grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 lg:items-center lg:gap-y-0",
          canTick ? tickCols : plainCols,
        )}
      >
        {canTick && (
          <span className="col-span-2 flex items-center lg:col-span-1">
            <input
              type="checkbox"
              className="h-5 w-5 accent-hiv-green disabled:opacity-40"
              aria-label={`Tick ${r.jobNumber} for Send`}
              disabled={!tickableForSend(r)}
              checked={ticked}
              onChange={() => onToggle(r.id)}
            />
          </span>
        )}
        <span className="col-span-2 flex items-center gap-2 text-sub lg:col-span-1">
          <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">
            {r.jobNumber}
          </Link>
          {r.isTest && (
            <span className="rounded bg-warning-soft px-1 text-[10px] font-bold text-foreground">
              TEST
            </span>
          )}
        </span>
        <span className="text-sub lg:hidden">Owner</span>
        <span className="truncate font-semibold text-ink">{f.owner}</span>
        <span className="text-sub lg:hidden">Suburb</span>
        <span className="truncate">{f.suburb}</span>
        <span className="text-sub lg:hidden">Size</span>
        <span>
          {f.size}
          {r.footprintM2 != null && (
            <span className="block text-[12px] text-sub">
              ~{Math.round(r.footprintM2)} m² from above
            </span>
          )}
        </span>
        <span className="text-sub lg:hidden">Estimate</span>
        <span className="font-display text-[16px] font-bold text-ink">{f.estimate}</span>
        <span className="text-sub lg:hidden">Waiting since</span>
        <span className="text-[13px] text-sub">{f.waiting}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] lg:mt-1">
        {batchLine ? (
          <span
            className={cn(
              "font-semibold",
              r.batch?.kind === "said_yes" ? "text-hiv-green" : "text-hiv-blue",
            )}
            data-batch={r.batch?.kind}
          >
            {batchLine}
          </span>
        ) : (
          r.band && (
            <Pill
              tone={BAND_TONE[r.band]}
              {...(r.band === "weak" ? { className: "text-sub" } : {})}
            >
              {BAND_LABEL[r.band]}
            </Pill>
          )
        )}
        {r.reason && <span className="text-sub">{r.reason}</span>}
        {(r.tags ?? []).map((t) =>
          t === "Life support" ? (
            <Pill key={t} tone="rose" className="text-rose">
              {t}
            </Pill>
          ) : (
            <span
              key={t}
              className="inline-flex items-center whitespace-nowrap rounded-[18px] bg-[#f1f3f8] px-2.5 py-0.5 text-[11px] font-semibold text-sub"
            >
              {t}
            </span>
          ),
        )}
        {r.satelliteUrl && (
          <a href={r.satelliteUrl} target="_blank" rel="noopener" className={outLink}>
            Satellite
          </a>
        )}
        {r.listingUrl && (
          <a href={r.listingUrl} target="_blank" rel="noopener" className={outLink}>
            Listing
          </a>
        )}
      </div>
    </li>
  );
}

/** `canTick` false (TEST office login) hides the checkboxes, like the Table. */
export function SavedSpotsByArea({
  list,
  ticked,
  onToggle,
  canTick = true,
}: {
  list: InstallerWaitingList;
  ticked: string[];
  onToggle: (id: string) => void;
  canTick?: boolean;
}) {
  const byId = new Map(list.rows.map((r) => [r.id, r]));
  const areas = list.areas
    .map((a) => ({
      ...a,
      rows: areaSpotOrder(
        a.jobIds.map((id) => byId.get(id)).filter((r): r is InstallerWaitingRow => !!r),
      ),
    }))
    .filter((a) => a.rows.length);
  if (!areas.length)
    return (
      <div className={listCard}>
        <p className="p-6 text-center text-sm text-sub">
          No saved spot is waiting for an installer.
        </p>
      </div>
    );
  return (
    <div className="space-y-4">
      {areas.map((a) => (
        <section
          key={a.key}
          aria-labelledby={`area-${a.key}`}
          className={listCard}
          data-area={a.key}
        >
          <h2
            id={`area-${a.key}`}
            className="border-b border-line bg-[#fafbfe] px-4 py-2.5 font-display text-[17px] font-bold text-ink lg:px-5"
          >
            {a.heading}
          </h2>
          <ul>
            {a.rows.map((r) => (
              <SpotRow
                key={r.id}
                r={r}
                now={list.now}
                ticked={ticked.includes(r.id)}
                onToggle={onToggle}
                canTick={canTick}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
