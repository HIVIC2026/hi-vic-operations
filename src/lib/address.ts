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
}