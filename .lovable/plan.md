# Exact launch plan — go live Monday 5 October

## First, breathe: the enquiries are safe

Every enquiry coming in is being captured and stored in the portal with all its answers, consent and photos. Nothing is lost, nothing is auto-emailed, nothing progresses on its own. They are queued and waiting for you — the risk is delay, not data loss. The plan below gets you processing them live on Monday.

## The plan, day by day

### Today (Thursday) — forms and decisions
1. You paste **Mitti_template_briefs_v5_A1.md** into Mitti's AI builder, eyeball it against the brief, send me the template ID. I connect and test the sync.
2. I build the **A2 brief** (our leads — same questions, no pricing) with the downlight Yes=red / No=green colours, and regenerate A1 (v6) with the same colours.
3. You give me the test team's names/emails (installer, electrician, owner) so I can set up the four real test logins.
4. You answer the three open decisions: (a) hazard photo per area or one description, (b) is "Not sure" allowed on remove/top-up, (c) $220 lead fee inc or ex GST.

### Friday — finish the machine
5. Forms B (PIESA) and C (PIISA) briefs rebuilt the same way as A1; you build them in Mitti; I connect all four IDs.
6. Shared gate timeline for installers/electricians with the 30-day PIESA countdown (already partly built — finished here).
7. Invoice preflight reconciled line-by-line against what Xero will receive; you approve the invoice design on screen. No Xero write yet.
8. Communications test mode: every message the portal would send gets redirected to the test team, so we prove wording and timing without touching a real customer.

### Saturday — full dress rehearsal
9. Run two complete dummy journeys start to finish with the real test logins: one installer-brings-customer job, one our-lead job — enquiry → Gate 1 → Ready Check → PIESA → quote → acceptance → invoice preview → deposit gate → install → PIISA → evidence → VEEC.
10. Every wrong stage, missing notification or confusing screen found gets fixed same day.

### Sunday — final checks
11. Regression run: all tests, build, security, mobile screens, failure cases (expired links, double-clicks, wrong role).
12. You review the launch evidence report and give the explicit go.

### Monday — launch
13. I switch on live communications and external sends (currently locked).
14. You action the first controlled Xero invoice yourself; we reconcile it together.
15. The enquiry backlog is worked through the pipeline — oldest first — with the To action tab driving the team.

## Go / no-go gates (all must be green Monday)
- Four role logins work; both dummy journeys pass end to end
- Mitti forms connected and syncing into the portal and official PDFs
- Messages reach the test team correctly; failures show in To action
- Invoice totals and design approved by you; deposit/scheduling gates cannot be bypassed
- No stage/action mismatches; no build or security errors

If any gate is red, we do a controlled pilot (a handful of real jobs, watched closely) instead of a full switch-on — never an unsafe launch.

## What I need from you
1. Mitti template IDs as you build each form (A1 first)
2. Test team names + emails
3. The three decisions in item 4 above
4. Monday: your explicit "go" before anything sends to real customers

## Technical details
- No changes to locked Step 1 (Base44 handoff) or Gate 1 rules
- Communications/external writes stay fail-closed until your explicit Monday approval
- Test jobs stay flagged `qa_test`, excluded from live totals and automation
- Forms work: `src/lib/mitti-forms.core.ts` spec + briefs generated from it so labels cannot drift; `validateTemplate` refuses drifted Mitti forms
