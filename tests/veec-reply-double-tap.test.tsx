// "Mark reply sent" (VEEC query reply) stays busy until the ["veec", jobId] refresh has finished, so a second tap cannot
// write a second veec_reply_sent event. Mounted-component harness (happy-dom), server functions stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

const serverImpls = new Map<string, (data: unknown) => Promise<unknown>>();
let marks = 0;
let finishRefresh!: () => void;
let veecRefreshes = 0;

const stub = (id: string) => { const f = (() => undefined) as unknown as { __id: string }; f.__id = id; return f; };

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));
mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: { __id: string }) => async (opts: { data: unknown }) => {
    const impl = serverImpls.get(fn.__id);
    if (!impl) throw new Error(`No stub registered for ${fn.__id}`);
    return impl(opts.data);
  },
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  getRequest: () => undefined,
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: true, error: null }),
  useQueryClient: () => ({
    // useAction refreshes everything (resolves at once); the ["veec", jobId] refresh is the slow one the button must wait for.
    invalidateQueries: (f?: { queryKey?: unknown[] }) => {
      if (f?.queryKey?.[0] === "veec") { veecRefreshes++; return new Promise<void>((r) => { finishRefresh = r; }); }
      return Promise.resolve();
    },
  }),
}));
mock.module("sonner", () => ({ toast: { success: () => 0, error: () => 0 } }));

const realPortal = await import("../src/lib/portal.functions");
mock.module("@/lib/portal.functions", () => ({ ...realPortal, markVeecReplySent: stub("markVeecReplySent"), draftVeecReply: stub("draftVeecReply") }));

const { render, act, cleanup, fireEvent } = await import("@testing-library/react");
const React = await import("react");
const { VeecQueryReply } = await import("../src/components/portal/office-job-parts");

afterEach(() => { cleanup(); serverImpls.clear(); marks = 0; veecRefreshes = 0; });

describe("VEEC Mark reply sent", () => {
  test("stays disabled until the VEEC refresh has finished, so it cannot be tapped twice", async () => {
    serverImpls.set("markVeecReplySent", async () => { marks++; return { ok: true }; });
    const r = render(React.createElement(VeecQueryReply, { jobId: "job-1", draft: "A reply to the Registry", sentAt: null }));
    const date = r.container.querySelector('input[name="sent"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-11-01" } });
    const btn = r.getByRole("button", { name: "Mark reply sent" }) as HTMLButtonElement;
    const form = btn.closest("form") as HTMLFormElement;

    await act(async () => { fireEvent.submit(form); });
    expect(marks).toBe(1);
    expect(veecRefreshes).toBe(1);
    expect(btn.disabled).toBe(true); // refresh not finished yet

    await act(async () => { fireEvent.click(btn); }); // a second tap (a disabled button submits nothing)
    expect(marks).toBe(1);

    await act(async () => { finishRefresh(); });
    expect(btn.disabled).toBe(false);
  });
});
