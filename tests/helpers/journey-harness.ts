// Journey harness (A1 / A2 complete-route tests, external review 25 Oct 2026 §6 "Run both complete routes").
// Everything the portal owns is REAL: every table (generated from the Supabase types, see pglite-journey-db.ts), the
// SQL functions that exist in docs/pending-migrations (loaded verbatim), the server modules and their guards.
// Only the EXTERNAL PROVIDERS are faked, at the one place the code reaches them — `fetch`:
//   Mitti (api.mitti.com), Resend + Twilio + Xero (connector-gateway.lovable.dev/{resend,twilio,xero}), Stripe (api.stripe.com).
// Plus the platform pieces PGlite cannot be: Supabase Storage (in-memory buckets) and Supabase Auth admin (users in
// `profiles`). Identity helpers (has_role, can_access_job, …) answer true: the journey drives the server modules as the
// service role, and who may act is decided by the modules' own membership/assignment reads against real rows.
// Never touches the live database or any network.
import { readFileSync, readdirSync } from "node:fs";
import { journeyDb, type JourneyDb } from "./pglite-journey-db";

// ---------------------------------------------------------------------------------------------------------------
// SQL functions, verbatim: the applied migration chain (drizzle/migrations, in order) and then the pending migrations
// (docs/pending-migrations, numbered files first, then named ones). The latest definition of each function wins.
// ---------------------------------------------------------------------------------------------------------------
export function pendingFunctionSql(): Map<string, string> {
  const out = new Map<string, string>();
  const scan = (dir: URL, files: string[]) => {
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8");
      const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\([\s\S]*?(\$[a-z_]*\$)[\s\S]*?\2[^;]*;/gi;
      for (const m of src.matchAll(re)) out.set(m[1]!.toLowerCase(), m[0]);
    }
  };
  const applied = new URL("../../drizzle/migrations/", import.meta.url);
  scan(applied, readdirSync(applied).filter((f) => f.endsWith(".sql")).sort());
  const dir = new URL("../../docs/pending-migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && !/rollback|verify|abort|revert/i.test(f));
  scan(dir, [...files.filter((f) => /^\d/.test(f)).sort(), ...files.filter((f) => !/^\d/.test(f)).sort()]);
  return out;
}

/** Create the named functions (or all of them) in the journey database; returns which ones compiled. */
export async function loadPendingFunctions(j: JourneyDb, names?: string[]): Promise<{ loaded: string[]; failed: Record<string, string> }> {
  const all = [...pendingFunctionSql()].filter(([n]) => !names || names.includes(n));
  const loaded: string[] = [];
  let failed: Record<string, string> = {};
  // Functions call each other: repeat until a pass compiles nothing new (dependency order without a graph).
  for (let pass = 0; pass < 5; pass++) {
    failed = {};
    let progress = false;
    for (const [name, sql] of all) {
      if (loaded.includes(name)) continue;
      try { await j.db.exec(sql); loaded.push(name); progress = true; } catch (e) { failed[name] = (e as Error).message; }
    }
    if (!progress) break;
  }
  return { loaded, failed };
}

// ---------------------------------------------------------------------------------------------------------------
// Fake providers behind fetch.
// ---------------------------------------------------------------------------------------------------------------
export type MittiItem = { item_id: string; label: string; type?: string; responses?: Record<string, unknown>; children?: MittiItem[]; media?: unknown[] };
export type MittiAudit = Record<string, unknown> & { audit_id: string; template_id: string; items: MittiItem[]; header_items: MittiItem[]; completed: boolean };
export type ProviderLog = { at: string; provider: "mitti" | "resend" | "twilio" | "xero" | "stripe"; method: string; path: string; body: unknown; headers: Record<string, string> };

export function fakeProviders(opts: { mittiTemplates: Record<string, { items: MittiItem[]; response_sets?: unknown[] }> }) {
  const log: ProviderLog[] = [];
  const mitti = { audits: new Map<string, MittiAudit>(), media: new Map<string, { bytes: Uint8Array; type: string }>() };
  const emails: { to: string[]; subject: string; text: string; html: string; idempotencyKey: string | null; attachments: number }[] = [];
  const texts: { to: string; body: string }[] = [];
  const storageFiles: { map: Map<string, { bytes: Uint8Array; contentType: string }> | null } = { map: null };
  const xero = { invoices: new Map<string, Record<string, unknown>>(), contacts: new Map<string, Record<string, unknown>>(), payments: [] as Record<string, unknown>[] };
  const stripe = { sessions: [] as { id: string; url: string; form: Record<string, string>; idempotencyKey: string | null }[] };
  let seq = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bodyOf = (init?: RequestInit) => { const b = init?.body; if (b == null) return null; if (typeof b === "string") { try { return JSON.parse(b); } catch { return b; } } if (b instanceof URLSearchParams) return Object.fromEntries(b); return String(b); };

  const mittiRoute = (method: string, path: string, body: Record<string, unknown> | null): Response => {
    if (path === "/users/search") return json(200, [{ id: "mitti-user-jo", email: "jo@actpropertyinspections.com.au" }]);
    const t = /^\/templates\/v1\/templates\/([^/?]+)/.exec(path);
    if (t) { const tpl = opts.mittiTemplates[decodeURIComponent(t[1]!)]; return tpl ? json(200, { template: { template_id: decodeURIComponent(t[1]!), ...tpl } }) : json(404, {}); }
    if (method === "POST" && path === "/audits") {
      const id = `audit_${++seq}`;
      const b = body as { template_id: string; items?: MittiItem[]; header_items?: MittiItem[] };
      const now = new Date().toISOString();
      // Like Mitti: the audit carries EVERY question of its template; the prefilled answers sent with the create fill theirs.
      const tpl = opts.mittiTemplates[b.template_id];
      const given = new Map([...(b.items ?? []), ...(b.header_items ?? [])].map((i) => [i.item_id, i]));
      const items = tpl ? tpl.items.map((t) => ({ ...JSON.parse(JSON.stringify(t)), ...(given.get(t.item_id) ?? {}) })) as MittiItem[] : (b.items ?? []);
      for (const g of b.items ?? []) if (!items.some((i) => i.item_id === g.item_id)) items.push(g);
      mitti.audits.set(id, { audit_id: id, template_id: b.template_id, created_at: now, modified_at: now, completed: false, items, header_items: tpl ? [] : (b.header_items ?? []) });
      return json(200, { audit_id: id });
    }
    if (method === "GET" && path.startsWith("/audits/search")) return json(200, { audits: [...mitti.audits.values()].map((a) => ({ audit_id: a.audit_id, template_id: a.template_id, modified_at: a["modified_at"] })) });
    const media = /^\/audits\/([^/]+)\/media\/([^/]+)$/.exec(path);
    if (media) { const m = mitti.media.get(decodeURIComponent(media[2]!)); return m ? new Response(m.bytes, { status: 200, headers: { "content-type": m.type } }) : json(404, {}); }
    const a = /^\/audits\/([^/]+)(\/.*)?$/.exec(path);
    if (a) {
      const audit = mitti.audits.get(decodeURIComponent(a[1]!));
      if (!audit) return json(404, {});
      if (!a[2] && method === "GET") return json(200, audit);
      if (!a[2] && method === "PUT") { const b = body as { items?: MittiItem[]; header_items?: MittiItem[] }; for (const it of [...(b.items ?? []), ...(b.header_items ?? [])]) { const ex = [...audit.items, ...audit.header_items].find((x) => x.item_id === it.item_id); if (ex) Object.assign(ex, it); else audit.items.push(it); } audit["modified_at"] = new Date().toISOString(); return json(200, {}); }
      if (a[2] === "/share" || a[2] === "/deep_link") return json(200, { url: `https://app.mitti.com/audits/${audit.audit_id}` });
      if (a[2]?.startsWith("/report")) return json(200, { id: "report_1", status: "SUCCESS", url: `https://reports.mitti.example/${audit.audit_id}.pdf` });
    }
    if (/^\/inspections\/v1\/inspections\/[^/]+\/owner$/.test(path)) return json(200, {});
    return json(404, { message: `fake Mitti: no route ${method} ${path}` });
  };

  const xeroRoute = (method: string, path: string, body: Record<string, unknown> | null): Response => {
    if (path === "/connections") return json(200, [{ tenantId: "tenant-demo", tenantName: "Demo Company (AU)" }, { tenantId: "tenant-live", tenantName: "Home Insulation Victoria" }]);
    if (/^\/api\.xro\/2\.0\/TrackingCategories/.test(path)) return json(200, { TrackingCategories: [] });
    if (/^\/api\.xro\/2\.0\/Contacts/.test(path)) {
      if (method === "GET") return json(200, { Contacts: [...xero.contacts.values()] });
      const c = ((body as { Contacts?: Record<string, unknown>[] })?.Contacts ?? [body ?? {}])[0]!;
      const id = `contact-${xero.contacts.size + 1}`; xero.contacts.set(id, { ...c, ContactID: id });
      return json(200, { Contacts: [{ ...c, ContactID: id }] });
    }
    const inv = /^\/api\.xro\/2\.0\/Invoices(?:\/([^/?]+))?(\/OnlineInvoice)?/.exec(path);
    if (inv) {
      if (inv[2]) return json(200, { OnlineInvoices: [{ OnlineInvoiceUrl: `https://in.xero.com/${inv[1]}` }] });
      // Reads show the payments as Xero holds them now (a bank transfer reconciled after the invoice was raised).
      const live = (i: Record<string, unknown>) => {
        const mine = xero.payments.filter((p) => (p["Invoice"] as { InvoiceID: string }).InvoiceID === i["InvoiceID"]);
        const paid = mine.filter((p) => p["Status"] !== "DELETED" && p["Status"] !== "VOIDED").reduce((s, p) => s + Number(p["Amount"]), 0);
        return { ...i, AmountPaid: paid, AmountDue: Number(i["Total"] ?? 0) - paid, Payments: mine };
      };
      if (method === "GET" && inv[1]) { const i = xero.invoices.get(decodeURIComponent(inv[1])); return i ? json(200, { Invoices: [live(i)] }) : json(404, {}); }
      if (method === "GET") { const ref = /Reference%3D%3D%22([^%]+)%22|Reference=="([^"]+)"/.exec(path); return json(200, { Invoices: [...xero.invoices.values()].filter((i) => !ref || i["Reference"] === decodeURIComponent(ref[1] ?? ref[2] ?? "")) }); }
      const incoming = ((body as { Invoices?: Record<string, unknown>[] })?.Invoices ?? [body ?? {}])[0]!;
      const id = (incoming["InvoiceID"] as string | undefined) ?? `inv-${xero.invoices.size + 1}`;
      const prev = xero.invoices.get(id) ?? {};
      const lines = (incoming["LineItems"] as { Quantity?: number; UnitAmount?: number; LineAmount?: number }[] | undefined) ?? (prev["LineItems"] as never) ?? [];
      const total = lines.reduce((s, l) => s + (l.LineAmount ?? (l.Quantity ?? 1) * (l.UnitAmount ?? 0)), 0);
      const paid = xero.payments.filter((p) => (p["Invoice"] as { InvoiceID: string }).InvoiceID === id && p["Status"] !== "DELETED").reduce((s, p) => s + Number(p["Amount"]), 0);
      const row = { ...prev, ...incoming, InvoiceID: id, InvoiceNumber: prev["InvoiceNumber"] ?? `INV-${4000 + xero.invoices.size}`, Status: incoming["Status"] ?? prev["Status"] ?? "AUTHORISED", Total: total, AmountDue: total - paid, AmountPaid: paid, Payments: xero.payments.filter((p) => (p["Invoice"] as { InvoiceID: string }).InvoiceID === id) };
      xero.invoices.set(id, row);
      return json(200, { Invoices: [row] });
    }
    if (/^\/api\.xro\/2\.0\/Payments/.test(path)) return json(200, { Payments: xero.payments });
    return json(404, { message: `fake Xero: no route ${method} ${path}` });
  };

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = bodyOf(init);
    const path = url.pathname + url.search;
    const headers = Object.fromEntries([...new Headers(init?.headers).entries()].filter(([k]) => !/authorization|api-key/i.test(k)));
    const note = (provider: ProviderLog["provider"], p: string) => log.push({ at: new Date().toISOString(), provider, method, path: p, body, headers });
    if (url.host === "api.mitti.com") { note("mitti", path); return mittiRoute(method, path, body as Record<string, unknown> | null); }
    if (url.host === "connector-gateway.lovable.dev" && url.pathname.startsWith("/resend")) {
      note("resend", path);
      const b = body as { to: string[]; subject: string; text?: string; html?: string; attachments?: unknown[] };
      const headers = new Headers(init?.headers);
      emails.push({ to: b.to, subject: b.subject, text: b.text ?? "", html: b.html ?? "", idempotencyKey: headers.get("Idempotency-Key"), attachments: b.attachments?.length ?? 0 });
      return json(200, { id: `email_${emails.length}` });
    }
    if (url.host === "connector-gateway.lovable.dev" && url.pathname.startsWith("/twilio")) {
      note("twilio", path);
      const b = body as Record<string, string>;
      texts.push({ to: b["To"]!, body: b["Body"]! });
      return json(201, { sid: `SM${String(texts.length).padStart(32, "0")}`, status: "queued" });
    }
    if (url.host === "connector-gateway.lovable.dev" && url.pathname.startsWith("/xero")) { note("xero", path.replace(/^\/xero/, "")); return xeroRoute(method, path.replace(/^\/xero/, ""), body as Record<string, unknown> | null); }
    if (url.host === "api.stripe.com") {
      note("stripe", path);
      // Review R02: the webhook reads the PaymentIntent (GET) for its charge id — a read, never a new checkout session.
      if (method === "GET" && path.startsWith("/v1/payment_intents/")) return json(200, { id: decodeURIComponent(path.split("/").pop() ?? ""), latest_charge: "ch_test_1" });
      const form = Object.fromEntries(new URLSearchParams(typeof init?.body === "string" ? init.body : ""));
      const key = headers["idempotency-key"] ?? null;
      const prior = stripe.sessions.find((x) => key && x.idempotencyKey === key);
      if (prior) return json(200, { id: prior.id, url: prior.url }); // Stripe returns the same session for a repeated idempotency key
      const id = `cs_test_${stripe.sessions.length + 1}`;
      const s = { id, url: `https://checkout.stripe.com/c/pay/${id}`, form, idempotencyKey: key };
      stripe.sessions.push(s);
      return json(200, { id, url: s.url });
    }
    // Signed storage URLs (journeyAdmin storage): the upload checker reads the first bytes back like the real bucket.
    if (url.host === "storage.test" && method === "GET" && storageFiles.map) {
      const f = storageFiles.map.get(decodeURIComponent(url.pathname.slice(1)));
      return f ? new Response(f.bytes, { status: 200, headers: { "content-type": f.contentType } }) : json(404, {});
    }
    throw new Error(`journey harness: unexpected network call ${method} ${url.href}`);
  };
  return { fetchImpl, log, mitti, emails, texts, xero, stripe, templates: opts.mittiTemplates, storageFiles };
}

