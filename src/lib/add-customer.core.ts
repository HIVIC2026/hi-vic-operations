// Pure checks for the installer's "Add your own customer" form. Never prices or decides eligibility.

export type A1Area = { name: string; length: string; width: string; existing: boolean | null; type: string; depth: string; depthPhoto: string | null; action: "remove" | "top_up" | null; downlights: string; hazards: string; hazardPhoto: string | null };

export function areaTotal(areas: A1Area[]): number {
  return Math.round(areas.reduce((s, a) => { const m = Number(a.length) * Number(a.width); return s + (Number.isFinite(m) && m > 0 ? m : 0); }, 0) * 10) / 10;
}

export type AddCustomerInput = {
  owner: { full_name: string; email: string; phone: string; address_line: string; rough: string };
  progress: "not_visited" | "measured" | "quoted" | null;
  areas: A1Area[]; how: string; roof5: boolean | null; sketch: boolean; access: boolean;
  lines: { code: string; qty: number }[]; agreed: boolean | null;
};

/** Plain-words list of what's missing. Empty = ready to send. */
export function addCustomerProblems(x: AddCustomerInput): string[] {
  const p: string[] = [];
  if (x.owner.full_name.trim().length < 2) p.push("Owner name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.owner.email.trim())) p.push("Owner email");
  if (x.owner.phone.replace(/\D/g, "").length < 8) p.push("Owner mobile");
  if (x.owner.address_line.trim().length < 3) p.push("Street address");
  if (!x.progress) p.push("Where you're up to");
  if (x.progress === "not_visited") { const r = Number(x.owner.rough); if (!(r > 0 && r < 5000)) p.push("Rough ceiling size"); return p; }
  if (!x.progress) return p;
  x.areas.forEach((a, i) => {
    const n = a.name.trim() || `Area ${i + 1}`;
    if (!(Number(a.length) > 0 && Number(a.width) > 0)) p.push(`${n}: length and width`);
    if (a.existing === null) p.push(`${n}: existing insulation yes or no`);
    if (a.existing) {
      if (!a.type.trim()) p.push(`${n}: insulation type`);
      if (!(Number(a.depth) >= 0 && a.depth !== "")) p.push(`${n}: insulation depth`);
      if (!a.depthPhoto) p.push(`${n}: depth photo`);
      if (!a.action) p.push(`${n}: remove or top up`);
    }
    if (a.hazards.trim() && !a.hazardPhoto) p.push(`${n}: hazard photo`);
  });
  if (!x.how) p.push("How you measured");
  if (!x.sketch) p.push("Area sketch or floor plan");
  // Jo 26 Oct 2026: the ceiling access (hatch) photo is kept but not mandatory — never listed as missing.
  if (x.roof5 === null) p.push("Roof built or replaced in the last 5 years");
  const codes = x.lines.filter((l) => l.code && l.qty > 0).map((l) => l.code);
  if (!codes.some((c) => /R5/i.test(c))) p.push("An R5.0 price line");
  if (x.areas.some((a) => a.action === "remove") && !codes.some((c) => /REMOVAL/i.test(c))) p.push("A removal price line");
  if (x.progress === "quoted" && x.agreed === null) p.push("Whether the owner has agreed");
  return p;
}
