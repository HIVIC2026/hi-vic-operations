-- Run with psql -v ON_ERROR_STOP=1
-- DO NOT RUN until Part 3 renders the agreement through fillAgreement/parseAgreement — the owner My job quote page (src/routes/my-job.$token.tsx ~510 via owner-link.functions.ts:73), portal assignment.tsx:115 and the flag-off signed acceptance (assignment.server.ts ~369) print the stored body raw.
-- customer-agreement-v1-3.sql (2 Nov 2026): loads Customer Agreement v1.3 as the approved, active customer_agreement wording.
-- Source: docs/approved-samples/2026-11-02/agreement-web.html and customer-agreement-v1.3-final.pdf.
-- Later versions go through the Settings path (add version, approve), no code change.
-- Idempotent; one transaction. Proven on PGlite: tests/customer-agreement-template-db.test.ts.
-- ROLLBACK: customer-agreement-v1-3.rollback.sql. NEVER run live without Jo's go-ahead.
BEGIN;

-- One active customer_agreement at a time (compliance_templates_one_active): retire any older active wording first, keep the row.
UPDATE public.compliance_templates
   SET is_active = false
 WHERE template_key = 'customer_agreement' AND is_active AND version <> '1.3';

INSERT INTO public.compliance_templates (template_key, version, body, approved, approved_by, approved_at, is_active, source_note)
VALUES ('customer_agreement', '1.3', $body$# CUSTOMER AGREEMENT | Your ceiling insulation upgrade
This is our agreement with you for job {job_number}. Please read it. Take your time and ask us anything.
> You | {owner_name}\n{address}
> Us | Home Insulation Victoria\ninfo@homeinsulationvictoria.com.au
> Your installer | {installer_name}\n{installer_phone}\n{installer_email}\nDoes the work for us
## 1 What we'll do
- Install {product} across {area_m2} m² of your ceiling, as in your quote.
- Remove your old insulation, if your quote says so.
- Take away all removed insulation and rubbish.
- Arrange an electrical safety check (PIESA) by a licensed electrician before the install.
- Create the rebate certificates for your job and take the rebate off your price.
## 2 What's not included
Electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK. You pay the electrician, not us.
## 3 When things happen
- Electrical safety check (PIESA): your installer calls you to book it within 2 business days of you accepting.
- Electrical upgrades (only if needed): booked directly with your electrician.
- Install: booked once your deposit is paid, and done within 30 days of the electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.
We confirm every visit by email and text. If a visit can't go ahead as booked, we'll tell you as soon as we can.
The 30-day rule: the rebate rules say your insulation must be installed within 30 days of the electrical safety check (PIESA). If it isn't, the check has to be done again. Whoever caused the delay pays for the new check: you, if the delay was yours, or your installer, if it was theirs. If it was both, or nobody's fault, we'll decide fairly and tell you why.
## 4 Your price
$ Price before rebate | {price_before_rebate}
$ Rebate | – {rebate}
$ Your price (incl. GST) | {your_price}
How and when you pay is in your payment terms (attached). In short: $349 now for the electrical safety check (PIESA), 10% to book your install day, and the rest on install day. There are no other fees.
Once your install is done, the rebate rules say you must have paid at least $200 (incl. GST). None of that $200 can be given back to you in any way.
Your quote is valid for 30 days, until {valid_until}.
Cooling-off: no cooling-off period applies. You asked for a quote and accepted it online in your own time.
## 5 What we need from you
- Clear access to your switchboard and ceiling hatch.
- Someone 18 or over at home for each visit.
- Pets kept away, and the power off while they work in the ceiling.
- Sign your rebate form on install day. This hands the rebate certificates to us so we can take the rebate off your price.
If your home isn't eligible: if we find your home can't get the rebate (for example, downlights that can't be covered), we'll cancel your job and you won't owe anything more. If your electrical safety check (PIESA) has already been done, the $349 isn't refunded.
## 6 Warranties
- The insulation: covered by the manufacturer's warranty for at least 5 years. We send you a copy after your install.
- The workmanship: your installer fixes any fault in their work for 1 year from your install day.
- Your rights under the Australian Consumer Law always apply.
## 7 If something's not right
Reply to any of our emails or write to info@homeinsulationvictoria.com.au. We'll reply within 5 business days and aim to sort it within 20 business days. If it's still not sorted, you can contact the Essential Services Commission (esc.vic.gov.au) or Consumer Affairs Victoria.
If we find out later that something about your install doesn't meet the rebate rules, we'll tell you straight away and fix it.
## 8 Changing or cancelling
To change a visit time, call your installer on their office number. To cancel, reply to any of our emails or write to info@homeinsulationvictoria.com.au.
- $349 electrical safety check: refunded if you cancel before the check is done. Not refunded once it's done.
- 10% deposit: refunded if you cancel at least 2 business days before your install day. Not refunded after that.
## 9 Your information
To run the rebate program, we share your details and job information with the Essential Services Commission, which may share them with WorkSafe and Energy Safe Victoria. You'll sign a separate consent form for this before your install.
## 10 Your documents
- Now: this agreement, your payment terms and your Statement of rights under the Victorian Energy Upgrades program.
- Before your install: a copy of your electrical safety check, the consent form and the Victorian Energy Upgrades consumer factsheet.
- After your install: your tax invoice, rebate form, product warranty and the manufacturer's instructions.
We send everything by email.
Version {version}
---
# PAYMENT TERMS | How you pay
Job {job_number} · {owner_name} · {address}
$ 1. When you accept your quote\nElectrical safety check (PIESA) | {safety_check}
$ 2. Once you're clear to install\n10% deposit to book your install day | {deposit}
$ 3. On install day\nThe rest | {rest}
$ Your price (incl. GST) | {your_price}
## ✓ How to pay
By card or bank transfer. No fees. Each payment has its own link in our email, and we email you a receipt each time.
## ! If your balance isn't paid
We'll remind you 1, 3 and 7 days after install day. After 7 days, your balance is overdue and we may pass it to a debt collector.
If your balance is overdue, we charge interest at the Victorian penalty interest rate (currently 10% a year), worked out daily from the day it becomes overdue until it's paid. We don't charge collection costs. If we have to take you to court or VCAT to recover an overdue balance, you may have to pay the legal costs the court or VCAT orders.
## ⚡ Electrical upgrades
If you need electrical upgrades, you pay your electrician directly. They're not part of our price.
## ↩ Refunds
- $349: refunded if you cancel before your electrical safety check is done.
- Deposit: refunded if you cancel at least 2 business days before your install day.
$body$, true, '950fa0b6-dc44-49af-a754-6a65f26a661e'::uuid, '2026-11-02', true, 'Approved 2 Nov 2026 (customer-agreement-v1.3-final.pdf)')
ON CONFLICT (template_key, version) DO NOTHING;

-- Fail closed: if v1.3 already existed in another state, DO NOTHING would leave it unused; abort the whole transaction.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.compliance_templates
                  WHERE template_key = 'customer_agreement' AND version = '1.3' AND approved AND is_active) THEN
    RAISE EXCEPTION 'customer_agreement v1.3 is not approved and active; nothing changed';
  END IF;
END
$check$;
COMMIT;
