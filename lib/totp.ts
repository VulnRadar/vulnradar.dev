import { createHmac, randomBytes } from "node:crypto"

// Generate a random base32 secret
export function generateSecret(): string {
  const bytes = randomBytes(20)
  return base32Encode(bytes)
}


// Verify a TOTP code (checks current and +/- 1 window)
export function verifyTOTP(secret: string, token: string, timeStep = 30, window = 1): boolean {
  const time = Math.floor(Date.now() / 1000 / timeStep)
  for (let i = -window; i <= window; i++) {
    const code = hotpGenerate(secret, time + i)
    if (code === token) return true
  }
  return false
}

// Generate the otpauth:// URI for QR code generation
export function generateOtpAuthUri(secret: string, email: string, issuer = "VulnRadar"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

// HOTP implementation
function hotpGenerate(secret: string, counter: number): string {
  const decodedSecret = base32Decode(secret)
  const buffer = Buffer.alloc(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    buffer[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }

  const hmac = createHmac("sha1", decodedSecret)
  hmac.update(buffer)
  const hmacResult = hmac.digest()

  const offset = hmacResult[hmacResult.length - 1] & 0x0f
  const code =
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)

  return (code % 1000000).toString().padStart(6, "0")
}

// Base32 encoding/decoding
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ""
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(input: string): Buffer {
  const cleanInput = input.replace(/=+$/, "").toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const c of cleanInput) {
    const idx = BASE32_CHARS.indexOf(c)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}