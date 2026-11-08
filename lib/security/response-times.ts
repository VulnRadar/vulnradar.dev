/**
 * How long a security report waits for its first human answer.
 *
 * One number on purpose: the contact form said 24 hours, SECURITY.md and
 * /security said 48, and the confirmation mail said "24 to 48", three
 * commitments for one event. 48 is the value in SECURITY.md, the document a
 * researcher actually reads before reporting.
 */
export const SECURITY_ACK_HOURS = 48;
