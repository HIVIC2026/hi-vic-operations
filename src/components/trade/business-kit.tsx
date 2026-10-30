// My business presentation pieces (approved installer mock-up M7, decision 204). PURE presentation: tokens navy/blue/
// green/mist/line/sub from the estimate brand, 44px+ targets, one primary button per screen. No domain rules here.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const M7 = {
  title: "font-display text-[22px] font-semibold leading-[1.2] text-estimate-navy",
  sub: "text-sm text-estimate-sub",
  primary: "flex min-h-12 w-full items-center justify-center rounded-[12px] bg-estimate-blue px-4 text-base font-semibold text-white disabled:opacity-45",
} as const;

export function Chevron() { return <span aria-hidden className="text-xl leading-none text-estimate-sub">›</span>; }

export function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="border-b border-estimate-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-estimate-sub">{children}</h2>;
}

/** One file row: title, one fact line, chevron. `warn` colours a fragment of the sub line (e.g. "expires 11 Nov"). */
export function FileRow({ to, title, sub, warn, testId }: { to: string; title: string; sub: React.ReactNode; warn?: boolean; testId?: string }) {
  return (
    <Link to={to as never} data-row={testId} className="flex min-h-14 items-center gap-3 border-b border-estimate-line py-2 text-estimate-navy">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className={`mt-0.5 block text-[13px] ${warn ? "font-semibold text-[#8A3B4A]" : "text-estimate-sub"}`}>{sub}</span>
      </span>
      <Chevron />
    </Link>
  );
}

/** Green pill switch, 50×30, 44px row. */
export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-block h-[30px] w-[50px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-estimate-green" : "bg-estimate-locked"}`}>
      <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[23px]" : "left-[3px]"}`} />
    </button>
  );
}

export function BackToBusiness({ label = "My business", to = "/field/business" }: { label?: string; to?: string }) {
  return <Link to={to as never} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-estimate-blue"><ChevronLeft className="h-4 w-4" />{label}</Link>;
}
