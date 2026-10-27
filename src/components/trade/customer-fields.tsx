import { useRef, useState, type InputHTMLAttributes } from "react";
import { VerifiedAddressInput } from "@/components/onboarding/VerifiedAddressInput";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";
import type { ResolvedAddress } from "@/lib/rec-onboarding.core";
import type { AddJobField } from "@/lib/add-job-flow.core";

// Approved heavier Add a job (decision 237, 24 Oct 2026): bold 14px labels, 52px white fields with a 2px line (blue when
// focused, #8A3B4A with one short red line under the field when wrong), the solid green "✓ Address found" box and the
// permission row as a 56px bordered card. Presentation only — the same OnsiteInput and validators as before
// (intake validation unchanged); errors are the pure `fieldErrors` mapping of the existing validator messages.
const addressText = (v: OnsiteInput) => [v.address_line, [v.suburb, v.postcode].filter((x) => x.trim()).join(" ")].filter((x) => x.trim()).join(", ");
const LINE = "#E4E9F5", ERR = "#8A3B4A";
export const FIELD_INPUT = "mt-1.5 block min-h-[52px] w-full rounded-[12px] border-2 bg-paper px-3.5 text-base text-ink outline-none focus:border-hiv-blue";
export const FIELD_LABEL = "block text-sm font-bold text-ink";
const inputStyle = (bad: boolean) => ({ width: "100%", minHeight: 52, borderRadius: 12, border: `2px solid ${bad ? ERR : LINE}`, background: "#fff", padding: "0 14px", fontSize: 16, color: "inherit" } as const);

/** One short line under a field (approved error state). */
export function FieldError({ children, id }: { children: string | undefined; id?: string }) {
  return children ? <p id={id} role="alert" className="mt-1.5 text-[13px] font-semibold" style={{ color: ERR }} data-field-error>{children}</p> : null;
}

export function CustomerFields({ value, onChange, consentLabel, offline = false, errors = {} }: { value: OnsiteInput; onChange: (v: OnsiteInput) => void; consentLabel?: string | undefined; offline?: boolean; errors?: Partial<Record<AddJobField, string>> }) {
  // Jo 24 Oct: the address is picked from the Google list, so street number, suburb and postcode always match.
  // Typing afterwards clears the pick; the suburb/postcode are shown, never typed.
  const [text, setText] = useState(() => addressText(value));
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  // The address lookup answers after a delay; merge into the LATEST details so a mobile/email typed meanwhile is kept.
  const latest = useRef(value); latest.current = value;
  const field = (key: "full_name" | "phone" | "email" | "address_line" | "suburb" | "postcode", label: string, props: InputHTMLAttributes<HTMLInputElement> = {}, err?: string) => (
    <div>
      <label className={FIELD_LABEL}>{label}<input className={FIELD_INPUT} style={{ borderColor: err ? ERR : undefined }} aria-invalid={err ? true : undefined} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} {...props} /></label>
      <FieldError>{err}</FieldError>
    </div>
  );
  const permission = consentLabel ?? OWNER_CONTACT_PERMISSION;
  return <div className="space-y-3.5" data-customer-fields>
    {field("full_name", "Owner's full name", { autoComplete: "name", maxLength: 200 }, errors.full_name)}
    {offline
      ? <>{field("address_line", "Address", {}, errors.address)}<div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">{field("suburb", "Suburb")}{field("postcode", "Postcode", { inputMode: "numeric", maxLength: 4 })}</div></>
      : <div>
        <label className={FIELD_LABEL} htmlFor="customer-address">Address</label>
        <div className="mt-1.5" data-address-field data-invalid={errors.address ? "true" : undefined}>
          <VerifiedAddressInput id="customer-address" victoriaOnly value={text} resolved={resolved} inputStyle={inputStyle(!!errors.address)} mutedColor="#5A6785"
            onChange={(next) => { setText(next); if (latest.current.address_verified) onChange({ ...latest.current, address_verified: false }); }}
            onSelect={(d) => {
              setResolved(d);
              if (!d) return;
              const street = (d.street ?? d.label.split(",")[0] ?? "").trim();
              onChange({ ...latest.current, address_line: street, suburb: (d.suburb ?? "").trim(), postcode: (d.postcode ?? "").trim(), address_verified: true });
            }} />
        </div>
        <FieldError>{errors.address}</FieldError>
        {value.address_verified && <div className="mt-2 rounded-[12px] border-2 border-hiv-green bg-[#E9FBF1] px-3.5 py-2.5 text-sm leading-[1.45]" data-address-confirmed><span className="font-bold text-hiv-green">✓ Address found</span> <span className="break-words font-medium">{resolved?.label ?? `${value.address_line}, ${value.suburb} VIC ${value.postcode}`}</span></div>}
        <p className="mt-1.5 text-[13px] text-sub">Start typing, then pick the address from the list.</p>
      </div>}
    {field("phone", "Mobile", { inputMode: "tel", autoComplete: "tel", maxLength: 40 }, errors.phone)}
    {field("email", "Email", { type: "email", autoComplete: "email", maxLength: 200 }, errors.email)}
    <div>
      <label className="flex min-h-14 items-center gap-3 rounded-[12px] border-2 bg-paper px-3.5 py-2.5" style={{ borderColor: errors.permission ? ERR : LINE }} data-permission-row>
        <input type="checkbox" className="peer sr-only" checked={value.contact_permission} onChange={(e) => onChange({ ...value, contact_permission: e.target.checked, consent_by: e.target.checked ? "installer" : null })} aria-label={permission} aria-invalid={errors.permission ? true : undefined} />
        <span aria-hidden className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-[15px] font-bold peer-focus-visible:ring-2 peer-focus-visible:ring-hiv-blue/40 ${value.contact_permission ? "bg-hiv-blue text-white" : "border-2 bg-paper text-transparent"}`} style={value.contact_permission ? undefined : { borderColor: errors.permission ? ERR : LINE }}>✓</span>
        <span className="text-[15px] font-medium leading-[1.4] text-ink">{permission}</span>
      </label>
      <FieldError>{errors.permission}</FieldError>
    </div>
  </div>;
}
