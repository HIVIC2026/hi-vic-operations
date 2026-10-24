// Installer screen pieces for the approved mock-ups M2/M4/M5/M6 (Jo 24 Oct 2026). Presentation only: tokens navy
// #22376B (ink), blue #3C51C4 (hiv-blue), green #07BF61 (hiv-green), mist #F2F4FC, line #E4E9F5, sub #5A6785;
// 44px targets; one primary button per screen. Pages pass in facts they already have.
import * as React from "react";
import { Link } from "@tanstack/react-router";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Phone-width column (390px mock-up), one gap between blocks. */
export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[430px] flex-col gap-5 text-ink md:max-w-[560px]">{children}</div>;
}

export function BackToWork() {
  return <Link to="/field" className="inline-flex min-h-9 items-center text-sm font-medium text-hiv-blue">‹ My work</Link>;
}

/** Heading block: back link, optional pill row, title (Outfit 21px), lines under it. */
export function ScreenHead({ pill, pillNote, title, line1, line2, children }: { pill?: string | null; pillNote?: string | null; title: React.ReactNode; line1?: React.ReactNode; line2?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div>
      <BackToWork />
      {pill && <div className="mt-1 flex items-center gap-2"><span className="inline-block rounded-full bg-mist px-3 py-1.5 text-[13px] font-bold">{pill}</span>{pillNote && <span className="text-[13px] text-sub">{pillNote}</span>}</div>}
      <h1 className={cx("font-display text-[21px] font-semibold leading-[1.25]", pill ? "mt-2.5" : "mt-1")}>{title}</h1>
      {line1 && <p className="mt-1 text-[15px]">{line1}</p>}
      {line2 && <p className="mt-0.5 text-[13px] text-sub">{line2}</p>}
      {children}
    </div>
  );
}

/** Call · Text · Directions (44px, blue text, thin line). */
export function ContactButtons({ phone, address }: { phone: string | null | undefined; address: string | null | undefined }) {
  const maps = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
  if (!phone && !maps) return null;
  const b = "flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line text-[15px] font-semibold text-hiv-blue";
  return (
    <div className="mt-3 flex gap-2">
      {phone && <a href={`tel:${phone}`} className={b}>Call</a>}
      {phone && <a href={`sms:${phone}`} className={b}>Text</a>}
      {maps && <a href={maps} target="_blank" rel="noreferrer" className={b}>Directions</a>}
    </div>
  );
}

/** The one NEXT panel: mist background, eyebrow, title, sub, then whatever the page puts inside. */
export function NextPanel({ eyebrow = "Next", title, sub, children }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section aria-label="Next" data-next-panel className="rounded-[18px] bg-mist p-4">
      <p className="text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">{eyebrow}</p>
      <h2 className="mt-1.5 text-[17px] font-semibold leading-[1.3]">{title}</h2>
      {sub && <p className="mt-1 text-sm leading-[1.45] text-sub">{sub}</p>}
      {children}
    </section>
  );
}

/** The primary (blue) button — one per screen. */
export function PrimaryButton({ className, asChild, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const cls = cx("flex min-h-12 w-full items-center justify-center rounded-xl bg-hiv-blue px-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45", className);
  if (asChild && React.isValidElement(p.children)) return React.cloneElement(p.children as React.ReactElement<{ className?: string }>, { className: cls });
  return <button type="button" {...p} className={cls} />;
}
export const primaryLinkClass = "flex min-h-12 w-full items-center justify-center rounded-xl bg-hiv-blue px-4 text-base font-semibold text-white";
export const outlineLinkClass = "flex min-h-12 w-full items-center justify-center rounded-xl border border-line px-4 text-[15px] font-semibold text-hiv-blue";

/** Quiet secondary button (white, thin line, blue text). */
export function QuietButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cx("flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-paper px-4 text-[15px] font-semibold text-hiv-blue disabled:opacity-45", className)} />;
}

/** Uppercase grey group heading with a thin line, then rows. */
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-group={title}>
      <h2 className="border-b border-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-sub">{title}</h2>
      {children}
    </section>
  );
}

