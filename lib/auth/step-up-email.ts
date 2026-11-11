import { APP_NAME } from "@/lib/config/constants";
import {
  emailCodeBlock,
  emailHeading,
  emailLead,
  emailNote,
} from "@/lib/email/layout";
import { pluralize } from "@/lib/ui/plural";

/**
 * The two codes mailed to someone who is already signed in: the step-up a
 * password-less account enters before a security change, and the
 * confirmation that proves the inbox works before email codes are turned on.
 *
 * Not the sign-in code template. That one tells the reader "if you didn't try
 * to sign in, change your password", which is the wrong advice for both: the
 * reader is signed in, and a password-less account has no password to change.
 * If someone else asked for one of these, they already hold a session, so the
 * advice is to end every session.
 */
export type SignedInCodePurpose = "reauth" | "setup";

const COPY: Record<
  SignedInCodePurpose,
  { subject: string; heading: string; lead: string; ask: string }
> = {
  reauth: {
    subject: `Your ${APP_NAME} confirmation code`,
    heading: "Confirm it is you",
    lead: "Enter this code to confirm it is you before changing a security setting.",
    ask: "you didn't ask to change a security setting",
  },
  setup: {
    subject: `Turn on ${APP_NAME} email codes`,
    heading: "Turn on email codes",
    lead: "Enter this code to turn on sign-in codes by email. It proves this address gets our mail before your account depends on it.",
    ask: "you didn't ask to turn on email codes",
  },
};

export function signedInCodeEmail(
  purpose: SignedInCodePurpose,
  code: string,
  expiryMinutes: number,
) {
  const copy = COPY[purpose];
  const window = pluralize(expiryMinutes, "minute");
  const warning = `If ${copy.ask}, someone else may be signed in to your account: sign out every session from the Security tab of your profile.`;
  return {
    template: purpose === "reauth" ? "stepUpCode" : "emailCodesSetupCode",
    preheader: `The code expires in ${window}. We will never ask you to share it.`,
    // Never the code itself: a subject shows on the lock screen and in search.
    subject: copy.subject,
    text: `${copy.lead}\n\nYour code is ${code}. It expires in ${window}.\n\nDon't share this code with anyone. ${APP_NAME} will never ask you for it. ${warning}`,
    html: `
      ${emailHeading(copy.heading)}
      ${emailLead(copy.lead)}
      ${emailCodeBlock(code)}
      ${emailNote(
        `The code expires in ${window}. Don't share it with anyone; ${APP_NAME} will never ask you for it. ${warning}`,
        "warn",
      )}
    `,
  };
}
