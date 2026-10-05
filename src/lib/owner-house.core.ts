// Signature owner house: navy outline, roof cavity with 5 insulation stripes filled bottom-up.
// Pure (no React) so the same drawing is used on owner screens and in owner emails.

export type HouseLevel = 0 | 1 | 2 | 3 | 4 | 5;
export const HOUSE_COLORS = { navy: "#22376B", pink: "#F4A9C7", mist: "#F3F6FF" } as const;

/** Fixed level per owner screen (Jo, 5 Oct). */
export const HOUSE_LEVEL = {
  save_my_spot: 0,
  ready_check_booked: 1,
  quote: 2,
  book_visits: 3,
  install: 4,
  all_done: 5,
} as const satisfies Record<string, HouseLevel>;

/** My job page: level follows the job's step. Presentation only — never moves a job. */
export function houseLevelForStage(stage: string): HouseLevel {
  if (stage === "complete" || stage === "ready_for_veec" || stage === "ap_review" || stage === "evidence_outstanding") return 5;
  if (["installation_booked", "installation_scheduling"].includes(stage)) return 4;
  if (["piesa_and_install_window_pending", "awaiting_electrician", "assessment_booking", "assessment_booked", "piesa_scheduled", "piesa_complete",
    "rectification_required", "electrical_variation_pending", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked",
    "measured_quote_accepted", "awaiting_deposit_payment"].includes(stage)) return 3;
  if (["ready_check_complete", "assessment_complete", "measured_estimate_ready", "ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(stage)) return 2;
  if (stage === "ready_check_scheduled") return 1;
  return 0;
}

export const clampLevel = (n: number): HouseLevel => Math.max(0, Math.min(5, Math.floor(n))) as HouseLevel;

/** Geometry shared by the React component and email SVG. viewBox 0 0 120 110. */
export function houseStripes() {
  // Roof triangle apex (60,8), eaves (10,52)/(110,52). Stripes stacked bottom-up inside the cavity.
  const top = 20, bottom = 50, n = 5, gap = 1.5, h = (bottom - top - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const y = bottom - (i + 1) * h - i * gap; // i=0 is the bottom stripe
    const halfAt = (yy: number) => ((yy - 8) / 44) * 50 - 3; // roof half-width at y, minus inset
    const w = Math.max(4, 2 * halfAt(y));
    return { i, x: 60 - w / 2, y, w, h };
  });
}

/** Inline SVG string for emails (no animation, fixed colours). */
export function ownerHouseSvg(level: number, size = 96): string {
  const lv = clampLevel(level);
  const stripes = houseStripes().map((s) => `<rect x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" width="${s.w.toFixed(1)}" height="${s.h.toFixed(1)}" rx="1.5" fill="${s.i < lv ? HOUSE_COLORS.pink : HOUSE_COLORS.mist}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 110 / 120)}" viewBox="0 0 120 110" role="img" aria-label="Your home, ${lv} of 5 steps done">${stripes}<path d="M6 54 L60 6 L114 54" fill="none" stroke="${HOUSE_COLORS.navy}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 52 V104 H102 V52" fill="none" stroke="${HOUSE_COLORS.navy}" stroke-width="4" stroke-linejoin="round"/><path d="M50 104 V78 H70 V104" fill="none" stroke="${HOUSE_COLORS.navy}" stroke-width="4" stroke-linejoin="round"/></svg>`;
}
