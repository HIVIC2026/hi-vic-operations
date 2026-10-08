import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AddressCombobox } from "@/components/portal/address-combobox";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";

export function CustomerFields({ value, onChange }: { value: OnsiteInput; onChange: (v: OnsiteInput) => void }) {
  const field = (key: "full_name" | "phone" | "email" | "suburb" | "postcode", label: string, props = {}) => (
    <label className="block text-sm font-bold">{label}<Input className="mt-1 h-12" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} {...props} /></label>
  );
  return <div className="space-y-3">
    <label className="block text-sm font-bold" htmlFor="customer-address">Address</label>
    <AddressCombobox id="customer-address" value={value.address_line} onChange={(address_line) => onChange({ ...value, address_line })} onPick={(a) => onChange({ ...value, address_line: [a.streetNumber, a.street].filter(Boolean).join(" "), suburb: a.suburb, postcode: a.postcode })} className="h-12 w-full rounded-md border border-line bg-paper pl-9 pr-10 text-base text-ink" placeholder="Street address and suburb" />
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">{field("suburb", "Suburb")}{field("postcode", "Postcode", { inputMode: "numeric", maxLength: 4 })}</div>
    {field("full_name", "Owner name", { autoComplete: "name", maxLength: 200 })}
    {field("phone", "Mobile number", { inputMode: "tel", autoComplete: "tel", maxLength: 40 })}
    {field("email", "Email", { type: "email", autoComplete: "email", maxLength: 200 })}
    <label className="flex items-start gap-3 pt-2 text-sm"><Checkbox className="mt-0.5" checked={value.contact_permission} onCheckedChange={(c) => onChange({ ...value, contact_permission: c === true, consent_by: c === true ? "installer" : null })} aria-label={OWNER_CONTACT_PERMISSION} /><span>{OWNER_CONTACT_PERMISSION}</span></label>
  </div>;
}