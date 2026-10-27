// Office job page pieces (spec 2026-10-27 "next step first"): short header with a Contact toggle, the Next box with what
// is blocking it, stages as one-line rows, and folded sections. Presentation only — the only read is the existing
// listChooseTrades (same query key as the Choose installer panel), and only when the next step is Choose installer.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { btnClass, Pill } from "@/components/portal/kit";
import { listChooseTrades } from "@/lib/offer-dispatch.functions";
import { installerBlock, stageRowLine } from "@/lib/job-page-layout.core";
import type { CardKey, StageCard } from "@/lib/office-stage-cards.core";
import type { JobPage } from "@/components/portal/office-job";

type Header = JobPage["header"];

const dayTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const card = "rounded-[18px] border border-line bg-paper shadow-card";
const tap = "min-h-[44px]";

/* ---------------- Header: pills always visible, contact details behind "Contact" ---------------- */
export function JobTop({ h, more }: { h: Header; more: ReactNode }) {
  const [contact, setContact] = useState(false);
  return (
    <header className={cn(card, "mb-4 p-4 md:p-5")} data-why="decision 218 header; 216 split address + Last heard from us; 207 permission wording">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link to="/admin/jobs/active" className="font-semibold text-sub">‹ Jobs</Link>
            <span className="font-display text-lg font-bold text-ink">{h.jobNumber}</span>
            <Pill className="whitespace-normal">{h.ownJob ? `Installer's own · ${h.installerName ?? "installer"}` : "Our lead"}</Pill>
            {h.statusPill && <Pill tone={h.stage === "cancelled" ? "rose" : "green"} className="whitespace-normal">{h.statusPill}</Pill>}
            {h.isTest && <Pill tone="amber" className="font-bold">TEST</Pill>}
            {h.lifeSupport && <Pill tone="rose">Life support</Pill>}
            {h.installBy && <Pill tone="rose">Install by {day(h.installBy)}</Pill>}
            {h.escDue && <Pill tone="amber">ESC notice due {dayTime(h.escDue)}</Pill>}
          </div>
          <h1 className="mt-2 break-words font-display text-[24px] font-extrabold leading-tight text-ink md:text-[28px]">{h.ownerName ?? "Owner not recorded"}</h1>
          <p className="break-words text-base text-ink">{[h.suburb, h.postcode].filter(Boolean).join(" ") || "Address not recorded"}</p>
        </div>
        {more}
      </div>
      <button type="button" aria-expanded={contact} aria-controls="job-contact" onClick={() => setContact(!contact)} className={btnClass("secondary", cn(tap, "mt-3"))}>Contact {contact ? "▴" : "▾"}</button>
      {contact && (
        <div id="job-contact" className="mt-3 space-y-2 text-sm">
          {(h.phone || h.email) && (
            <div className="flex flex-wrap gap-2">
              {h.phone && <a href={`tel:${h.phone}`} className={btnClass("secondary", tap)}>Call</a>}
              {h.phone && <a href={`sms:${h.phone}`} className={btnClass("secondary", tap)}>Text</a>}
              {h.email && <a href={`mailto:${h.email}`} className={btnClass("secondary", tap)}>Email</a>}
            </div>
          )}
          {h.street && <p className="break-words text-ink">{[h.street, h.suburb, h.postcode].filter(Boolean).join(" · ")}</p>}
          {h.phone && <p className="break-words text-ink">{h.phone}</p>}
          {h.email && <p className="break-all text-ink">{h.email}</p>}
          <p className="break-words text-xs text-sub">
            {h.sourceLabel} {day(h.receivedAt)} · {h.permissionAt ? `permission to contact given ${day(h.permissionAt)}` : h.permissionState === "declined" ? "permission to contact NOT given" : "no permission to contact recorded"} · Last heard from us: {h.lastHeard ? `${dayTime(h.lastHeard.at)} · ${h.lastHeard.channel.toLowerCase()}` : "never"}
          </p>
        </div>
      )}
      {h.deleted && <p role="status" className="mt-2 rounded-[10px] bg-pink px-3 py-2 text-sm font-semibold text-rose">This job is deleted. It is hidden from every list; restore it from More › Settings › Deleted jobs.</p>}
    </header>
  );
}

