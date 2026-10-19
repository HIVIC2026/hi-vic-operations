import { simpleEmail } from "./simple-email.core";

export const OWNER_CODE_PURPOSE = "owner_verification_code";

export function ownerCodeSmsBody(code: string) {
  return `Your signing code is ${code}. It expires in 10 minutes. If you did not request this, ignore this text.`;
}

export function ownerCodeEmail(code: string) {
  return simpleEmail("Your signing code", [
    `Your Home Insulation Victoria signing code is ${code}.`,
    "It expires in 10 minutes. If you did not request this, you can ignore this email.",
  ], undefined, { testLabel: false });
}

export function ownerCodeDeliveryKey(codeId: string) {
  return `owner-code-${codeId}`;
}
