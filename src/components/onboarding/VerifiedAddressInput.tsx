import { useEffect, useRef, useState, type CSSProperties } from "react";
import { defaultAddressProvider } from "@/lib/address-provider";
import { isAustralianAddress, isVictorianAddress, keepPickedNumber, type ResolvedAddress } from "@/lib/trade-shared-consts.core";
import type { AddressDetails, AddressSuggestion } from "@/lib/whatif-location";

const DETAILS_TIMEOUT_MS = 10_000;

type AddressProvider = {
  search: (query: string) => Promise<AddressSuggestion[]>;
  details: (placeId: string) => Promise<AddressDetails | null>;
};

type Props = {
  value: string;
  resolved?: ResolvedAddress | null | undefined;
  onChange: (value: string) => void;
  onSelect: (value: ResolvedAddress | null) => void;
  /** A8: true when the lookup found nothing or is unavailable, false when results come back. */
  onNoMatch?: (none: boolean) => void;
  victoriaOnly?: boolean;
  id?: string;
  inputStyle: CSSProperties;
  mutedColor: string;
  provider?: AddressProvider;
  onPendingChange?: ((pending: boolean) => void) | undefined;
};

/** Verified Australian address picker. Free text never becomes a verified address. */
export function VerifiedAddressInput({ value, resolved, onChange, onSelect, victoriaOnly = false, id = "address", inputStyle, mutedColor, provider = defaultAddressProvider, onPendingChange, onNoMatch }: Props) {
  const [announce, setAnnounce] = useState("");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const searchSeq = useRef(0);
  const detailsSeq = useRef(0);
  const root = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const picking = useRef(false);
  const pickedLabel = useRef<string | null>(null);
  const mounted = useRef(true);
  const pendingCb = useRef(onPendingChange);
  pendingCb.current = onPendingChange;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; searchSeq.current += 1; detailsSeq.current += 1;
      if (picking.current) pendingCb.current?.(false);
      picking.current = false; pickedLabel.current = null;
    };
  }, []);
  useEffect(() => {
    if (resolved?.label !== value) return;
    searchSeq.current += 1;
    detailsSeq.current += 1;
    picking.current = false;
    pickedLabel.current = null;
    setEdited(false); setItems([]); setOpen(false); setActive(-1); setLoading(false); setNote("");
  }, [resolved, value]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current || event.composedPath().includes(root.current)) return;
      // Do not cancel the details request selected inside this picker. Previously this
      // incremented detailsSeq while `picking` stayed true forever, locking the field.
      searchSeq.current += 1;
      setFocused(false); setOpen(false); setItems([]); setActive(-1);
      if (!picking.current) setLoading(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    const q = value.trim();
    if (!focused || !edited || picking.current || (resolved && resolved.label === value)) { setItems([]); setOpen(false); if (!picking.current) setLoading(false); return; }
    if (q.length < 4) { searchSeq.current += 1; setItems([]); setOpen(false); setActive(-1); setLoading(false); setNote(""); return; }
    const mine = ++searchSeq.current;
    const timer = setTimeout(async () => {
      if (!mounted.current || mine !== searchSeq.current || picking.current) return;
      setLoading(true);
      try {
        const results = (await provider.search(q)).slice(0, 6);
        if (!mounted.current || mine !== searchSeq.current || picking.current) return;
        setItems(results); setActive(results.length ? 0 : -1); setOpen(true);
        setNote(results.length ? "" : "No Australian address matched. Keep typing and include the postcode.");
        onNoMatch?.(results.length === 0);
      } catch {
        if (mounted.current && mine === searchSeq.current && !picking.current) {
          setItems([]); setOpen(true); setNote("Address lookup is unavailable right now. Edit the address to try again.");
          onNoMatch?.(true);
        }
      } finally {
        if (mounted.current && mine === searchSeq.current && !picking.current) setLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); searchSeq.current += 1; };
  }, [edited, focused, provider, resolved, value]);

  function cancelPick() {
    // Explicit cancel: invalidate the in-flight details request and release every lock.
    detailsSeq.current += 1;
    picking.current = false;
    pickedLabel.current = null;
    setLoading(false);
    onPendingChange?.(false);
  }

  async function choose(suggestion: AddressSuggestion) {
    // Set the lock before blur. Mobile browsers dispatch blur/outside events before click.
    picking.current = true;
    pickedLabel.current = suggestion.label;
    onPendingChange?.(true);
    inputRef.current?.blur();
    searchSeq.current += 1;
    const mine = ++detailsSeq.current;
    onSelect(null); onChange(suggestion.label);
    setFocused(false); setOpen(false); setItems([]); setActive(-1); setLoading(true); setNote("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Never let a hung lookup hold the field: give up after a bounded wait.
      const timeout = new Promise<null>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), DETAILS_TIMEOUT_MS); });
      const raw = await Promise.race([provider.details(suggestion.id), timeout]);
      const verified = raw?.country === "AU" && raw.provider === "google_places_au"
        ? { ...raw, country: "AU" as const, provider: "google_places_au" as const }
        : null;
      const details = verified ? keepPickedNumber(suggestion.label, verified) : null;
      if (!mounted.current || mine !== detailsSeq.current) return;
      if (!isAustralianAddress(details)) throw new Error("incomplete");
      if (!details) throw new Error("incomplete");
      if (victoriaOnly && !isVictorianAddress(details)) {
        onSelect(null); setEdited(true); setNote("Sorry, your service area needs to be in Victoria. Choose another result."); return;
      }
      onChange(details.label); onSelect(details); setEdited(false); setAnnounce(`Selected ${details.label}`);
    } catch {
      if (mounted.current && mine === detailsSeq.current) {
        onSelect(null); setEdited(true); setNote("We couldn't verify that address. Edit it to try again or choose another result.");
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (mine === detailsSeq.current) {
        picking.current = false;
        pickedLabel.current = null;
        if (mounted.current) setLoading(false);
        onPendingChange?.(false);
      }
    }
  }

  const dismiss = () => { searchSeq.current += 1; if (picking.current) cancelPick(); setOpen(false); setItems([]); setActive(-1); setLoading(false); };
  return (
    <div ref={root} style={{ position: "relative" }}>
      <input ref={inputRef} id={id} style={inputStyle} role="combobox" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-expanded={open && items.length > 0} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} autoComplete="off" placeholder="Start typing your address…" value={value}
        onFocus={() => setFocused(true)} onChange={(event) => {
          const next = event.target.value;
          if (picking.current) {
            // Mobile keyboards may echo the picked label on blur; that must not cancel the pick.
            if (next === pickedLabel.current) return;
            // A real edit while details are pending explicitly cancels the pick and unlocks the field.
            cancelPick();
          }
          searchSeq.current += 1; detailsSeq.current += 1; setLoading(false); setEdited(true); setFocused(true); setItems([]); setActive(-1); setOpen(false); setNote(""); setAnnounce(""); onSelect(null); onChange(next);
        }} onBlur={() => { setFocused(false); searchSeq.current += 1; setOpen(false); setActive(-1); }}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setActive((x) => (x + 1) % items.length); } else if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setActive((x) => (x - 1 + items.length) % items.length); } else if (event.key === "Enter" && open && items[active]) { event.preventDefault(); void choose(items[active]); } else if (event.key === "Escape") { event.preventDefault(); dismiss(); } }} />
      {loading && <div style={{ position: "absolute", right: 14, top: 14, fontSize: 12, color: mutedColor }}>Searching…</div>}
      {open && items.length > 0 && <ul id={`${id}-options`} role="listbox" aria-label="Address suggestions" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, margin: "4px 0 0", padding: 0, listStyle: "none", background: "#fff", border: "1px solid #D7DCE8", borderRadius: 12, boxShadow: "0 12px 30px -12px rgba(34,55,107,.35)", overflow: "hidden" }}>
        {items.map((suggestion, index) => <li id={`${id}-option-${index}`} onMouseEnter={() => setActive(index)} role="option" aria-selected={active === index} key={suggestion.id} style={{ padding: "12px 14px", fontSize: 14, cursor: "pointer", borderBottom: "1px solid #F0F2F8", background: active === index ? "#F2F4FC" : "#fff" }}
          onMouseDown={(event) => event.preventDefault()} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void choose(suggestion); }}>{suggestion.label}</li>)}
      </ul>}
      {note && <div role="status" style={{ marginTop: 5, color: victoriaOnly ? "#8C1D18" : mutedColor, fontSize: 12 }}>{note}</div>}
      <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{announce}</span>
    </div>
  );
}