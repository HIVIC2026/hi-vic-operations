# Move to Asia Pacific: what has to come across (6 Nov 2026)

How Lovable works (docs.lovable.dev/integrations/cloud): the region can't change after Cloud is on. **When remixing you pick the new backend's region** (Americas, Europe or Asia Pacific), and it can't change after that. Manually added keys are **not** copied. You can't revert to versions from before the remix. The MCP remix tool has no region setting, so **Jo does the remix in the Lovable editor** and picks Asia Pacific.

## Inventory (live project fb35adfe…)
| Item | Size | How it comes across |
|---|---|---|
| Code | repo `hi-vic-operations` | Remix copies it |
| Database: 158 tables, 6 views, 182 functions, RLS policies, triggers | 270 MB | Schema: migrations (`drizzle/migrations`, 198 files) + `supabase/manual_sql`. Data: **unknown whether the remix copies it** — ask Lovable |
| Sign-ins | 275 users, all with passwords | Must keep their password hashes or everyone resets. **Ask Lovable** |
| Files (3 buckets) | 2,952 files, **3.4 GB** | Needs a storage copy. **Ask Lovable** (not doable through SQL alone) |
| Scheduled jobs (pg_cron) | 6: follow-ups 10 min, Outlook sync 10 min, allocation 15 min, Mitti pull 15 min, post-intake 2 min, spot reminders hourly | Re-create, pointing at the new project's URL |
| Database extensions | pg_cron, pg_net, pgcrypto, uuid-ossp, vault, pg_stat_statements | Turn on in the new project |
| Secrets (manually added: **not copied**) | Stripe (live + test key, webhook secrets), Resend (key, webhook secret), Twilio (from number), Mitti (API token, user id, webhook token, trades group), Nearmap, Google Solar, ESC robot (username, password, token, mode), LOVABLE_CRON_SECRET (+ previous), HIV bank (name, BSB, number), PayID, office phone, Google review URL, AP fee override users | Jo pastes them into the new project |
| Lovable connectors | Xero, Microsoft Outlook, Twilio (gateway keys) | Reconnect in the new project |
| Webhooks coming in | Stripe, Xero, Resend, Twilio SMS, Mitti | Update each to the new address, unless the custom domain moves and they already use it |
| Domains | portal.homeinsulationvictoria.com.au (staff host) and the customer host | Point at the new project |

## Questions for Lovable support (they decide whether the weekend is possible)
1. Does remixing into Asia Pacific copy the **database data**, **sign-ins (with passwords)** and **storage files**? If not, can you copy them for us, and how soon?
2. Which city is "Asia Pacific": Sydney or Singapore?
3. Is there any current problem turning on Cloud in Asia Pacific? (Their beta site showed a status notice about this.)

## Go / no-go (Saturday midday)
**Go only if:** all data, all sign-ins and all files are in the new project, and the TEST journey passes there. **Otherwise no-go:** the old project stays live, nothing changes, and we pick a later date.
