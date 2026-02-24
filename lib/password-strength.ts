// Common passwords list (top ~120 most common passwords and variations)
const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "abc123", "monkey", "1234567",
  "letmein", "trustno1", "dragon", "baseball", "iloveyou", "master", "sunshine",
  "ashley", "bailey", "shadow", "123123", "654321", "superman", "qazwsx",
  "michael", "football", "password1", "password123", "welcome", "welcome1",
  "p@ssword", "p@ssw0rd", "passw0rd", "admin", "admin123", "root", "toor",
  "login", "access", "master", "hello", "charlie", "donald", "qwerty123",
  "654321", "555555", "lovely", "7777777", "888888", "princess", "dragon",
  "password1!", "changeme", "test123", "guest", "default", "letmein1",
  "1234567890", "123456789", "1234", "12345", "11111", "00000", "121212",
  "qwertyuiop", "asdfghjkl", "zxcvbnm", "1q2w3e4r", "1qaz2wsx",
  "abcdef", "abcdefg", "abcdefgh", "secret", "password2", "password12",
  "starwars", "whatever", "trustno1", "computer", "jessica", "pepper",
  "ginger", "killer", "summer", "internet", "service", "canada", "hello1",
  "freedom", "thunder", "jordan", "samsung", "google", "pokemon", "hunter",
  "ranger", "buster", "soccer", "hockey", "george", "andrew", "harley",
  "matrix", "yankees", "dallas", "austin", "banana", "jennifer", "andrea",
  "joshua", "daniel", "robert", "thomas", "batman", "corvette", "merlin",
])

/**
 * Check if a string has 3+ sequential characters (abc, 123, cba, 321)
 */
function hasSequentialChars(pw: string): boolean {
  const lower = pw.toLowerCase()
  for (let i = 0; i < lower.length - 2; i++) {
    const a = lower.charCodeAt(i)
    const b = lower.charCodeAt(i + 1)
    const c = lower.charCodeAt(i + 2)
    // ascending: abc, 123
    if (b === a + 1 && c === a + 2) return true
    // descending: cba, 321
    if (b === a - 1 && c === a - 2) return true
  }
  return false
}

/**
 * Check if a string has 3+ repeated characters (aaa, 111)
 */
function hasRepeatedChars(pw: string): boolean {
  for (let i = 0; i < pw.length - 2; i++) {
    if (pw[i] === pw[i + 1] && pw[i] === pw[i + 2]) return true
  }
  return false
}

export interface PasswordStrength {
  level: number
  label: string
  color: string
}

/**
 * Calculate password strength with strict scoring.
 *
 * Scoring:
 *   +1 for length >= 8
 *   +1 for length >= 12
 *   +1 for length >= 16
 *   +1 for mixed case (a-z AND A-Z)
 *   +1 for digits
 *   +1 for special characters
 *   -3 if matches common password dictionary
 *   -1 if has 3+ repeated chars (aaa) or sequential (abc, 123)
 *
 * Levels:
 *   0-1 = Weak, 2-3 = Fair, 4 = Strong, 5+ = Very Strong
 */
export function getPasswordStrength(pw: string): PasswordStrength {
  if (!pw) return { level: 0, label: "", color: "" }

  let score = 0

  // Length bonuses
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++

  // Character class bonuses
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++

  // Penalties
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) score -= 3
  if (hasRepeatedChars(pw) || hasSequentialChars(pw)) score--

  // Clamp to 0 minimum
  score = Math.max(0, score)

  if (score <= 1) return { level: 1, label: "Weak", color: "bg-[hsl(var(--severity-critical))]" }
  if (score <= 3) return { level: 2, label: "Fair", color: "bg-[hsl(var(--severity-high))]" }
  if (score === 4) return { level: 3, label: "Strong", color: "bg-primary" }
  return { level: 4, label: "Very Strong", color: "bg-emerald-500" }
}
