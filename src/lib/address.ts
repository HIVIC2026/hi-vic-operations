export type AddressParts = {
  address_line?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
};

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsToken = (value: string, token: string) => new RegExp(`(^|[,\\s])${escaped(token)}([,\\s]|$)`, "i").test(value);
const containsPostcode = (value: string, postcode: string) => new RegExp(`(^|\\D)${escaped(postcode)}(\\D|$)`).test(value);

/** Formats split or provider-complete addresses without repeating locality tokens. */
export function formatPropertyAddress(parts: AddressParts | null | undefined): string {
  if (!parts) return "";
  let result = parts.address_line?.trim() ?? "";
  const suburb = parts.suburb?.trim();
  const state = parts.state?.trim().toUpperCase();
  const postcode = parts.postcode?.trim();
  if (suburb && !containsToken(result, suburb)) result = [result, suburb].filter(Boolean).join(", ");
  if (state && !containsToken(result, state)) result = [result, state].filter(Boolean).join(", ");
  if (postcode && !containsPostcode(result, postcode)) result = [result, postcode].filter(Boolean).join(" ");
  return result.replace(/\s+/g, " ").trim();
}const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Street part only: strips a trailing ", Suburb [VIC] [postcode]" already baked into the line. */
export function streetOnly(line: string | null | undefined, suburb?: string | null): string | null {
  let l = line?.trim().replace(/,\s*$/, "") || null;
  if (!l) return null;
  const parts = l.split(",").map((p) => p.trim()).filter(Boolean);
  const sub = suburb?.trim() ? norm(suburb) : null;
  while (parts.length > 1) {
    const last = norm(parts[parts.length - 1]!).replace(/\b(vic|victoria)\b/g, "").replace(/\b\d{4}\b/g, "").trim();
    if (last === "" || (sub && last === sub)) parts.pop(); else break;
  }
  l = parts.join(", ");
  return l || null;
}

/** "20 Banksia Street, Frankston VIC 3199" — each part once. */
export function fullAddress(line: string | null | undefined, suburb?: string | null, postcode?: string | null): string {
  const street = streetOnly(line, suburb);
  const tail = [suburb?.trim(), postcode?.trim() ? `VIC ${postcode.trim()}` : suburb?.trim() ? "VIC" : null].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ");
}

/** "20 Banksia Street, Frankston" — each part once. */
export function shortAddress(line: string | null | undefined, suburb?: string | null): string | null {
  return [streetOnly(line, suburb), suburb?.trim() || null].filter(Boolean).join(", ") || null;
}

/** Collapse an already-joined address with repeated trailing parts ("…, Frankston VIC 3199, Frankston VIC 3199"). */
export function dedupeAddress(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const n = norm(p);
    if (out.some((o) => norm(o) === n || norm(o).endsWith(` ${n}`))) continue;
    out.push(p);
  }
  return out.join(", ") || null;
}
