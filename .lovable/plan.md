# Portal layout audit and one clean structure

## Read-only result

No screens, records, rules, switches or routes were changed. The current portal has the right functions, but the same work is split across too many places. The office menu alone has 24 internal links plus 3 public links. The cleanest correction is six office destinations: **Today, Work, Leads, Partners, Money, More**.

## Current screen map

### Office / admin

| Route | What is on it now | Main actions | Used when |
|---|---|---|---|
| `/admin` | Pipeline board; enquiry, quote, job and ineligible views; filters; warnings; registered-interest rows | New enquiry; search/filter; select many; hold, cancel, mark test, delete; open job | Every stage |
| `/admin/today` | Morning brief; wants-a-spot list; urgent/today/soon; at-risk dates; yesterday totals | Open saved spots; open to-action list | Daily start |
| `/admin/todo` | “Needs Home Insulation Victoria” exceptions and “All actions”; seven task categories | Filter; refresh; open job/application/staff approval | Any office exception |
| `/admin/ap-queue` | Clean and flagged AP-review jobs | Add note; approve one job; open job | AP review |
| `/admin/jobs/$jobId` | Identity, next action, blockers, eligibility, progress, people, source, coverage, assignments, hold controls, enquiry, Ready Check, quotes, payment, signing, PIESA, rectification, install, evidence, AP review, VEEC, messages, files and history | All office job actions | Every stage |
| `/admin/enquiry-groups` | Four email groups; reasons; video priority; search; bulk selection; draft review | Prepare drafts; preview email; open job | Enquiry follow-up |
| `/admin/hot-leads` | Covered leads, coverage gaps, regional counts, fresh preliminary prices and sample email | Select leads; preview samples; send disabled | Pre-launch campaign only |
| `/admin/launch-campaign` | Sent/opened/saved/opt-out/upload counts; saved spots; desk checks; two email previews | Record desk-check result; open job | Pre-launch campaign only |
| `/admin/interests` | Calculator registrations with New/Contacted/Booked/Closed states and notes | Call/email; change status; save note | Early lead follow-up |
| `/admin/coverage` | Network totals, region map, partner lists, suburb detail, live enquiry coverage | Open partner management; open job | Coverage planning |
| `/admin/team-ups` | Installer/electrician pairing links | Create/copy team-up link | Partner setup |
| `/admin/businesses` | All partner businesses, active/inactive history and business detail | Create business; check expiries; edit business | Partner management |
| `/admin/partners` | Installer and REC applications/enquiries; approved/declined history; unsigned drafts | Review; approve/decline; activate; view agreement/files | Partner intake |
| `/admin/workers` | Pending and all trade staff | Approve/reject worker | Staff onboarding |
| `/admin/users` | User roles, business links and Mitti access | Assign role/business; check access | Access administration |
| `/admin/electrician-rates` | Draft, active, expired and discarded REC rates | Add; activate; expire; discard | Rate management |
| `/admin/pricing` | Customer rates, AP fees and margin settings | Edit prices/settings | Commercial setup |
| `/admin/veec` | Spot price, VEEC buckets, payment filter, job values, margin table | Refresh/save spot price; open job | Finance and VEEC monitoring |
| `/admin/compliance` | Activity 48 form register and versioned form templates | Add version/fields; approve version | Controlled wording setup |
| `/admin/communications` | Customer template catalogue, drafts/history and partner invitation previews | Draft/approve; preview; copy subject | Message setup |
| `/admin/test-centre` | Test jobs, role links, time simulation, test accounts, onboarding links, limits and cleanup | Create/archive test; open as role; simulate deadlines; create links/accounts | QA only |

**Current office menu:** Pipeline, Today, AP approval queue, To action, Enquiries, Enquiry email groups, Hot leads, Spot saved, Pending quote approval, Active jobs, Ineligible, Registered interest, Service coverage, Electrician team-ups, Approved partners, Electrician rates, Prices & margins, Partner applications, Staff approvals, Users & access, VEECs, Compliance, Customer communications, Test Centre, plus calculator and two application-form links.

### Owner