/** The trade answers the form on their phone: each answered question replaces the template question with the same
 *  wording (first still-unanswered one, in form order); anything the template does not have is added. Then Complete. */
export function fillAudit(audit: MittiAudit, answered: MittiItem[], opts: { complete?: boolean } = {}) {
  const key = (l: string) => l.split("\n")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const a of answered) {
    // An unanswered question first; else the same question the portal prefilled (the trade confirms / edits it there).
    const slot = audit.items.find((i) => key(i.label) === key(a.label) && !i.responses && !i.media) ?? audit.items.find((i) => key(i.label) === key(a.label) && !answered.includes(i));
    if (slot) Object.assign(slot, { ...a, item_id: slot.item_id });
    else audit.items.push(a);
  }
  if (opts.complete ?? true) audit.completed = true;
  audit["modified_at"] = new Date().toISOString();
}

/** What Stripe POSTs to /api/public/hooks/stripe-payments when the owner pays on a Checkout page we created: a signed
 *  `checkout.session.completed` carrying the metadata the portal put on the session. */
export async function stripePaidWebhook(session: { id: string; form: Record<string, string> }, secret: string, opts: { eventId?: string; paymentIntent?: string; livemode?: boolean; nowMs?: number } = {}) {
  const f = session.form;
  const body = JSON.stringify({
    id: opts.eventId ?? `evt_${session.id}`, type: "checkout.session.completed", livemode: opts.livemode ?? false, created: Math.floor((opts.nowMs ?? Date.now()) / 1000),
    data: { object: { id: session.id, object: "checkout.session", payment_status: "paid", amount_total: Number(f["line_items[0][price_data][unit_amount]"]), payment_intent: opts.paymentIntent ?? `pi_${session.id}`, customer_email: f["customer_email"] ?? null,
      metadata: { job_id: f["metadata[job_id]"], invoice_id: f["metadata[invoice_id]"], step: f["metadata[step]"], job_number: f["metadata[job_number]"], job_source: f["metadata[job_source]"] } } },
  });
  const t = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { body, signature: `t=${t},v1=${sig}` };
}

