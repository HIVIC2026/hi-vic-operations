// Trade-frame building blocks (same look as My work, Money and My business). Drop-in names so partner pages
// can switch from the office look without changing their logic.
import * as React from "react";
import { Button as BaseButton } from "@/components/ui/button";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("rounded-[18px] bg-card p-5 text-estimate-navy shadow-sm", className)} />;
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
    <section className="rounded-[18px] bg-card p-5 text-estimate-navy shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-bold">{title}</h2>{right ?? action}</div>
      {children}
    </section>
  );
}

type Tone = "default" | "secondary" | "destructive" | "outline" | "ok" | "info" | "alert";
const TONE: Record<Tone, string> = {
  default: "bg-estimate-green/15 text-estimate-navy",
  ok: "bg-estimate-green/15 text-estimate-navy",
  secondary: "bg-estimate-blue/10 text-estimate-blue",
  info: "bg-estimate-blue/10 text-estimate-blue",
  destructive: "bg-owner-house-pink text-estimate-navy",
  alert: "bg-owner-house-pink text-estimate-navy",
  outline: "border border-estimate-line text-estimate-navy",
};
export function Badge({ variant = "default", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { variant?: Tone }) {
  return <span {...p} className={cx("inline-flex items-center rounded-full px-3 py-1 text-xs font-bold", TONE[variant], className)} />;
}

/** Pill buttons in the trade colours: default = green, outline = white with a line, ghost = text. */
export const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof BaseButton>>(function Button({ variant = "default", className, ...p }, ref) {
  const look = variant === "default" ? "rounded-full bg-estimate-green font-bold text-white hover:bg-estimate-green/90"
    : variant === "outline" ? "rounded-full border border-estimate-line bg-card font-bold text-estimate-navy hover:bg-estimate-canvas"
    : variant === "ghost" ? "rounded-full font-bold text-estimate-blue" : "rounded-full";
  return <BaseButton ref={ref} variant={variant === "default" || variant === "outline" || variant === "ghost" ? "ghost" : variant} {...p} className={cx(look, className)} />;
});
