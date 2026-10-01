/**
 * "Register my interest" band under the public calculator.
 *
 * Three questions only — name, mobile, email. The postcode they already
 * entered comes down automatically so we never lose the lead.
 * Submits to the interest list only: no job, no message, no external write.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, MapPin } from "lucide-react";
import { INTEREST_CONSENT_STATEMENT } from "@/lib/interest.core";
import { registerInterest, type InterestErrors } from "@/lib/interest.functions";

type InsulationChoice = "none" | "present" | "unknown";

type Props = {
  postcode: string;
  ceilingM2: number | null;
  insulation: InsulationChoice;
};

const FIELD =
  "h-10 w-full rounded-lg border-2 border-estimate-line bg-estimate-white px-3 text-base font-semibold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const LABEL = "text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy";

function firstNameOf(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function RegisterInterest({ postcode, ceilingM2, insulation }: Props) {
  const submit = useServerFn(registerInterest);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [pc, setPc] = useState(postcode);
  const [editingPc, setEditingPc] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<InterestErrors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pcTouched = useRef(false);

  // Follow the postcode from the calculator until they edit it here.
  useEffect(() => {
    if (!pcTouched.current) setPc(postcode);
  }, [postcode]);

  const go = async () => {
    setBusy(true);
    setErrors({});
    const result = await submit({
      data: {
        fullName,
        mobile,
        email,
        addressLine: "",
        suburb: "",
        postcode: pc,
        ceilingM2: ceilingM2 ?? 0,
        insulationDeclared: insulation,
        consent,
        honeypot,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setDone(firstNameOf(fullName));
  };

  if (done) {
    return (
      <section
        data-testid="register-interest-done"
        className="estimate-offset mt-3 rounded-2xl border border-estimate-green/40 bg-estimate-mint/70 p-5"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-white">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-estimate-blue">Thanks {done} — we&rsquo;ve got your details.</h2>
            <p className="mt-1 text-sm leading-relaxed text-estimate-navy/85">
              Someone from Home Insulation Victoria will be in touch to confirm your price and arrange the free Ready
              Check. Nothing has been booked and no payment is due.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const pcKnown = pc.trim().length === 4 && !editingPc;

  return (
    <section
      data-testid="register-interest"
      className="estimate-offset relative mt-3 rounded-2xl border border-estimate-blue/20 bg-gradient-to-br from-estimate-mist to-estimate-white p-5"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div>
            <h2 className="text-lg font-extrabold text-estimate-blue">Register my interest</h2>
            <p className="mt-0.5 text-sm text-estimate-navy/85">
              Three details and we&rsquo;ll hold your estimate and confirm the next step. No obligation.
            </p>
          </div>
          <p className="text-xs font-bold text-estimate-green">Free Ready Check · no payment now</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pcKnown ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-estimate-mint px-2.5 py-1.5 text-xs font-extrabold text-estimate-navy">
                <MapPin aria-hidden="true" className="size-3.5 text-estimate-green" />
                Postcode {pc}
              </span>
              <button
                type="button"
                onClick={() => setEditingPc(true)}
                className="text-xs font-extrabold text-estimate-blue underline underline-offset-2 hover:brightness-125"
              >
                Change
              </button>
            </>
          ) : (
            <label className="flex items-center gap-2 text-xs font-extrabold text-estimate-navy">
              Postcode
              <input
                className="h-9 w-[104px] rounded-lg border-2 border-estimate-line bg-estimate-white px-2.5 text-sm font-bold text-estimate-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                value={pc}
                onChange={(e) => {
                  pcTouched.current = true;
                  setPc(e.target.value.replace(/\D/g, "").slice(0, 4));
                }}
                placeholder="3336"
                inputMode="numeric"
                autoComplete="postal-code"
                aria-label="Property postcode"
              />
            </label>
          )}
        </div>
        {errors.postcode && <p className="mt-1 text-xs font-bold text-danger">{errors.postcode}</p>}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="ri-name">
              Full name
            </label>
            <input
              id="ri-name"
              className={`${FIELD} mt-1`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Sam Taylor"
              autoComplete="name"
            />
            {errors.fullName && <p className="mt-1 text-xs font-bold text-danger">{errors.fullName}</p>}
          </div>
          <div>
            <label className={LABEL} htmlFor="ri-mobile">
              Mobile
            </label>
            <input
              id="ri-mobile"
              className={`${FIELD} mt-1`}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="0400 000 000"
              inputMode="tel"
              autoComplete="tel"
            />
            {errors.mobile && <p className="mt-1 text-xs font-bold text-danger">{errors.mobile}</p>}
          </div>
          <div>
            <label className={LABEL} htmlFor="ri-email">
              Email
            </label>
            <input
              id="ri-email"
              className={`${FIELD} mt-1`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              inputMode="email"
              autoComplete="email"
            />
            {errors.email && <p className="mt-1 text-xs font-bold text-danger">{errors.email}</p>}
          </div>
        </div>

        {/* Spam trap — real people never see or fill this. */}
        <input
          aria-hidden="true"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-start gap-2 text-xs leading-snug text-estimate-navy/85">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-estimate-blue"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="max-w-[46ch]">
              {INTEREST_CONSENT_STATEMENT}
              {errors.consent && <span className="mt-0.5 block font-bold text-danger">{errors.consent}</span>}
            </span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-estimate-blue px-5 text-sm font-extrabold text-estimate-white shadow-[0_10px_24px_-14px_rgba(60,81,196,0.9)] transition hover:brightness-110 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Register my interest
          </button>
        </div>
        {errors.submit && <p className="mt-2 text-xs font-bold text-danger">{errors.submit}</p>}
      </form>
    </section>
  );
}
