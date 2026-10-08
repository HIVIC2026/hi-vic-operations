// Trade-frame building blocks (same look as My work, Money and My business). Drop-in names so partner pages
// can switch from the office look without changing their logic.
import * as React from "react";
import { Button as BaseButton } from "@/components/ui/button";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("rounded-[18px] border border-line bg-paper p-[19px] text-ink shadow-card", className)} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("mb-3", className)} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...p} className={cx("font-display text-xl font-bold", className)} />;
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("space-y-3", className?.replace(/\bp-\d+\b/g, ""))} />;
}

/** Trade section card: bold heading, then content. */
export function Section({ title, children, right, action }: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-line bg-paper p-[19px] text-ink shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-bold">{title}</h2>{right ?? action}</div>
      {children}
    </section>
  );
}

type Tone = "default" | "secondary" | "destructive" | "outline" | "ok" | "info" | "alert";
const TONE: Record<Tone, string> = {
  default: "bg-mint text-hiv-green", ok: "bg-mint text-hiv-green",
  secondary: "bg-mist text-hiv-blue", info: "bg-mist text-hiv-blue",
  destructive: "bg-pink text-rose", alert: "bg-pink text-rose",
  outline: "border border-line text-sub",
};
export function Badge({ variant = "default", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { variant?: Tone }) {
  return <span {...p} className={cx("inline-flex items-center whitespace-nowrap rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold", TONE[variant], className)} />;
}

/** Pill buttons in the trade colours: default = green, outline = white with a line, ghost = text. */
export const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof BaseButton>>(function Button({ variant = "default", className, ...p }, ref) {
  const look = variant === "default" ? "rounded-[10px] bg-action text-[13px] font-bold text-action-foreground hover:bg-action/90 hover:text-action-foreground"
    : variant === "outline" ? "rounded-[10px] border border-line bg-paper text-[13px] font-bold text-hiv-blue hover:bg-mist hover:text-hiv-blue"
    : variant === "ghost" ? "rounded-[10px] text-[13px] font-bold text-hiv-blue hover:text-hiv-blue" : "rounded-[10px]";
  return <BaseButton ref={ref} variant={variant === "default" || variant === "outline" || variant === "ghost" ? "ghost" : variant} {...p} className={cx(look, className)} />;
});

/** Small Yes/No toggle (phase 1 style). Presentation only. */
export function YesNo({ value, onChange, disabled, label }: { value: boolean | null | undefined; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-[11px] bg-mist p-1">
      {[true, false].map((v) => <button key={String(v)} type="button" disabled={disabled} aria-pressed={value === v} onClick={() => onChange(v)} className={cx("min-h-9 min-w-14 rounded-[8px] border px-3 text-xs font-semibold disabled:opacity-50", value === v ? "border-line bg-paper text-ink" : "border-transparent text-sub")}>{v ? "Yes" : "No"}</button>)}
    </div>
  );
}
