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
/** Same box, red edge, shown once the answer in it is wrong. */
const lightInputInvalid = lightInput.replace("border-estimate-line", "border-danger");

/** Which answer a problem belongs to, so the message can sit next to the field it is about. */
type InterestField = "address" | "fullName" | "mobile" | "email" | "consent";
type InterestFieldErrors = Partial<Record<InterestField, string | undefined>>;

/** Screen order (top to bottom) — the first unanswered box is the one that gets focus. */
const FIELD_ORDER: InterestField[] = ["address", "fullName", "mobile", "email", "consent"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Server keys are the saved draft's names; map them back to the box on screen. */
const SERVER_FIELD: Record<string, InterestField> = {
  fullName: "fullName",
  mobile: "mobile",
  email: "email",
  consent: "consent",
  addressLine: "address",
  postcode: "address",
  suburb: "address",
};

/** Points at the refusal the server sent for the named field, or nothing extra to say. */
function errorsFromServer(errors: Record<string, string | undefined>) {
  const mapped: InterestFieldErrors = {};
  const loose: string[] = [];
  for (const [key, message] of Object.entries(errors)) {
    if (!message) continue;
    const field = SERVER_FIELD[key];
    if (field && !mapped[field]) mapped[field] = message;
    else loose.push(message);
  }
  return { mapped, loose };
}

function Row({
  id,
  label,
  children,
  error,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-estimate-navy/70">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-bold text-danger">
          {error}
        </p>
      ) : null}
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
  /** Whole-form problems (the server said no, or a bot filled the hidden box). */
  const [error, setError] = useState("");
  /** Per-answer problems, shown next to the box they belong to. */
  const [fieldErrors, setFieldErrors] = useState<InterestFieldErrors>({});
  const [focusField, setFocusField] = useState<InterestField | null>(null);
  const [done, setDone] = useState("");

  const nameRef = useRef<HTMLInputElement | null>(null);
  const mobileRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const consentRef = useRef<HTMLInputElement | null>(null);

  /** Drop a message as soon as the person starts fixing that answer. */
  const clearField = (field: InterestField) =>
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const focusFirstProblem = (errors: InterestFieldErrors) => {
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) setFocusField(first);
    return first;
  };

  // Run after the refused submit has rendered — the address box may only just have opened —
  // so the first problem is both on screen (scrolled to) and announced once.
  useEffect(() => {
    if (!focusField) return;
    const inputs = { fullName: nameRef, mobile: mobileRef, email: emailRef, consent: consentRef };
    const el =
      focusField === "address"
        ? document.getElementById("register-address")
        : (inputs[focusField]?.current ?? null);
    if (el) {
      el.focus();
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    }
    setFocusField(null);
  }, [focusField]);

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
    // Same rules and same wording as before — only the answers are checked together now so
    // every missing box is marked at once instead of one message describing whichever came first.
    const next: InterestFieldErrors = {};
    if (trimmedLine.length >= 5 && foundPostcode.length !== 4) {
      if (!editing) setEditing(true);
      next.address =
        "Please include your postcode in the address, for example 34 Watsons Road, Bundoora VIC 3757.";
    }
    if (fullName.trim().length < 2) {
      next.fullName = "Please enter your name so we know who to ask for.";
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email address.";
    }
    if (mobile.replace(/\D/g, "").length < 9) {
      next.mobile = "Please enter a valid mobile number.";
    }
    if (!consent) {
      next.consent = "Please tick the box so we can contact you.";
    }
    setFieldErrors(next);
    if (focusFirstProblem(next)) return;
    // Nothing left to say to the person — hand the draft to the office.
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
        // Put the server's reason next to the box it is about when we know which one it is.
        const { mapped, loose } = errorsFromServer(result.errors);
        setFieldErrors(mapped);
        const firstProblem = focusFirstProblem(mapped);
        const summary = loose[0];
        if (summary) setError(summary);
        else if (!firstProblem)
          setError("We couldn't save that — please check the details and try again.");
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
                  invalid={!!fieldErrors.address}
                  describedBy={fieldErrors.address ? "register-address-error" : undefined}
                  onChange={(next) => {
                    addressTouched.current = true;
                    setLine(next);
                    setPostcodeNow(extractPostcode(next));
                    setSuburbNow(suburbFromLine(next));
                    clearField("address");
                  }}
                  onPick={(suggestion) => {
                    addressTouched.current = true;
                    setLine(suggestion.full);
                    setPostcodeNow(suggestion.postcode);
                    setSuburbNow(suggestion.suburb);
                    setEditing(false);
                    setError("");
                    clearField("address");
                  }}
                  placeholder="e.g. 34 Watsons Road, Bundoora"
                  ariaLabel="Property address"
                />
                {fieldErrors.address ? (
                  <p
                    id="register-address-error"
                    role="alert"
                    className="mt-1 text-xs font-bold text-danger"
                  >
                    {fieldErrors.address}
                  </p>
                ) : null}
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
            <Row id="ri-name" label="Full name" error={fieldErrors.fullName}>
              <input
                id="ri-name"
                ref={nameRef}
                name="fullName"
                autoComplete="name"
                aria-required="true"
                aria-invalid={!!fieldErrors.fullName}
                aria-describedby={fieldErrors.fullName ? "ri-name-error" : undefined}
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  clearField("fullName");
                }}
                placeholder="Jane Doe"
                className={fieldErrors.fullName ? lightInputInvalid : lightInput}
              />
            </Row>
            <Row id="ri-mobile" label="Mobile" error={fieldErrors.mobile}>
              <input
                id="ri-mobile"
                ref={mobileRef}
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-required="true"
                aria-invalid={!!fieldErrors.mobile}
                aria-describedby={fieldErrors.mobile ? "ri-mobile-error" : undefined}
                value={mobile}
                onChange={(event) => {
                  setMobile(event.target.value);
                  clearField("mobile");
                }}
                placeholder="0400 000 000"
                className={fieldErrors.mobile ? lightInputInvalid : lightInput}
              />
            </Row>
            <Row id="ri-email" label="Email" error={fieldErrors.email}>
              <input
                id="ri-email"
                ref={emailRef}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-required="true"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "ri-email-error" : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearField("email");
                }}
                placeholder="jane@example.com"
                className={fieldErrors.email ? lightInputInvalid : lightInput}
              />
            </Row>
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-2 text-[0.7rem] leading-relaxed text-estimate-navy/75">
              <input
                id="ri-consent"
                ref={consentRef}
                type="checkbox"
                checked={consent}
                aria-required="true"
                aria-invalid={!!fieldErrors.consent}
                aria-describedby={fieldErrors.consent ? "ri-consent-error" : undefined}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  clearField("consent");
                }}
                className="mt-0.5 size-4 shrink-0 accent-estimate-green"
              />
              <span>{INTEREST_CONSENT_STATEMENT}</span>
            </label>
            {fieldErrors.consent ? (
              <p id="ri-consent-error" role="alert" className="mt-1 text-xs font-bold text-danger">
                {fieldErrors.consent}
              </p>
            ) : null}
          </div>

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
