/**
 * Address type-ahead for the public calculator and the "register your interest"
 * band.
 *
 * Searches the portal's own address endpoint (which looks the property up in
 * OpenStreetMap for us) and keeps whatever the person has already typed.
 * Nothing is stored here — the person either picks a suggestion or finishes
 * typing their own address.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import {
  mergeTypedNumber,
  parseNominatimSuggestions,
  type AddressSuggestion,
} from "@/lib/address.core";

const SEARCH_URL = "/api/public/address-search";
const MIN_CHARS = 6;
const DEBOUNCE_MS = 450;

type Props = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  className?: string;
  /** "dark" renders the input and status note legibly on the navy register panel. */
  tone?: "light" | "dark";
  ariaLabel?: string;
  /** Marks the box red and points at the refusal shown next to it. */
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  /** Never search (sample/preview screens): plain typing only, no network. */
  offline?: boolean;
};

export function AddressCombobox({
  id,
  value,
  onChange,
  onPick,
  placeholder,
  className,
  tone = "light",
  ariaLabel,
  invalid,
  describedBy,
  offline = false,
}: Props) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Set when a pick fills the input — that value change must not re-search. */
  const justPicked = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    if (offline || q.length < MIN_CHARS) {
      setItems([]);
      setOpen(false);
      setNote("");
      setBusy(false);
      return;
    }
    timer.current = setTimeout(() => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setBusy(true);
      fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, {
        signal: ac.signal,
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`status ${res.status}`);
          return res.json();
        })
        .then((payload: unknown) => {
          const results = (payload as { results?: unknown })?.results;
          const found = parseNominatimSuggestions(results, q);
          setItems(found);
          setActive(found.length ? 0 : -1);
          setOpen(true);
          setNote(
            found.length
              ? ""
              : "We couldn't find a Victorian match — we only work with Victorian properties. Keep typing, or type your full address including the postcode.",
          );
        })
        .catch((err: unknown) => {
          if ((err as Error)?.name === "AbortError") return;
          setItems([]);
          setOpen(true);
          setNote("Address autofill isn't available right now — type your full address, including the postcode.");
        })
        .finally(() => setBusy(false));
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  useEffect(() => {
    const onDocDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const choose = (suggestion: AddressSuggestion) => {
    justPicked.current = true;
    onPick(mergeTypedNumber(value, suggestion));
    setOpen(false);
    setItems([]);
    setNote("");
  };

  // A refused answer swaps the grey edge for the danger token rather than adding a second border class.
  const boxClass =
    className ??
    (tone === "dark"
      ? "h-11 w-full rounded-xl border border-white/15 bg-white/10 pl-9 pr-10 text-[0.95rem] text-white placeholder:text-white/60 focus-visible:border-white/40 focus-visible:bg-white/15 focus-visible:outline-none"
      : invalid
        ? "h-11 w-full rounded-lg border-2 border-danger bg-estimate-white pl-9 pr-10 text-base font-bold text-estimate-navy"
        : "h-11 w-full rounded-lg border-2 border-estimate-line bg-estimate-white pl-9 pr-10 text-base font-bold text-estimate-navy");

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <MapPin
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-estimate-green"
        />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && open ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={!!invalid}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (items.length || note) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && items.length) {
              event.preventDefault();
              setActive((i) => (i + 1) % items.length);
              return;
            }
            if (event.key === "ArrowUp" && items.length) {
              event.preventDefault();
              setActive((i) => (i - 1 + items.length) % items.length);
              return;
            }
            if (event.key === "Enter" && open && active >= 0 && items[active]) {
              event.preventDefault();
              choose(items[active]);
              return;
            }
            if (event.key === "Escape") setOpen(false);
          }}
          className={`${boxClass} ${tone === "dark" ? "placeholder:font-normal focus-visible:outline-none" : "placeholder:font-normal placeholder:text-estimate-navy/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"}`}
        />
        {busy && (
          <Loader2 aria-hidden="true" className={`absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin ${tone === "dark" ? "text-white" : "text-estimate-blue"}`} />
        )}
      </div>

      {open && items.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border-2 border-estimate-line bg-estimate-white p-1 shadow-[0_22px_45px_-24px_rgba(34,55,107,0.55)]"
        >
          {items.map((suggestion, index) => (
            <li
              key={suggestion.key}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-bold text-estimate-navy ${
                index === active ? "bg-estimate-mint" : "hover:bg-estimate-mist"
              }`}
            >
              {suggestion.full}
            </li>
          ))}
        </ul>
      )}

      {open && items.length === 0 && note && (
        <p role="status" className={`mt-1.5 text-xs leading-relaxed font-semibold ${tone === "dark" ? "text-white/80" : "text-estimate-navy/85"}`}>
          {note}
        </p>
      )}
      <span className="sr-only" role="status">
        {busy ? "Searching addresses" : ""}
      </span>
    </div>
  );
}
