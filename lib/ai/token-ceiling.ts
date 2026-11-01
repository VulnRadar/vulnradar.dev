/**
 * The most a metered AI call can cost, counted before it is made.
 *
 * Verification and repo review are admitted call by call against what the
 * route reserved, and a call admitted below its real cost spends past the
 * reservation: the settle can only charge the overrun afterwards, with a floor
 * at zero. Most of what those prompts carry is chosen by someone else (the
 * scanned page, the repository), so the count has to hold for the densest text
 * they could send, not for typical English. A character-per-token ratio does
 * not: emoji, CJK text and symbol-heavy code all tokenise near or below one
 * character per token.
 *
 * One token per UTF-8 byte does hold. A byte-level BPE tokenizer cannot emit
 * more tokens than the bytes it was given, and a SentencePiece one with byte
 * fallback cannot either, so no provider bills more input than this for the
 * same text. ASCII counts at one token per character, which is also the bound
 * for symbol-heavy code.
 */

/**
 * Per-call allowance for what the provider adds around the messages: role
 * markers, the chat template, the reply primer. Tens of tokens on every API
 * this app speaks; counted generously because it is small next to a prompt.
 */
export const CALL_FRAMING_TOKENS = 64;

/** The most input tokens `text` can be billed as. */
export function maxInputTokens(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
