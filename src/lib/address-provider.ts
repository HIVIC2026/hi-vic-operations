import { addressDetails, searchAddresses } from "./address-search.functions";
import type { AddressDetails, AddressSuggestion } from "./whatif-location";
/** Default provider: the website's address-search service via a read-only proxy. */
export const defaultAddressProvider = {
  search: (query: string): Promise<AddressSuggestion[]> => searchAddresses({ data: { query } }),
  details: (placeId: string): Promise<AddressDetails | null> => addressDetails({ data: { placeId } }),
};