const TONE = { green: "text-hiv-green font-semibold", plain: "font-medium", sub: "text-sub", bold: "font-semibold" } as const;
/** label · value row, 48px, thin line below. */
export function Row({ label, value, tone = "plain", last = false }: { label: React.ReactNode; value: React.ReactNode; tone?: keyof typeof TONE; last?: boolean }) {
  return (
    <div className={cx("flex min-h-12 items-center justify-between gap-3 text-[15px]", !last && "border-b border-line")}>
      <span className="shrink-0 text-sub">{label}</span>
      <span className={cx("min-w-0 text-right", TONE[tone])}>{value}</span>
    </div>
  );
}

/** Blue link row with a chevron ("Open Mitti form ›"). */
export function LinkRow({ children, onClick, href, to, params, muted = false, border = false }: { children: React.ReactNode; onClick?: () => void; href?: string; to?: string; params?: Record<string, string>; muted?: boolean; border?: boolean }) {
  const cls = cx("flex min-h-12 w-full items-center justify-between gap-3 text-left text-[15px]", muted ? "text-sub" : "font-semibold text-hiv-blue", border && "border-y border-line");
  const inner = <><span>{children}</span><span className="text-xl text-sub">›</span></>;
  if (to) return <Link to={to as never} params={params as never} className={cls}>{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** Small grey note under a group. */
export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cx("mt-1.5 text-[13px] leading-[1.45] text-sub", className)}>{children}</p>;
}

/** 3-column day grid (44px tiles, blue outline when picked). `more` adds a "More days" tile that reveals the rest. */
export function DayGrid({ days, picked, onToggle, label, initial = 5 }: { days: string[]; picked: string[]; onToggle: (d: string) => void; label: (d: string) => string; initial?: number }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? days : days.slice(0, initial);
  const hidden = days.length - shown.length;
  return (
    <div className="mt-3.5 grid grid-cols-3 gap-2">
      {shown.map((d) => { const on = picked.includes(d); return (
        <button key={d} type="button" aria-pressed={on} onClick={() => onToggle(d)} className={cx("flex min-h-11 items-center justify-center rounded-xl border bg-paper px-1 text-sm", on ? "border-[1.5px] border-hiv-blue font-semibold text-hiv-blue" : "border-line text-ink")}>{on ? "✓ " : ""}{label(d)}</button>
      ); })}
      {hidden > 0 && <button type="button" onClick={() => setAll(true)} className="flex min-h-11 items-center justify-center rounded-xl border border-line bg-paper text-sm text-sub">More days</button>}
    </div>
  );
}

/** "Arrival time for each day" rows with a time select on the right. */
export function TimeRows({ rows }: { rows: { key: string; label: string; value: string; options: readonly string[]; optionLabel: (t: string) => string; onChange: (t: string) => void }[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3.5">
      <p className="text-[13px] text-sub">Arrival time for each day</p>
      {rows.map((r, i) => (
        <div key={r.key} className={cx("flex min-h-11 items-center justify-between gap-2 text-[15px]", i < rows.length - 1 && "border-b border-line")}>
          <span>{r.label}</span>
          <select aria-label={`Arrival time ${r.label}`} value={r.value} onChange={(e) => r.onChange(e.target.value)} className="min-h-10 rounded-[10px] border border-line bg-paper px-3 text-[15px] font-semibold text-ink">
            <option value="">Time ▾</option>
            {r.options.map((t) => <option key={t} value={t}>{r.optionLabel(t)}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

/** Green tick / empty box check line (M4). */
export function CheckLine({ on, onClick, children }: { on: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="flex min-h-10 w-full items-center gap-2.5 text-left text-sm">
      <span className={cx("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-[13px] font-bold", on ? "bg-hiv-green text-white" : "border border-line bg-paper")}>{on ? "✓" : ""}</span>
      {children}
    </button>
  );
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return children ? <p role="alert" className="mt-2 rounded-xl border border-rose/40 bg-paper p-3 text-sm text-rose">{children}</p> : null;
}

/** Money / status pill (payPill tones). */
export function Pill({ tone, children }: { tone: "blue" | "blush" | "mint"; children: React.ReactNode }) {
  const t = { blue: "bg-mist text-hiv-blue", blush: "bg-[#FBEFF1] text-[#8A3B4A]", mint: "bg-[#E9FBF1] text-[#0A7A43]" }[tone];
  return <span className={cx("inline-block rounded-full px-2.5 py-[3px] text-xs font-semibold", t)}>{children}</span>;
}

export const dayTileLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`)).replace(",", "");
