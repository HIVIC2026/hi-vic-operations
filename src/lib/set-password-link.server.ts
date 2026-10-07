// One way to issue a set-password link. generateLink never emails; we build our own link to /reset-password.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { SET_PASSWORD_BASE, setPasswordLink } from "./set-password-link.core";

export async function issueSetPasswordLink(email: string, base = SET_PASSWORD_BASE): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data.properties?.hashed_token) throw new WorkflowError(`The set-password link failed: ${error?.message ?? "no token"}`);
  return setPasswordLink(data.properties.hashed_token, "/field/welcome", base);
}
