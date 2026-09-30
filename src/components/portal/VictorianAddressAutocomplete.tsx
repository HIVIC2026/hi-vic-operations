import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ADDRESS_DEBOUNCE_MS, ADDRESS_MAX_SUGGESTIONS, ADDRESS_MIN_CHARS, WHATIF_ADDRESS_COPY, acceptSelectedAddress, type AddressDetails, type AddressSuggestion, type SelectedAddress } from "@/lib/whatif-location";

export type AddressProvider = { search: (q: string) => Promise<AddressSuggestion[]>; details: (id: string) => Promise<AddressDetails | null> };

/** Type-ahead Victorian address lookup (same service as the website form). Selection is local state only. */
export function VictorianAddressAutocomplete({ provider, onSelect }: { provider: AddressProvider; onSelect: (a: SelectedAddress | null) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (selected !== null && text === selected) return;
    const q = text.trim();
    if (q.length < ADDRESS_MIN_CHARS) { setItems([]); setOpen(false); setMsg(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = (await provider.search(q)).slice(0, ADDRESS_MAX_SUGGESTIONS);
        if (mine !== seq.current) return;
        setItems(r); setOpen(true); setActive(-1); setMsg(r.length ? null : WHATIF_ADDRESS_COPY.noResults);
      } catch { if (mine === seq.current) { setItems([]); setOpen(false); setMsg(WHATIF_ADDRESS_COPY.providerError); } }
      finally { if (mine === seq.current) setLoading(false); }
    }, ADDRESS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, selected, provider]);

  const change = (v: string) => {
    setText(v);
    if (selected !== null) { setSelected(null); onSelect(null); } // editing invalidates the alternate location
  };
  const choose = async (s: AddressSuggestion) => {
    setOpen(false); setItems([]); seq.current++;
    setLoading(true);
    try {
      const r = acceptSelectedAddress(await provider.details(s.id));
      if (!r.ok) { setMsg(WHATIF_ADDRESS_COPY.notVic); onSelect(null); setText(s.label); return; }
      setText(r.address.label); setSelected(r.address.label); setMsg(null); onSelect(r.address);
    } catch { setMsg(WHATIF_ADDRESS_COPY.providerError); onSelect(null); }
    finally { setLoading(false); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); void choose(items[active]!); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };
  const listId = `${id}-list`;
  return (
    <div className="relative" data-testid="address-autocomplete">
      <label className="block font-semibold" htmlFor={`${id}-input`}>{WHATIF_ADDRESS_COPY.label}</label>
      <div className="relative mt-1">
        <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off" maxLength={200} className="h-12 w-full rounded-xl border border-estimate-blue bg-estimate-white px-3 pr-10 text-estimate-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          value={text} placeholder={WHATIF_ADDRESS_COPY.placeholder} onChange={(e) => change(e.target.value)} onKeyDown={onKey} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {loading && <Loader2 aria-label="Searching addresses" className="absolute right-3 top-3.5 size-5 animate-spin text-estimate-blue" />}
      </div>
      {open && items.length > 0 && <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-estimate-blue-soft bg-estimate-white shadow-lg">
        {items.map((s, i) => <li key={s.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
          className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm text-estimate-navy break-words ${i === active ? "bg-estimate-green-soft" : "hover:bg-estimate-blue-pale"}`}
          onMouseDown={(e) => { e.preventDefault(); void choose(s); }}>{s.label}</li>)}
      </ul>}
      {msg && <p role="status" className="mt-2 text-sm font-bold text-estimate-navy">{msg}</p>}
      {!selected && !msg && text.trim().length >= ADDRESS_MIN_CHARS && !open && !loading && <p className="mt-2 text-xs font-semibold">{WHATIF_ADDRESS_COPY.selectPrompt}</p>}
    </div>
  );
}
