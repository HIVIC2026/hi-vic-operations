// Practice database (PGlite) proof for docs/pending-migrations/ai-answers-50-deposit.sql (Jo 5 Nov 2026: 50% deposit).
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const PLAN = "We don't offer a payment plan. Say so with empathy: we pay the installer, the electrician and the products as each step happens. The payments are already spread: $349 for the electrical safety check (PIESA), 10% to book the install, and the rest on install day. Their spot stays saved.";
const CARD = "They can pay by card for the $349 electrical safety check (PIESA) and the 10% deposit. The balance is by bank transfer or PayID.";
let db: PGlite;
const rows = async () => (await db.query<{ topic: string; answer: string }>("select topic, answer from ai_reply_answers order by sort")).rows;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE public.ai_reply_answers (id uuid primary key, topic text, answer text, active boolean, sort int, updated_at timestamptz, updated_by uuid);
    INSERT INTO public.ai_reply_answers VALUES ('442c3d48-7183-45f0-9c21-fa9d0f0368a3','Payment plan',$a$${PLAN}$a$,true,12,now(),null),
      ('0a245821-ca2c-48df-b8a7-3bdf6ba3f3c9','Paying by card',$a$${CARD}$a$,true,20,now(),null),
      ('11111111-1111-1111-1111-111111111111','Other','Interest is 10% a year.',true,30,now(),null);`);
});

describe("AI answers: 50% deposit", () => {
  test("only the two deposit answers change, and only 10% → 50%", async () => {
    await db.exec(read("ai-answers-50-deposit.sql"));
    expect(await rows()).toEqual([
      { topic: "Payment plan", answer: PLAN.replace("10% to book", "50% to book") },
      { topic: "Paying by card", answer: CARD.replace("the 10% deposit", "the 50% deposit") },
      { topic: "Other", answer: "Interest is 10% a year." },
    ]);
  });
  test("running twice is safe", async () => {
    await db.exec(read("ai-answers-50-deposit.sql"));
    await db.exec(read("ai-answers-50-deposit.sql"));
    expect((await rows())[0]!.answer).toContain("50% to book the install");
  });
  test("an edited row fails closed", async () => {
    await db.exec("update ai_reply_answers set answer='Something else, 10% to book' where sort=20");
    await expect(db.exec(read("ai-answers-50-deposit.sql"))).rejects.toThrow(/not both on 50%/);
  });
  test("rollback restores the 10% wording", async () => {
    await db.exec(read("ai-answers-50-deposit.sql"));
    await db.exec(read("ai-answers-50-deposit.rollback.sql"));
    expect((await rows()).map((r) => r.answer)).toEqual([PLAN, CARD, "Interest is 10% a year."]);
  });
});