| Route | What is on it / actions | Used when |
|---|---|---|
| `/owner` | Job cards; opens the only job automatically | More than one home/job |
| `/owner/$jobId` | Who acts next; status/progress; estimate; agreement; quotes; payment plan; PIESA times; visit changes; install days; booking; documents; contacts; messages; two timelines | All post-login stages |
| `/estimate/$token` | Personal preliminary estimate; request free measure-up; choose Ready Check times; referral | Estimate to Ready Check |
| `/estimate_/$token/campaign` | Group B upload prompt; live calculator; one Save my spot; opt-out | Launch campaign |
| `/estimate_/$token/video` | Record/choose roof-space video or photo; retry; calculator link | Group B check |
| `/eligibility/$token` | Extra eligibility questions; submit; thank-you | Missing owner answers |

### Installer boss

| Route | What is on it / actions | Used when |
|---|---|---|
| `/partner` | Four header links; needs attention; available offers; install-day choices; jobs split into many buckets | Daily business work |
| `/partner/import` | Single job from pasted text, CSV or files; extraction review | Add one customer |
| `/partner/bulk-import` | Multi-file/ZIP upload; per-file reading; row review and confirmation | Add many customers |
| `/partner/workers` | Invite links; manual staff entry; staff list/status | Manage staff |
| `/partner/profile` | Business profile, documents and onboarding status | Maintain business |
| `/field` | Assigned jobs plus another manual “Submit a job” form | Assigned work; also duplicates add-customer flow |
| `/field/$jobId` | Job header, blockers, timeline, installer journey, measure-up, electrician choice, quote proposal, booking, install evidence/declaration, worker links, contacts and messages | Ready Check through AP submission |

### Installer worker

| Route | What is on it / actions | Used when |
|---|---|---|
| `/w/$token` | One job; next step; bookings/deadline; Mitti form; messages; timeline | One assigned visit without portal account |
| `/join/$token` | Personal details, qualification, declarations and signature | Join an approved company |
| `/field`, `/field/$jobId` | Same logged-in field pages as boss when the worker has an account | Assigned field work |

### Electrician / REC

| Route | What is on it / actions | Used when |
|---|---|---|
| `/partner` | Offers, owner time choices, electrical job buckets and attention warnings | Accept and manage work |
| `/field` | Assigned jobs | Daily visits |
| `/field/$jobId` | Booking; PIESA/Mitti or fallback form; electrical evidence; standard/other rectification items; hours/times; completion/reassessment | PIESA and rectification |
| `/w/$token` | One job; approved rectification items; Mitti; messages; timeline | Worker link visit |
| `/electrician-onboarding` | Nine-page REC application, insurance, work area, availability, rates, bank details, agreement and signature | Initial onboarding |
| `/join/$token` | Staff electrician details, licence, declarations and signature | Staff joining REC |

### Public and support pages

| Route | What is on it / actions | Used when |
|---|---|---|
| `/` and `/calculator` | The same public calculator and interest registration | New public enquiry |
| `/auth` | Email/password and Google sign-in | Portal entry |
| `/installer-onboarding` | Nine-page installer application and agreement | Initial onboarding |
| `/campaign-preview` | Group A/B owner-page and email previews | Internal preview; currently public-addressable |
| `/step3-email-preview` | Outcome email/confirmation previews | Internal preview; currently public-addressable |
| `/qa-access` | Automatic TEST-role sign-in | QA only |
| `/home` | Sends each signed-in role to its home | Login routing |

API, file-stream and tracking addresses are not user screens and should remain out of navigation.

## Top 15 problems

1. **The office menu is far too long:** 24 internal choices plus 3 public links.
2. **Five menu entries are one page:** Pipeline, Enquiries, Pending quote approval, Active jobs and Ineligible are filters on `/admin`.
3. **Lead work is split across five places:** Enquiries, email groups, Hot leads, Spot saved and Registered interest.
4. **Today and To action compete:** both answer “what needs me now,” using different lists.
5. **Partner work is scattered:** businesses, applications, workers, team-ups and coverage live in different menu groups.
6. **Money is scattered:** electrician rates and prices sit under People; VEECs sits under Money; job margins sit inside jobs.
7. **Several labels do not match their destination:** Spot saved/Existing leads campaign, Approved partners/Partner businesses, Partner applications/Partner enquiries.
8. **The pipeline is visually wide and repetitive:** 474 jobs sit in one Ready Check lane, hiding priorities and useful comparison.
9. **The job page is a filing cabinet, not a work screen:** eight record drawers and many embedded tools make the next office action easy to miss.
10. **The owner page can stack more than ten panels:** old, current and future steps appear in one long page instead of one next action.
11. **Installer bosses have three ways to add one job:** Import, Bulk upload and the form on My jobs.
12. **Boss and worker controls are mixed:** staff-link management appears inside the field job used onsite.
13. **Electricians can see two different versions of the same assessment:** Mitti jobs and non-Mitti jobs have substantially different screens.
14. **Launch-only and QA tools look permanent:** Hot leads, campaign previews, Test Centre and public preview addresses sit beside daily work.
15. **Dead ends remain:** unlinked partner account, unavailable worker form, completed eligibility/campaign states and failed private links do not always give one clear next action.

