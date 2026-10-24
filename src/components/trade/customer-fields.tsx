import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { VerifiedAddressInput } from "@/components/onboarding/VerifiedAddressInput";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";
import type { ResolvedAddress } from "@/lib/rec-onboarding.core";

const addressText = (v: OnsiteInput) => [v.address_line, [v.suburb, v.postcode].filter((x) => x.trim()).join(" ")].filter((x) => x.trim()).join(", ");
// Same look as the portal's h-12 inputs; the picker itself is the onboarding Google address picker.
const INPUT_STYLE = { width: "100%", height: 48, borderRadius: 6, border: "1px solid #D7DCE8", background: "#fff", padding: "0 12px", fontSize: 16, color: "inherit" } as const;

export function CustomerFields({ value, onChange, consentLabel, offline = false }: { value: OnsiteInput; onChange: (v: OnsiteInput) => void; consentLabel?: string | undefined; offline?: boolean }) {
  // Jo 24 Oct: the address is picked from the Google list, so street number, suburb and postcode always match.
  // Typing afterwards clears the pick; the suburb/postcode are shown, never typed.
  const [text, setText] = useState(() => addressText(value));
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const field = (key: "full_name" | "phone" | "email" | "address_line" | "suburb" | "postcode", label: string, props = {}) => (
    <label className="block text-sm font-bold">{label}<Input className="mt-1 h-12" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} {...props} /></label>
  );
  return <div className="space-y-3">
    {offline
      ? <>{field("address_line", "Address")}<div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">{field("suburb", "Suburb")}{field("postcode", "Postcode", { inputMode: "numeric", maxLength: 4 })}</div></>
      : <>
        <label className="block text-sm font-bold" htmlFor="customer-address">Address</label>
        <VerifiedAddressInput id="customer-address" victoriaOnly value={text} resolved={resolved} inputStyle={INPUT_STYLE} mutedColor="#5B6478"
          onChange={(next) => { setText(next); if (value.address_verified) onChange({ ...value, address_verified: false }); }}
          onSelect={(d) => {
            setResolved(d);
            if (!d) return;
            const street = (d.street ?? d.label.split(",")[0] ?? "").trim();
            onChange({ ...value, address_line: street, suburb: (d.suburb ?? "").trim(), postcode: (d.postcode ?? "").trim(), address_verified: true });
          }} />
        {value.address_verified
          ? <div className="rounded-[12px] bg-mist px-3 py-2 text-sm" data-address-confirmed><span className="break-words">{value.address_line}, {value.suburb} {value.postcode}</span></div>
          : <p className="text-xs text-sub">Start typing, then choose the address from the list. Include the unit number if there is one.</p>}
      </>}
    {field("full_name", "Owner's full name (first and last)", { autoComplete: "name", maxLength: 200 })}
    {field("phone", "Mobile number", { inputMode: "tel", autoComplete: "tel", maxLength: 40 })}
    {field("email", "Email", { type: "email", autoComplete: "email", maxLength: 200 })}
    <label className="flex items-start gap-3 pt-2 text-sm"><Checkbox className="mt-0.5" checked={value.contact_permission} onCheckedChange={(c) => onChange({ ...value, contact_permission: c === true, consent_by: c === true ? "installer" : null })} aria-label={consentLabel ?? OWNER_CONTACT_PERMISSION} /><span>{consentLabel ?? OWNER_CONTACT_PERMISSION}</span></label>
  </div>;
}
