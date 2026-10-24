# Office portal audit — is it "100% current"?

**Branch audited:** `installer-mitti-workflow` at commit `1a525df6` ("Log decision 215", 24 Oct 2026). Read-only; nothing was changed.
**Asked for by:** decision 212 (Jo, 24 Oct 2026: "the office layout is unclear, cluttered and unfunctional"; same method as the installer audit, then mock-ups one at a time).
**Yardstick:** `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts`, `docs/JO_DECISIONS_LOG.md` (decisions 1–216), `AGENTS.md`, `src/lib/AGENTS.md`, and the dated Jo rules written into the office code (19, 21, 22, 23 Oct).

**Decision 216 (Jo, 24 Oct, leads data):** live counts are 1,717 real jobs, 1,325 estimate-only leads, 133 one-word names, junk names, 17 case problems, 72 never contacted, and website addresses stored as one line with a blank suburb. Jo approved: full name required at Save my spot; a **Fix details** pile for one-word / junk names; automatic capitalisation tidy; address normalisation into street / suburb / postcode for every source; a **Contact history** panel on every job (every email, text and call with date, content and what we are waiting for); a **Last heard from us** column on Leads; and a one-off review of the 1,325 estimate-only leads. These are written into Parts 2, 4 and 5 below.
**Written for:** Jo. Plain words in Parts 1–5; file paths only in the appendix. Style A tokens are already decided, so nothing here is about colours or type — only structure, content and wording.

**Who uses the office:** Jo (owner, Accredited Person representative, approves wording and money) and Chris (office, day-to-day: enquiries, choosing trades, checking quotes, signing as AP representative, recording payments, final check). "Daily" below means several times a day on a normal day; "weekly" once a week or less; "rare" only when something goes wrong or at set-up.

**Legend:** **KEEP** = matches a current decision (cited). **REMOVE** = belongs to a retired rule or isn't needed (reason cited). **UNSURE** = one question for Jo. **MISSING** = the current process needs it and it isn't there (or is buried).

**Retired rules looked for on every screen:** installer quote approval ("Waiting on installer", decision 7); the old 4-step Add a job and its "who organises / quoted? / site check?" questions (34, 185); owner-picked Ready Check times, 2-hour windows and the owner "choose 3–5 times" step (52, 53, 61); "first to accept" batch offers and automatic dispatch (49, 157); office booking of visits and the record-then-confirm "Arrange the visit" model (1, 19, 52, 54); office install-day step and "expected install week" (1, 2); 50% deposit / native Xero deposit request / 3-instalment plan (source of truth "Payment gate", `payment.retired`); cooling-off and Gate A paperwork (Jo 21 Oct); the separate installer declaration and "sign the VEEC form at acceptance" (118a, 119); the "check your ceiling" photos email (68); the what-if calculator and legacy email editors (AGENTS); duplicated piles (0218, Jo 21 Oct).

---

## Part 1 — Screen inventory

