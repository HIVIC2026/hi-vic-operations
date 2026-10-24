import { useState, type InputHTMLAttributes } from "react";
import { VerifiedAddressInput } from "@/components/onboarding/VerifiedAddressInput";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";
import type { ResolvedAddress } from "@/lib/rec-onboarding.core";

// Approved mock-up M3 (decision 198): Owner's full name · Address (picked from the Google list, "✓ Address found") ·
// Mobile · Email · permission tick. 48px fields, 12px corners, thin line, 16px text. Presentation only — the same
// OnsiteInput and validators as before (intake validation unchanged).
const addressText = (v: OnsiteInput) => [v.address_line, [v.suburb, v.postcode].filter((x) => x.trim()).join(" ")].filter((x) => x.trim()).join(", ");
const INPUT_STYLE = { width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid #E4E9F5", background: "#fff", padding: "0 14px", fontSize: 16, color: "inherit" } as const;
export const FIELD_INPUT = "mt-1.5 block min-h-12 w-full rounded-[12px] border border-line bg-paper px-3.5 text-base text-ink outline-none focus:border-hiv-blue";
export const FIELD_LABEL = "block text-sm font-semibold text-ink";

export function CustomerFields({ value, onChange, consentLabel, offline = false }: { value: OnsiteInput; onChange: (v: OnsiteInput) => void; consentLabel?: string | undefined; offline?: boolean }) {
  // Jo 24 Oct: the address is picked from the Google list, so street number, suburb and postcode always match.
  // Typing afterwards clears the pick; the suburb/postcode are shown, never typed.
  const [text, setText] = useState(() => addressText(value));
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const field = (key: "full_name" | "phone" | "email" | "address_line" | "suburb" | "postcode", label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={FIELD_LABEL}>{label}<input className={FIELD_INPUT} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} {...props} /></label>
  );
  const permission = consentLabel ?? OWNER_CONTACT_PERMISSION;
  return <div className="space-y-[18px]">
    {field("full_name", "Owner's full name", { autoComplete: "name", maxLength: 200 })}
    {offline
      ? <>{field("address_line", "Address")}<div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">{field("suburb", "Suburb")}{field("postcode", "Postcode", { inputMode: "numeric", maxLength: 4 })}</div></>
      : <div>
        <label className={FIELD_LABEL} htmlFor="customer-address">Address</label>
        <div className="mt-1.5">
          <VerifiedAddressInput id="customer-address" victoriaOnly value={text} resolved={resolved} inputStyle={INPUT_STYLE} mutedColor="#5A6785"
            onChange={(next) => { setText(next); if (value.address_verified) onChange({ ...value, address_verified: false }); }}
            onSelect={(d) => {
              setResolved(d);
              if (!d) return;
              const street = (d.street ?? d.label.split(",")[0] ?? "").trim();
              onChange({ ...value, address_line: street, suburb: (d.suburb ?? "").trim(), postcode: (d.postcode ?? "").trim(), address_verified: true });
            }} />
        </div>
        {value.address_verified && <div className="mt-2 rounded-[12px] bg-mist px-3 py-2.5 text-sm leading-[1.45]" data-address-confirmed><span className="font-bold text-hiv-green">✓ Address found</span> <span className="break-words">{resolved?.label ?? `${value.address_line}, ${value.suburb} VIC ${value.postcode}`}</span></div>}
        <p className="mt-1.5 text-[13px] text-sub">Start typing, then pick the address from the list.</p>
      </div>}
    {field("phone", "Mobile", { inputMode: "tel", autoComplete: "tel", maxLength: 40 })}
    {field("email", "Email", { type: "email", autoComplete: "email", maxLength: 200 })}
    <label className="flex min-h-12 items-start gap-3 py-1.5">
      <input type="checkbox" className="peer sr-only" checked={value.contact_permission} onChange={(e) => onChange({ ...value, contact_permission: e.target.checked, consent_by: e.target.checked ? "installer" : null })} aria-label={permission} />
      <span aria-hidden className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[15px] font-bold peer-focus-visible:ring-2 peer-focus-visible:ring-hiv-blue/40 ${value.contact_permission ? "bg-hiv-blue text-white" : "border border-line bg-paper text-transparent"}`}>✓</span>
      <span className="text-[15px] leading-[1.45] text-ink">{permission}</span>
    </label>
  </div>;
}
