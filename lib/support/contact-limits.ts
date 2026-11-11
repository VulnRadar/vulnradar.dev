import { CONFIG_CONTACT_MESSAGE_MAX_LENGTH } from "@/lib/config/config-values";

/**
 * Length limits on the public contact form, shared by the route that enforces
 * them and the form that shows them, so the counter and maxLength on the page
 * cannot drift from what the server refuses. Client-safe.
 *
 * The message limit is the admin setting CONTACT_MESSAGE_MAX_LENGTH; the
 * value here is only its default, for a form that was not handed the live one.
 */
export const CONTACT_NAME_MAX = 120;
export const CONTACT_SUBJECT_MAX = 160;
export const CONTACT_MESSAGE_MAX_DEFAULT = CONFIG_CONTACT_MESSAGE_MAX_LENGTH;

export interface ContactLimits {
  name: number;
  subject: number;
  message: number;
}

export const DEFAULT_CONTACT_LIMITS: ContactLimits = {
  name: CONTACT_NAME_MAX,
  subject: CONTACT_SUBJECT_MAX,
  message: CONTACT_MESSAGE_MAX_DEFAULT,
};
