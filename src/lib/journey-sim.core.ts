// Simulated Mitti forms for the live full-journey runner (journey.server.ts) — TEST jobs only. Pure: no I/O.
// The runner feeds these to the REAL Mitti sync (mitti.server syncMittiAssessment, which takes the Mitti call as a
// parameter) instead of a phone filling the form in Mitti, so every sync rule, evidence rule (decision 178) and stage
// gate still runs. The question wording is the portal's own (official-short.core / piesa-evidence.core), exactly as the
// journey tests' completed A3 (tests/helpers/journey-forms.ts completedA3Pass).
import { LIFE_SUPPORT_PRESENT, NO_PRICE_TALK_LABEL } from "./official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "./piesa-evidence.core";
import type { MittiCall } from "./mitti.core";

/** Frankston 3199 (the journey property's suburb): photos are geotagged there. */
export const JOURNEY_SITE = { lat: -38.1446, lng: 145.1257 };

type Item = { item_id: string; label: string; type: string; responses?: unknown; media?: unknown[] };

/** Mitti media ids are 32 hex characters (the signature reader only accepts those). */
export const simMediaId = (seed: string) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const c of seed) { h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619) >>> 0; h2 = Math.imul(h2 ^ c.charCodeAt(0), 2246822519) >>> 0; }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex((h1 + h2) >>> 0)}`;
};

/** The electrician's A3 PIESA, Complete, no repair work: mains, solar, wiring safe; no downlights or hazards; the
 *  switchboard and on-site photos geotagged at the property; declaration ticked and signed. */
export function simulatedA3PassAnswers(o: { seed: string; inspectionDate: string; capturedAt: string; electrician: string }) {
  const m = (n: string) => simMediaId(`${o.seed}-${n}`);
  let seq = 0;
  const id = () => `sim_a3_${++seq}`;
  const pick = (label: string, v: string): Item => ({ item_id: id(), label, type: "question", responses: { selected: [{ label: v }] } });
  const text = (label: string, v: string): Item => ({ item_id: id(), label, type: "textsingle", responses: { text: v } });
  const photo = (label: string, mediaId: string): Item => ({ item_id: id(), label, type: "media", media: [{ media_id: mediaId, captured_at: o.capturedAt, date_created: o.capturedAt, location: { ...JOURNEY_SITE } }] });
  const items: Item[] = [
    pick(NO_PRICE_TALK_LABEL, "Yes"),
    text("Date of inspection", o.inspectionDate),
    pick(LIFE_SUPPORT_PRESENT, "No"),
    pick("Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.", "Yes"),
    pick("Is there solar, a battery or a generator at the property?", "No"),
    pick("Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?", "Yes"),
    pick("Are there any downlights or other recessed lights in the ceiling?", "No"),
    pick("Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?", "No"),
    pick("Is any electrical repair work needed before insulation can be installed?", "No"),
    photo(PIESA_EVIDENCE_BY_ID.switchboard_photo.label, m("switchboard")),
    photo(PIESA_EVIDENCE_BY_ID.onsite_photo.label, m("onsite")),
    pick("I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", "Yes"),
    { item_id: id(), label: "Electrician signature", type: "signature", responses: { image: { media_id: m("signature"), timestamp: o.capturedAt }, name: o.electrician } },
  ];
  return { items };
}

// ---------------------------------------------------------------------------------------------------------------------
// A small in-memory Mitti for the A5 "Install day" form (decisions 262/328/396): the real createPiisaMittiAudit creates it
// here (template, assignee lookup, create, share, owner), and the lead installer's answers are filled in here. Never
// reaches Mitti; Mitti's PDF report is refused (there is no real form).
// ---------------------------------------------------------------------------------------------------------------------

type InstallDayQ = { n: number; label: string; type: string; options?: readonly string[] };
type SimItem = Item & { id?: string; question?: { response_set_id: string }; children?: SimItem[] };
export type SimAudit = { audit_id: string; template_id: string; completed: boolean; created_at: string; modified_at: string; items: SimItem[]; header_items: SimItem[] };

/** The "A5 – Install day" template as Mitti serves it: every question in the portal's wording, choice questions with their
 *  response sets (so the prefill picks real option ids). Same shape as the journey tests' installDayTemplate. */
export function simulatedInstallDayTemplate(questions: readonly InstallDayQ[]) {
  const kind: Record<string, string> = { yes_no: "question", pick_one: "question", photo: "media", video: "media", signature: "signature", date: "datetime", number: "textsingle", text: "textsingle", checkbox: "checkbox" };
  const response_sets: { id: string; responses: { id: string; label: string }[] }[] = [];
  const items: SimItem[] = questions.map((q) => {
    const item_id = `a5_${q.n}`;
    const opts = q.type === "yes_no" ? (q.options ?? ["Yes", "No"]) : q.type === "pick_one" ? (q.options ?? []) : null;
    if (opts) response_sets.push({ id: `rs_${q.n}`, responses: opts.map((label, i) => ({ id: `rs_${q.n}_${i}`, label })) });
    return { item_id, id: item_id, label: q.label, type: kind[q.type] ?? "textsingle", ...(opts ? { question: { response_set_id: `rs_${q.n}` } } : {}) };
  });
  return { items, response_sets };
}

export function simulatedMitti(o: { templates: Record<string, { items: SimItem[]; response_sets?: unknown[] }>; users: { id: string; email: string }[]; now?: () => string }) {
  const audits = new Map<string, SimAudit>();
  const now = o.now ?? (() => new Date().toISOString());
  let seq = 0;
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const call: MittiCall = async (method, path, body) => {
    const p = path.split("?")[0]!;
    if (method === "POST" && p === "/users/search") {
      const want = ((body as { email?: string[] } | undefined)?.email ?? []).map((e) => e.toLowerCase());
      return o.users.filter((u) => want.includes(u.email.toLowerCase())).map((u) => ({ id: u.id, email: u.email }));
    }
    const t = /^\/templates\/v1\/templates\/([^/]+)$/.exec(p);
    if (method === "GET" && t) { const id = decodeURIComponent(t[1]!); const tpl = o.templates[id]; if (!tpl) throw new Error(`Simulated Mitti: no template ${id}`); return { template: { template_id: id, ...clone(tpl) } }; }
    if (method === "POST" && p === "/audits") {
      const b = body as { template_id: string; items?: SimItem[]; header_items?: SimItem[] };
      const tpl = o.templates[b.template_id];
      if (!tpl) throw new Error(`Simulated Mitti: no template ${b.template_id}`);
      const given = new Map([...(b.items ?? []), ...(b.header_items ?? [])].map((i) => [i.item_id, i]));
      const items = tpl.items.map((x) => ({ ...clone(x), ...(given.get(x.item_id) ?? {}) }));
      for (const g of b.items ?? []) if (!items.some((i) => i.item_id === g.item_id)) items.push(clone(g));
      const id = `audit_sim_${Date.now().toString(36)}_${++seq}`;
      audits.set(id, { audit_id: id, template_id: b.template_id, completed: false, created_at: now(), modified_at: now(), items, header_items: [] });
      return { audit_id: id };
    }
    const a = /^\/audits\/([^/]+)(\/.*)?$/.exec(p) ?? /^\/inspections\/v1\/inspections\/([^/]+)(\/owner)$/.exec(p);
    if (a) {
      const audit = audits.get(decodeURIComponent(a[1]!));
      if (!audit) throw new Error(`Simulated Mitti: no audit ${a[1]}`);
      if (!a[2] && method === "GET") return clone(audit);
      if (a[2] === "/share" || a[2] === "/owner") return {};
      if (!a[2] && method === "PUT") {
        const b = body as { items?: SimItem[]; header_items?: SimItem[] };
        for (const it of [...(b.items ?? []), ...(b.header_items ?? [])]) { const ex = audit.items.find((x) => x.item_id === it.item_id); if (ex) Object.assign(ex, it); else audit.items.push(clone(it)); }
        audit.modified_at = now();
        return {};
      }
    }
    throw new Error(`Simulated Mitti form (TEST journey): no ${method} ${p}`);
  };
  /** The trade answers on their phone: each answer replaces the template question with the same wording (first one still
   *  unanswered); anything the template doesn't carry (repeat-section copies) is added. Then Complete. */
  const fill = (auditId: string, answered: SimItem[], opts: { complete?: boolean } = {}) => {
    const audit = audits.get(auditId);
    if (!audit) throw new Error(`Simulated Mitti: no audit ${auditId}`);
    const key = (l: string) => l.split("\n")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const used = new Set<string>();
    for (const ans of answered) {
      const same = (i: SimItem) => !used.has(i.item_id) && key(i.label) === key(ans.label);
      const slot = ans.label ? audit.items.find((i) => same(i) && !i.responses && !i.media) ?? audit.items.find(same) : undefined;
      if (slot) { Object.assign(slot, { ...clone(ans), item_id: slot.item_id, id: slot.id ?? slot.item_id }); used.add(slot.item_id); }
      else audit.items.push(clone(ans));
    }
    if (opts.complete ?? true) audit.completed = true;
    audit.modified_at = now();
  };
  /** A form that already exists in Mitti for this job (made at booking): held here under the same id so the answers are
   *  filled in and read back here — the real form in Mitti is never read or written. */
  const seed = (auditId: string, templateId: string) => {
    const tpl = o.templates[templateId];
    if (!tpl) throw new Error(`Simulated Mitti: no template ${templateId}`);
    if (!audits.has(auditId)) audits.set(auditId, { audit_id: auditId, template_id: templateId, completed: false, created_at: now(), modified_at: now(), items: clone(tpl.items), header_items: [] });
  };
  return { call, audits, fill, seed };
}

/** A template definition from answered items: the same questions, no answers. */
export const templateOfItems = (items: readonly { item_id: string; label: string; type: string }[]) => ({ items: items.map(({ item_id, label, type }) => ({ item_id, id: item_id, label, type })) });

/** The lead installer's completed "A5 – Install day" (alone on site, no solar, no life support, no electrician at the
 *  start): ID, isolation and product label photos, the declaration signed before work, one after video and depth photo
 *  per Ready Check area, the decision 396 ruler photos (one repeat copy per area: existing depth + new depth, geotagged
 *  and timed), power back on, the final "All filled in" tick and the closing signature. Same answers as the journey
 *  tests' completedA5. `q` = install-day.core INSTALL_DAY_Q, `ruler` = INSTALL_DAY_RULER_Q. */
export function simulatedCompletedA5(o: { q: Record<string, string>; ruler: { existingDepth: string; newDepth: string }; capturedAt: string; seed: string; lead: string; areas: number }) {
  const m = (n: string) => simMediaId(`${o.seed}-${n}`);
  let seq = 0;
  const id = () => `sim_a5_${++seq}`;
  const pick = (label: string, v: string): SimItem => ({ item_id: id(), label, type: "question", responses: { selected: [{ label: v }] } });
  const ticked = (label: string): SimItem => ({ item_id: id(), label, type: "checkbox", responses: { value: true } });
  const photo = (label: string, ids: string[]): SimItem => ({ item_id: id(), label, type: "media", media: ids.map((media_id) => ({ media_id, captured_at: o.capturedAt, date_created: o.capturedAt, location: { ...JOURNEY_SITE } })) });
  const signature = (label: string, mediaId: string): SimItem => ({ item_id: id(), label, type: "signature", responses: { image: { media_id: mediaId, timestamp: o.capturedAt }, name: o.lead } });
  const q = o.q;
  const areas = Math.max(1, o.areas);
  const ruler: SimItem[] = Array.from({ length: areas }, (_, i) => ({ item_id: `ruler_copy_${o.seed}_${i + 1}`, label: "", type: "section",
    children: [photo(o.ruler.existingDepth, [m(`ruler-existing-${i + 1}`)]), photo(o.ruler.newDepth, [m(`ruler-new-${i + 1}`)])] }));
  const videos = Array.from({ length: areas }, (_, i) => m(`after-video-${i + 1}`));
  const depth = Array.from({ length: areas }, (_, i) => m(`depth-${i + 1}`));
  const items: SimItem[] = [
    photo(q["leadPhoto"]!, [m("lead-id")]),
    pick(q["powerInformed"]!, "Yes"),
    pick(q["lifeSupport"]!, "No"),
    pick(q["swmsSigned"]!, "Yes"),
    pick(q["hazardsCovered"]!, "Yes"),
    pick(q["solar"]!, "No"),
    pick(q["isolated"]!, "Yes"),
    photo(q["isolationPhoto"]!, [m("isolation")]),
    pick(q["piesaRead"]!, "Yes"),
    pick(q["ceilingEntered"]!, "No"),
    photo(q["productPhotos"]!, [m("product")]),
    ...ruler,
    ticked(q["declaration"]!),
    signature(q["signature"]!, m("signature-start")),
    photo(q["afterVideos"]!, videos),
    photo(q["depthPhotos"]!, depth),
    pick(q["multiDay"]!, "No"),
    pick(q["lockoutOff"]!, "Yes"),
    pick(q["lockoutBy"]!, "Lead installer"),
    photo(q["switchboardOn"]!, [m("switchboard-on")]),
    pick(q["solarBack"]!, "There isn't one"),
    ticked(q["supervised"]!),
    ticked(q["allFilledIn"]!),
    signature(q["signature"]!, m("signature-end")),
  ];
  // Start of work = everything up to the signature under the declaration (captured before any work, decision 262);
  // the rest is filled in after the work, then the form is marked Complete.
  const startEnd = items.findIndex((i) => i.type === "signature") + 1;
  return { items, startItems: items.slice(0, startEnd), finishItems: items.slice(startEnd), videoIds: new Set(videos) };
}
