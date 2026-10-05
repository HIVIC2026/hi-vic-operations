import { HOUSE_COLORS, clampLevel, houseStripes } from "@/lib/owner-house.core";
import { cn } from "@/lib/utils";

/** Signature owner house. level 0–5 = filled insulation stripes (bottom-up). */
export function OwnerHouse({ level, size = "lg", className }: { level: number; size?: "sm" | "lg"; className?: string }) {
  const lv = clampLevel(level);
  return (
    <svg
      viewBox="0 0 120 110"
      role="img"
      aria-label={`Your home, ${lv} of 5 steps done`}
      className={cn(size === "sm" ? "h-16 w-[70px]" : "h-32 w-[140px]", "shrink-0 text-estimate-navy", className)}
    >
      {houseStripes().map((s) => (
        <rect
          key={s.i}
          x={s.x} y={s.y} width={s.w} height={s.h} rx={1.5}
          fill={s.i < lv ? HOUSE_COLORS.pink : HOUSE_COLORS.mist}
          stroke={s.i < lv ? "none" : "#E4E9F5"}
          strokeWidth={0.8}
          className="transition-[fill] duration-[400ms] ease-out motion-reduce:transition-none"
        />
      ))}
      <g fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 54 L60 6 L114 54" />
        <path d="M18 52 V104 H102 V52" />
        <path d="M50 104 V78 H70 V104" />
      </g>
    </svg>
  );
}
