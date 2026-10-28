import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

GlobalRegistrator.register();
const { render, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const businesses = new Map<string, Record<string, unknown>>();
let saves: Record<string, unknown>[] = [];
const profile = (id: string) => ({ business: businesses.get(id), myRole: "business_admin", checklist: [], credentials: [], members: [], workers: [], collectionNotice: [], relationships: [], electricianBusinesses: [], measurementMethods: [], rateCards: [], agreements: [] });
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("@/hooks/use-me", () => ({ useAction: (fn: (input: unknown) => unknown) => fn }));
const source = readFileSync(new URL("../src/components/portal/business.tsx", import.meta.url), "utf8");
const pilotImports = source.match(/import \{([^}]+)\} from "@\/lib\/pilot.functions"/s)?.[1];
if (!pilotImports) throw new Error("Business actions not found");
const pilot = Object.fromEntries(pilotImports.split(",").map((name) => [name.trim(), async () => null]));
mock.module("@/lib/pilot.functions", () => ({ ...pilot,
  getPartnerProfile: async ({ data }: { data: { businessId: string } }) => profile(data.businessId),
  saveBusiness: async (input: Record<string, unknown>) => {
    saves.push(input);
    const business = businesses.get(String(input.id));
    if (!business) throw new Error("Missing TEST business");
    businesses.set(String(input.id), { ...business, service_postcodes: input.service_postcodes, coverage_verified_at: "2026-10-28T06:52:00Z", coverage_verified_by: "TEST office" });
    return { id: input.id };
  },
}));
mock.module("@/lib/rate-requests.functions", () => ({ getHigherRates: async () => null, requestHigherRates: async () => null, reviewHigherRates: async () => null }));
mock.module("@/components/portal/file-viewer", () => ({ openFileViewer: () => {} }));
mock.module("@/components/portal/worker-compliance", () => ({ SendNoticeLinkInline: () => null }));
const { BusinessProfile } = await import("../src/components/portal/business");
afterEach(() => { cleanup(); businesses.clear(); saves = []; });
const fixture = (id: string, type: string) => ({ id, name: `TEST ${id}`, business_type: type, onboarding_status: "submitted", service_postcodes: [], coverage_verified_at: null, declared_service_origin: "Frankston VIC 3199", declared_travel_radius_km: 10, declared_excluded_areas: "No islands" });

test("office confirmation saves only the selected business through existing verification for both trades", async () => {
  for (const type of ["eec_installer", "rec"]) {
    businesses.set("selected", fixture("selected", type));
    businesses.set("other", fixture("other", type));
    const otherBefore = JSON.stringify(businesses.get("other"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = render(<QueryClientProvider client={client}><BusinessProfile businessId="selected" isHivicAdmin /></QueryClientProvider>);
    const confirm = await ui.findByRole("button", { name: "Confirm coverage" });
    expect(saves).toHaveLength(0);
    expect(businesses.get("selected")?.coverage_verified_at).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.id).toBe("selected");
    expect(saves[0]?.verify_coverage).toBe(true);
    expect(saves[0]?.service_postcodes).toContain("3199");
    expect(saves[0]?.service_postcodes).toContain("3200");
    await waitFor(() => expect(ui.queryByRole("button", { name: "Confirm coverage" })).toBeNull());
    expect(JSON.stringify(businesses.get("other"))).toBe(otherBefore);
    cleanup(); client.clear(); saves = [];
  }
});

test("a partner sees no office confirmation action and no verification occurs", async () => {
  businesses.set("selected", fixture("selected", "eec_installer"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = render(<QueryClientProvider client={client}><BusinessProfile businessId="selected" isHivicAdmin={false} /></QueryClientProvider>);
  await ui.findByRole("heading", { name: "TEST selected" });
  expect(ui.queryByRole("button", { name: "Confirm coverage" })).toBeNull();
  expect(saves).toHaveLength(0);
  expect(businesses.get("selected")?.coverage_verified_at).toBeNull();
  client.clear();
});