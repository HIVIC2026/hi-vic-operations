// Jo 27 Oct: on Add a job, a mobile/email typed while the address lookup is still finishing must stay.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const React = await import("react");
const { CustomerFields } = await import("../src/components/trade/customer-fields");
const { blankCustomer } = await import("../src/lib/add-job-flow.core");
type ResolvedAddress = import("../src/lib/rec-onboarding.core").ResolvedAddress;
type OnsiteInput = import("../src/lib/onsite-ready-check.core").OnsiteInput;
afterEach(() => cleanup());

test("mobile and email typed while the address is being found are kept", async () => {
  let resolve!: (v: ResolvedAddress | null) => void;
  const details = new Promise<ResolvedAddress | null>((d) => { resolve = d; });
  const provider = { search: async () => [{ id: "p1", label: "12 Ryrie Street, Geelong VIC 3220" }], details: () => details };
  const state = { v: blankCustomer() as OnsiteInput };
  function Host() { const [v, setV] = React.useState<OnsiteInput>(blankCustomer()); state.v = v; return React.createElement(CustomerFields, { value: v, onChange: setV, addressProvider: provider }); }
  const r = render(React.createElement(Host));
  const addr = r.getByRole("combobox");
  fireEvent.focus(addr); fireEvent.change(addr, { target: { value: "12 ryrie" } });
  await act(async () => { await new Promise((d) => setTimeout(d, 330)); });
  await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
  fireEvent.change(r.getByLabelText("Mobile"), { target: { value: "0412 000 777" } });
  fireEvent.change(r.getByLabelText("Email"), { target: { value: "owner@hivic-test.example" } });
  await act(async () => { resolve({ label: "12 Ryrie Street, Geelong VIC 3220", street: "12 Ryrie Street", suburb: "Geelong", state: "VIC", postcode: "3220", country: "AU", provider: "google_places_au" }); await details; });
  expect(state.v.address_verified).toBe(true);
  expect(state.v.phone).toBe("0412 000 777");
  expect(state.v.email).toBe("owner@hivic-test.example");
});
