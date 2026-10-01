/**
 * "Register my interest" band on the public calculator.
 *
 * The property address typed above is carried down automatically — the person
 * only adds their name, mobile and email. Saving a lead sends nothing and
 * creates no job; the office sees it under "Registered interest".
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, MapPin } from "lucide-react";
import { registerInterest } from "@/lib/interest.functions";
import { INTEREST_CONSENT_STATEMENT } from "@/lib/interest.core";
import { extractPostcode, suburbFromLine } from "@/lib/address.core";
import type { InsulationDeclared } from "@/lib/estimate.core";
import { AddressCombobox } from "./address-combobox";

type Props = {
  address: string;
  suburb: string;
  postcode: string;
  ceilingM2: number;
  insulation: string;
};

const inputClass =
  "h-10 w-full rounded-lg border-2 border-estimate-line bg-estimate-white px-3 text-base font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Row({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function RegisterInterest({ address, suburb, postcode, ceilingM2, insulation }: Props) {
  const register = useServerFn(registerInterest);

  const [line, setLine] = useState(address);
  const [suburbNow, setSuburbNow] = useState(suburb);
  const [postcodeNow, setPostcodeNow] = useState(postcode);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Follow the address typed above until the person edits it here.
  const addressTouched = useRef(false);
  useEffect(() => {
    if (addressTouched.current) return;
    setLine(address);
    setSuburbNow(suburb);
    setPostcodeNow(postcode);
  }, [address, suburb, postcode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const trimmedLine = line.trim();
    const foundPostcode = postcodeNow.trim() || extractPostcode(trimmedLine);
    if (trimmedLine.length < 5) {
      setEditing(true);
      setError("Please add your property address so we know where to come.");
      return;
    }
    if (foundPostcode.length !== 4) {
      setEditing(true);
      setError("Please include your postcode in the address, for example 34 Watsons Road, Bundoora VIC 3757.");
      return;
    }
    setBusy(true);
    try {
      await register({
        data: {
          fullName,
          mobile,
          email,
          addressLine: trimmedLine,
          suburb: suburbNow || suburbFromLine(trimmedLine),
          postcode: foundPostcode,
          ceilingM2: Number(ceilingM2) || 0,
          insulationDeclared: insulation,
          consent,
          honeypot,
        },
      });
      setDone(fullName.trim().split(/\s+/)[0] || "there");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't save that — please check the details and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        data-testid="register-interest-done"
        className="mt-3 rounded-xl border-2 border-estimate-green/40 bg-estimate-mint px-4 py-3.5"
      >
        <p className="flex items-center gap-2 text-sm font-extrabold text-estimate-navy">
          <Check aria-hidden="true" className="size-4 shrink-0 text-estimate-green" />
          Thanks {done} — we&apos;ve got your details.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-estimate-navy/85">
          Someone from Home Insulation Victoria will be in touch to confirm your price and arrange the free Ready
          Check. Nothing has been booked and no payment is due.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="relative mt-3 rounded-xl border border-estimate-line bg-estimate-white px-4 py-3.5 shadow-[0_18px_45px_-30px_rgba(34,55,107,0.45)]"
    >
      <h2 className="text-[0.95rem] font-extrabold text-estimate-navy">Register my interest</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-estimate-navy/85">
        No obligation and no payment — we&apos;ll confirm your price and arrange the free Ready Check.
      </p>

      <div className="mt-2.5 rounded-lg border-2 border-estimate-line bg-estimate-canvas px-3 py-2">
        {editing ? (
          <>
            <AddressCombobox
              id="register-address"
              value={line}
              onChange={(next) => {
                addressTouched.current = true;
                setLine(next);
                setPostcodeNow(extractPostcode(next));
                setSuburbNow(suburbFromLine(next));
              }}
              onPick={(suggestion) => {
                addressTouched.current = true;
                setLine(suggestion.full);
                setPostcodeNow(suggestion.postcode);
                setSuburbNow(suggestion.suburb);
                setEditing(false);
                setError("");
              }}
              placeholder="e.g. 34 Watsons Road, Bundoora"
              ariaLabel="Property address"
            />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="mt-1.5 text-[0.7rem] font-extrabold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green"
            >
              Done
            </button>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-estimate-navy">
              <MapPin aria-hidden="true" className="size-4 shrink-0 text-estimate-green" />
              <span className="truncate">{line || "Your property address"}</span>
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[0.7rem] font-extrabold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green"
            >
              Change
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
        <Row id="ri-name" label="Full name">
          <input
            id="ri-name"
            name="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Jane Doe"
            className={inputClass}
          />
        </Row>
        <Row id="ri-mobile" label="Mobile">
          <input
            id="ri-mobile"
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
            placeholder="0400 000 000"
            className={inputClass}
          />
        </Row>
        <Row id="ri-email" label="Email">
          <input
            id="ri-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jane@example.com"
            className={inputClass}
          />
        </Row>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[0.7rem] leading-relaxed text-estimate-navy/85">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-estimate-green"
        />
        <span>{INTEREST_CONSENT_STATEMENT}</span>
      </label>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-workspace-blush/60 px-3 py-2 text-xs font-bold text-estimate-navy">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.7rem] text-estimate-navy/85">We&apos;ll only use these details to confirm your price.</p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-estimate-blue px-4 text-sm font-extrabold text-estimate-white transition hover:bg-estimate-green disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Demand is high — register your interest
        </button>
      </div>

      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={honeypot}
        onChange={(event) => setHoneypot(event.target.value)}
        className="absolute left-0 top-0 h-0 w-0 opacity-0"
      />
    </form>
  );
}
