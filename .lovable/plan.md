# A3/A4 Part 3 wording in the Mitti rebuild — check and safest order

## What I found
- The Part 3 branch and `docs/MITTI_PART3_EDIT_PROMPT.md` are not in this project, so I can't confirm the exact text in that file. The wording below comes from your message.
- The live portal reads only the OLD A3/A4 wording. Nothing in it reads "Are electrical upgrades needed?", "Are you doing the electrical upgrades today?" or "Do you have the Certificate of Electrical Safety now?"

## 1. What breaks on the live portal if A3/A4 go to Mitti now
- **Whether electrical upgrades are needed is lost.** The portal can't read the answer, so the official safety check result can't be worked out. Each new A3/A4 waits for the office.
- **Same-visit upgrades are lost.** The portal can't tell that the electrician did the work today, so the job doesn't move on.
- **Certificate.** The portal still needs the Q45 file before it counts the safety check as complete. Now Q45 only shows when "Certificate now?" = Yes. So when the electrician says No, the job stays held, and the "add it later" link doesn't exist yet (that's Part 3).
- **Price removed.** The electrician's total price (incl GST) is gone, so the owner's electrical upgrades quote falls back to the old rate-card way or is held for the office.
- **No harm:** deleting the "I will not discuss any prices…" checkbox. Forms without it are already accepted.
- **Form check:** the office form-health check will say A3/A4 are "missing questions" until Part 3 is in.
- A1, A2 and A5 are not affected.

## 2. Safest order (recommended)
1. **Send A1, A2 and A5 to Mitti now. Keep A3 and A4 on today's wording.**
2. Bring Part 3 into the live portal so it reads the new AND old A3/A4 wording. You'll need to share the branch or say "rebuild it", since you asked me to leave Part 3 alone.
3. Prove it on practice forms. Then send the A3/A4 changes below to Mitti.
4. After Mitti publishes, read A3/A4 back and check each question matches.

The other way round (A3/A4 to Mitti first) would hold every new safety check until Part 3 is live.

## 3. Exact A3 and A4 wording to send (when step 3 is reached)

```text
A3 – PIESA – Electrician safety assessment
- Change "Is any electrical repair work needed before insulation can be installed?"
  to: "Are electrical upgrades needed?"
- Change "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?"
  to: "Are you doing the electrical upgrades today?"
- Add (Yes / No, Required): "Do you have the Certificate of Electrical Safety now?"
  Help text: "No? We'll text you a link to add it later."
- Certificate number, certificate date and the Q45 certificate photo/PDF:
  show ONLY when "Do you have the Certificate of Electrical Safety now?" = Yes.
- Delete: "Your total price for all the repair work, including GST"
- Delete: the checkbox "I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices."

A4 – Electrical upgrades
- After Q10, add (Yes / No, Required): "Do you have the Certificate of Electrical Safety now?"
  Help text: "No? We'll text you a link to add it later."
- Certificate number, certificate date and certificate photo/PDF:
  show ONLY when "Do you have the Certificate of Electrical Safety now?" = Yes.
```

## Questions for Jo
- Part 3 code: (a) share the branch / project copy, (b) rebuild it, or (c) keep A3/A4 out of Mitti for now.
- Should the A4 certificate question also have the help text "No? We'll text you a link to add it later."? Your message gave it for A3 only. I've included it above. Say if it should come out.

No Mitti templates changed. Nothing built, sent or published.