## Proposed office menu — six items

1. **Today** — the only daily starting point.
2. **Work** — all jobs, pipeline, office actions and sign-off.
3. **Leads** — enquiries, calculator interests and campaign work.
4. **Partners** — businesses, applications, staff, coverage and team-ups.
5. **Money** — prices, rates, payouts, invoices/margins and VEEC value.
6. **More** — compliance wording, communications, users/access, Test Centre and useful public links.

Old addresses stay working. They open the correct tab in the new structure, so bookmarks and live links do not break.

## Proposed page layouts

### Today
1. Header: date and one sentence.
2. Three decision lists: **Now**, **Today**, **This week**.
3. Each row: job/person, reason, one next-action button.
4. Three summaries: **Work**, **Partners**, **Money**.
5. Yesterday's totals at the bottom.

Merge **To action** into Today. Show “Wants a spot” as a lead task, not a separate block.

### Work
1. Tabs: **Needs action**, **All jobs**, **Sign-off**, **Completed**.
2. Search and only essential filters: stage, source, owner/trade.
3. One table: Job, address, stage, next step, due, owner/trade.
4. Pipeline becomes an optional view, not the default.
5. AP queue becomes the Sign-off tab; VEEC lodgement stays tied to the job.

### Clear job page
1. Identity: job, address, owner, stage and deadline.
2. **Do this now**: one office action and blockers.
3. **Progress**: the house/progress mark and short timeline.
4. Tabs in job order: Enquiry; Ready Check; Quote; PIESA; Fix-up; Installation; AP & VEEC; Files & history.
5. Keep only current-step controls open. Completed records become short read-only summaries.
6. Money strip stays visible to office only. Messages/files/history stay last.

### Leads
1. Tabs: **New**, **Needs review**, **Follow-up**, **Campaigns**, **Closed**.
2. One owner/address row even when a calculator interest and website enquiry match.
3. Columns: name, suburb, result, received, next step.
4. Campaigns contains Email groups, Hot leads and Existing leads as sub-tabs.
5. Campaign send controls remain locked by their existing approvals and switches.

### Partners
1. Tabs: **Needs approval**, **Businesses**, **Staff**, **Coverage**, **Team-ups**.
2. Partner applications and unsigned drafts stay in Needs approval.
3. Business page contains profile, documents, service area and rates link.
4. Coverage is a planning tab, not a primary menu destination.

### Money
1. Tabs: **Payouts**, **Prices**, **Electrician rates**, **Job margins**, **VEEC value**.
2. Default to payouts due/overdue after that feature is live; until then default to Prices.
3. Keep spot-price entry and value summaries separate from the per-job margin table.
4. Never expose this area to owners or trades.

### More
1. Compliance forms.
2. Customer and partner messages.
3. Users and access.
4. Test Centre, clearly marked TEST.
5. Public calculator and application-form links under “Open public pages,” not in the main menu.

## Approved “nothing lost” safety net

This belongs inside **Today → Needs me** and the top of each job page. It must not become another menu item or a second task system.

