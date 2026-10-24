// Presentation pieces for Jo's approved owner pages (24 Oct 2026, P1–P4 mock-ups in docs/templates/approved).
// PURE PRESENTATION: no server reads, no workflow, price or access decisions — pages pass in facts they already have
// and keep their own server functions, validation and guards. Phone-first (390px, 16px gutters, no horizontal scroll).
import { useState, type ReactNode } from "react";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { OWNER_PAGE_FOOTER, THIRTY_DAY_CLOCK } from "@/lib/owner-pages.core";

/** White top bar: logo left, job number right (P2–P4). */
export function OwnerPageHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-estimate-line bg-card">
      <div className="mx-auto flex max-w-[560px] items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto max-w-[120px] object-contain object-left" />
        {right && <span className="text-xs text-estimate-sub">{right}</span>}
      </div>
    </header>
  );
}

/** Green uppercase eyebrow + headline + grey sub line. */
export function PageIntro({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-estimate-logo-green">{kicker}</p>
      <h1 className="mt-1 font-display text-[25px] font-extrabold leading-[1.2]">{title}</h1>
      {children && <div className="mt-1.5 text-sm leading-relaxed text-estimate-sub">{children}</div>}
    </div>
  );
}

/** Soft blue info box ("Why we need this", "Your rights"). */
export function InfoBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[14px] bg-estimate-panel px-4 py-3.5 text-sm leading-relaxed ${className}`}>{children}</div>;
}

/** White bordered form card with a small grey uppercase eyebrow. */
export function FormCard({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return <section className="rounded-[14px] border border-estimate-line bg-card px-4 py-3.5">{eyebrow && <p className="text-xs font-bold uppercase tracking-[0.1em] text-estimate-sub">{eyebrow}</p>}{children}</section>;
}

export function SectionTitle({ children, className = "mt-4" }: { children: ReactNode; className?: string }) {
  return <h2 className={`${className} font-display text-[15px] font-bold`}>{children}</h2>;
}

/** Label / value rows (Section 1 of the consent, Section 2 of the VEEC form). */
export function FactRows({ rows, labelWidth = "40%" }: { rows: { label: string; value: string }[]; labelWidth?: string }) {
  return (
    <table className="mt-1 w-full border-collapse"><tbody>
      {rows.map((r) => <tr key={r.label} className="border-t border-estimate-line align-top"><td className="py-1.5 pr-3 text-[13px] text-estimate-sub" style={{ width: labelWidth }}>{r.label}</td><td className="py-1.5 text-sm font-bold break-words">{r.value}</td></tr>)}
    </tbody></table>
  );
}

/** Approved tick card: square box, bold line, optional grey sub text with a "Read … ›" expander. */
export function TickCard({ on, set, title, sub, read, readBody, bold = true, disabled }: {
  on: boolean; set: (b: boolean) => void; title: ReactNode; sub?: ReactNode; read?: string; readBody?: ReactNode; bold?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-[12px] border border-estimate-line bg-card px-3.5 py-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" className="peer sr-only" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
        <span aria-hidden className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] border-2 border-estimate-blue text-sm font-bold text-estimate-blue peer-focus-visible:ring-2 peer-focus-visible:ring-estimate-blue/40 ${on ? "bg-estimate-selected" : "bg-card"}`}>{on ? "✓" : ""}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] leading-[1.4] ${bold ? "font-bold" : ""}`}>{title}</span>
          {(sub || read) && <span className="mt-0.5 block text-[13px] leading-relaxed text-estimate-sub">{sub}{read && <> <button type="button" className="font-bold text-estimate-blue" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} aria-expanded={open}>{read}</button></>}</span>}
        </span>
      </label>
      {open && readBody && <div className="mt-3 max-h-[320px] overflow-y-auto rounded-[10px] bg-estimate-panel p-3 text-sm leading-relaxed whitespace-pre-wrap">{readBody}</div>}
    </div>
  );
}

/** Small bold label over a bordered input. */
export function TypedField({ label, value, onChange, placeholder, italic = false, autoComplete }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; italic?: boolean; autoComplete?: string }) {
  return (
    <label className="mt-2.5 block">
      <span className="mb-1 block text-xs font-bold">{label}</span>
      <input className={`h-12 w-full rounded-[10px] border border-estimate-field-line bg-card px-3 text-[15px] placeholder:text-[#9AA6BF] ${italic ? "font-display italic" : ""}`} value={value} placeholder={placeholder} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Owner / signing-for-the-owner choice: the record keeps the authority type behind the approved "18 or over … or authorised" tick. */
export function AuthorityChoice({ value, onChange }: { value: "owner" | "authorised_representative"; onChange: (v: "owner" | "authorised_representative") => void }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who is signing">
      {(["owner", "authorised_representative"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={`min-h-11 rounded-[10px] border px-2 text-[13px] font-bold ${value === k ? "border-estimate-blue bg-estimate-selected text-estimate-blue" : "border-estimate-field-line bg-card"}`}>{k === "owner" ? "I'm the owner" : "Signing for the owner"}</button>)}
    </div>
  );
}

/** Big rounded button: grey while locked, green once everything is done. */
export function LockedButton({ ready, busy, busyLabel, onClick, children }: { ready: boolean; busy?: boolean; busyLabel?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={!ready || busy} aria-disabled={!ready || busy} onClick={onClick} className={`mt-4 flex min-h-14 w-full items-center justify-center rounded-[14px] px-4 text-center text-[17px] font-bold text-white ${ready && !busy ? "bg-estimate-green" : "bg-estimate-locked"}`}>{busy && busyLabel ? busyLabel : children}</button>;
}
/** Amber "Tick all … and type your name" line under a locked button. */
export function LockHint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-center text-[13px] font-bold text-estimate-amber">{children}</p>;
}
export function SmallNote({ children, className = "mt-2.5" }: { children: ReactNode; className?: string }) {
  return <p className={`${className} text-center text-xs leading-relaxed text-estimate-sub`}>{children}</p>;
}
export function OwnerFooter() {
  return <p className="mt-7 text-[11px] leading-relaxed text-estimate-sub">{OWNER_PAGE_FOOTER}</p>;
}

/** Decision 137: the red "⏰ The 30-day clock" box. `expiresOn` ("5 December") gives the fixes-quote wording. */
export function ThirtyDayClock({ expiresOn, className = "" }: { expiresOn?: string | null; className?: string }) {
  return (
    <aside role="note" data-testid="thirty-day-clock" className={`rounded-[14px] border border-estimate-red-line bg-estimate-red-soft px-4 py-3.5 ${className}`}>
      <p className="text-[15px] font-bold text-estimate-red">{THIRTY_DAY_CLOCK.title}</p>
      <p className="mt-1 text-sm leading-[1.55] text-estimate-navy">{expiresOn
        ? <><strong>{THIRTY_DAY_CLOCK.fixesLead}</strong>{THIRTY_DAY_CLOCK.fixesBefore}<strong>{expiresOn}</strong>{THIRTY_DAY_CLOCK.fixesAfter}</>
        : <><strong>{THIRTY_DAY_CLOCK.lead}</strong>{THIRTY_DAY_CLOCK.body}</>}</p>
    </aside>
  );
}
