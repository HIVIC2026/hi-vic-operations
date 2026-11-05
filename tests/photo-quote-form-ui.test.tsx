// Photo-quote installers Task 6: the Quote from photos box — photos grid, the four fields, Send for quote greyed out with
// the first problem until the form is right, and no prices or quote links anywhere (Jo 5 Nov 14:50: HIV's price).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { expect, mock, test } from "bun:test";
const sent: unknown[] = [];
mock.module("@/lib/trade-view.functions", () => ({ getPhotoQuoteMedia: { id: "media" }, tradeSubmitPhotoQuote: { id: "submit" }, tradeHandBack: { id: "back" } }));
mock.module("@/lib/office-list-refresh", () => ({ markOfficeChanged: () => {} }));
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: { id: string }) => async (input: unknown) => { sent.push([fn.id, input]); return { ok: true, sent: false, held: [] }; } }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: {
  media: [{ id: "p1", kind: "photo", url: "/api/files/abc.sig/roof.jpg", name: "roof.jpg" }, { id: "v1", kind: "video", url: "/api/files/def.sig/attic.mp4", name: "attic.mp4" }],
  ownerSaid: [["Insulation (owner said)", "Some — batts, patchy"]],
}, isLoading: false, error: null }), useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
const React = await import("react");
const { render, fireEvent } = await import("@testing-library/react");
const { PhotoQuoteForm } = await import("../src/components/portal/PhotoQuoteForm");

test("photos open full size, videos play inline, owner said shows; no $ amount or quote link", () => {
  const r = render(React.createElement(PhotoQuoteForm, { jobId: "j" }));
  expect((r.container.querySelector("a[href='/api/files/abc.sig/roof.jpg']") as HTMLAnchorElement).target).toBe("_blank");
  expect(r.container.querySelector("video[src='/api/files/def.sig/attic.mp4']")).toBeTruthy();
  expect(r.getByText("Some — batts, patchy")).toBeTruthy();
  expect(r.container.textContent).not.toMatch(/\$\s?\d/);
  expect(r.container.innerHTML).not.toMatch(/View quote|my-job|quote \(PDF\)/i);
});
test("Send for quote is greyed out with the first problem, then sends the four answers", async () => {
  const r = render(React.createElement(PhotoQuoteForm, { jobId: "j2" }));
  const btn = () => r.getAllByRole("button", { name: "Send for quote" }).at(-1) as HTMLButtonElement;
  expect(btn().disabled).toBe(true);
  expect(r.getAllByText("Say if the existing insulation is under R2").length).toBeGreaterThan(0);
  fireEvent.click(r.getAllByRole("button", { name: "Yes" }).at(-1)!);
  fireEvent.change(r.getAllByLabelText("Sqm to remove").at(-1)!, { target: { value: "0" } });
  fireEvent.change(r.getAllByLabelText("Sqm to install").at(-1)!, { target: { value: "84.5" } });
  fireEvent.change(r.getAllByLabelText("Product").at(-1)!, { target: { value: "Bradford Gold R5" } });
  expect(btn().disabled).toBe(false);
  fireEvent.click(btn());
  await new Promise((res) => setTimeout(res, 0));
  expect(sent).toContainEqual(["submit", { data: { jobId: "j2", underR2: true, removeM2: 0, installM2: 84.5, product: "Bradford Gold R5" } }]);
});