| Rule | Current state | Where it lives now | Smallest safe addition |
|---|---|---|---|
| Every active job has a next step, who has the ball and a due date; missing values show as “No next step” | **Partly built** | Shared next-step and party rules: `src/lib/nextstep.core.ts`, `src/lib/waiting.core.ts`; secure fact loader: `src/lib/waiting.functions.ts`; stage changes set a default next action in `src/lib/workflow.server.ts` | Add one pure completeness check for every non-terminal job. Feed missing next step, party or due date into the existing office exception list as **No next step**. Show the same three facts in every job header. Do not create a second workflow source. |
| Every stage has a target time; over-target or inactive jobs are flagged | **Partly built** | Party-based 24h/48h and 3-day/7-day targets: `src/lib/waiting.core.ts`; generic seven-day inactivity check: `src/lib/stuck.core.ts`; pipeline wiring: `src/lib/portal.functions.ts` | Add a configurable presentation target for each active stage, with a safe fallback. Combine stage age and `last_activity_at`, then feed breaches into **Needs me**. Keep regulatory deadlines, booking times and the PIESA clock authoritative over generic targets. |
| Mitti, Xero and email failures always appear in Needs me with the reason | **Partly built** | Xero errors already reach the office list through `src/lib/xero.server.ts`, `src/lib/todo.functions.ts` and `src/lib/todo.core.ts`; failed/undelivered job messages already reach the exception list through `src/lib/needs.server.ts`; Mitti errors are stored by `src/lib/mitti.server.ts` but currently stay on the job’s Mitti panel | Extend the existing exception loader to include unresolved Mitti errors and any failed email rows not represented in `job_communications`. Use stable failure keys so one fault appears once and clears only when the underlying record succeeds. |
| “Later” returns next morning; a second snooze requires a reason | **New** | No snooze state or control exists. The current to-action list is deliberately derived and clears only when its source record changes: `src/lib/todo.core.ts` | Add one small audited snooze record keyed to the existing stable task key and staff member. First Later returns at the next Melbourne morning; subsequent Later requires a reason. Snoozing hides only the presentation row and never changes job stage, deadlines or blockers. |
| A job ends only as Complete, Cancelled with reason, or On hold with revisit date; overdue holds are flagged | **Partly built** | Complete is compliance-gated in `src/lib/workflow.server.ts`; cancelled/on-hold are protected terminal/exception states; `setHold` in `src/lib/portal.functions.ts` already requires a reason and preserves the prior stage | Require a revisit date when placing a job on hold, retain the existing reason, and add overdue holds to Needs me. Keep resume reversible through the stored prior stage. Add a database guard only if the practice-database proof shows the server guard alone cannot cover every write path. |
| Quiet owners receive reminders, a final notice, then closure frees the spot | **New as a whole-job rule** | A narrow unopened-estimate reminder exists in `src/lib/followups.server.ts`; owner due/flag timing exists in `src/lib/waiting.core.ts`. There is no universal final-notice-and-close journey | Reuse the existing queued, idempotent communication pattern. Define stage-specific eligibility and cancellation exclusions; prepare reminder and final-notice wording for Jo’s approval; after the approved response window, cancel with a fixed audited reason and release only the relevant reservation/offer. Nothing sends while communication switches are off. |
| Daily “nothing lost” count reconciles every job to exactly one stage | **New** | The 7am portal-only brief exists in `src/lib/daily-brief.server.ts`; the database gives each job one enum stage, while presentation grouping lives in `src/lib/workflow.ts` | Add a read-only reconciliation to the morning brief: total active jobs must equal the sum of the six office groups plus separately counted On hold, Completed and Cancelled jobs. Flag null/unknown/unmapped, duplicate presentation membership, and load failures instead of showing a false all-clear. |
| Quiet trades retain 24h reminder / 48h flag, then work can be offered elsewhere | **Partly built** | Timings are locked in `src/config/workflow-decisions.ts`; coordination exceptions and re-offer paths live in `src/lib/allocation.core.ts`, `src/lib/allocation.functions.ts`, `src/lib/pilot.functions.ts` and `src/lib/readycheck-booking.server.ts`; the office list is loaded by `src/lib/needs.server.ts` | Keep the existing timers. Standardise the 48h action across Ready Check, PIESA, rectification and installation: show one clear **Offer to another trade** action where reassignment is permitted, preserving the old assignment and history. Never silently replace the accepted installation provider where owner approval is required. |

### Six office stages

The active workflow maps cleanly enough for a **presentation-only** six-stage view. It must not replace the detailed database stages or transition guards.

| Office stage | Detailed stages shown inside it |
|---|---|
| **Enquiry** | `new_enquiry`, `eligibility_review`, `preliminary_estimate_ready` |
| **Ready Check** | `ready_check_awaiting_acceptance`, legacy Ready Check payment record, ready to schedule, scheduled, complete |
| **Quote & pay** | `measured_estimate_ready`, `measured_quote_accepted`, `ready_for_installer_quotes`, `awaiting_quote_acceptance`, `awaiting_deposit_payment` |
| **Safety check** | PIESA window pending/scheduled/complete, electrical variation, rectification required/approval/scheduling/booked |
| **Install** | `installation_scheduling`, `installation_booked` |
| **Sign-off** | `evidence_outstanding`, `ap_review`, `ready_for_veec` |

