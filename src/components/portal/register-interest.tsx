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

/** The calculator's answer once the person has chosen ("unknown" until then). */
type InsulationAnswer = Exclude<InsulationDeclared, null>;

type Props = {
  address: string;
  suburb: string;
  postcode: string;
  ceilingM2: number;
  insulation: InsulationAnswer;
};

const lightInput =
  "h-11 w-full rounded-xl border border-estimate-line bg-estimate-white px-4 text-[0.95rem] text-estimate-navy placeholder:text-estimate-navy/50 focus-visible:border-estimate-blue focus-visible:outline-none";

function Row({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-estimate-navy/70">
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
    if (trimmedLine.length >= 5 && foundPostcode.length !== 4) {
      setEditing(true);
      setError("Please include your postcode in the address, for example 34 Watsons Road, Bundoora VIC 3757.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("Please enter your name so we know who to ask for.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (mobile.replace(/\D/g, "").length < 9) {
      setError("Please enter a valid mobile number.");
      return;
    }
    if (!consent) {
      setError("Please tick the box so we can contact you.");
      return;
    }
    setBusy(true);
    try {
      const result = await register({
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
      if (!result.ok) {
        // A filled honeypot means a bot (or a browser autofill glitch) — never
        // show a raw error for it; just stay quiet so real people aren't blocked.
        if (result.errors.honeypot) {
          setError("We couldn't save that — please check the details and try again. If it keeps happening, message us through the contact page on our website and we'll register you.");
          return;
        }
        const first = Object.values(result.errors).find(Boolean);
        setError(first || "We couldn't save that — please check the details and try again.");
        return;
      }
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
        className="mt-4 rounded-3xl border-2 border-estimate-green/40 bg-estimate-mint px-5 py-4"
      >
        <p className="flex items-center gap-2 text-sm font-extrabold text-estimate-navy">
          <Check aria-hidden="true" className="size-4 shrink-0 text-estimate-green" />
          Thanks {done} — we&apos;ve got your details.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-estimate-navy/85">
          We&apos;ll contact you about your estimate and book your free Ready Check. Nothing has been booked and no payment is due.
        </p>
      </div>
    );
  }

  return (
    <form
      id="register-interest"
      onSubmit={submit}
      className="relative mt-4 scroll-mt-4 overflow-hidden rounded-3xl bg-estimate-white px-5 py-6 shadow-[0_30px_70px_-45px_rgba(34,55,107,0.45)] sm:px-8 sm:py-8"
    >
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10">
        <div className="rounded-2xl bg-estimate-blush/60 p-5 lg:p-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-estimate-white px-3 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-estimate-navy shadow-sm">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-estimate-green" />
            High demand
          </span>
          <h2 className="mt-3 text-[1.35rem] font-extrabold leading-snug text-estimate-navy sm:text-[1.55rem]">
            Demand is high. Installer availability is limited.
          </h2>
          <p className="mt-2 text-[0.8rem] leading-relaxed text-estimate-navy/75">
            Register your interest now so our team can check your property and discuss availability in your area.
          </p>
          <p className="mt-3 text-[0.75rem] font-bold leading-relaxed text-estimate-navy">
            Free to register. No obligation to proceed.
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-estimate-line bg-estimate-mist px-4 py-2.5">
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
                  className="mt-1.5 text-[0.7rem] font-extrabold text-estimate-blue underline underline-offset-2 hover:text-estimate-green"
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
                  className="text-[0.7rem] font-extrabold text-estimate-blue underline underline-offset-2 hover:text-estimate-green"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Row id="ri-name" label="Full name">
              <input
                id="ri-name"
                name="fullName"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Jane Doe"
                className={lightInput}
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
                className={lightInput}
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
                className={lightInput}
              />
            </Row>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[0.7rem] leading-relaxed text-estimate-navy/75">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-estimate-green"
            />
            <span>{INTEREST_CONSENT_STATEMENT}</span>
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-estimate-blush px-3.5 py-2 text-xs font-bold text-estimate-navy">
              {error}
            </p>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-estimate-green px-4 text-base font-extrabold text-estimate-white shadow-lg shadow-estimate-green/25 transition hover:bg-estimate-accent active:scale-[0.99] disabled:opacity-60"
            >
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Register my interest
            </button>
            <p className="mt-1.5 text-center text-[0.7rem] text-estimate-navy/75">
              We&apos;ll contact you to discuss your estimate and arrange your free Ready Check.
            </p>
          </div>
        </div>
      </div>

      <input
        type="text"
        name="hp_ref_x9"
        tabIndex={-1}
        autoComplete="new-password"
        aria-hidden="true"
        value={honeypot}
        onChange={(event) => setHoneypot(event.target.value)}
        className="absolute left-0 top-0 h-0 w-0 opacity-0"
      />
    </form>
  );
}
