Feasibility only: Mitti-first installer jobs. Nothing will be built.

What Mitti's connection supports (tested read-only with our access tonight)
- Search: yes. Mitti can list forms changed after a date, with each form's ID, form type and last change. Filtering by form type works too: 31 installer-customer (A1) forms since 1 Oct. Searching by owner name or address is not supported as far as I can find, but the portal can open each form and read those.
- Who started it: each form records its Mitti owner and author (for example "Deep"). It gives a Mitti user ID, not an email. The portal would match that ID to a business; it already looks up Mitti user IDs by email when it assigns forms.
- Webhooks (Mitti telling the portal straight away): the webhooks address answered our check, so they appear to be available. I haven't set one up or tested one, so whether they work for new forms is unconfirmed. Checking every few minutes with search works today.

Checks that would be skipped or happen too late
- Owner permission: today it's ticked before anything exists. Mitti-first, the job only appears after the visit, so permission comes from a Mitti tick and is confirmed by the portal afterwards.
- Same owner or address already a lead or job (like HV-2303): this is already not checked today. Mitti-first, it could be flagged when the portal picks the form up, but the installer has already done the visit.
- Blocked or door-knocked leads: the portal can't warn the installer before the visit. It can only flag the job afterwards.
- Who does the electrical, and the owner fee-awareness tick: today these are asked in Add a job. Mitti-first, they'd have to be new Mitti questions; otherwise the quote stays held until the office collects them.
- Owner name, mobile, email and permission: the A1 form doesn't ask for mobile, email or permission now (1101 and 1158 tonight). Those would be new required Mitti questions.
- Wrong form (like 1256 on A2): can be spotted and sent to office review, but the installer's quote answers are missing from that form.

What would need building
1. Small: fix the owner-name box mismatch ("Homeowner name"). This is needed for either model.
2. Small: an office "Link existing Mitti form" action. This is needed for either model.
3. Medium: check Mitti every few minutes for new A1 forms with no Portal Job Number, plus a matching office review list for anything doubtful.
4. Medium: create the installer job from the form, write the HV number back into Mitti, and run the usual sync and quote draft.
5. Small to medium: flag a clash with an existing lead or job (flag only, never block).
6. Later, optional: switch to Mitti webhooks once tested.
Overall: medium to large.

New questions the A1 Mitti form would need
- Owner mobile.
- Owner email.
- Owner permission tick, with the exact approved wording.
- Who does the electrical (Home Insulation Victoria, or the owner's own electrician).
- Owner told about the fees (matching that electrician choice).

Recommendation: both, in this order.
- Keep portal-first as the normal path, because it runs the permission, electrician and fee checks before the visit. First fix the owner-name box so it works at all.
- Add "Link existing Mitti form" for jobs started in Mitti (like tonight's).
- Add Mitti-first pick-up only if installers keep starting in Mitti, and once the five new form questions are approved.
