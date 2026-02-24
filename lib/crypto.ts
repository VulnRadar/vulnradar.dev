import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // 96-bit IV for GCM
const TAG_LENGTH = 16 // 128-bit auth tag

/**
 * Get the AES-256 encryption key from environment.
 * Must be a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return Buffer.from(hex, "hex")
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a combined string: base64(iv + ciphertext + authTag)
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])

  const tag = cipher.getAuthTag()

  // Combine: iv (12) + encrypted (variable) + tag (16)
  const combined = Buffer.concat([iv, encrypted, tag])
  return combined.toString("base64")
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects the format from encryptApiKey: base64(iv + ciphertext + authTag)
 */
export function decryptApiKey(encryptedBase64: string): string {
  const key = getEncryptionKey()
  const combined = Buffer.from(encryptedBase64, "base64")

  const iv = combined.subarray(0, IV_LENGTH)
  const tag = combined.subarray(combined.length - TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}

/**
 * Check if an encryption key is configured.
 * Returns false if not set, allowing graceful fallback.
 */
export function isEncryptionConfigured(): boolean {
  const hex = process.env.API_KEY_ENCRYPTION_KEY
  return !!hex && hex.length === 64
}