/* ---------------- Next box: who, sentence, one button, and what is blocking it ---------------- */
export function NextBox({ jobId, next, onGo }: { jobId: string; next: JobPage["next"]; onGo: (k: CardKey) => void }) {
  const isChoose = next.kind === "choose_installer";
  const list = useServerFn(listChooseTrades);
  // Same key as ChooseInstallerPanel so the cache is shared; never runs for any other next step.
  const q = useQuery({ queryKey: ["choose-trades", jobId, "ready_check"], queryFn: () => list({ data: { jobId, kind: "ready_check" } }), enabled: isChoose });
  const inst = isChoose ? installerBlock(q.data) : { blocked: false, reasons: [] };
  const reasons = [...(next.blocked ? [next.blocked] : []), ...(inst.blocked ? inst.reasons : [])];
  return (
    <section aria-label="Next" className={cn("mb-4 rounded-[18px] border p-4 md:p-5", next.who === "us" ? "border-hiv-green/30 bg-mint" : "border-line bg-mist")} data-why="decision 218: one Next panel, one button">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sub">Next · {next.who === "nobody" ? "nothing to do" : next.who}</p>
      <p className="mt-1 break-words text-base font-semibold text-ink">{next.sentence}</p>
      {isChoose && q.isPending && <p role="status" className="mt-2 text-sm text-sub">Checking installers…</p>}
      {isChoose && q.isError && <p role="status" className="mt-2 text-sm text-sub">Couldn't check installers</p>}
      {reasons.length > 0 && (
        <div role="status" className="mt-3 rounded-[12px] bg-pink px-3 py-2 text-sm text-rose">
          <p className="font-semibold">Can't be done yet</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {reasons.map((r) => <li key={r} className="break-words">{r}</li>)}
          </ul>
          {inst.blocked && <button type="button" className={cn(tap, "mt-1 font-semibold text-hiv-blue underline")} onClick={() => onGo("ready-check")}>See installers ›</button>}
        </div>
      )}
      {/* Mock-up order: sentence, then what is blocking it, then the one button (full width on a phone). */}
      {next.button && <button type="button" className={btnClass(inst.blocked ? "secondary" : "primary", cn(tap, "mt-3 w-full sm:w-auto"))} onClick={() => onGo(next.button!.section as CardKey)}>{next.button.label}</button>}
    </section>
  );
}

/* ---------------- Stages as one-line rows ---------------- */
// `open`/`full` live in the route (job-page-layout.core JobView): a row tap shows only the lines; links open the tools.
export function StageRows({ cards, open, full, onToggle, onFull, workspace }: { cards: StageCard[]; open: CardKey | null; full: boolean; onToggle: (k: CardKey) => void; onFull: () => void; workspace: (k: CardKey) => ReactNode }) {
  return (
    <ul aria-label="Stages" className={cn(card, "mb-4 divide-y divide-line overflow-hidden")}>
      {cards.map((c) => {
        const isOpen = open === c.key;
        const now = c.state === "now";
        return (
          <li key={c.key}>
            <button type="button" id={`stage-${c.key}`} aria-expanded={isOpen} onClick={() => onToggle(c.key)} className={cn("flex min-h-[52px] w-full scroll-mt-24 items-center gap-3 px-4 py-2 text-left", now && "bg-pink/40")}>
              <span aria-hidden className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", c.state === "done" ? "bg-mint text-hiv-green" : now ? "bg-rose text-white" : "bg-mist text-sub")}>{c.state === "done" ? "✓" : c.n}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words font-display text-[15px] font-bold text-ink">{c.title}</span>
                <span className="block break-words text-[13px] text-sub">{stageRowLine(c)}</span>
              </span>
              {now && <Pill tone="rose">Now</Pill>}
              <span aria-hidden className="text-sub">{isOpen ? "▴" : "▾"}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4">
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13px]">
                  {c.lines.map((l) => <div key={l.label} className="contents"><dt className="text-sub">{l.label}</dt><dd className="min-w-0 break-words text-ink">{l.value}</dd></div>)}
                </dl>
                {full
                  ? <div className="mt-3">{workspace(c.key)}</div>
                  : <button type="button" className={btnClass("secondary", cn(tap, "mt-3"))} onClick={onFull}>Open full details</button>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Folded section: closed by default, content mounted only when open ---------------- */
export function Fold({ id, title, hint, open, onToggle, children }: { id: string; title: string; hint?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mb-4">
      <button type="button" id={`stage-${id}`} aria-expanded={open} onClick={onToggle} className={cn(card, "flex min-h-[52px] w-full scroll-mt-24 items-center gap-3 px-4 py-2 text-left")}>
        <span className="min-w-0 flex-1 break-words font-display text-base font-bold text-ink">{title}</span>
        {hint && <span className="shrink-0 text-sm text-sub">{hint}</span>}
        <span aria-hidden className="text-sub">{open ? "▴" : "▾"}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
