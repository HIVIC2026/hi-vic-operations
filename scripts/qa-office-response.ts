// Strict decoding of TanStack server-function replies for QA (20 Oct 2026). Pure; no network or DB.
// Nothing here can turn an HTML page, redirect, parse failure, framed/unsupported body or an HTTP 200 error
// envelope into a pass. Only a decoded {result} without an error counts as a result.
import { fromCrossJSON } from "seroval";
import { createDefaultSerovalPlugins } from "@tanstack/router-core/ssr/client";
// Same plugin set the app's own client uses to decode replies (thrown errors arrive as plugin-tagged nodes).
let plugins: unknown[] | null = null;
const clientPlugins = () => (plugins ??= createDefaultSerovalPlugins() as unknown[]) // src/start.ts registers no serializationAdapters;

export type Decoded =
  | { kind: "result"; status: number; result: unknown }
  | { kind: "fn_error"; status: number; message: string }
  | { kind: "blocked"; status: number; reason: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : String(e));

export function decodeFnResponse(status: number, contentType: string | null, text: string): Decoded {
  if (status >= 300 && status < 400) return { kind: "blocked", status, reason: `redirect (HTTP ${status})` };
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html") || /^\s*</.test(text)) return { kind: "blocked", status, reason: `HTML page instead of a server-function reply (HTTP ${status})` };
  if (ct.includes("x-tss-framed")) return { kind: "blocked", status, reason: "framed/streamed reply is not supported by this harness" };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: "blocked", status, reason: `reply is not JSON (HTTP ${status})` }; }
  let value: unknown;
  try { value = fromCrossJSON(raw as never, { refs: new Map(), plugins: clientPlugins() as never }); } catch (e) { return { kind: "blocked", status, reason: `reply could not be decoded: ${errMessage(e).slice(0, 120)}` }; }
  if (value instanceof Error) return { kind: "fn_error", status, message: value.message };
  if (!value || typeof value !== "object") return { kind: "blocked", status, reason: "decoded reply is not an envelope" };
  const env = value as Record<string, unknown>;
  if (env["error"] !== undefined) return { kind: "fn_error", status, message: errMessage(env["error"]) };
  if (!("result" in env)) return { kind: "blocked", status, reason: "decoded envelope has no result" };
  if (env["result"] instanceof Error) return { kind: "fn_error", status, message: (env["result"] as Error).message };
  if (status !== 200) return { kind: "blocked", status, reason: `HTTP ${status} with a result envelope` };
  return { kind: "result", status, result: env["result"] };
}

type Row = { key: string; label: string; total: number };
const isRow = (r: unknown): r is Row => !!r && typeof (r as Row).key === "string" && typeof (r as Row).label === "string" && Number.isInteger((r as Row).total) && (r as Row).total >= 0;
export type Pipeline = { stages: { rows: Row[] }[]; ended: Row[]; waitingList: Row[] };
export function asPipeline(v: unknown): Pipeline | null {
  const p = v as Pipeline;
  if (!p || !Array.isArray(p.stages) || !Array.isArray(p.ended) || !Array.isArray(p.waitingList)) return null;
  if (!p.stages.every((s) => s && Array.isArray(s.rows) && s.rows.every(isRow)) || !p.ended.every(isRow) || !p.waitingList.every(isRow)) return null;
  return p;
}
export type JobList = { rows: { jobNumber: string; status: string }[]; total: number };
export function asJobList(v: unknown): JobList | null {
  const l = v as JobList;
  if (!l || !Array.isArray(l.rows) || !Number.isInteger(l.total) || l.total < 0) return null;
  return l.rows.every((r) => r && typeof r.jobNumber === "string" && typeof r.status === "string") ? l : null;
}
/** A write passes only on a decoded {ok:true}; the caller must still read the TEST job back. */
export const isOkWrite = (d: Decoded) => d.kind === "result" && !!d.result && typeof d.result === "object" && (d.result as { ok?: unknown }).ok === true;
/** Authorization evidence = the real handler's admin refusal, decoded. Generic 500/403, HTML or unresolved never counts. */
export const isAdminDenial = (d: Decoded) => d.kind === "fn_error" && /^Admin only\.?$/.test(d.message.trim());
export const describe = (d: Decoded) => d.kind === "result" ? `HTTP ${d.status} result` : d.kind === "fn_error" ? `HTTP ${d.status} error "${d.message.slice(0, 120)}"` : `blocked: ${d.reason}`;

/** DB reads used as before/after proof must exist; an error or missing TEST row throws (null===null proves nothing). */
export function requireRow<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: read failed (${r.error.message})`);
  if (r.data == null) throw new Error(`${what}: expected TEST row missing`);
  return r.data;
}
