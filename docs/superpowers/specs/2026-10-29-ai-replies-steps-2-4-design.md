# AI replies, steps 2–4 — design

From Jo's grilling session, 29 Oct 2026 (decisions Q6–Q30, samples 1–26). Step 1 (redo blocked drafts) is its own spec: `2026-10-29-ai-reply-redo-blocked-drafts-design.md`. Build order: 1 → 2 → 3 → 4.

Applies to AI replies on **jobs** (job page + Emails tab job cards). No-job replies, automatic emails, texts and My job pages are unchanged unless stated.

---

## Step 2 — answer more questions

### 2a. Standard answers list (Q6)
- New office-only **AI answers** page, opened from a button on the Emails tab: a list of topic + answer, Jo adds/edits/removes from her phone. Stored in a new table `ai_reply_answers` (id, topic, answer, active, updated_at, updated_by). Every AI draft gets the active list as its business rules — changes apply to the next draft, no merge needed.
- Seeded with today's `AI_BUSINESS_RULES` (with the changes below) plus the new answers in 2c.

### 2b. Unknown questions (Q7)
- When a question isn't covered, the AI writes the rest of the reply and marks it (`NEEDS_JO: <the question>`); the draft shows **"Needs your answer: <question>"** and is never auto-sent.
- After Jo writes the answer and sends, the card offers **"Save as a standard answer"** (prefilled topic + her wording, editable) → added to the list.

### 2c. Answers and rules (all from Jo)
| # | Topic | Answer |
|---|---|---|
| Q8 | Payment plan | No payment plan, said with empathy: we pay the installer, electrician and products as each step happens. Payments are spread: $349 electrical safety check (PIESA), 10% to book install, rest on install day. Spot stays saved. |
| Q9 | Low income / concession | Very warm. Sorry it's hard; the rebate is the same for every home and is the biggest help we can give; no extra discount, no need to send the card; spot stays saved; no pressure. |
| Q10 | Too expensive / cheaper quote / "scam" | Explain the value and why others are cheaper: electrical safety check (PIESA) for wiring/downlight fire risk, CII-certified installers and REC electricians with licences and $5m insurance checked, approved product to the Australian standard, Accredited Person handles evidence and rebate claim upfront. Cheaper quotes often skip the PIESA, use uncertified workers, or can't give the rebate. Welcome to compare; no obligation. Never name the program (no "Victorian Energy Upgrades"); "Accredited Person" is fine. (Samples 3, 15.) |
| Q11 | Existing electrical certificate | Can't be used. Government rebate rules: the PIESA must be by an electrician working under a REC, whose $5m insurance we approve, within 30 days of the install. |
| — | Own electrician for electrical upgrades | Allowed if they show REC + $5m insurance (we approve), do the work and get the COES and our forms back before the 30 days run out; otherwise a new PIESA ($349) is needed. Sign-up link. (Sample 14.) |
| Q12 | Garage, flat roof, cathedral ceiling, no manhole | Kindly: we can't do these. |
| Q19 | R6.0 / R7.0 | Give the revised price and rebate for their size from the price list (`OWNER_HIGHER_R_INC_PER_M2`: R6 $33, R7 $35/m²) and say to tell the installer at the free Ready Check. Replaces "never quote R6/R7". |
| Q22 | Underfloor / walls | We only do ceilings; the installer can quote underfloor directly at the Ready Check, outside our system. |
| Q23 | Cancel / not going ahead | Short kind reply: closed, reply if you change your mind. (A plain "thanks" still gets no reply.) |
| Q25 | Rental / landlord | Rentals qualify; same steps and rebate. |
| Q26 | Paying by card | Card for the $349 and the 10% deposit; balance by bank transfer or PayID. |
| Q27 | Home on install day | No one needs to be home if the crew can get in. About 4 hours. |
| Q29 | Other languages | Reply in simple English. |
| Q30 | Tenant | Happy to help, but the owner needs to give permission. |
| — | Installer access | Batts go in through the manhole; no roof access needed. |

Standing wording rules (every reply):
- First mention is **"electrical safety check (PIESA)"**. Anything required is **"the government's rebate rules"**, never "our rule".
- "Electrical upgrades", never "fixes". "Rebate", no scheme words.

### 2d. Before release (Q18, Q21)
- AI replies may explain what release means: *"When your spot is released, it's your turn: an installer will text and email you some times for your free Ready Check."* No timing promises (see step 1 spec).
- Jo's **wait line** (whenever timing is asked): *"We're bringing on more and more certified installers, but demand is high and there aren't enough of them yet. So we're booking people in the order they saved their spot, as quickly as we can bring on more CII-certified installers. We can't give a date yet, but we'll be in touch as soon as your spot is released."*

### 2e. Actions on Send (Q20, Q24)
- The AI may propose job changes alongside the draft, shown under it before Send:
  - **Note for the installer** (e.g. "Owner wants R7.0 (asked by email 29 Oct)") — saved on the job when Jo sends; shown on the installer's job page and added to the installer's Ready Check text.
  - **New ceiling size** given by the owner — the reply uses the price for that size; the job's `estimated_area_m2` is updated when Jo sends.
- Jo can untick either before Send. Nothing changes if she doesn't send.

### 2f. Complaints after install (Q28)
- Holding reply (sorry, we're looking into it with the installer), marked **"Needs you"**, never auto-sent.

---

## Step 3 — sound like Jo, smarter (Q13, Q13b, Q14)
- Each draft includes up to 8 recent replies Jo sent from the portal (sent AI drafts she edited, and her own replies), picked for similar topics, as **style examples only** — the prompt says never copy facts, prices or promises from them.
- Uses her latest sent replies every time (keeps learning).
- Length: a bit more detail — answer each question and explain the why when it helps. Short sentences, warm, the occasional ":)".
- Uses all job facts: their size, price, rebate, stage, what's paid, next step, and their earlier emails.

---

## Step 4 — send simple ones itself (Q15, Q16, Q17)
- Auto-send only for: **where's my job up to**, **resend a link**, **photos/files received** (samples 17–19). Plain "thanks" stays no reply. Everything else, anything marked "Needs your answer"/"Needs you", and any draft with a rule problem stays a draft.
- Off until Jo switches it on: the **AI answers** page shows 10 recent drafts of those kinds as samples, then a **"Turn on auto-send"** button (replaces `AI_EMAIL_AUTO_SEND_ENABLED` constant with a setting).
- Automatic sends keep the 8pm–7am quiet hours (held to 7am).
- Each auto-sent reply is saved on its job (marked "Sent by AI") and counted in the 6am report.

---

## Samples (acceptance examples)
Samples 1–26 agreed with Jo on 29 Oct 2026 (in the chat) are the target outputs. Plan tasks turn the key ones into prompt tests: payment plan, low income, cheaper quote, R7 + size (Mohamed), wait time, haven't heard back, electrical upgrades / own electrician, scam, cancel, tenant.

## Testing
- Unit: answers list → prompt; `NEEDS_JO` parsing; action proposals parsed and applied only on Send; auto-send eligibility; quiet hours; AI pre-release check (timing only).
- Live sample run on TEST jobs with the samples' emails; Jo approves before step 4 is switched on.
