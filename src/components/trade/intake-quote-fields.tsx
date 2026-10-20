import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "./trade-ui";
import { parseProposedR, selectRemovalAnswer, type RemovalInput } from "@/lib/intake-quote-details.core";
import { ORIGINAL_STATUS_NOTE, type CommercialInput } from "@/lib/installer-quote-commercial.core";

export function ProposedRField({ value, onChange, disabled = false }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const parsed = parseProposedR(value);
  const [other, setOther] = useState(false);
  const standard = parsed != null && [5, 6, 7].includes(parsed);
  const custom = other || (!!value && !standard);
  return <div className="space-y-2"><p className="text-sm font-bold">Proposed installed R-value</p>
    <Select disabled={disabled} value={custom ? "other" : standard ? String(parsed) : "unknown"} onValueChange={(v) => { setOther(v === "other"); onChange(v === "unknown" || v === "other" ? "" : v); }}>
      <SelectTrigger aria-label="Proposed installed R-value" className="h-12"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="unknown">Not yet known</SelectItem>{[5, 6, 7].map((r) => <SelectItem key={r} value={String(r)}>R{r}.0</SelectItem>)}<SelectItem value="other">Other</SelectItem></SelectContent>
    </Select>
    {custom && <label className="block text-sm">Custom R-value<Input disabled={disabled} className="mt-1 h-12" placeholder="e.g. R5.5" value={value} onChange={(e) => onChange(e.target.value)} /></label>}
  </div>;
}
export function RemovalQuoteFields({ value, onChange, disabled = false }: { value: RemovalInput; onChange: (v: RemovalInput) => void; disabled?: boolean }) {
  // Physical site fact only (Jo 20 Oct). How removal is priced is asked with the quote.
  return <fieldset disabled={disabled} className="space-y-2"><legend className="text-sm font-bold">Does existing insulation need to be removed?</legend>
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Removal required">{([['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not sure']] as const).map(([answer, label]) => <Button key={answer} size="field" variant={value.answer === answer ? "default" : "outline"} role="radio" aria-checked={value.answer === answer} className="h-auto min-h-12 whitespace-normal text-xs" onClick={() => { if (answer === value.answer) return; onChange(selectRemovalAnswer(value, answer)); }}>{label}</Button>)}</div>
    {value.answer === "yes" && <label className="block text-sm font-bold">Removal area (m²)<span className="block text-xs font-normal text-sub">Leave blank if not measured yet</span><Input className="mt-1 h-12" inputMode="decimal" value={value.area} onChange={(e) => onChange({ ...value, area: e.target.value })} /></label>}
  </fieldset>;
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return <div className="space-y-1"><p className="text-sm font-bold">{label}</p>
    <div className={`grid gap-2 ${options.length > 2 ? "grid-cols-3" : "grid-cols-2"}`} role="radiogroup" aria-label={label}>{options.map(([v, l]) => <Button key={v} size="field" variant={value === v ? "default" : "outline"} role="radio" aria-checked={value === v} className="h-auto min-h-12 whitespace-normal text-xs" onClick={() => onChange(v)}>{l}</Button>)}</div></div>;
}
const PRICING_OPTS = [["included", "In works total"], ["additional", "Additional price"], ["not_priced", "Not priced"]] as const;

/** The installer's OWN quote facts (before VEU discount). Missing answers save as a draft; the office can't send until clear. */
export function QuoteCommercialFields({ value, onChange, removalRequired, disabled = false }: { value: CommercialInput; onChange: (v: CommercialInput) => void; removalRequired: boolean; disabled?: boolean }) {
  const set = (p: Partial<CommercialInput>) => onChange({ ...value, ...p });
  return <fieldset disabled={disabled} className="space-y-3" data-commercial-fields>
    <Choice label="Is your price before the VEU discount?" value={value.basis} options={[["before_discount", "Before discount"], ["after_discount", "Already discounted"], ["unsure", "Not sure"]]} onChange={(basis) => set({ basis })} />
    {value.basis === "after_discount" && <p className="text-xs text-sub">Saved for review. The office needs your price before the discount so the discount is applied once.</p>}
    <Choice label="Does the amount include GST?" value={value.gst} options={[["inc_gst", "Includes GST"], ["ex_gst", "Excludes GST"], ["unsure", "Not sure"]]} onChange={(gst) => set({ gst })} />
    {value.gst === "ex_gst" && <p className="text-xs text-sub">Saved for review. Please enter the amount including GST — we never calculate GST for you.</p>}
    <Choice label="Your quote to the customer" value={value.originalStatus} options={[["prepared", "Prepared"], ["sent", "Sent"], ["accepted_by_customer", "Accepted"]]} onChange={(originalStatus) => set({ originalStatus })} />
    <p className="text-xs text-sub">{ORIGINAL_STATUS_NOTE}</p>
    <label className="block text-sm font-bold">What your quote excludes<span className="block text-xs font-normal text-sub">Optional</span><Input className="mt-1 h-12" value={value.exclusions ?? ""} onChange={(e) => set({ exclusions: e.target.value })} /></label>
    {removalRequired && <><Choice label="How is removal priced?" value={value.removalPricing} options={PRICING_OPTS} onChange={(removalPricing) => set({ removalPricing })} />
      {value.removalPricing === "additional" && <label className="block text-sm font-bold">Agreed removal price inc GST<Input className="mt-1 h-12" inputMode="decimal" value={value.removalAmount} onChange={(e) => set({ removalAmount: e.target.value })} /></label>}
      {value.removalPricing === "included" && <p className="text-xs text-sub">Removal is inside your works total and is not added again.</p>}</>}
    <div className="space-y-2"><p className="text-sm font-bold">Extra charges (tile lift, metal roof access, difficult access…)</p>
      {value.extras.map((x, n) => <div key={n} className="space-y-2 rounded-lg border p-2" data-extra-row>
        <Input aria-label={`Extra ${n + 1} description`} className="h-12" placeholder="Describe the extra" value={x.description} onChange={(e) => set({ extras: value.extras.map((y, k) => k === n ? { ...y, description: e.target.value } : y) })} />
        <Choice label={`Extra ${n + 1} pricing`} value={x.pricing} options={PRICING_OPTS} onChange={(pricing) => set({ extras: value.extras.map((y, k) => k === n ? { ...y, pricing } : y) })} />
        {x.pricing === "additional" && <Input aria-label={`Extra ${n + 1} price inc GST`} className="h-12" inputMode="decimal" placeholder="Agreed price inc GST" value={x.amount} onChange={(e) => set({ extras: value.extras.map((y, k) => k === n ? { ...y, amount: e.target.value } : y) })} />}
        <Button size="field" variant="outline" className="h-12" onClick={() => set({ extras: value.extras.filter((_, k) => k !== n) })}>Remove extra</Button>
      </div>)}
      {value.extras.length < 20 && <Button size="field" variant="outline" className="h-12" onClick={() => set({ extras: [...value.extras, { description: "", pricing: "included", amount: "" }] })}>Add an extra charge</Button>}
    </div>
  </fieldset>;
}