| # | Screen | Route | Purpose today | Who · how often | Verdict |
|---|---|---|---|---|---|
| 0 | Office frame (top bar, More menu, phone tabs) | every `/admin/*` | Enquiries · Active jobs · Closed jobs · Communications · Templates, search, More | Both · always | KEEP frame, change the five headings |
| 1 | **Needs me** | `/admin/needs-me` | Every job that needs the office, most urgent first | Both · daily | KEEP — should be the home; today it is not even in the menu |
| 2 | Today's brief | `/admin/today` | 7am brief: needs, at-risk, yesterday's numbers; also repeats New from installers and Quotes to check | Jo · daily-ish | REMOVE (fold into Needs me) |
| 3 | AP approval queue ("Final check") | `/admin/ap-queue` | Approve each job to Ready for VEEC, flagged vs clean | Jo · weekly | KEEP (as a Needs me group / own tab) |
| 4 | **Enquiries** (the Leads screen) | `/admin/enquiries` (legacy `/admin/enquiry-groups`, `/admin/list`, `/admin/ready-check`, `/admin/hot-leads` redirect here) | Every website enquiry: one outcome, photo review, next office action; carries Quotes to check at the top | Chris · daily | KEEP, trim |
| 5 | **Active jobs** | `/admin/jobs/active` (legacy `/admin/jobs`, `/admin/pipeline`, `/admin/operations`, `/admin/todo`, `/admin/list`) | One paged list of operational jobs + New from installers + Mitti pick-ups + Mitti sync problems + Quotes to check | Both · daily | KEEP, trim |
| 6 | Closed jobs | `/admin/jobs/closed` | Completed / Cancelled / Ineligible / Removed-test | Both · weekly | KEEP |
| 7 | Pipeline board / "Quote approvals" | `/admin/board?tab=quotes` (`/admin/quotes`, `/admin?tab=quotes` redirect here) | Old kanban lanes, "PENDING QUOTE APPROVAL", bulk hold/cancel/mark-test/delete, New enquiry dialog, filters | Nobody should · rare | REMOVE (keep New enquiry and bulk actions elsewhere) |
| 8 | **Job page** | `/admin/jobs/$jobId` | Everything about one job in seven fold-out record groups | Both · daily, the most-used screen | KEEP, rebuild around "Next" |
| 9 | Communications | `/admin/communications` (Overview · Outgoing · Sent & history · Failed · Campaigns · Outlook & review) | Email operations centre | Chris · daily | KEEP 3 of 6 tabs |
| 10 | Templates | `/admin/templates` (Email · Mitti · Compliance) | The one register of approved wording | Jo · weekly (template review) | KEEP |
| 11 | Compliance Setup | `/admin/compliance` | Activity 48 form register, Mitti forms, template versions, ESC notification fields | Jo · rare | KEEP under Settings, fix wording |
| 12 | Owner paperwork | `/admin/owner-paperwork` | Owner documents by gate, approve, "owner signs again after install" switch | Jo · rare | MERGE into 11; remove the switch |
| 13 | Partner applications ("Partner Enquiries") | `/admin/partners` | Approve installer / REC applications, website partner enquiries, tests | Both · weekly | KEEP |
| 14 | Approved partners ("Partner businesses") | `/admin/businesses` | Business file: approval, rates, insurance, team, bank, agreement, ESC notice, Xero supplier | Both · weekly | KEEP |
| 15 | Staff approvals | `/admin/workers` | Approve partner staff (CII check) | Chris · weekly | KEEP (fold into Partners) |
| 16 | Partners overview | `/admin/partners-overview` | Cards: live jobs, on time %, reply time | Nobody · rare | REMOVE |
| 17 | Service coverage | `/admin/coverage` | Network at a glance, regions, team directory, active enquiry check | Both · rare | UNSURE (keep as a reference tab under Partners) |
| 18 | Electrician team-ups | `/admin/team-ups` | Installers' nominated electricians, copy invite link, "I've sent it" | Nobody · rare | REMOVE (decision 157 replaced it) |
| 19 | Electrician rates | `/admin/electrician-rates` | Versioned REC rate card, office spread | Jo · rare | KEEP (under Partners or Money) |
| 20 | Prices & margins | `/admin/pricing` | Owner price list R5/R6/R7, VEEC sale price, margins by trade | Jo · rare | KEEP |
| 21 | Money / Payouts | `/admin/money` | Margin this month, VEECs lodged, owners owe, we owe trades; payouts Mark paid | Jo · weekly | KEEP |
| 22 | VEECs | `/admin/veec` | Spot price, VEEC value of confirmed/pending jobs, markup by job | Jo · weekly | KEEP, merge price entry |
| 23 | Users & access | `/admin/users` | Roles, TEST login file (Deep's handover), "Check all trades in Mitti" | Jo · rare | KEEP under Settings |
| 24 | Automatic sending rules | `/admin/save-my-spot-rules` | Save my spot automatic selection filters; the global owner Ready Check booking switch | Jo · rare | KEEP filters; REMOVE the booking switch |
| 25 | 3 questions reminder (one-off) | `/admin/save-spot-reminder-blast` | Decision 172 one-off blast | Jo · once | KEEP until run, then remove |
| 26 | Registered interest | `/admin/interests` | Calculator "register interest" list, new/contacted/booked/closed | Chris · weekly | UNSURE |
| 27 | Deleted jobs | `/admin/deleted` | Restore soft-deleted jobs | Rare | KEEP under Settings |
| 28 | Test Centre | `/admin/test-centre` | Dummy journeys, TEST roles, Jo-as-tradie, Xero connection card, test trade accounts, onboarding links/limits | Jo · during the TEST run | KEEP; move the Xero card to Settings |
| 29 | Left sidebar nav (old) | inside `AppShell` | 30 links incl. Pipeline, Pending quote approval, Save my spot follow-ups, Electrician team-ups | never shown to admins (dead code) | REMOVE the code |

Twenty-nine screens for two people. The current process needs about nine.

---

## Part 2 — Screen by screen: KEEP / REMOVE / UNSURE

### Screen 0 · The frame (top bar, More, phone tabs)

| Element | Verdict | Why |
|---|---|---|
| Logo → Enquiries; search "Find a job, owner or address"; initials + **More** | KEEP | Approved phase-3 frame (office-nav rule). |
| Five headings: **Enquiries · Active jobs · Closed jobs · Communications · Templates** | CHANGE | Needs me is missing entirely (only reachable through a link on Today's brief). Closed jobs and Templates are weekly screens taking two of five slots. Proposed: **Needs me · Enquiries · Jobs · Partners · Money**, everything else in More. |
| More → "Office tools": Today's brief · **Quote approvals** · Final check · Registered interest · Deleted jobs · Test centre | REMOVE "Quote approvals", "Today's brief" | "Quote approvals" opens the old board's PENDING QUOTE APPROVAL lane — the retired installer-approval model (decision 7; quotes are prepared on Mitti Complete and the office presses Send, 24 Oct "first weeks", 159). Today's brief duplicates Needs me. |
| More → Partners: Overview · Approved · Applications · Staff · Coverage · **Team-ups** | REMOVE Team-ups, Overview | Decision 157/173: the installer's usual electrician (saved in My business) does the PIESA; the "nominate, copy invite link, I've sent it" team-up flow is gone. Overview cards (on-time %, reply time) measure nothing Jo decided on. |
| More → Money: Overview · Payouts · Prices · Electrician rates · VEECs | KEEP | 26, 30, 109, 157. |
| More → Settings: Users · Compliance · Owner paperwork · Automatic sending rules · 3 questions reminder | KEEP, merge | Owner paperwork and Compliance are two registers for the same documents (see screens 11/12). **MISSING: Xero** (decision 179 says "Office → Settings → Xero"; the only Xero card is inside Test Centre). **MISSING: message switches** (159: switch on one message type at a time; 16: cancel all held messages). |
| More → Public forms: Customer calculator · Electrician application form · Installer application form | KEEP | Handy links. |
| Phone: five bottom tabs mirroring the headings | KEEP | Same headings as above. |
| Old left sidebar in `AppShell` (Pipeline · Today · AP approval queue · Enquiries · Enquiry email groups · Save my spot follow-ups · Pending quote approval · Active jobs · Ineligible · Registered interest · Service coverage · Electrician team-ups · …) | REMOVE the code | Admins never see it (the admin branch returns the top bar first), but it is the full retired menu and will confuse the next builder. |

### Screen 1 · Needs me (`/admin/needs-me`) — should be the home

**Purpose:** one row per job (its most urgent reason) plus partner items; Later = tomorrow 7am.

| Element | Verdict | Why |
|---|---|---|
| "N need you. Most urgent first. Every row says why it's here." + Include TEST jobs link | KEEP | Jo's safety-net rule; TEST isolation. |
| Row: what · job · suburb · time left · rule pill · why · one action button · **Later** | KEEP | One pile per job (0218): one row per job is exactly right. |
| **"How job offers go out: Office picks first / Automatic"** switch at the top | REMOVE | Decision 49: the office picks ONE installer, "there is no automatic batch offering"; 157: the office still chooses and sends the PIESA offer. "Automatic" is a retired mode and a live switch on the home screen is a hazard. |
| **"Send to all"** button on trade rows | REMOVE | Same decisions (49, 51, 157): a declined/expired offer comes back to the office to pick another installer, never to blast everyone. |
| Rule "Partner item": new applications, staff to approve, Mitti forms not set up, failed daily texts, partner change requests | KEEP | Application queue rule; 153; decision 83 texts. |
| Grouped rows "N enquiries not contacted yet" linking to `/admin/enquiry-groups` and `/admin/hot-leads` | FIX links | Both routes are redirects (one lands on Communications › Outgoing). Should open Enquiries › New. |
| Rule "30-day install clock nearly up" fires at **5 days** left (`clock_warning_days`) | FIX | Decision 2: ONE office alert at **10 days** left. |
| Rows for "chosen installer said Not for me / didn't offer times in 24h → Choose installer" | KEEP | Decision 51. |
| Rows for "Quote held → Review quote" | KEEP | 24 Oct held reasons, 159 ("the office sees only held ones"). |
| Rows for "Owner picking times → Remind owner" (Ready Check) | REMOVE | Decision 53: owners no longer pick Ready Check times. |
| Rows for "Agreeing install date → Remind installer" | REMOVE | Decision 1: "the office is never involved" in install days, except the 10-day alert. |
| Rows for "Arranging Ready Check / Arranging PIESA → Remind installer/electrician" after 48h | UNSURE | Source-of-truth direct-contact rule (48h → Needs attention) predates decisions 52/61 (tap-to-book back-and-forth). Question for Jo: does the office still step in when a Ready Check or PIESA isn't agreed after 48 hours, or only when the 24-hour offer lapses? |
| **MISSING** rows the process needs: ESC owner consent waiting for the AP signature (123/128); VEEC form waiting for the AP Part A signature and its four prerequisites (119); the **day-10 VEEC unsigned alert** (120 — the event `veec_assignment_unsigned_10_days` is written but Needs me never reads it); ESC install notification window open / closing in 48h (121, 195 — only *failed* notices reach Needs me today); quote **declined by the owner** (92: "office alert"); install-day **second no-access** (215); 30-day window lapsed with the payer decision (158); fixes quote waiting for office check (14); Mitti pick-ups to link and Mitti sync problems (today only on Active jobs); installer jobs that "need sorting out" (today only in New from installers). | — | These are the office's real daily jobs and most of them are only visible by opening the right job and the right fold-out. |

### Screen 2 · Today's brief (`/admin/today`)

| Element | Verdict | Why |
|---|---|---|
| New from installers + Quotes to check (repeated from Active jobs) | REMOVE here | Same blocks on three screens = three piles for one job (0218). |
| "Spots saved: N" list with "See all saved spots" → `/admin/launch-campaign` (a redirect to Communications › Campaigns) | REMOVE | Spot saved is an Enquiries pile (Jo 22 Oct). Dead link. |
| What needs you (Urgent / Today / Soon), "Open Needs me" | REMOVE (merge) | A second, differently grouped copy of Needs me. |
| At risk this week: 30-day clock · ESC deadline · Pre-start check | KEEP the content, move into Needs me | These three are exactly the rows Needs me is missing. |
| Yesterday: enquiries · bookings · installs · VEECs submitted/registered | UNSURE | Question for Jo: do you want a small numbers strip (yesterday / this week) on Needs me, or none at all? |
| "This morning's brief was made at 7am… Sending is off, so it is shown here only." | REMOVE | The 7am brief email was never approved in the template review. |

### Screen 3 · AP approval queue / "Final check" (`/admin/ap-queue`)

| Element | Verdict | Why |
|---|---|---|
| No flags / Flagged columns, note (required when flagged), **Approve this job** → Ready for VEEC | KEEP | Workflow steps 28–29; decision 213 ("the office still reviews before Ready for VEEC"). |
| Two names for one screen ("AP approval queue" heading, "Final check" in menus and statuses) | FIX wording | One name: **Final check**. |
| Reached only from More and from a button buried in the job page | MOVE | Make it a Needs me group ("Final check (N)") or a tab next to Active jobs. |

### Screen 4 · Enquiries (`/admin/enquiries`) — the Leads screen

| Element | Verdict | Why |
|---|---|---|
| Heading, "Every website enquiry with one current outcome and the next office action", search, paging | KEEP | One Leads screen rule. |
| Header buttons **Email centre** and **Quote approvals** | REMOVE | Email centre is already a top heading; Quote approvals is the retired board lane (decision 7). |
| **Quotes to check** block at the top of Enquiries | REMOVE here | Quotes come from Ready Checks, i.e. Active jobs; AGENTS puts "Installer quotes to check" on Active jobs. On Enquiries it is a second pile. |
| Scope line "N open website enquiries · reply accepted / recorded / uncertain / no reply" | KEEP, shorten | Honest send accounting (source of truth "sent never progresses workflow"). |
| Tiles: **OFFICE REVIEW** (full width) · Open enquiries · New · no reply recorded · Spot saved · Spot offered · Awaiting photos/videos · Ineligible | KEEP the piles, fix two labels | 0218 one-pile rule is built in (pending-photo and New-no-reply are excluded from the others). "Awaiting photos/videos" = `insulation_requested`: decision 68 retired the photos/video email; these owners were sent the **3 questions** email (69, 85), photos optional. Label → "Asked the 3 questions". "Open enquiries" is the sum of the others; a tile that equals the total of the other tiles invites "counts don't add up" questions — show it as the page total instead. |
| "Office tools: Office review (N) · Quote approvals · Final check" strip under the tiles | REMOVE | Office review is already the big tile above it; the other two links belong to other screens. |
| Office review explainer "Photos/videos to check and exceptions needing an Office decision" | KEEP | |
| Row: owner · property · status + reply state + photo review outcome · insulation/area · photos · age · next office action with **PhotoRankButtons** (No insulation / Under R2 / Thicker / Can't tell / Not eligible – close) | KEEP | Jo 8 Oct photo rule; 23 Oct "no photos → same three buttons"; "Not eligible – close" sends T7 (24 Oct). |
| Next office action for Spot saved = **"Book Ready Check"** | FIX wording | Decision 49: the office **chooses an installer**; nothing is booked by the office. Button → "Choose installer" (opens the job's Choose installer panel). |
| Remove selected (reason "Fake or test enquiry") | KEEP | Removed stays hidden, history kept (AGENTS). |
| Row status "Email sent – offering spot" / "Email sent – insulation details needed" (`STATUS_LABEL`) vs tile labels "Spot offered" / "Awaiting photos/videos" (`OFFICE_ENQUIRY_LABEL`) | FIX | Two label sets for one status; the row and the tile should say the same words (decisions 55: "estimate", not "quote"; 69: "3 questions"). |
| **MISSING:** the **New enquiry (phone / manual)** button — it only exists on the retired Pipeline board. | — | Chris takes phone enquiries. |
| **MISSING (decision 216): a "Fix details" pile** for one-word names, junk names and case problems (133 + 17 today), with an inline fix (name, address split) and the automatic capitalisation tidy applied first so only real junk reaches the pile. | — | Today the only hint is the "Email looked wrong" pill; a one-word name sails straight into Save my spot emails and quotes. One pile per job (0218): a lead in Fix details is in no other pile until fixed. |
| **MISSING (216): a "Last heard from us" column** (date and what it was: estimate email, Save my spot, 3 questions, text) and "Never contacted" visible per row. | — | The scope line gives totals (72 never contacted) but no row says which ones. The reply-state words under Status ("reply recorded") are not a date. |
| **MISSING (216): the address shown as street · suburb · postcode** for every source (website rows arrive as one line with a blank suburb). | — | Blank suburb breaks Choose installer distance, coverage and the approved texts ("near {Suburb}", decisions 71, 76, 78). |
| **MISSING (216): a one-off review of the 1,325 estimate-only leads** (a filter or a Settings one-off like the 3 questions reminder, decision 172): keep · fix details · not eligible – close · remove. | — | Estimate-only leads are the "waiting list" statuses; nothing lists them for a decision. |

### Screen 5 · Active jobs (`/admin/jobs/active`)

| Element | Verdict | Why |
|---|---|---|
| Heading, server-paged list, search, sort, page size | KEEP | One jobs workspace rule. |
| Tiles **In progress · Review required · Payment overdue · Safety/PIESA attention** | REMOVE | They are counts over different predicates than the stage chips below them, so they can disagree with the list; "Review required" is a Gate 1 enquiry state, not a job state; "Payment overdue" uses the Xero invoice status, which the Payment steps block already shows per job. Needs me is where "attention" lives. |
| **New from installers** (needs sorting out / added in the last 7 days) with Open job + Mitti form | KEEP | Jo 23 Oct; decision 31 ("their-own-jobs only"). |
| **Ready Checks started in Mitti** (link by HV number) and **Mitti sync problems** (Retry) | KEEP | Mitti-first pick-up rule. Also surface them as Needs me rows. |
| **Quotes to check**: Ready for you (Held reasons, total, **Check & send**, Mitti form) · Declined by the owner (Reopen) · Not drafted yet (What's missing) · Show practice jobs | KEEP | 24 Oct "office presses Send"; 33 (keep Not drafted yet); 92 (declined); held reasons (62). This is the ONE home for it. |
| Stage filter chips built from `stageCounts` using `nextStep().label` (so chips can read "Spot saved", "Check onsite", legacy stage tags) | FIX | Use the six office stages (Enquiry · Ready Check · Quote · PIESA · Install · Final check — `OFFICE_STAGES`) as the only filter; the job row already shows its status. |
| Row (`StaffJobRow`): address · job no · owner · life support · **JobFactsLine** (insulation / media / ceiling area) · SourceBadge · step pill · supplemental eligibility pill · next action · waiting on · **InstallerFactsLine** · coverage pill · comms pill · stuck reasons · last activity | TRIM | JobFactsLine ("Insulation present · Media not checked · Ceiling not provided") is enquiry information on an operational list. InstallerFactsLine shows the retired intake facts ("quoted / site check", decisions 34, 185). Coverage pill is an allocation detail. Keep: address, job no, owner, label "Your customer"/our lead style source (31), ONE status pill (`officeStatus` label), waiting on, time left, life support. |
| Footer "Enquiries keeps pre-handoff records out of this list" | KEEP | |
| **MISSING:** Closed jobs as a tab here rather than a top heading. | — | |

### Screen 6 · Closed jobs (`/admin/jobs/closed`)

| Element | Verdict | Why |
|---|---|---|
| Tiles Completed · Cancelled · Ineligible · Removed / test; same row layout | KEEP | Exact live-TEST archive complement rule. |
| Subtitle "nothing is marked complete by this page" | KEEP | |

### Screen 7 · Pipeline board / "Quote approvals" (`/admin/board`)

| Element | Verdict | Why |
|---|---|---|
| Kanban lanes from `PIPELINE_PHASES` incl. **"PIESA (earlier jobs)"** (the retired `awaiting_electrician` stages) and **"Payment"** (`awaiting_deposit_payment`) | REMOVE | `RETIRED_LEGACY_STAGES`; the deposit-gate stage is the retired payment rule (source of truth). |
| Tab titles "PENDING QUOTE APPROVAL", "Quote approvals" | REMOVE | Decision 7 and 24 Oct: no approval step; Quotes to check is the queue. |
| On every open: `sweepAuthorities()` and `autoAdvancePipeline()` run, then the list refetches | REMOVE | Hidden automation triggered by opening a screen; nothing in Jo's process says "opening the board moves jobs". |
| "Messages on/off" pill; "Pre-launch safety is active" line; System health fold-out | MOVE | Belongs in Settings › Switches. |
| Filters Source · Stage · Insulation · Media · Sort; "More views: Review required, Exceptions, On hold, Finalised, Cancelled, Test" | REMOVE | Jo 19 Oct: three plain sections, now built as Enquiries / Active / Closed. |
| **Select all shown → Put on hold · Cancel · Mark as test · Delete** (reason, audited; delete = test only) | KEEP the actions, move to Active jobs | Bulk rule (guarded per job). |
| **New enquiry (phone / manual)** dialog | KEEP, move to Enquiries | Only place a phone enquiry can be created. |
| "Registered interest" rows mixed into the enquiry list | REMOVE | Different record type; see screen 26. |
| Board card: ready-check "Booked" from the bookings table | REMOVE with the board | |

### Screen 8 · Job page (`/admin/jobs/$jobId`) — the most cluttered screen

**Purpose:** everything about one job. Today: a header, then three different "where is it" boxes, then seven fold-outs holding ~45 panels.

**Top of the page**

| Element | Verdict | Why |
|---|---|---|
| ← Back; **JobIdentity**: "Installer's own job — {business}" banner, job no, TEST / life support, address, owner, phone, email, contact consent (+ View evidence), Eligibility (Gate 1) pill, warning pills (PIESA expired / install by / ESC notice due / payment not verified / Ready to install / Ready to lodge VEEC) | KEEP, reword the banner | Decision 48 wording: a quiet label "Your customer" / "Home Insulation Victoria lead" — on the office side "Installer's own job — {business}" / "Our lead". The warning pills are the right idea: they are the only place the ESC due date appears without opening a fold-out. |
| Cancelled banner with reason | KEEP | |
| **InstallerJobSummary** (installer jobs): waiting-on pill, "up to" line, Owner permission, Ready Check form + Open in Mitti, Quote, "What you need to do" | KEEP | Jo 23 Oct. This is already the "Next" panel the installer audit asked for — make it the top panel for every job, not only installer jobs. |
| **CompactJobStatus**: bucket · process words · eligibility · "Current action" tasks with party · "Open current records" / "Communication records" · last email sent · "Status loaded …" · "Automatic sending settings" fold-out | REMOVE (merge into one Next panel) | Second status box; its tasks come from the operations classifier, the summary above from the installer summary, the blockers below from a third read. Three answers to "what's next". |
| "Current blockers" heading + **Change classification** + **Update job** buttons; **JobDeleteControls**; **CurrentJobBlockers** ("What happens next" list) | REMOVE as a block; keep one "Blocked because…" line in Next, keep Delete under More | Third status box. Update job reveals EligibilityForm + HoldControls (hold / resume / cancel) + three jump buttons; Change classification reveals EligibilityForm again; the Eligibility fold-out reveals EligibilityForm a third time. One Gate 1 form, in one place. |
| "Eligibility evidence & verified decision" fold-out: EligibilityCard (six checks: owner said / result / onsite) with override + VerifiedEligibilityCard | KEEP as the Enquiry card | Source of truth "Eligibility" and step 11 (office records verified eligibility). |
| Installer jobs wrap all of the above in a closed "Full details — stage checks, classification and website eligibility answers" | KEEP the idea (collapse), apply to all jobs | Jo 23 Oct. |
| SourceBadge + UrgencyBadge row | REMOVE | Both already in JobIdentity. |
| Record shortcut buttons: Quotes & payments · Forms & evidence · Communications · History | REMOVE | A second navigation for the same seven fold-outs. |

**Fold-out "Contacts, source & exceptions"**

| Element | Verdict | Why |
|---|---|---|
| **Job source**: channel, originating installer, **Invoice route** select (HIV invoices owner / "Installer invoices the owner — recorded but not yet supported, stays locked" / Commercial setup required) | REMOVE the select | Installer-led rule: Home Insulation Victoria invoices the owner, co-branded; the unsupported route is a dead option that locks jobs. Keep channel + installer as facts in the header. |
| **Installer's job** (`OfficeInstallerFactsCard`: "quoted? site check?" facts) | REMOVE | Retired 4-step intake (34, 185). |
| **Trade coverage** (REC / installer serviceable, Open coverage view, Email service-area update) | KEEP as one line | Decision 74 "Not in your area yet" email is approved; the send button is the only place to send it. Move the button into Enquiry. |
| **Assigned trades**: pick an electrician / installer *user* by name, Mitti membership check, "Assign anyway" with reason | UNSURE | Allocation is now business-level (Choose installer, Choose trades) and Mitti membership per person (22, 188). Question for Jo: is a per-person assignment still needed, or is "business accepted the offer" + the installer's own staff allocation (161) enough? |
| **Expected install week (office only)** | REMOVE | Decision 1: installer offers 3 days, owner picks; no office planning note. |
| **ESC install notification and pre-start check (office only)** (`OfficePrestartCard`: Registry window, copy-to-Registry block, record reference, withdraw/resubmit, pre-start check) | KEEP, but ONE panel | Decisions 118b, 121, 155 (manual prepare/remind/record), 195 (robot later). It is duplicated by "Pre-install compliance (ESC notice · consent · PIESA copies)" under Installation — two Record-submission forms for the same notice. Keep this one, move it under Install. |
| **Daily Mitti links texts** log | KEEP, move to History | Decision 83 texts. |
| **Partner & relationship**: acquisition channel, relationship owner switch with reason, **Offer to partner** (choose approved installer, 3-day expiry), installer proposed scope/supplier price | REMOVE | Pre-decision-49 batch offer with a 3-day expiry and a "partner dashboard"; Choose installer (24-hour, one installer) replaced it. Relationship owner is the channel, already shown. |
| **Record retention** ("Retain until …") | KEEP, move to History | 6-year rule (118a). |

**Fold-out "Enquiry"**

| Element | Verdict | Why |
|---|---|---|
| **Paperwork** strip A · B · C · D with items and DRAFT tags; landlord-consent form | UNSURE / simplify | Jo 21 Oct: Gate A has no required items, cooling-off not required; decision 97/123/119 moved everything to acceptance → install consent → VEEC after install. Question for Jo: keep one line "Signed: acceptance ✓ · install consent ✓ · rebate form ✓/pending" instead of four gates? |
| **Step 3 · Indicative estimate**: area/postcode/climate zone, **GHG formula**, VEEC value × settings version, access totals, secure link panel (Show link, views), Engagement panel, **750px customer email preview iframe**, "Exact calculation audit" JSON | TRIM hard | Keep: estimate figure, rebate, link status + Show link, when it was sent. Remove the formula line, the audit JSON and the email iframe (the approved email lives in Templates, decision 66/67). |
| "The website-style indicative estimate isn't used for installer jobs" | KEEP (one line) | Decision 75 (no estimate email to installers' customers). |
| **Contact and photos** (`IntakeSummary`): consent, age, assistance, preferred contact, home built, 3 insulation answers, photos + **PhotoRankButtons** | KEEP, drop the second set of rank buttons | Photo ranking already happens on the Enquiries list; two places to rank the same photos. |
| Documents in this section (Property) | KEEP | |

**Fold-out "Ready Check"**

| Element | Verdict | Why |
|---|---|---|
| **Offer Ready Check booking** button ("Owner booking is switched off for everyone (Settings → Automatic sending rules)") | REMOVE | Decision 53: owners no longer pick Ready Check times; the installer offers 3 times (52). The whole owner-booking path (button, global switch, `enquiry.spot_saved_waiting` status) is retired. |
| **Choose installer** (nearby approved installers, area, R5 rate, Send offer; open offer line with closing time; Said Not for me / Didn't answer notes; Show more) | KEEP — and promote | Decisions 49–51. This is the office's main daily action on our leads and it sits in the fourth fold-out. It should be the Next panel's button. |
| **Choose trades for this job** (PIESA tick list, "Office picks for this job" override, usual-electrician note, Select all, search to add, "Send offer to N trades", "first 24 hours… Suggest another time") | KEEP as **Choose electrician**, move to PIESA, simplify | Decision 157/173: the usual electrician is pre-marked; office sends the offer to ONE REC (or any approved REC in the area if none). Multi-tick "send to N trades", "Office picks for this job" and the "Suggest another time opens after Nh" line belong to the retired automatic dispatch. |
| **Visit scope** banner + **Ready Check** card with measurement, variance vs tolerance, Missing fields, **Accept Ready Check / Needs review / Reject** with reason, earlier records | UNSURE | Since Mitti Complete prepares the quote and the office presses Send (24 Oct, 159), is a separate "Accept Ready Check" step still part of the process, or is Check & send the acceptance? AGENTS still describes `accepted_by` as the route to `ready_check_complete`. One question for Jo. |
| **Electrical / PIESA** card (electrician, assessment date, outcome, 30-day deadline, fixes) under the Ready Check heading | MOVE to PIESA | Combined Ready Check + PIESA visit is retired (source of truth). |
| **Arrange the visit** (`AppointmentPanel`: propose a time, accept/decline, coordination history, request another electrician) | REMOVE | The record-then-confirm proposals model is retired by tap-to-book (52, 61, 80); the installer's own customers arrange directly with nothing in the portal (54). |
| **Assessment booking** (fact + Cancel booking) | KEEP as a fact line "Ready Check booked {day} {time}" | Decision 82 texts need the fact; the office should not re-book. |
| **Admin override / set booking directly** (reason, destructive) | UNSURE | Emergency path. Question for Jo: keep one hidden "set the time (with reason)" for phone bookings, or none? |
| **Ready Check (Mitti)** / **Mitti electrical assessment** card (form ID, measured area, removal, Open in Mitti, Copy link, Sync from Mitti, validation issues) | KEEP | Mitti is the only Ready Check form; Mitti-first rule. |
| **Electrical assessment record** (downlights, exhaust fans, hazards, switchboard, RCDs…) from the old combined `assessments` row, shown under Ready Check | MOVE to PIESA | Retired combined visit; these are PIESA facts. |
| Documents (Ready Check) | KEEP | |

**Fold-out "Quotes & payments"**

| Element | Verdict | Why |
|---|---|---|
| **Generate installer quotes** button (our leads) | REMOVE | The quote is prepared on Mitti Complete for A1 and A2 alike (source of truth 24 Oct; 26 for the our-lead price list). No manual generate. |
| **Regenerate electrical fixes quote** | KEEP (rename "Re-price fixes quote") | Decision 142 (+$100 spread across lines) and 14 (office checks the fixes quote). |
| **Quotes (all prices inc GST)** list | KEEP | |
| **Internal pricing (admin only)** table with Cost / AP margin / AP fee / Customer and its own **Adjust** editor | REMOVE the table, keep one Adjust | A second Adjust next to the draft panel's Adjust; margins already live on the Profit card. |
| **Installer intake** review panel (Who organises · owner eligibility (office) · quote inc GST · price basis · fee declaration · electrician payer · "Prepare owner quote (draft)") | REMOVE | The retired 4-step intake (34, 185) and its "who organises / fee declaration / installer price basis" guards; the Ready Check basics now come from Mitti and show on Quotes to check as "Not drafted yet" (33). |
| **Owner quote from the installer's Ready Check** (`InstallerQuoteDraftPanel`: held reasons, lines, totals, **Send quote**, **Adjust** with reason, Sent/Accepted line) | KEEP — this is the office Send | 24 Oct "office presses Send"; 62 (held reasons); Adjust leaves the draft for office Send (AGENTS). |
| **Co-branded owner invoice (preview)** with AP fee override ("Xero invoice is still raised by hand") | UNSURE | Decision 176: the portal creates the owner's invoice at acceptance; 209 fixes its lines. The "raised by hand" sentence is stale. Question for Jo: does the per-job AP fee override stay (owner-only), or is the fee always the setting? |
| **Xero invoice & payments**: invoice, total, "PIESA payment $349" paid/not, "after the PIESA payment: 10% to book · balance on install day", paid to date, remaining, final due date, View/pay link, lock line, refunds text, Xero ids, **Sync with Xero**, **Record payment** steps block (step · amount · how · state; provisional hold until; bank details not configured warning; Stripe availability; Xero online invoice (office view); append-only ledger) | KEEP the steps block and Record payment | Decisions 139–141, 144; 14a; 152. |
| "Deposit request must be raised in Xero (Invoice → Request deposit), then mark it raised here" + **Mark deposit request raised** ("Native Xero 50% deposit request") | REMOVE | Retired 50% deposit gate (source of truth "Payment gate"; `payment.retired`). |
| "Refunds: check never happens → refund everything…" text | UNSURE | 7 Oct rule, "superseded 24 Oct; kept for history". Question for Jo: is the refund rule unchanged under the new payments? |
| **Override PIESA payment block** (reason, audited) | KEEP as exception | Office-only guarded action. |
| **3-instalment plan** card (`Propose 3-instalment plan`, verify first instalment in Xero, record collection) | REMOVE | `payment.retired` lists "3-instalment plan" and "10%/5% minimum deposit"; decisions 13/139/144 define the only payment steps. |
| **Electronic signing** 1. Customer Agreement / Quote Acceptance (signed record) | KEEP | 127; 171 (the agreement is the AP–consumer contract). |
| 2. **ESC owner consent** (status, blockers, Section 3 Part A details prefilled, Part B declaration tick, **Sign as accredited person representative**, delivery) | KEEP — and surface it | Decisions 123, 128, 170. This is an office signature with a 24-hour deadline, four fold-outs deep and with no Needs me row. |
| 3. **Installer declaration (Mitti PIISA before work)** | REMOVE the section | Decision 118a: the separate installer declaration is dropped; the PIISA shows under Installation. |
| 4. **Official ESC VEEC assignment form v1.1** (blockers → Compliance Setup; Prepare the form; AP prerequisites list; signing order list; Section 3 Part A declaration + **Sign**; Recheck final facts; Raise variation) | KEEP — and surface it | Decisions 119, 120, 143. Also an office signature with no Needs me row. |
| Documents (Quotes, Payments, Customer / Consent) | KEEP | |

**Fold-out "PIESA"**

| Element | Verdict | Why |
|---|---|---|
| **Electrician allocation and visit contacts**: **Offer PIESA to approved electricians** (batch) · **Offer with rate to be confirmed** · Show matching electricians · **Share installation contacts** · draft fixes quote **Mark reviewed** → **Send to owner for approval** | SPLIT | Batch offer and "share contacts" are retired (157: office sends to the usual REC or one approved REC; AGENTS: trades get contact on acceptance via `contact_releases`). Keep: the fixes quote review/send (decision 14) and "rate to be confirmed" as the recorded exception. |
| **PIESA 30-day installation window** section | REMOVE | The same date appears in the header pill, in the Electrical/PIESA card and here — three places. One place: the header pill plus the Install card. |
| **PIESA records (entered once by the electrician)** | KEEP | Step 19 Mitti syncs PIESA. |
| **Electrical fixes items** with "needs office pricing" + `PriceItemForm` | KEEP | Source of truth step 21 (non-standard items held for office). |
| **Rectification booking** with an office booking form (datetime, Confirm date) | REMOVE the form | Decision 14: the owner approves, pays and picks one of the electrician's times in one step; "The office is not involved". Keep the fact line. |
| Documents (Electrical / PIESA) | KEEP | |

**Fold-out "Installation"**

| Element | Verdict | Why |
|---|---|---|
| **Pre-install compliance (ESC notice · consent · PIESA copies)**: READY / NOT READY TO INSTALL banner with blockers, ESC notification v, payload JSON + Copy, **Record manual submission**, **Signed PIESA copy delivered** (Record delivered to owner/installer now) | MERGE | Second ESC-notice panel (see Contacts). The PIESA copy is now emailed automatically ≥24h before install (111, 131) — keep the delivered facts, drop the "record delivered now" buttons unless the email failed. |
| **Installer safety assessment (PIISA)**: AP, responsible, next action, hazards (Part 7), Ready Check items the installer hasn't supplied, **Official Word forms** download, create/send PIISA form | KEEP, trim | Decision 114: the PIISA audit is auto-created the day before install; keep status + official form download; the manual create is the fallback. |
| **Installation booking** with an office booking form (datetime, Confirm date / Reschedule) | REMOVE the form | Decisions 1, 19, 43: installer offers 3 days with arrival times, owner taps one, Change day on both sides; "the office is never involved". Keep the fact line "Install booked {day} {time} · must start by {date} · N days left" and the deposit hold state (14a). |
| **Evidence** (installation gate) with per-row upload for admins | UNSURE | Decisions 205/206/213: evidence is captured in the Mitti install form; the portal blocks Ready for VEEC until present. Question for Jo (same as installer audit Q3): read-only checklist of what Mitti holds, or can the office still upload a missing photo? |
| Documents (Installation) | KEEP | |
| **MISSING:** the office fallback **Complete installation** button (decision 213 "the office button stays as the fallback") is not visible in this fold-out. | — | Verify where it renders; if nowhere, add it to the Install card. |

**Fold-out "Final check & VEECs"**

| Element | Verdict | Why |
|---|---|---|
| Evidence (other gates) + "Open installation evidence" button | KEEP (one evidence list) | |
| **Activity 48 records** (life support plan · pre-install documents · safety assessment · completion documents · **$200 co-payment** · assignment copy; permanent once saved) | KEEP | Decision 197 ($200 co-payment item confirmed current). |
| **Gate 6 · AP compliance review** (pass/fail/pending per check, Run automated checks, **Approve in AP queue**) | KEEP, rename "Final check" | Steps 28–29. |
| **VEEC lodgement** (quantity, status, ESC ref, date, notes, query reply with AI draft, Mark reply sent) | KEEP | |
| **Profit (office only)** (expected vs actual: AP fee, VEEC spread, PIESA markup, installer markup; **Current VEEC price** + **Actual sale price** inputs) | KEEP the table; move the price inputs | VEEC spot price is also entered on the VEECs page and "Current VEEC sale price" on Prices — three places to set one number. |
| Documents (ESC / VEEC) | KEEP | |

**Fold-out "Correspondence & history"**

| Element | Verdict | Why |
|---|---|---|
| **Owner eligibility questions** (create / copy a question link for installer jobs) | REMOVE | Decision 36 removed the owner eligibility questions link from the installer side; on the office side it was the old intake's eligibility check. The Ready Check decides. |
| **Staff job links** (per-worker 30-day links) | UNSURE | Decision 161: the business owner allocates staff and the portal re-assigns the Mitti form and texts them. Same question as installer audit Q7: still needed? |
| **Messages** (portal thread) | KEEP | Messages stays on the installer job page (36). |
| **Owner conversation** (Outlook-matched email) + **Log a call, email or note** | KEEP | Outlook record-only rule. |
| **What's happened** (`ClearTimeline`) · Visit changes and no-shows · fold-out "Detailed and raw audit history" (JobTimeline + TimelinePanel) | KEEP one timeline | Three history lists; keep the plain one with the raw one behind "More". |
| **MISSING (decision 216): one Contact history panel** — every email, text and call, newest first: date · channel · what it was (approved template name) · the content · delivered / failed · "what we're waiting for". | — | Today the facts are split across four panels (Owner conversation = Outlook; Messages = portal thread; Daily Mitti links texts = trade texts; "Last email or text sent" one-liner in CompactJobStatus) and three timelines. The data already exists: `customer_email_sends` (portal emails, provider status), `job_communications` (recorded sends, calls and notes, direction + provider), `sms_messages` (texts, type, status), `messages` (portal thread), `outlook_message_work` (matched Outlook mail). One read that unions these five is the panel; nothing new needs storing. |
| **All documents** + **Export complete job pack** | KEEP | 6-year record. |

**Not rendered but still in the file:** `NextActionBand`, `EligibilityGlance`, `PhaseStrip` (job-workspace), `JobRightNow` + `StageTracker` (office.tsx), `OfficeReadyCheckReopen`, `ManualCommunicationActions`, `EngagementPanel` (only inside the estimate card). Dead or near-dead code the next builder will trip over.

### Screen 9 · Communications (`/admin/communications`)

| Tab | Verdict | Why |
|---|---|---|
| **Overview**: enquiry response counts (five tiles) + recent send log | KEEP, shorten | Source of truth "Communications" tracking; the counts duplicate the Enquiries scope line — show them once. |
| **Outgoing**: the first-reply batch sender ("at most 10 real customer emails… only when you confirm") | KEEP for now, reshape | Decision 180: the automatic Save my spot email is ON with customer comms. After go-live this tab becomes **Held & queued** with **Cancel all** (decision 16) and per-type switches (159). |
| **Sent & history**, **Failed / attention** (Retry ineligible email) | KEEP | Failed → Needs attention rule. |
| **Campaigns**: Spots saved list, Desktop insulation checks, "Campaign sending is off", "Campaign wording in Templates" | REMOVE | Decision 180: "the office batch campaign part is superseded by the one-off 3-questions reminder"; Spot saved is an Enquiries pile (Jo 22 Oct). |
| **Outlook & review**: connect, shared mailbox, catch-up, review list | KEEP | Outlook copier rule (record-only). |
| Old `?key=` draft editor → redirects to Templates | KEEP the redirect | Legacy email editors retired (AGENTS). |

### Screen 10 · Templates (`/admin/templates`)

| Element | Verdict | Why |
|---|---|---|
| Email · Mitti · Compliance categories; standing filters Current approved / Drafts & unrecorded / Reference & versioned / Historical; previews in an iframe; Versions → Compliance Setup; Documents → Owner paperwork | KEEP | Decision 15 wants "one review page, a card per email or text (phone preview, who, when, auto or pressed), one at a time". This is close; the card needs "who · when · auto or pressed" per message (decision 60's touchpoint list). |
| Links out to two other registers (Compliance Setup, Owner paperwork) | MERGE | One wording register, three screens today. |
| Retired entries to delete from the register: "Ready Check booking confirmation" text type, old REC/installer copy-and-paste invitation templates | REMOVE | Decision 171. |

### Screen 11 · Compliance Setup (`/admin/compliance`)

| Element | Verdict | Why |
|---|---|---|
| "Activity 48 control centre / **COMPLIANCE**" (caps heading) | FIX wording | Style A: no shouting headings. |
| Intro: "four separate events in order: quote acceptance → ESC owner consent once the installation date is booked → **installer declaration after installation** → final VEEC assignment signed installer → AP → customer during Final check" | FIX | Decision 118a dropped the separate installer declaration; 97/123: consent is signed when the owner books the install day; 119: the VEEC order is installer Part B → AP Part A → owner, after install. |
| Activity 48 form register cards (name, purpose, signer, when, blocks, source, retention) | KEEP | 124 FAQ facts; useful reference. |
| **Mitti forms** section (connect template IDs after validation) | KEEP | Mitti forms rule; decisions 117, 150. |
| Readiness cards (Ready / Not ready) | KEEP | |
| Template versions per key, incl. `installer_declaration` | KEEP, hide the retired key | 118a. |
| Add a version (official wording + form fields) | KEEP (Jo only) | |
| **ESC notification fields** (`EscConfigSection`) | KEEP, update | Decision 197: replace `DEFAULT_REGISTRY_FIELDS` with the Appendix A Table 5 list. |

### Screen 12 · Owner paperwork (`/admin/owner-paperwork`)

| Element | Verdict | Why |
|---|---|---|
| Table: gate · document · version · status · approved by · Approve (type APPROVE) · Edit wording | MERGE into Compliance Setup / Templates | Same documents, third screen. |
| **"Owner signs again after install"** switch ("Off (normal): the owner's signature at quote acceptance is used on the official form") | REMOVE | This is decision 100/108 (sign at acceptance), replaced by 119: the owner **always** signs the VEEC form after install via the secure link. The "normal" setting describes a retired rule. |
| "DRAFT wording works on TEST jobs only; real jobs are blocked until it's approved" | KEEP the rule | |

### Screen 13 · Partner applications (`/admin/partners`)

| Element | Verdict | Why |
|---|---|---|
| Queues: Pending approval · Website enquiries · Approved applications · Declined/closed · Started, not finished · Test applications; Installer / REC tabs; cards with review flags | KEEP | One review queue rule; 136 (application received email). |
| Detail: fields, review flags, office email box, **Approve partner** (checklist, create login, welcome), profile card, signed agreement, status buttons (new / contacted / onboarding / declined / closed), internal notes | KEEP | 107 welcome email; 171 (agreement = AP contract). |
| Heading "Partner Enquiries… never appear in the Pipeline" | FIX wording | "Applications"; the Pipeline is gone. |
| Installer card lines "Free quotes for Home Insulation Victoria leads", "Free Ready Checks for qualified quote leads", "Indicative R5 rate" | KEEP (29: free Ready Check on our leads is in the agreement) | |
| **MISSING:** after approval, the Mitti invite (22/188: "build behind a switch, office confirm per person") and the ESC privacy notice send (130) are not offered here. | — | Today they live on Users ("Check all trades in Mitti") and the business file. |

### Screen 14 · Approved partners (`/admin/businesses`)

| Element | Verdict | Why |
|---|---|---|
| List with Show inactive, Check expiries, create business (name + type) | KEEP | 193: PL insurance re-checked yearly. |
| Business file: approval, onboarding checklist, business details, insurance/licences, **Team**, **Preferred electricians**, bank, participation agreement, measurement method, AP measurement standard, rate cards + higher-R rates, Xero supplier setup, **ESC privacy collection notice** | KEEP; rename "Preferred electricians" → "Usual electrician" | 157/173 (usual electrician matched to an onboarded REC); 130 (who has acknowledged the notice). |
| Team rows | KEEP; add CII level/expiry and "cleared for crews" | Decision 153 (`officeVerifyEec` records level + expiry; clearance derived). |

### Screens 15–19 · Staff approvals, Partners overview, Coverage, Team-ups, Electrician rates

| Screen | Verdict | Why |
|---|---|---|
| **Staff approvals** (waiting / all staff, approve, reject, copy set-password link) | KEEP, fold into Partners › People | Decision 153: approval = CII verified with level + expiry recorded; 160 (Manminder's CII). The page should ask for the CII number, level and expiry when approving, not just "Approve". |
| **Partners overview** (live jobs, on time %, reply time) | REMOVE | No decision uses these numbers; "No rate" status is covered by Electrician rates. |
| **Service coverage** (network at a glance, regions, team directory, active enquiry check, Manage partner coverage) | UNSURE | Useful when picking an installer, but Choose installer already shows distance and area. Question for Jo: keep as a reference tab under Partners, or drop it? |
| **Electrician team-ups** | REMOVE | Decision 157/173 and 171 (old invitation templates removed). |
| **Electrician rates** (versioned rate card, "rate card is not switched on yet… pending database change", office spread) | KEEP; fix the banner | Decision 157: the onboarding rate is the PIESA rate. The "not switched on yet" banner must reflect the real state after the pending migration. |

### Screens 20–22 · Prices & margins, Money / Payouts, VEECs

| Element | Verdict | Why |
|---|---|---|
| **Prices & margins**: owner prices by version (R5/R6/R7), reason for change (owner only), **Current VEEC sale price**, price history, margins at current prices | KEEP | Decision 26 (our fixed price list). |
| **Money**: tiles Our margin this month · VEECs lodged · Owners owe us (Xero) · We owe trades; **Payouts** table with **Mark paid** (bank reference) | KEEP | Decisions 30, 109 ("installer-supplied jobs also need the owner paid in full" matches 109). |
| **VEECs**: "Admin only" page, spot price (Update from online / enter by hand / history), VEEC value of confirmed and pending jobs, markup by job table, "Bought @ $70" | KEEP, merge the price entry | Three places set the VEEC price (here, Prices, the job Profit card). One place: VEECs. "Pending quote acceptance – VEEC value" is a forecast tile that can disagree with Quotes to check counts — UNSURE whether Jo wants it. |

### Screens 23–28 · Users & access, Automatic sending rules, 3 questions reminder, Registered interest, Deleted jobs, Test Centre

| Element | Verdict | Why |
|---|---|---|
| **Users & access**: "USERS & ACCESS" caps heading, roles, **Save private login file** (Deep's TEST handover, exact QA preflight), "Check all trades in Mitti" | KEEP; fix heading; label the handover | AGENTS (TEST handover = private download); 22/188. "Save private login file" does not say what it is for — "Prepare {name}'s TEST login (private file)". |
| **Automatic sending rules**: automatic selection ON/OFF, filters, rules that always apply, preview | KEEP | Decision 180 (auto Save my spot ON with customer comms). |
| Same page: **Owner Ready Check booking: on/off (all owners)** switch | REMOVE | Decision 53 (owners don't pick Ready Check times). |
| **3 questions reminder (one-off)**: sample messages, skipped records, send results | KEEP until run, then remove | Decisions 172, 180 (skips "no insulation" and "spot already saved"). |
| **Registered interest** (calculator register-interest list; new / contacted / booked / closed) | UNSURE | Question for Jo: are calculator "register interest" entries still coming in, and if so should they simply be enquiries (one Leads screen)? |
| **Deleted jobs** (restore with reason) | KEEP under Settings | |
| **Test Centre**: Create dummy journey, TEST roles (open as owner / installer boss / electrician / worker; simulate 24h/48h/PIESA expired/payment), **Jo as a fake tradie** steps 1a–4, **Xero connection and routes** card, test trade accounts, onboarding staff links, sign-up limits, upload cleanup | KEEP; move the Xero card to Settings › Xero | Test Centre rule (qa_test); 177, 189 (TEST run). Decisions 176–182 make the Xero organisation a live setting, not a test tool. |

---

## Part 3 — Clutter and clarity findings (across screens)

**Same fact shown twice or more**
1. "Where is this job / what's next": InstallerJobSummary + CompactJobStatus "Current action" + CurrentJobBlockers "What happens next" + JobIdentity warning pills, each from a different read. Four answers that can disagree.
2. Gate 1 eligibility form in three places on one page (Change classification, Update job, Eligibility fold-out).
3. ESC install notification: two full panels with two "Record submission" forms (Contacts fold-out and Installation fold-out).
4. PIESA 30-day window: header pill, Electrical/PIESA card, "PIESA 30-day installation window" section, Install booking line.
5. Quote Adjust: Internal pricing table and the draft panel.
6. VEEC price entry: VEECs page, Prices page, job Profit card.
7. Quotes to check: Enquiries, Active jobs, Today's brief (three piles for one quote).
8. New from installers: Active jobs and Today's brief.
9. Needs me content: Needs me and Today's brief ("What needs you").
10. Photo rank buttons: Enquiries list and the job's Contact and photos card.
11. Enquiry response counts: Enquiries scope line and Communications Overview.
12. History: What's happened, Timeline / audit, History panel, Visit changes — four lists.
13. Status labels: `STATUS_LABEL` ("Email sent – offering spot") vs `OFFICE_ENQUIRY_LABEL` ("Spot offered") for the same enquiry status; `nextStep` stage tags vs `officeStatus` labels vs operations `processWords` for the same job.

**Actions that don't match the process**
- Office booking forms for Ready Check, fixes and installation (decisions 1, 14, 19, 52, 54).
- "Arrange the visit" propose/accept/decline (52, 61, 80).
- "Offer PIESA to approved electricians" batch, "Send to all", "Offer to partner (3 days)", dispatch mode Automatic (49, 51, 157).
- "Generate installer quotes", "Prepare owner quote (draft)" from the intake panel (24 Oct: prepared on Complete).
- "Mark deposit request raised (native Xero 50%)", "Propose 3-instalment plan" (`payment.retired`).
- "Offer Ready Check booking", the global owner booking switch (53).
- "Owner signs again after install" switch (119 made it always).
- "Share installation contacts" (contacts released on acceptance).
- Opening the board runs `sweepAuthorities` + `autoAdvancePipeline`.

**Dead or misleading buttons / links**
- Needs me grouped rows → `/admin/enquiry-groups` and `/admin/hot-leads` (redirects to the wrong tab).
- Today's brief "See all saved spots" → `/admin/launch-campaign` (redirect).
- Enquiries header "Quote approvals"; More › "Quote approvals"; job page "Approve in AP queue" says "AP queue" while the menu says "Final check".
- Invoice route option "Installer invoices the owner — not yet supported".
- Electrician rates banner "The rate card is not switched on yet" (depends on a pending migration; must not stay once applied).
- Co-branded invoice "the Xero invoice is still raised by hand" (176: created at acceptance).
- Old sidebar nav (never rendered for admins).

**Wording that is not Jo's**
- Caps headings "COMPLIANCE", "USERS & ACCESS", "ENQUIRIES / ACTIVE JOBS / PENDING QUOTE APPROVAL".
- "Gate 1", "Gate 6", "Step 3 · Indicative estimate", "Partner & relationship", "Acquisition channel", "Customer relationship owner", "Commercial setup required", "measure-up" (retired name), "AP approval queue" vs "Final check", "Pipeline".
- Status words that describe retired steps: "Owner picking times", "Offered to installers / Offer to more installers", "Book Ready Check", "Agreeing install date / Remind installer", "PIESA passed / Book install within 30 days" (the installer offers days, 186), "Photos missing / Installer to upload photos and PIISA" (photos are in the Mitti install form, 205/213), "Photos asked for / Remind owner" (68), "Waiting – Ready Checks not open yet" (53).
- Compliance intro naming the installer declaration as a separate event (118a).
- "Expected install week", "planning note".
- Estimate card's GHG formula and settings versions on an operational screen.

**Counts that can disagree**
- Active jobs tiles (In progress / Review required / Payment overdue / Safety attention) vs the stage chips vs "N matching".
- Enquiries "Open enquiries" tile vs the sum of the other tiles (same number, two presentations); Needs me badge total vs Today's brief groups; VEECs "pending quote acceptance" value vs Quotes to check.
- Board lane counts ("counts describe the rows this page has loaded") vs server-paged Active jobs.

**One pile per job (0218)**
- Enquiries piles are mutually exclusive by construction (good). Breaches: Quotes to check and New from installers on three screens; Today's brief re-listing Needs me jobs under different headings; the board listing the same jobs by lane and by work view.

---

## Part 4 — Gaps (what the process needs the office to do that has no screen, or is buried)

| Office job in the process | Decision | Today | Gap |
|---|---|---|---|
| **Choose installer** for each our-lead Ready Check; pick another when it lapses | 49–51 | Job page › Ready Check fold-out (4th panel); Needs me row exists | Not on Enquiries (the Spot saved pile says "Book Ready Check"); no "Spot saved → choose installer" button on the row. |
| **Choose electrician** for the PIESA (usual REC pre-marked, else any approved REC) | 157, 173 | Job page › Ready Check › "Choose trades" (wrong section) + a second batch panel under PIESA | Two panels; wrong place; no Needs me row until the dispatch classifier says "choose". |
| **Send quote** (check held reasons, Adjust, Send) | 24 Oct, 62, 159 | Quotes to check (three screens) + job page | Works; needs one home and a Needs me row for held/declined. |
| **Check the electrical fixes quote** before it goes | 14, 142 | Job page › PIESA › allocation panel (Mark reviewed → Send) | Buried; no Needs me row. |
| **Sign the ESC owner consent** as AP representative (Part A details + Part B declaration) within 24h of the install being booked | 123, 128 | Job page › Quotes & payments › Electronic signing › 2 | Five levels deep; no Needs me row; no due time shown. |
| **Record the four VEEC prerequisites** (PIESA copies ≥24h, ESC notice ≥24h, warranty copy, collection notice) and **sign VEEC Section 3 Part A** | 119, 121 | Same panel, section 4 | Same; the day-10 unsigned alert is written as an event but never read by Needs me. |
| **ESC install notification** in the 24h–5 day window (prepare, submit in the Registry, record; withdraw/resubmit on a date change) | 118b, 121, 155, 195 | Two panels; "At risk this week" on Today's brief | Needs one panel and a Needs me row "ESC notice window open · due {time}". |
| **Final check** → Ready for VEEC; **VEEC lodgement** | 28–29, 213 | AP queue (More) + job page | Not in the main navigation. |
| **Record a bank-transfer payment** ($349 if paid by bank, 10% deposit, balance) | 139, 140, 152 | Job page › Quotes & payments › Xero invoice › Payment steps › Record payment | Six clicks; the deposit's 48-hour hold (14a) is only visible there. |
| **Mark payouts paid** | 30, 109 | Money › Payouts | Fine. |
| **Approve applications**, send welcome + guide, **Mitti invite per person**, **ESC privacy notice** per person, **verify CII** with level/expiry | 107, 21, 22/188, 130, 153 | Four screens (Applications, Approved partners, Staff approvals, Users) | Needs one Partners › People flow: approve → CII → notice → Mitti. |
| **Deep's TEST handover** (private login file, exact preflight) and the **TEST run** (Jo's phone run-through, TEST REC, Demo Company) | 159, 177, 189, AGENTS | Users page ("Save private login file"), Test Centre, Xero card in Test Centre | Scattered; nothing says "this is the handover". |
| **Xero: connect the new organisation; TEST → Demo Company** | 176, 179, 181, 182 | Xero card inside Test Centre | No Settings › Xero page although decision 179 names one. |
| **Message switches** (customer comms, per-type SMS switches, `AUTO_QUOTE_SEND_ENABLED`) and **Cancel all held/queued** when messages switch on | 159, 16, 154 | Board header pill (read-only), CompactJobStatus fold-out "Automatic sending settings", code flags | No office screen to see or flip the switches, or to cancel the held backlog. |
| **New enquiry by phone** | — | Only on the retired board | Needs a button on Enquiries. |
| **Office bulk import** of a new installer's job list | installer audit decision 42 | `/partner/bulk-import` (partner route, installer-locked) | No office entry point. |
| **Install-day no access** (first: owner told, installer re-offers; second: office alert) | 214, 215 | Not built | Needs me row + job history. |
| **30-day window lapsed** payer record | 158 | Job history only | A Needs me row when it lapses (someone has to re-book a PIESA). |
| **Office fallback "Complete installation"** | 213 | Not found on the job page | Verify / add to the Install card. |
| **Template review**: one page, a card per email or text with who / when / auto or pressed | 15, 60 | Templates hub (previews, no who/when/auto per card) | Partly built. |
| **Owner "Couldn't reach / wrong email" re-contact**, Not-in-your-area email | 74 | Coverage card button in the Contacts fold-out | Should sit with the enquiry. |
| **Fix lead details** (one-word / junk names, case problems, one-line addresses with blank suburb) | 216 | Nothing; "Email looked wrong" pill only | Needs: full name required at Save my spot (P1/owner pages), automatic capitalisation tidy on every source, address normalisation into street / suburb / postcode on every source (website, phone, installer Add a job, office import), and a **Fix details** pile on Leads with an inline fix. |
| **See when we last contacted a lead** (72 never contacted) | 216 | Totals only in the Enquiries scope line and Communications Overview | A **Last heard from us** column (date · what) and a "Never contacted" filter on Leads. |
| **See the whole contact history of a job** (every email, text, call; what we're waiting for) | 216 | Four panels + three timelines on the job page | One **Contact history** panel reading `customer_email_sends`, `job_communications`, `sms_messages`, `messages`, `outlook_message_work`; the "what we're waiting for" line comes from the job's one status (`officeStatus`). |
| **One-off review of the 1,325 estimate-only leads** | 216 | No list | A Settings one-off (like the 3 questions reminder) or a Leads filter: keep · fix details · not eligible – close · remove, in batches, recorded per lead. |

---

## Part 5 — Proposed simplified office structure

**Rule for every screen:** one purpose, one list, one action per row; every job in exactly one pile; wording from the decisions log; nothing from a retired rule.

**Top bar (five):** Needs me · Enquiries · Jobs · Partners · Money. **More:** Communications · Templates · Settings · Test Centre · Sign out.

### 1. Needs me — the home. "What needs the office today."
One row per job, most urgent first, grouped by the office's real actions, each with ONE button:
- **Choose installer** (saved spots waiting; offers declined / lapsed) → opens the job at Choose installer.
- **Quotes to check** (held, with reasons · declined by the owner · not drafted yet behind a fold) → Check & send.
- **Choose electrician** (quote accepted and $349 paid; usual REC pre-marked) → Send offer.
- **Fixes quote to check** → Review and send.
- **Sign** (ESC consent waiting for AP · VEEC Part A waiting, with the four prerequisites) → Sign.
- **ESC notice** (window open · due in 48h · date moved, withdraw/resubmit) → Open Registry block.
- **Final check** (clean · flagged) → Approve.
- **Money** (payment not received on a held install day · balance overdue · payouts due) → Record / Mark paid.
- **Watch** (10 days left on the 30-day clock · install no-access second time · VEEC unsigned day 10 · window lapsed) → Open job.
- **Partners & system** (applications · CII to verify · privacy notice outstanding · Mitti forms to link · Mitti sync problems · failed texts/emails).
Later = tomorrow 7am stays. Include TEST jobs stays. No dispatch switch, no "Send to all", no numbers strip unless Jo wants one (Part 2 Q).

### 2. Enquiries (Leads) — "Every website enquiry, one outcome, clean details."
Piles: **Office review** · **Fix details** (one-word / junk names, case problems, addresses that didn't split — decision 216) · New (never contacted) · Spot offered · Spot saved (waiting for an installer) · Asked the 3 questions · Not eligible. Search, remove, **New enquiry (phone)**, and a one-off **Review estimate-only leads** mode (216) that walks the 1,325 in batches: keep · fix details · not eligible – close · remove. Row: owner (tidied capitalisation) · street · suburb · postcode · insulation/area · age · **Last heard from us** (date · what, or "Never") · one status word · one action (photo rank buttons on Office review; inline fix on Fix details; **Choose installer** on Spot saved; Not-in-your-area email when coverage proves unavailable). Nothing about quotes here. Full name is required at Save my spot so new leads stop arriving one-worded.

### 3. Jobs — one list, Active and Closed tabs.
Active: filter by the six stages (Ready Check · Quote · PIESA · Install · Final check, plus "Installers' own jobs" per decision 31), search, sort; blocks above the list: **New from installers**, **Ready Checks started in Mitti**, **Mitti sync problems** (also mirrored in Needs me). Row: address · job no · owner · "Your customer / Our lead" · one status pill · waiting on · time left · life support. Bulk Put on hold / Cancel / Mark as test / Delete (test only) with reason. Closed: Completed · Cancelled · Ineligible · Removed/test.

### 4. Job page — "Next, then the six stages, then the file."
- **Header**: job no, address as street · suburb · postcode (216), owner (tidied) + Call/Text/Email, consent, label (own job / our lead), TEST, life support, **Last heard from us** (216), the one or two warning pills (install by · ESC notice due).
- **Next** (one panel): whose move it is, one sentence, one button (Choose installer / Check & send / Choose electrician / Sign consent / Submit ESC notice / Sign VEEC Part A / Approve / Record payment), plus "Blocked because …" when blocked. Hold / Resume / Cancel / Delete behind **More**.
- **Enquiry** card: estimate (figure, rebate, link status), the six eligibility checks (owner said / result / onsite) with the one change-result form, insulation answers, photos.
- **Ready Check** card: Choose installer (our leads) or "Installer arranges directly" (own jobs, decision 54); booked day + time (fact); Mitti form (open · copy link · sync · what's missing); measured facts.
- **Quote** card: the draft/sent/accepted quote (lines, total), held reasons, Send · Adjust; acceptance record (agreement, $349 paid).
- **PIESA** card: Choose electrician (usual REC marked); booked time (fact); PIESA record and hazards; electrical fixes items (price the held ones); fixes quote → Review and send; rate-to-confirm exception.
- **Install** card: clearance date → install must start by {date} · N days left; install days state (offered / owner's days / booked with time / deposit held until / Change day history); ESC owner consent (status, AP sign); ESC install notification (one panel: window, Registry block, record, withdraw/resubmit); PIISA status + official form; Mitti install form link; evidence checklist (read-only unless Jo says otherwise); office fallback Complete installation.
- **Final check** card: Activity 48 records; the compliance checks + Approve; VEEC form (prerequisites, Part A sign, owner status, copy sent); VEEC lodgement; Profit (office only).
- **Money** card: the one invoice, payment steps (what · how · state · due), Record payment, Xero sync, online invoice (office view), override with reason, payout for the trade.
- **Contact history** (216): one list, newest first — date · email / text / call / portal message · what it was (template name) · content · delivered / failed · "what we're waiting for" (from the job's one status). Built from `customer_email_sends`, `job_communications`, `sms_messages`, `messages` and `outlook_message_work`; "Log a call or note" lives here. Replaces Owner conversation, Messages, Daily Mitti links texts and the "last email sent" line as separate panels.
- **File**: one timeline (raw audit behind More) · visit changes · all documents · export pack · retain until.

### 5. Partners — "Who we work with."
Tabs: **Applications** (today's queues) · **Approved** (business file with Team incl. CII level/expiry and cleared-for-crews, Usual electrician, rates, insurance expiry, agreement, ESC notice status, Xero supplier) · **People** (staff approvals = CII verification; privacy notice outstanding; Mitti invite per person) · **Rates** (installer price list and electrician rate card) · Coverage (if kept).

### 6. Money — "What we earn and owe."
Tabs: **Overview** (margin this month, VEECs lodged, owners owe, we owe trades) · **Payouts** (Mark paid) · **Invoices** (owners owe: invoice, steps, overdue) · **VEECs** (spot price — the only place it is entered — lodgements, value) · **Prices** (owner price list, electrician rates link).

### 7. Communications (More) — "What went out, what failed, what is held."
Tabs: Held & queued (with Cancel all and the per-type switches once Jo flips them on) · Sent · Failed · Outlook.

### 8. Settings (More)
Templates (the one wording register, with Compliance Setup's versions and the owner documents folded in) · Mitti forms · ESC notification fields · Xero (connection, live organisation, Demo Company for TEST) · Switches (customer comms, auto quote send, message types) · Automatic sending rules (Save my spot) · Users & access (incl. "Prepare {name}'s TEST login") · Deleted jobs · 3 questions reminder (until run).

### 9. Test Centre (More) — unchanged in purpose; loses the Xero card.

**Gone from the office's world:** Pipeline board and Quote approvals, Today's brief, Partners overview, Team-ups, Owner paperwork as a separate screen, office visit-booking forms, Arrange the visit, dispatch mode and Send to all, batch PIESA offers, Offer to partner, installer intake review, Generate installer quotes, deposit request / 3-instalment plan, Offer Ready Check booking and its global switch, owner-signs-again switch, expected install week, owner eligibility question links, the second ESC panel, the internal pricing table, the dead sidebar.

### Mock-up order (one at a time, no annotation boxes — decision 198)
1. **Needs me** (sets the grouping and row shape everything else reuses)
2. **Job page** (the Next panel, the six stage cards and the Contact history panel)
3. **Jobs** (Active + Closed, the row)
4. **Enquiries / Leads** (piles incl. Fix details, row with Last heard from us and split address, photo review, Choose installer, New enquiry, the estimate-only review mode)
5. **Partners** (Applications · Approved file · People · Rates)
6. **Money** (Overview · Payouts · Invoices · VEECs · Prices)
7. **Communications + Settings** (Held & queued with Cancel all; Templates as the one register; Xero; Switches)

---

## Part 6 — Prioritised summary

### The 10 biggest removals (do these first)
1. **The Pipeline board and every "Quote approvals / Pending quote approval" link** (More, Enquiries header, Enquiries office-tools strip, `/admin/quotes`). Retired installer-approval model (decision 7); quotes are prepared on Mitti Complete and sent from Quotes to check. The board also silently runs `sweepAuthorities` + `autoAdvancePipeline` on open and shows retired lanes. Keep only its New enquiry dialog and bulk actions, moved.
2. **Office booking forms and the "Arrange the visit" proposals panel** (assessment, rectification, installation `BookingPanel` forms, `AppointmentPanel`, "Admin override" unless Jo keeps it). Visits are tap-to-book between owner and trade (1, 14, 19, 52, 54, 61, 80).
3. **"How job offers go out: Office picks first / Automatic" + "Send to all" on Needs me, "Offer PIESA to approved electricians" and "Offer to partner" on the job page.** The office picks one installer / one REC (49, 51, 157).
4. **Payment leftovers**: "Deposit request must be raised in Xero… Mark deposit request raised" (50%) and the **3-instalment plan** card (`payment.retired`; 13, 139–144).
5. **"Offer Ready Check booking" on the job page, the global "Owner Ready Check booking" switch in Settings, and the `spot_saved_waiting` status** (decision 53).
6. **The installer intake review panel, "Installer's job" facts card, InstallerFactsLine and "Owner eligibility questions"** — the retired 4-step intake and its guards (34, 185; decision 36 on the installer side).
7. **The "Owner signs again after install" switch and the Compliance intro naming the installer declaration** (119, 118a); the Owner paperwork screen merges into one register.
8. **Today's brief** and the **second copies of Quotes to check / New from installers** on Enquiries and Today (one pile per job, 0218). Fold "At risk this week" into Needs me.
9. **Expected install week, Partner & relationship, Invoice route select, Electrician team-ups, Partners overview** — planning and relationship panels no decision asks for (1, 157, 173).
10. **The dead code that still describes the old office**: the sidebar nav in `AppShell`, `JobRightNow`/`StageTracker`, `NextActionBand`/`EligibilityGlance`/`PhaseStrip`, `OfficeReadyCheckReopen`, `ManualCommunicationActions`, the second ESC panel (`EscInstallPanel` vs `OfficePrestartCard`), the Internal pricing Adjust, and the retired status words in `job-wording.ts` ("Owner picking times", "Book Ready Check", "Agreeing install date", "Installer to upload photos", "Photos asked for").

### The 8 biggest gaps
1. **Needs me is not in the navigation** and misses the office's real signatures and deadlines (ESC consent AP sign, VEEC Part A + prerequisites, day-10 VEEC alert, ESC notice window, fixes quote to check, declined quotes, second no-access, lapsed window). The 30-day alert fires at 5 days instead of 10 (decision 2).
2. **One "Next" panel per job** — today three status boxes from three reads, and the main daily actions (Choose installer, Send quote, Sign consent, Sign VEEC, Record payment) are three to five fold-outs deep.
3. **No Settings › Xero and no Settings › Switches** (176–182; 159; 16 cancel-all).
4. **Partners › People** flow: approve → CII level/expiry (153) → ESC privacy notice (130) → Mitti invite per person (22/188) is spread over four screens.
5. **New enquiry (phone)** and **office bulk import** of an installer's list have no entry point once the board goes.
6. **Install-day no access** (214/215) and the **office fallback Complete installation** (213) are not visible.
7. **Status wording** — the office statuses (`SITUATION`) still describe owner-picked times, office booking and portal photo uploads; they drive Enquiries "Next office action", Active jobs pills and Needs me rows, so one wording table fixes three screens.
8. **Leads data (decision 216)** — no Fix details pile, no Last heard from us, addresses in one line with a blank suburb, no contact history in one place, and no way to review the 1,325 estimate-only leads. The contact facts already exist in five tables (`customer_email_sends`, `job_communications`, `sms_messages`, `messages`, `outlook_message_work`); the name/address clean-up needs the capitalisation tidy and address split run on every source plus a required full name at Save my spot.

### Questions only Jo can answer (the UNSURE list)
1. Needs me: does the office still step in when a Ready Check or PIESA isn't agreed 48 hours after contact, or only when a 24-hour offer lapses?
2. A small numbers strip on Needs me (yesterday / this week), or none?
3. Ready Check: is "Accept Ready Check / Needs review / Reject" still a step, or is Check & send the acceptance?
4. Keep one hidden "set the Ready Check time (with reason)" for phone bookings?
5. Assigned trades by person (with the Mitti membership check): still needed next to business-level Choose installer / Choose electrician and the installer's own staff allocation (161)?
6. Install evidence: read-only checklist of what Mitti holds, or can the office upload a missing photo?
7. Per-job AP fee override on installer-led jobs: keep (owner only), or always the setting?
8. Refund wording under the new payment rule: unchanged from 7 Oct?
9. Staff job links (per-worker 30-day links): still wanted now that allocation re-assigns the Mitti form?
10. Paperwork strip A/B/C/D: replace with one "Signed: acceptance · install consent · rebate form" line?
11. Service coverage: keep as a Partners tab, or drop?
12. Registered interest: still arriving; should it simply be an enquiry?

---

## Appendix — where each screen lives (technical)

All paths under the repository root on `installer-mitti-workflow` at `1a525df6`.

**Frame / navigation**
- `src/lib/office-nav.ts` (`OFFICE_HEADINGS`, `OFFICE_TOOLS`, `MORE_SECTIONS`, `OFFICE_ENQUIRY_LABEL`, `sectionFor` — `/admin/needs-me` is in `ENQUIRY_PATHS` but in no menu)
- `src/components/portal/office.tsx` (`OfficeTopBar`, `OfficeSearch`, `AvatarMenu`; unused `JobRightNow`, `StageTracker`)
- `src/components/portal/AppShell.tsx` (admin branch returns the top bar; the sidebar `nav` block below it is the retired menu)
- Redirect-only routes: `admin.index.tsx`, `admin.jobs.tsx`, `admin.list.tsx`, `admin.pipeline.tsx`, `admin.quotes.tsx`, `admin.todo.tsx`, `admin.operations.tsx`, `admin.operations-preview.tsx`, `admin.hot-leads.tsx`, `admin.ready-check.tsx`, `admin.campaign-emails.tsx`, `admin.launch-campaign.tsx`, `admin.enquiry-groups.tsx` (all under `src/routes/_authenticated/`)

**Needs me / Today / Final check**
- `src/routes/_authenticated/admin.needs-me.tsx` (`Row`, `DispatchModeSwitch` import, "Send to all" via `sendOfferToAll`), `src/components/portal/dispatch-mode.tsx`
- Rules: `src/lib/needs-me.core.ts` (`buildNeedsMe`, `RULE_LABEL`, `movedFromTodo`, grouped waiting rows with `href: "/admin/enquiry-groups"` / `"/admin/hot-leads"`), `src/lib/office-status.core.ts` (`OFFICE_STAGES`, `OFFICE_STATUSES`, `DEFAULT_LIMITS.clock_warning_days = 5`, `officeStatus`), `src/lib/job-wording.ts` (`SITUATION` tags/next words), `src/lib/office.server.ts` (`getNeedsMe` inputs: failures, tradeChoice, offerChoice, reassignment, partner items; no VEEC day-10 / consent / ESC-window inputs)
- VEEC day-10 event: `src/lib/veec-reminders.server.ts` (`office_alert_10`), `src/lib/veec-assignment-form.core.ts` (`VEEC_OFFICE_ALERT_EVENT = "veec_assignment_unsigned_10_days"`)
- `src/routes/_authenticated/admin.today.tsx` (`getTodayBrief`, `getLaunchCampaignOffice`, `NeedGroup`, at-risk kinds), `src/lib/daily-brief.core.ts`
- `src/routes/_authenticated/admin.ap-queue.tsx` (`getApQueue`, `approveApJob`)

**Enquiries**
- `src/routes/_authenticated/admin.enquiries.tsx`, `src/components/portal/EnquiriesWorkspace.tsx` (`VIEW_ORDER`, `VIEW_LABEL`, `MediaReview`, header buttons, "Office tools" strip, `<QuotesToCheck />`), `src/components/portal/SpotPhotoCheck.tsx` (`PhotoRankButtons`)
- Rules: `src/lib/enquiry-groups.core.ts` (`STATUS_ORDER`, `STATUS_LABEL`, `enquiryStatus`, photo outcome), `src/lib/enquiry-response.core.ts` (`enquiryRowTag`, `RESPONSE_STATE_LABEL`), `src/lib/enquiry-groups.functions.ts`

**Active / Closed jobs**
- `src/routes/_authenticated/admin.jobs.active.tsx`, `admin.jobs.closed.tsx`, `src/components/portal/JobsWorkspace.tsx` (tiles, `MittiPickupsToLink`, `MittiSyncProblems`, `InstallerQuotesToCheck`, stage chips via `nextStep`), `src/components/portal/StaffJobRow.tsx`, `src/components/portal/job-facts-line.tsx`, `src/components/portal/installer-job-facts.tsx` (`InstallerFactsLine`, `OfficeInstallerFactsCard`), `src/components/portal/badges.tsx` (`SourceBadge`, `UrgencyBadge`)
- `src/components/portal/NewFromInstallers.tsx` (+ `src/lib/installer-new-jobs.core.ts`), `src/components/portal/QuotesToCheck.tsx` (+ `src/lib/installer-quote-review.functions.ts`, `src/lib/installer-quote-status.core.ts`), `src/lib/job-list-page.core.ts`, `src/lib/mitti-pickup.*`

**Pipeline board**
- `src/routes/_authenticated/admin.board.tsx` (`Pipeline`, `PipelineBoard`, `BoardCard`, `NewEnquiry`, bulk via `bulkJobAction`; on-mount `sweepAuthorities` + `autoAdvancePipeline`), `src/lib/workflow.ts` (`PIPELINE_PHASES` incl. "PIESA (earlier jobs)" and "Payment", `RETIRED_LEGACY_STAGES`), `src/lib/board-phase.core.ts`

**Job page**
- Route: `src/routes/_authenticated/admin.jobs.$jobId.tsx` (`JobDetail`, `Wrap`, `JobCoverage`, `EligibilityForm` ×3 mounts, `JobSource` + `MODEL_LABEL`, `Assignments`, `HoldControls`, `AssessmentView`, `AdminQuotes` with Internal pricing, `Compliance`, `Veec`, `VeecQueryReply`, `ComplianceRecords`)
- Header / status: `src/components/portal/job-workspace.tsx` (`JobIdentity`, `RecordDisclosure`, `SubHeading`, `usePortalTargetNavigation`; unused `NextActionBand`, `EligibilityGlance`, `PhaseStrip`), `src/components/portal/CompactJobStatus.tsx` (`CompactJobStatus`, `JobStatusSummary`, `CurrentJobBlockers`), `src/components/portal/InstallerJobSummary.tsx`, `src/components/portal/JobDeleteControls.tsx`, `src/components/portal/eligibility-card.tsx`, `src/components/portal/verified-eligibility.tsx`
- Contacts fold-out: `src/components/portal/install-hold.tsx` (`OfficeInstallHoldCard`), `src/components/portal/prestart.tsx` (`OfficePrestartCard` — ESC notice #1), `src/components/portal/trade-texts.tsx`, `src/components/portal/partner.tsx` (`AdminPartnerPanel`, `AppointmentPanel`, `AdminBookingOverride`, `ElectricianChoicePanel`), `src/components/portal/jobfile.tsx` (`RetentionCard`, `Correspondence`, `LogCommunication`, `JobTimeline`, `AllDocuments`, `ExportJobPack`, `SectionDocuments`)
- Enquiry fold-out: `src/components/portal/paperwork.tsx` (`PaperworkStrip`), `src/components/portal/estimate.tsx` (`AdminEstimateCard`, `AdminCustomerEmailPreview`, `EstimateLinkPanel`), `src/components/portal/engagement.tsx`, `src/components/portal/intake.tsx` (`IntakeSummary`)
- Ready Check fold-out: `src/components/portal/ready-check-booking-access.tsx` (`OfficeReadyCheckBooking`, `OwnerReadyCheckBookingSetting`), `src/components/portal/choose-installer.tsx`, `src/components/portal/choose-trade.tsx`, `src/components/portal/requirements.tsx` (`RequirementCards`, measurement Accept/Needs review/Reject), `src/components/portal/panels.tsx` (`BookingPanel`, `Section`, `BlockersPanel`, `EvidencePanel`, `MessagesPanel`, `TimelinePanel`, `QuotesPanel`, `PaymentsPanel`, `PaymentStepsBlock`), `src/components/portal/mitti.tsx` (`MittiCard`, `PriceItemForm`); unused `src/components/portal/ready-check-office.tsx`
- Quotes & payments fold-out: `src/components/portal/installer-quote.tsx` (`InstallerQuoteDraftPanel` = office Send; `InstallerIntakeReviewPanel` = retired intake), `src/components/portal/installer-invoice.tsx`, `src/components/portal/instalment-plan.tsx` (`OfficeInstalmentPlanCard`), `src/components/portal/assignment.tsx` (`AdminAssignmentPanel` sections 1–4, `ApPrerequisites`, `VeecPreparation`), `src/lib/payments.functions.ts` (`recordOwnerPayment`, `getJobPayments`)
- PIESA fold-out: `src/components/portal/allocation.tsx` (`OfficeAllocationPanel`), `src/components/portal/rectification-times.tsx` (`RectWindowsSummary`)
- Installation fold-out: `src/components/portal/intelligence.tsx` (`EscInstallPanel` — ESC notice #2; `EscConfigSection`), `src/components/portal/piisa-panel.tsx`
- Final check fold-out: `src/components/portal/job-profit.tsx`, `src/lib/compliance-timeline.core.ts` (`RECORD_LABELS`)
- History fold-out: `src/components/portal/owner-eligibility.tsx`, `src/components/portal/workers.tsx` (`WorkerLinksPanel`), `src/components/portal/waiting.tsx` (`ClearTimeline`; `WhoHasTheBall` unused), `src/components/portal/visit-changes.tsx` (`AdminVisitHistory`)
- Shared rules: `src/lib/nextstep.core.ts`, `src/lib/waiting.core.ts`, `src/lib/journey.core.ts`, `src/lib/portal-presentation.core.ts` (`targetForAction`, labels only), `src/lib/allocation.core.ts` (`parseJobSection`)

**Contact history sources (decision 216)**
- `customer_email_sends` (read in `src/lib/communications-centre.functions.ts`, `src/lib/jobfile.server.ts`), `job_communications` (`src/lib/portal-presentation.core.ts` `communicationOrigin`, `src/components/portal/jobfile.tsx` `LogCommunication`), `sms_messages` (`src/lib/sms.server.ts`, `src/lib/spot-saved-send.server.ts`), `messages` (`src/components/portal/panels.tsx` `MessagesPanel`, `src/lib/portal.functions.ts`), `outlook_message_work` (`src/lib/outlook-sync.server.ts`, `src/components/portal/OutlookReview.tsx`). Enquiry reply state today: `src/lib/enquiry-response.core.ts`; name/address fields: `owners`, `properties` via `src/lib/enquiry-groups.functions.ts`.

**Communications / Templates / Compliance / Owner paperwork**
- `src/routes/_authenticated/admin.communications.tsx` (tabs, `HistoryTable`, `Overview`, `IneligibleRetry`), `src/components/portal/EnquiryResponseOverview.tsx`, `src/components/portal/CampaignsPanel.tsx`, `src/components/portal/OutlookReview.tsx`
- `src/routes/_authenticated/admin.templates.tsx`, `src/components/portal/template-hub.tsx`, `src/lib/template-hub.core.ts`, `src/lib/template-catalog.ts` (`COMPLIANCE_TEMPLATE_KEYS`, `ACTIVITY_48_FORMS`)
- `src/routes/_authenticated/admin.compliance.tsx` (intro text, versions, Add a version, `MittiFormsSection`, `EscConfigSection`), `src/components/portal/mitti-forms.tsx`
- `src/routes/_authenticated/admin.owner-paperwork.tsx` (`ResignSwitch`), `src/lib/owner-gates.functions.ts`, `src/lib/owner-paperwork.core.ts`

**Partners**
- `src/routes/_authenticated/admin.partners.tsx` (queues, `Detail`, `ApprovePartner`, `SignedRecAgreement`, `OfficeEmailBox`), `src/components/portal/onboarding-drafts.tsx`, `src/components/portal/partner-profile-card.tsx`, `src/components/portal/rate-offer-panel.tsx`
- `src/routes/_authenticated/admin.businesses.tsx`, `src/components/portal/business.tsx` (`BusinessProfile` sections incl. "Preferred electricians", Team, ESC privacy collection notice, Xero supplier), `src/lib/worker-compliance.core.ts` (`crewClearance`, `officeVerifyEec`)
- `src/routes/_authenticated/admin.workers.tsx`, `admin.partners-overview.tsx`, `admin.coverage.tsx`, `admin.team-ups.tsx`, `admin.electrician-rates.tsx`

**Money**
- `src/routes/_authenticated/admin.money.tsx` (`getMoneyOverview`, `markPayoutPaid`), `admin.veec.tsx` (spot price, markup by job), `admin.pricing.tsx` (owner prices, Current VEEC sale price, margins)

**Settings / Test Centre**
- `src/routes/_authenticated/admin.users.tsx` ("Save private login file" → `src/lib/dad-test-login.*`, `src/lib/qa-access.server.ts` exact preflight; "Check all trades in Mitti" → `src/lib/mitti-membership.*`)
- `src/routes/_authenticated/admin.save-my-spot-rules.tsx` (+ `OwnerReadyCheckBookingSetting`), `admin.save-spot-reminder-blast.tsx`, `admin.interests.tsx`, `admin.deleted.tsx`
- `src/routes/_authenticated/admin.test-centre.tsx` (`CreateTestJob`, `QaRoleControls`, `TestTradeAccounts`, `OnboardingLinks`, `OnboardingLimits`, `XeroConnectionCard`), `src/components/portal/jo-tradie-panel.tsx`
- No Settings › Xero or Settings › Switches route exists; switches live in `workflow_settings` / env flags (`customer_comms_enabled`, `sms_message_switches`, `AUTO_QUOTE_SEND_ENABLED`) with no office screen.

**Look (not changed by this audit):** `src/styles.css` (`.portal-theme` tokens; `.installer-redesign` Style A tokens, decision 198), `src/components/portal/kit.tsx` (`PageHeader`, `Panel`, `Pill`, `NowPanel`, `StatTile`, `Segmented`, `ListTable`, `RecordRow`, `WithAside`) — the office mock-ups should reuse these pieces and the installer Style A tokens.

**Retired-term scanner:** `scripts/scan-retired-terms.ts` does not yet catch "Quote approvals", "Pending quote approval", "Book Ready Check", "Owner picking times", "Agreeing install date", "Expected install week", "deposit request", "instalment", "Offer Ready Check booking", "Arrange the visit", "first 24 hours… Suggest another time" on office screens.
