import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "./trade-ui";
import { parseProposedR, selectRemovalAnswer, type RemovalInput } from "@/lib/intake-quote-details.core";

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
  return <fieldset disabled={disabled} className="space-y-2"><legend className="text-sm font-bold">Does this quote include removal of existing insulation?</legend>
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Quote includes removal">{([['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not assessed']] as const).map(([answer, label]) => <Button key={answer} size="field" variant={value.answer === answer ? "default" : "outline"} role="radio" aria-checked={value.answer === answer} className="h-auto min-h-12 whitespace-normal text-xs" onClick={() => { if (answer === value.answer) return; onChange(selectRemovalAnswer(value, answer)); }}>{label}</Button>)}</div>
    {value.answer === "yes" && <><label className="block text-sm font-bold">Removal area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={value.area} onChange={(e) => onChange({ ...value, area: e.target.value })} /></label><label className="block text-sm font-bold">Removal charge inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="0 if no separate charge" value={value.charge} onChange={(e) => onChange({ ...value, charge: e.target.value })} /></label><p className="text-xs text-sub">This charge is already included in your total installer quote. It will not be added again. Enter 0 if included without a separate charge.</p></>}
  </fieldset>;
}