// Portal speed step 2, Task 7: `useAction` — an audited screen-only action finishes once its save is done and the screen
// refreshes in the background (one refetch); a Send / Book / Cancel waits for the save AND the fresh screen; a failed save
// shows the server's message, changes nothing and refetches nothing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const toasts: string[] = [];
mock.module("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
mock.module("sonner", () => ({ toast: { success: (m: string) => toasts.push(`ok:${m}`), error: (m: string) => toasts.push(`error:${m}`) } }));
const { useAction } = await import("../src/hooks/use-me");
afterEach(() => { cleanup(); toasts.length = 0; });

function setup() {
  const qc = new QueryClient();
  let fetches = 0;
  let release!: () => void;
  const screen = () => new Promise<string>((r) => { fetches++; if (fetches === 1) r("first"); else release = () => r("fresh"); });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper, screen, fetches: () => fetches, release: () => release() };
}

describe("useAction", () => {
  test("a note finishes once saved; the screen refreshes in the background (once)", async () => {
    const s = setup();
    const save = mock(async () => ({ ok: true as const }));
    const { result } = renderHook(() => ({ q: useQuery({ queryKey: ["screen"], queryFn: s.screen }), act: useAction(save as never, { name: "logOfficeCallOrNote" }) }), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.q.data).toBe("first"));
    const out = await result.current.act({ jobId: "j" } as never, "Logged"); // resolves while the refetch is still out
    expect(out).toEqual({ ok: true });
    expect(toasts).toEqual(["ok:Logged"]);
    await waitFor(() => expect(s.fetches()).toBe(2));
    s.release();
    await waitFor(() => expect(result.current.q.data).toBe("fresh"));
  });

  test("a Book / Send / Cancel waits for the save and the fresh screen before it finishes", async () => {
    const s = setup();
    const book = mock(async () => ({ ok: true as const }));
    const { result } = renderHook(() => ({ q: useQuery({ queryKey: ["screen"], queryFn: s.screen }), act: useAction(book as never) }), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.q.data).toBe("first"));
    let done = false;
    const p = result.current.act({ jobId: "j" } as never).then(() => { done = true; });
    await waitFor(() => expect(s.fetches()).toBe(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false); // still waiting for the fresh screen
    s.release();
    await p;
    expect(done).toBe(true);
  });

  test("a failed save shows the server's message, returns nothing and refetches nothing", async () => {
    const s = setup();
    const save = mock(async () => { throw new Error("Not allowed on this job."); });
    const { result } = renderHook(() => ({ q: useQuery({ queryKey: ["screen"], queryFn: s.screen }), act: useAction(save as never, { name: "logOfficeCallOrNote" }) }), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.q.data).toBe("first"));
    expect(await result.current.act({ jobId: "j" } as never, "Logged")).toBeUndefined();
    expect(toasts).toEqual(["error:Not allowed on this job."]);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.fetches()).toBe(1);
    expect(result.current.q.data).toBe("first");
  });
});
