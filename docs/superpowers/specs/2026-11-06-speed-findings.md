# Why the portal is slow (6 Nov 2026, read-only checks)

## What was measured
- Database stats (`pg_stat_statements`, since 28 Sep): 46.7M calls, about 7.1 hours of total database work in 39 days. **The database is not overloaded.** Cache hit is 100%, and there are no deadlocks.
- The portal is served by Cloudflare at the edge nearest the person (from this workspace: `cf-ray …-IAD`). For Australian users that's Sydney.
- The database is in Europe (Lovable told Jo on 3 Nov that its region can't be changed in place).
- An EXPLAIN on a typical job lookup (`property_facts where job_id = …`) runs in **0.85 ms** on the database.

## Where the seconds go
1. **Distance:** the server (Sydney) to the database (Europe) and back is roughly 0.3 s per trip. Every server function first checks the sign-in (`auth-middleware.ts` creates a client and calls Supabase Auth), then the business (`ctxOrThrow`, several awaits), then 2–3 rounds of reads. The installer home (`tradeHome`) has 8 sequential awaits, which is roughly **3–4 s of travel before any work**. Route guards (`loadAccess`) add another trip.
2. **Slow office reads on the database itself** (mean / worst):
   - `office_enquiry_page` RPC: 743 ms / 5.3 s
   - `job_overview` search (5 × ilike): 1.4 s / 8.0 s
   - `job_overview` list: 609 ms / 4.6 s
   - `office_enquiry_index` by ids: 647 ms / 6.0 s
   - `workflow_events by event_type` ordered by `created_at` (paged): 152 ms / 6.6 s
   - The `property_facts` by-job read from the browser: 632 ms / 6.9 s (0.85 ms run directly, so the cost is in the request path, not the query)
3. **Background work at the same time:** `post_intake_tick` every 2 minutes (worst 8 s), plus 10- and 15-minute jobs (Outlook sync, follow-ups, allocation, Mitti pull).

## What fixes it
- **Moving the database to Sydney** turns each trip from roughly 0.3 s to a few milliseconds. Installer screens go from 3–4 s of travel to well under 0.5 s. This is the biggest single win.
- **Fixing the slow office reads** (indexes or rewrites for the search and enquiry index, and a look at the browser `property_facts` path) removes the 5–8 s spikes. This is needed whether or not the database moves.
- Cutting the remaining sequential awaits (sign-in + business check in one call) helps further, but matters much less once the database is in Sydney.
