# Jo's answers to the plan questions (2 Nov 2026, evening)
1. 10% deposit = 10% of the price after the $349 (portal's current method, e.g. $183.90 on $2,188). Fix the approved receipt sample (rec-dep.html) and Part 1 receipt test values to match.
2. Own customers: owner pays $349 PIESA; electrician is paid their own rate (e.g. $275); Home Insulation Victoria keeps the difference.
3. Booking order: installer CAN book the install before upgrades are done (warning, not a block); deposit taken later (replaces the current "deposit before booking" block for that case). Follow-up asked: deposit must be paid by when?
4. Trade drops a booked job ("Can't do this one"): email the owner straight away: "Your visit on {day} can't go ahead. We'll be in touch about a new day." (wording to Jo as a picture in Part 4/5 build).
5. Deposit must be paid before install day — checked at the 2pm GO check the day before (unpaid = DON'T START).
6. Tenant notice: Jo raised that ACCESS (who lets trades in at rentals) isn't covered anywhere — follow-up asked.
7. ACCESS at rentals (new, Jo approved): Ready Check asks "Do you live there or is it rented?" and, if rented, "Who'll let us in? (owner / tenant / property manager)" + name + mobile (Part 8 Mitti fields + Part 5 job page "Owner" row shows access person). The access person gets the PIESA + install "You're booked" and day-before texts (Part 4; trades call that person to arrange times, Part 6). Tenant gets the cl 23 notice by text + email automatically once the install day is booked: date, time, power off for the day, business name + office phone (Part 4, wording to Jo as picture, flag off). Owner still gets all job messages. Owner-occupied: unchanged.
8. Do not contact: office button on the job page AND an owner replying STOP to any text turns it on. Legal copies still go.
9. "Didn't comply" (cl 27) notice: Jo decides and sends, same day, from an office button on the job page.
10. Signed ESC consent copy: sent straight away when the owner signs, on its own (not held until a bank-transfer deposit lands).
11. "Book by" dates: PIESA 2 business days after acceptance (spec); Ready Check 5 business days after allocation; price 1 business day after Ready Check; install booked 1 business day after clear.
12. Manhole and Pets/access rows: LEAVE OUT of the job page (no new Ready Check questions).
13. 30-day red flag: email to installer office, copy to info@, plus a Needs me row for Jo.
14. (Decided from approved mock-up, not asked) Money screen: no "Download statement" button (mock-up has none).
15. Website consent line: use "I agree to Home Insulation Victoria and the EEC-certified installer it picks for me contacting me about my ceiling insulation." Tom changes the website homeowner form.
16. SWMS "Changes during the job": recorded by the Lead Installer in the Mitti install form; printed on the SWMS PDF.
17. Insurance/licence expiry reminders: installer's main business email, copy to info@.
18. End-to-end runs: Jo wants REAL runs with INSolation (installer) and Tom's Electrical (electrician), not TEST-only. Follow-up asked about the owner and ESC/Registry safety.
19. Real runs: owner = Jo or Tom (own email/mobile, real address); INSolation + Tom's Electrical; all texts/emails/Mitti forms real; card payments in Stripe test mode; ESC installation notice and VEEC/certificate creation STOPPED for these runs (a per-job "no ESC" marker that the notice robot, Registry submit and certificate creation all refuse).
20. Build method: checked step by step (subagent-driven: fresh builder per task + reviewer before the next).

## Later answers (2 Nov, ~20:20) — these SUPERSEDE answers 3, 5 and 7 where they differ
21. Deposit + booking (supersedes 3 and 5): the 10% deposit is paid on the ONE confirm-and-pay page (PIESA owner declarations + ESC consent + pay). That page opens straight after the PIESA result, INCLUDING when electrical upgrades are still to come. The install day can only be booked AFTER the deposit is paid (keep `installDepositBlocker`). Booking before the upgrades day = warning only. The GO check (2pm day before / 6:30am) still requires the Part C + Certificate of Electrical Safety when upgrades were needed. There is NO "deposit by 2pm the day before" rule and no "booked before deposit" messages (drop Part 4 Task 16's booked-already variant). The "electrical upgrades needed" owner message must also lead to the confirm-and-pay page (draft wording → Jo as picture).
22. Rentals/tenants (supersedes where 7 put the questions in the Ready Check): the OWNER answers in the QUICK TAPS after the "It's your turn" text (the one offering the Ready Check): "Do you live there or is it rented?"; if rented: tenant name, mobile and email, and who lets us in (owner / tenant / property manager + name + mobile). The Mitti Ready Check form does NOT ask these. Tenant always gets the notice by text and email.
23. Real runs: no trade pay (run stops before any installer/electrician pay is approved). Invoices go into Xero as normal, then are voided after the run.
24. Own customers' rental details: after the installer adds the job, the OWNER gets the same rental quick taps by text (rented? tenant name/mobile/email, who lets us in). Not on Add a job. (Part 3 T19 sender also fires for own customers on job creation; Part 10 notes it; the text needs Jo's wording OK, flag off.)