// ---------------------------------------------------------------------------------------------------------------
// supabaseAdmin stand-in: the PGlite shim + rpc + storage + auth admin.
// ---------------------------------------------------------------------------------------------------------------
export function journeyAdmin(j: JourneyDb) {
  const storage = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const procs = async () => new Set((await j.q<{ proname: string }>("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).map((r) => r.proname));
  /** One SQL function call. With `asUser` it runs in a transaction where auth.uid() = that user (their own client). */
  const callSql = async (name: string, args: Record<string, unknown>, asUser: string | null) => {
    // Exactly what PostgREST answers for a function that is not deployed (e.g. a staged migration not applied yet).
    if (!(await procs()).has(name)) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache (journey harness: not in the migration chain)` } };
    const keys = Object.keys(args);
    const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    const vals = keys.map((k) => { const v = args[k]; return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v; });
    try {
      const r = asUser
        ? await j.db.transaction(async (tx) => { await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [asUser]); return tx.query<Record<string, unknown>>(sql, vals); })
        : await j.db.query<Record<string, unknown>>(sql, vals);
      const rows = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
      const scalar = r.fields.length === 1 && r.fields[0]!.name === name;
      return { data: scalar ? (rows[0]?.[name] ?? null) : rows, error: null };
    } catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  };
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });
    // The service role (supabaseAdmin) passes these identity helpers; a signed-in caller's own client (`asUser`) runs the
    // REAL SQL functions instead, so who may act is decided by the migration chain's rules against real rows.
    if (["has_role", "is_admin", "can_access_job", "is_job_owner", "is_business_member", "has_contact_release"].includes(name)) return { data: true, error: null };
    return callSql(name, args, null);
  };
  /** A signed-in caller's own Supabase client (context.supabase): the same tables, identity RPCs run as that user. */
  const asUser = (userId: string) => ({
    ...j.shim,
    rpc: async (name: string, args: Record<string, unknown> = {}) => { rpcCalls.push({ name, args: { ...args, as: userId } }); return callSql(name, args, userId); },
    auth: { getUser: async () => ({ data: { user: { id: userId, user_metadata: {} } }, error: null }) },
  });
  let users = 0;
  const admin = {
    ...j.shim,
    rpc,
    storage: {
      from(bucket: string) {
        const key = (p: string) => `${bucket}/${p}`;
        return {
          async upload(path: string, body: Uint8Array | ArrayBuffer | Blob | string, o?: { contentType?: string; upsert?: boolean }) {
            if (storage.has(key(path)) && !o?.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
            const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body as ArrayBuffer);
            storage.set(key(path), { bytes, contentType: o?.contentType ?? "application/octet-stream" });
            return { data: { path }, error: null };
          },
          async download(path: string) { const f = storage.get(key(path)); return f ? { data: new Blob([f.bytes], { type: f.contentType }), error: null } : { data: null, error: { message: "Object not found" } }; },
          async createSignedUrl(path: string, secs: number) { return { data: { signedUrl: `https://storage.test/${key(path)}?exp=${secs}` }, error: null }; },
          async createSignedUploadUrl(path: string) { return { data: { signedUrl: `https://storage.test/upload/${key(path)}`, token: "upload-token", path }, error: null }; },
          async list(prefix = "") { return { data: [...storage.keys()].filter((k) => k.startsWith(key(prefix))).map((k) => ({ name: k.slice(key(prefix).length).replace(/^\//, "") })), error: null }; },
          async remove(paths: string[]) { for (const p of paths) storage.delete(key(p)); return { data: paths.map((name) => ({ name })), error: null }; },
        };
      },
    },
    auth: {
      admin: {
        async createUser(u: { email?: string; user_metadata?: { full_name?: string } }) {
          const id = `5${String(++users).padStart(7, "0")}-0000-4000-8000-000000000000`;
          await j.q("insert into profiles (id, full_name, email) values ($1,$2,$3)", [id, u.user_metadata?.full_name ?? null, u.email ?? null]);
          return { data: { user: { id, email: u.email } }, error: null };
        },
        async getUserById(id: string) { const [p] = await j.q<{ email: string | null }>("select email from profiles where id = $1", [id]); return p ? { data: { user: { id, email: p.email } }, error: null } : { data: { user: null }, error: { message: "User not found" } }; },
        async listUsers() { return { data: { users: (await j.q<{ id: string; email: string }>("select id, email from profiles")) }, error: null }; },
        async generateLink(p: { email: string }) { return { data: { properties: { action_link: `https://auth.test/link?email=${encodeURIComponent(p.email)}` } }, error: null }; },
        async updateUserById(id: string) { return { data: { user: { id } }, error: null }; },
        async inviteUserByEmail(email: string) { return admin.auth.admin.createUser({ email }); },
      },
    },
  };
  return { admin, storage, rpcCalls, asUser };
}

/** TanStack server-function stand-in: keeps the literal chain, runs the input validator, calls the handler with the given context. */
export const serverFnStandIn = () => ({
  createServerFn: () => {
    let validator: unknown = null;
    const b = {
      middleware: () => b,
      inputValidator: (v: unknown) => { validator = v; return b; },
      validator: (v: unknown) => { validator = v; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => unknown) => (a: { data?: unknown; context?: unknown } = {}) => {
        const v = validator as { parse?: (x: unknown) => unknown } | ((x: unknown) => unknown) | null;
        const data = typeof v === "function" ? v(a.data) : v?.parse ? v.parse(a.data) : a.data;
        return h({ data, context: a.context });
      },
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}), middleware: () => ({ server: () => ({}) }) }),
});

export { journeyDb };
