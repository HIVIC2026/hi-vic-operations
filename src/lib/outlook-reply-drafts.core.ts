// Decision 244 switches for the Outlook reply DRAFTER (email-reply.core / email-reply.server). Kept in their own
// import-free module so the Outlook copier (and its test harness) can check them without loading the drafter.
/** Master switch (code constant): OFF. Drafts only — this build never sends anything. */
export const EMAIL_REPLY_DRAFTS_ENABLED: boolean = false;
/** TEST mode: only mail from the allow-list, and only qa_test jobs / TEST partners, ever get a draft. */
export const EMAIL_REPLY_DRAFTS_TEST_ONLY: boolean = true;
export const REPLY_TEST_ALLOWLIST: readonly string[] = ["jolowexo@hotmail.com"];