**Exceptions:** Complete, Cancelled and On hold are statuses outside the six active stages. On hold also keeps the office stage it paused in. The four retired assessment stages remain readable for history and display under Safety check with a **Legacy** label; they are never re-entered. Rectification sits under Safety check because it resolves the electrical clearance, even though its quote is still shown in the job’s Quote & pay records.

Technical approach: add a pure `officeGroupForStage` mapping beside the existing `PIPELINE_PHASES` in `src/lib/workflow.ts`. Do not change the stage enum, stored job stages, `STAGE_ORDER`, transitions or compliance gates.

## Proposed per-role structure

- **Owner:** one home screen. Top shows the single next step; then appointment/status; completed steps collapsed; help/messages last. Never show all possible future actions.
- **Installer boss:** **Today, My jobs, Add customers, My business**. Merge single import and manual entry; bulk upload is a choice inside Add customers. Staff lives inside My business.
- **Installer worker:** one assigned-job list and one job screen. Show only today’s task, required photos/form and Submit. No staff links, business setup or price controls.
- **Electrician/REC:** **Today, My jobs, My business**. Today shows offers and booked visits. Job shows only the current electrical task. Rates/bank details stay in My business for authorised bosses only.
- **Public:** calculator, secure estimate/campaign action, onboarding and sign-in only. Internal previews and QA entry should not be discoverable public pages after launch.

## What to merge, hide or retire from navigation

- Merge Today + To action.
- Merge the five `/admin` menu variants into Work filters.
- Merge AP queue into Work → Sign-off.
- Merge all lead/campaign pages under Leads.
- Merge partner businesses/applications/staff/coverage/team-ups under Partners.
- Merge pricing/rates/margins/VEECs under Money.
- Merge installer manual import and single-job entry; keep bulk as a mode.
- Hide Test Centre, campaign preview tools and public-form shortcuts under More.
- Keep old routes as redirects/aliases until no active link uses them; do not delete records or history.

## Safe rebuild stages after launch

1. **Office frame only:** replace the menu with six destinations; preserve every old address and action.
2. **Safety-net read model:** add the six-stage presentation mapping and one read-only completeness check. Prove every active job resolves to exactly one office stage, next step, responsible party and due date before changing the screens.
3. **Today:** merge the two attention lists into **Needs me**; include No next step, overdue/inactive work, overdue holds and every unresolved Mitti/Xero/message failure. Add Work/Partners/Money summaries and the daily nothing-lost count.
4. **Job page:** reorder existing panels around “Do this now,” showing next step, who has the ball, due date and safety-net reason. No gate or compliance wording changes.
5. **Later and hold controls:** add audited next-morning snoozing and mandatory hold revisit dates, practice database first with an undo file. Do not let either change the underlying workflow deadline.
6. **Work lists:** replace the five pipeline menu entries with six presentation-stage tabs and a clear default table; retain detailed stages and the board as optional views.
7. **Leads and quiet owners:** put enquiries, interests and campaigns behind one page; preserve safety locks. Add the reminder/final-notice/closure sequence only after Jo approves its exact wording and timing.
8. **Partners and Money:** regroup the existing screens into tabs; add no new commercial behavior. Standardise the existing 24h/48h quiet-trade handoff without silently changing accepted providers.
9. **Installer and electrician:** separate boss tools from onsite next-step screens; merge duplicate add-customer entry points.
10. **Owner:** show only the current next step and collapse completed/history sections.
11. **Cleanup and proof:** hide launch/QA tools from normal menus, guard internal previews, verify every active job appears once in the morning count, then retire duplicate UI only after link-use checks.

Each stage is presentation-only, previewed separately, checked on desktop and phone, and reversible. Live job rules, stages, evidence, pricing, sending, payment and Xero behavior remain untouched.

## Screenshot evidence: five worst screens

Captured read-only at 1280px from the signed-in preview:
- **Pipeline:** 24-link menu and a 474-card Ready Check lane.
- **Service coverage:** summary cards, map, region panels and partner lists on one long screen.
- **VEECs:** spot price, value buckets, payment filtering and margin reporting combined.
- **Job page:** dense header followed by eight record drawers.
- **Hot leads:** campaign selection, regional coverage and pricing presented as a permanent daily page.
